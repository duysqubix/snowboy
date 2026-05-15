/**
 * Credential store layered on top of Electron's `safeStorage`.
 *
 * Design notes:
 * - Pure module with plain function exports. No DI framework. Test helpers
 *   (`__set*ForTesting`) inject a deterministic mock so unit tests can run
 *   under `bun test` without dragging in the Electron binary.
 * - Secrets are persisted as a single JSON snapshot at
 *   `<userData>/secrets.json` with shape `{ version: 1, entries: { [k]: b64 } }`
 *   where each `b64` is `Buffer.from(safeStorage.encryptString(plain)).toString('base64')`.
 * - The on-disk snapshot is loaded lazily on the first call to any method.
 *   Subsequent calls reuse the in-memory copy. Writes use a tmp-then-rename
 *   pattern for atomicity.
 * - Concurrent `setSecret`/`deleteSecret` calls are serialized through a
 *   process-local promise chain (the "write mutex") so interleaved renames
 *   cannot lose data.
 * - On Linux without a real keyring (`getSelectedStorageBackend() === 'basic_text'`)
 *   we emit a single console warning per process lifetime. macOS Keychain and
 *   Windows DPAPI are unconditionally `os-keychain`.
 *
 * T1.2 only delivers the module + tests. Wiring into IPC handlers lives in
 * T1.1 (handler scaffolds reference these exports) and Wave 3 finalizes the
 * connection-profile flow that actually writes credentials.
 */

import type { SafeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Coarse classification of the encryption backend currently protecting secrets.
 *
 * - `os-keychain`: encryption is anchored in an OS-managed keyring (macOS
 *   Keychain, Windows DPAPI, or a libsecret/kwallet provider on Linux).
 * - `basic-fallback`: Linux-only fallback. Electron derives a process-scoped
 *   key without any keyring. Functional but losing that key means losing
 *   every secret, and at-rest protection is weak — callers should warn the
 *   user.
 * - `unavailable`: encryption is not ready (e.g. `app` has not emitted
 *   `ready` yet, or no backend was selected). Callers should refuse to
 *   persist new secrets while in this state.
 */
export type EncryptionBackend = 'os-keychain' | 'basic-fallback' | 'unavailable';

type LinuxBackend = ReturnType<SafeStorage['getSelectedStorageBackend']>;

/**
 * Minimal structural slice of Electron's `safeStorage` we actually consume.
 * Defined locally so tests can satisfy it with a plain object literal without
 * importing Electron. Electron's `SafeStorage` matches it structurally.
 */
export interface SafeStorageImpl {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  getSelectedStorageBackend(): LinuxBackend;
}

interface SnapshotShape {
  version: 1;
  entries: Record<string, string>;
}

const SNAPSHOT_FILE_VERSION = 1 as const;
const WARNING_MESSAGE =
  '[secrets] WARNING: OS keyring unavailable; secrets are encrypted with a session-only key. ' +
  'Install gnome-keyring or kwallet for proper protection.';

// CommonJS-style require so we can pull `electron.safeStorage` and
// `electron.app` synchronously from the main process. Inside a packaged
// Electron app this returns the live Electron namespace; from plain
// Node/Bun the package's `index.js` returns a string path, so the lookups
// below fail loudly — but tests always set an override before that path
// is reached.
const nodeRequire = createRequire(import.meta.url);

let storagePathOverride: string | null = null;
let safeStorageOverride: SafeStorageImpl | null = null;
let snapshotPromise: Promise<SnapshotShape> | null = null;
let warningEmitted = false;
// Mutex implemented as a promise chain. Each enqueued op awaits the prior
// op's settlement (success OR failure) before running. The chain itself
// swallows rejections so a single failed write does not poison the queue.
let writeChain: Promise<unknown> = Promise.resolve();

function resetLazyState(): void {
  snapshotPromise = null;
  warningEmitted = false;
  writeChain = Promise.resolve();
}

function emptySnapshot(): SnapshotShape {
  return { version: SNAPSHOT_FILE_VERSION, entries: {} };
}

function loadElectronNamespace(): {
  safeStorage: SafeStorageImpl;
  userDataPath: string;
} {
  const raw: unknown = nodeRequire('electron');
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(
      '[secrets] electron namespace is unavailable (not running inside Electron main process)'
    );
  }
  const ns = raw as {
    safeStorage?: SafeStorageImpl;
    app?: { getPath?: (name: string) => string };
  };
  if (!ns.safeStorage || !ns.app || typeof ns.app.getPath !== 'function') {
    throw new Error(
      '[secrets] electron namespace missing app.getPath or safeStorage; cannot persist secrets'
    );
  }
  return {
    safeStorage: ns.safeStorage,
    userDataPath: ns.app.getPath('userData')
  };
}

function getSafeStorage(): SafeStorageImpl {
  if (safeStorageOverride) return safeStorageOverride;
  return loadElectronNamespace().safeStorage;
}

function getStoragePath(): string {
  if (storagePathOverride) return storagePathOverride;
  return path.join(loadElectronNamespace().userDataPath, 'secrets.json');
}

function classifyBackend(impl: SafeStorageImpl): EncryptionBackend {
  if (!impl.isEncryptionAvailable()) return 'unavailable';
  // Linux is the only platform where Electron exposes a backend selector;
  // on macOS / Windows `isEncryptionAvailable() === true` already implies
  // the OS keychain is in use.
  if (process.platform !== 'linux') return 'os-keychain';
  const backend = impl.getSelectedStorageBackend();
  if (backend === 'basic_text') return 'basic-fallback';
  if (backend === 'unknown') return 'unavailable';
  return 'os-keychain';
}

function maybeWarnBasicFallback(impl: SafeStorageImpl): void {
  if (warningEmitted) return;
  if (classifyBackend(impl) !== 'basic-fallback') return;
  warningEmitted = true;
  console.warn(WARNING_MESSAGE);
}

async function readSnapshotFromDisk(filePath: string): Promise<SnapshotShape> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptySnapshot();
    }
    throw err;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return emptySnapshot();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `[secrets] failed to parse secrets.json at ${filePath}: ${(err as Error).message}`
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`[secrets] secrets.json at ${filePath} is not an object`);
  }
  const obj = parsed as { version?: unknown; entries?: unknown };
  if (obj.version !== SNAPSHOT_FILE_VERSION) {
    throw new Error(
      `[secrets] secrets.json at ${filePath} has unsupported version ${String(obj.version)}; expected ${SNAPSHOT_FILE_VERSION}`
    );
  }
  if (typeof obj.entries !== 'object' || obj.entries === null) {
    return emptySnapshot();
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj.entries as Record<string, unknown>)) {
    // Defensive: silently drop non-string values rather than corrupting
    // the in-memory map. They can only appear if the file was hand-edited.
    if (typeof v === 'string') out[k] = v;
  }
  return { version: SNAPSHOT_FILE_VERSION, entries: out };
}

async function persistSnapshot(filePath: string, snapshot: SnapshotShape): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = `${filePath}.tmp`;
  const body = JSON.stringify(snapshot);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(tmp, body, { encoding: 'utf8' });
    await fs.rename(tmp, filePath);
  } catch (err) {
    // Best-effort cleanup; ignore secondary errors so the original
    // failure surfaces.
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function loadSnapshot(): Promise<SnapshotShape> {
  if (!snapshotPromise) {
    snapshotPromise = (async (): Promise<SnapshotShape> => {
      const impl = getSafeStorage();
      maybeWarnBasicFallback(impl);
      const filePath = getStoragePath();
      return readSnapshotFromDisk(filePath);
    })();
  }
  return snapshotPromise;
}

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  // Keep the chain alive across failures so subsequent enqueues don't
  // pile up behind a rejected promise.
  writeChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function setSecret(key: string, value: string): Promise<void> {
  if (key.length === 0) {
    throw new Error('[secrets] setSecret: key must be a non-empty string');
  }
  await enqueueWrite(async () => {
    const snapshot = await loadSnapshot();
    const impl = getSafeStorage();
    const ciphertext = impl.encryptString(value);
    const encoded = Buffer.from(ciphertext).toString('base64');
    const nextEntries: Record<string, string> = { ...snapshot.entries, [key]: encoded };
    await persistSnapshot(getStoragePath(), {
      version: SNAPSHOT_FILE_VERSION,
      entries: nextEntries
    });
    // Commit cache only after disk write succeeds so an I/O failure
    // does not leave the in-memory view ahead of the file.
    snapshot.entries = nextEntries;
  });
}

export async function getSecret(key: string): Promise<string | null> {
  const snapshot = await loadSnapshot();
  const encoded = snapshot.entries[key];
  if (typeof encoded !== 'string') return null;
  const impl = getSafeStorage();
  const buf = Buffer.from(encoded, 'base64');
  return impl.decryptString(buf);
}

export async function deleteSecret(key: string): Promise<void> {
  await enqueueWrite(async () => {
    const snapshot = await loadSnapshot();
    if (!(key in snapshot.entries)) return;
    const nextEntries: Record<string, string> = { ...snapshot.entries };
    delete nextEntries[key];
    await persistSnapshot(getStoragePath(), {
      version: SNAPSHOT_FILE_VERSION,
      entries: nextEntries
    });
    snapshot.entries = nextEntries;
  });
}

export async function listKeys(): Promise<string[]> {
  const snapshot = await loadSnapshot();
  return Object.keys(snapshot.entries).sort();
}

export function isEncryptionAvailable(): boolean {
  return getSafeStorage().isEncryptionAvailable();
}

export function getEncryptionBackend(): EncryptionBackend {
  return classifyBackend(getSafeStorage());
}

// ---------------------------------------------------------------------------
// Test-only helpers. Names prefixed with `__` so callers know they are not
// part of the supported runtime surface.
// ---------------------------------------------------------------------------

/**
 * Inject a fake `safeStorage` implementation. Pass `null` to revert to the
 * real Electron-backed implementation. Calling this helper also resets the
 * lazy snapshot cache and one-time-warning flag so the next call reloads
 * from disk against the new impl.
 */
export function __setSafeStorageForTesting(impl: SafeStorageImpl | null): void {
  safeStorageOverride = impl;
  resetLazyState();
}

/**
 * Override the on-disk JSON path. Pass `null` to revert to
 * `app.getPath('userData') / secrets.json`. Resets the lazy snapshot cache
 * so the next call rereads the file at the new location.
 */
export function __setStoragePathForTesting(filePath: string | null): void {
  storagePathOverride = filePath;
  resetLazyState();
}
