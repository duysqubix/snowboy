/**
 * T3.1 — connections.* IPC handlers.
 *
 * Wires the renderer's connection-profile surface (`window.snowboy.connections`)
 * into Wave 1's storage (`profiles.ts`), secrets vault (`safeStorage`), and
 * Snowflake driver (`Session`). Handler functions are exported as plain
 * async functions so the unit suite can drive them without standing up
 * `ipcMain`; `register()` is the thin adapter that wires those functions
 * onto Electron's invoke channels.
 *
 * Translation layer: storage rows are snake_case + `string | null`; the IPC
 * surface (shared with the renderer) is camelCase + `string | undefined`.
 * `rowToProfile`, `profileToInsert`, `profileToPatch`, and `rowToLite` are
 * the only places where the two shapes meet — keep them collocated so
 * future schema drift surfaces in one diff.
 *
 * Secret material: passwords for the two password-based auth methods are
 * keyed `profile:${profileId}:password` in safeStorage. v0.1's wizard does
 * NOT collect passwords yet (T3.2's session.open flow owns that), so
 * password-auth profiles fail `test()` with a clear message instead of
 * triggering a confusing SDK error. `deleteProfile` cleans up every
 * `profile:${id}:*` key so deletion can never leak orphaned credentials.
 *
 * Key-pair profiles (M2.1b) store only the private key's file path; the
 * SDK reads the file at connect time. The optional key passphrase is keyed
 * `profile:${profileId}:private_key_passphrase`. `test()` and
 * `sessions.open` parse the key first (`prepareKeyPairAuth`), so a missing
 * file or wrong passphrase gets a specific message before any network call.
 * `saveProfile` deletes the secret of any auth method the profile no longer
 * uses, so switching methods never leaves a password or passphrase behind.
 *
 * Session test: `test()` opens a one-shot Session with empty session
 * context (the profile's defaults are already baked into the connect
 * options by `buildConnectOptions`), runs `SELECT CURRENT_ROLE()`, and
 * always closes — including in the failure path. The handler NEVER
 * throws across the IPC boundary; every error is captured into a
 * structured `TestResult` so the renderer can render a single toast.
 */

import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import type {
  BrowserWindow,
  Dialog,
  IpcMain,
  OpenDialogOptions,
  OpenDialogReturnValue,
  WebContents
} from 'electron';
import { CHANNELS } from './channels';
import {
  deleteProfile as storageDeleteProfile,
  getProfile as storageGetProfile,
  insertProfile as storageInsertProfile,
  listProfiles as storageListProfiles,
  updateProfile as storageUpdateProfile,
  type ConnectionProfilePatch,
  type ConnectionProfileRow,
  type NewConnectionProfile
} from '../storage/profiles';
import {
  deleteSecret,
  getSecret,
  listKeys,
  setSecret
} from '../secrets/safeStorage';
import { checkPrivateKeyFile } from '../snowflake/auth';
import {
  Session,
  type OpenSessionOptions
} from '../snowflake/session';
import type {
  ConnectionProfileLite,
  SessionContext
} from '../snowflake/types';
import type { AuthMethod, ConnectionProfile, PrivateKeyCheck, TestResult } from '../types';

const TEST_QUERY_SQL = 'SELECT CURRENT_ROLE() AS ROLE';
const TEST_QUERY_TIMEOUT_MS = 30_000;

const nodeRequire = createRequire(import.meta.url);

/**
 * Translates known-confusing Snowflake error codes into actionable messages.
 * The codes Snowflake returns are stable across SDK versions, but the raw
 * messages tell users to "Contact Snowflake support" — not useful when the
 * fix is on the user's side (wrong auth method, missing role, etc.).
 *
 * Pattern: detect the code in the raw error text, return a replacement
 * message that explains the cause + next step. Falls through to the raw
 * message when nothing matches. `keyFingerprint` (key-pair profiles only)
 * is added to the JWT hint so it can be compared with `DESC USER` output.
 */
function snowflakeErrorHint(raw: string, keyFingerprint?: string): string {
  if (raw.includes('390190') || raw.includes('SAML Identity Provider account parameter')) {
    return (
      'This Snowflake account does not have SSO (SAML) configured, so ' +
      'externalbrowser authentication cannot be used. Switch the profile to ' +
      'Password or Password+MFA, or configure SAML SSO in Snowflake first ' +
      '(see https://docs.snowflake.com/en/user-guide/admin-security-fed-auth-overview).'
    );
  }
  if (raw.includes('390100') || raw.includes('Incorrect username or password')) {
    return (
      'Incorrect username or password. Double-check the username on the ' +
      'profile and the stored password.'
    );
  }
  if (raw.includes('390101') || raw.includes('User is locked')) {
    return (
      'This Snowflake user is locked. An account admin needs to unlock the ' +
      'user before sign-in can succeed.'
    );
  }
  // Key-pair sign-in rejected. Checked before the 390114 branch below,
  // which also matches this text.
  if (raw.includes('390144') || raw.includes('JWT token is invalid')) {
    const keyFp = keyFingerprint !== undefined ? ` (${keyFingerprint})` : '';
    return (
      'Snowflake rejected the key-pair sign-in (JWT token is invalid). Usually the ' +
      "user's registered public key doesn't match this private key: compare " +
      `RSA_PUBLIC_KEY_FP from DESC USER with this key's fingerprint${keyFp}, and if they ` +
      "differ, register the public key with ALTER USER ... SET RSA_PUBLIC_KEY = '...'. " +
      "Also check the profile's username and Account URL, and this computer's clock."
    );
  }
  if (raw.includes('390114') || raw.includes('JWT token is invalid')) {
    return (
      'The Snowflake JWT for key-pair auth is invalid or expired. Re-register ' +
      'the public key on the user, or regenerate the key pair.'
    );
  }
  if (raw.includes('ENOTFOUND') || raw.includes('getaddrinfo')) {
    return (
      'Cannot reach Snowflake. Check the Account URL on the profile and ' +
      'confirm the host resolves.'
    );
  }
  return raw;
}

/**
 * Session factory shape — matches `Session.open`. The indirection exists
 * so unit tests can inject a stub that never touches snowflake-sdk; in
 * production this resolves to `Session.open.bind(Session)`.
 */
export type SessionFactory = (
  profile: ConnectionProfileLite,
  context: SessionContext,
  options: OpenSessionOptions
) => Promise<Session>;

let sessionFactoryOverride: SessionFactory | null = null;

/**
 * Test-only: install a fake `Session.open`. Pass `null` to revert to the
 * real driver. Named with `__` so it cannot be mistaken for runtime API.
 */
export function __setSessionFactoryForTesting(factory: SessionFactory | null): void {
  sessionFactoryOverride = factory;
}

function getSessionFactory(): SessionFactory {
  return sessionFactoryOverride ?? Session.open.bind(Session);
}

function passwordKey(profileId: string): string {
  return `profile:${profileId}:password`;
}

/** Auth methods whose secret lives under `passwordKey` (a PAT included). */
const PASSWORD_KEY_METHODS: ReadonlySet<AuthMethod> = new Set(['password', 'password_mfa', 'pat']);

function privateKeyPassphraseKey(profileId: string): string {
  return `profile:${profileId}:private_key_passphrase`;
}

function profilePrefix(profileId: string): string {
  return `profile:${profileId}:`;
}

/**
 * Native open-dialog shape. Tests install a stub; production shows
 * Electron's dialog, modal to the window whose renderer asked for it.
 */
export type OpenDialogFn = (
  options: OpenDialogOptions,
  requester: WebContents | null
) => Promise<OpenDialogReturnValue>;

function defaultOpenDialog(
  options: OpenDialogOptions,
  requester: WebContents | null
): Promise<OpenDialogReturnValue> {
  type ElectronModule = { dialog?: Dialog; BrowserWindow?: typeof BrowserWindow };
  const mod = nodeRequire('electron') as ElectronModule;
  if (mod?.dialog === undefined) {
    throw new Error('[connections] electron.dialog is unavailable');
  }
  const owner = requester !== null ? (mod.BrowserWindow?.fromWebContents(requester) ?? null) : null;
  return owner !== null
    ? mod.dialog.showOpenDialog(owner, options)
    : mod.dialog.showOpenDialog(options);
}

let openDialog: OpenDialogFn = defaultOpenDialog;

/** Test-only: install a fake open dialog. Pass `null` to restore Electron's. */
export function __setOpenDialogForTesting(fn: OpenDialogFn | null): void {
  openDialog = fn ?? defaultOpenDialog;
}

// ---------------------------------------------------------------------------
// Row <-> IPC translation
// ---------------------------------------------------------------------------

function rowToProfile(row: ConnectionProfileRow): ConnectionProfile {
  const profile: ConnectionProfile = {
    id: row.id,
    name: row.name,
    accountUrl: row.account_url,
    authMethod: row.auth_method,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  // Optional fields: storage keeps `null`, IPC contract is `string | undefined`.
  // Empty strings collapse to undefined as well so a wizard-cleared field
  // round-trips deterministically.
  if (row.default_role !== null && row.default_role !== '') {
    profile.defaultRole = row.default_role;
  }
  if (row.default_warehouse !== null && row.default_warehouse !== '') {
    profile.defaultWarehouse = row.default_warehouse;
  }
  if (row.default_database !== null && row.default_database !== '') {
    profile.defaultDatabase = row.default_database;
  }
  if (row.default_schema !== null && row.default_schema !== '') {
    profile.defaultSchema = row.default_schema;
  }
  if (row.private_key_path !== null && row.private_key_path !== '') {
    profile.privateKeyPath = row.private_key_path;
  }
  return profile;
}

function normalizeOptional(v: string | undefined): string | null {
  if (v === undefined) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Only `keypair` profiles keep a key path, so switching a profile to another
 * auth method drops it. The path comes from the native dialog, so it must be
 * absolute, and it is not trimmed.
 */
function privateKeyPathFor(p: ConnectionProfile): string | null {
  const raw: unknown = p.privateKeyPath;
  if (p.authMethod !== 'keypair' || raw === undefined || raw === null || raw === '') {
    return null;
  }
  if (typeof raw !== 'string' || !isAbsolute(raw)) {
    throw new Error('saveProfile: privateKeyPath must be an absolute path');
  }
  return raw;
}

function profileToInsert(p: ConnectionProfile): NewConnectionProfile {
  return {
    id: p.id,
    name: p.name,
    account_url: p.accountUrl,
    auth_method: p.authMethod,
    username: p.username,
    default_role: normalizeOptional(p.defaultRole),
    default_warehouse: normalizeOptional(p.defaultWarehouse),
    default_database: normalizeOptional(p.defaultDatabase),
    default_schema: normalizeOptional(p.defaultSchema),
    private_key_path: privateKeyPathFor(p)
  };
}

function profileToPatch(p: ConnectionProfile): ConnectionProfilePatch {
  return {
    name: p.name,
    account_url: p.accountUrl,
    auth_method: p.authMethod,
    username: p.username,
    default_role: normalizeOptional(p.defaultRole),
    default_warehouse: normalizeOptional(p.defaultWarehouse),
    default_database: normalizeOptional(p.defaultDatabase),
    default_schema: normalizeOptional(p.defaultSchema),
    private_key_path: privateKeyPathFor(p)
  };
}

function rowToLite(row: ConnectionProfileRow): ConnectionProfileLite {
  return {
    id: row.id,
    accountUrl: row.account_url,
    authMethod: row.auth_method,
    username: row.username,
    ...(row.private_key_path !== null && row.private_key_path !== ''
      ? { privateKeyPath: row.private_key_path }
      : {}),
    ...(row.default_role !== null && row.default_role !== ''
      ? { defaultRole: row.default_role }
      : {}),
    ...(row.default_warehouse !== null && row.default_warehouse !== ''
      ? { defaultWarehouse: row.default_warehouse }
      : {}),
    ...(row.default_database !== null && row.default_database !== ''
      ? { defaultDatabase: row.default_database }
      : {}),
    ...(row.default_schema !== null && row.default_schema !== ''
      ? { defaultSchema: row.default_schema }
      : {})
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs a one-shot streaming query and resolves when `onComplete` fires.
 * `runStreaming` is event-driven (callbacks) but `test()` needs a single
 * Promise — this is the thin wrapper. `onError`/`onCancel` reject so the
 * caller never silently hangs.
 */
async function runTinyQuery(
  session: Session,
  sql: string,
  timeoutMs: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    session.runStreaming(
      sql,
      { timeoutMs },
      {
        onBatch: () => {
          /* row content discarded — `test()` only cares whether the round-trip succeeds */
        },
        onComplete: () => settle(() => resolve()),
        onError: (err) => settle(() => reject(err)),
        onCancel: () =>
          settle(() => reject(new Error('Test query was cancelled')))
      }
    );
  });
}

/**
 * Checks a key-pair profile's key before any SDK call. Returns the stored
 * passphrase only when the key is encrypted (a leftover one for an
 * unencrypted key is not forwarded), plus the key's fingerprint for error
 * hints. Throws with a message ready for the user. Shared by `test()` and
 * `sessions.open`.
 */
export async function prepareKeyPairAuth(
  profileId: string,
  privateKeyPath: string | null
): Promise<{ passphrase?: string; fingerprint: string }> {
  if (privateKeyPath === null || privateKeyPath === '') {
    throw new Error(
      'No private key file is set for this profile. Edit the profile and choose your private key file.'
    );
  }
  const passphrase = (await getSecret(privateKeyPassphraseKey(profileId))) ?? undefined;
  const check = await checkPrivateKeyFile(privateKeyPath, passphrase);
  if (!check.ok) {
    if (check.problem === 'passphrase_required') {
      throw new Error(
        'This private key is encrypted and no passphrase is stored for the profile. ' +
          "Edit the profile and enter the key's passphrase."
      );
    }
    if (check.problem === 'wrong_passphrase') {
      throw new Error(
        'The stored passphrase does not unlock this private key (or the key file is damaged). ' +
          'Edit the profile and enter the correct passphrase.'
      );
    }
    throw new Error(check.message);
  }
  return check.encrypted && passphrase !== undefined
    ? { passphrase, fingerprint: check.fingerprint }
    : { fingerprint: check.fingerprint };
}

// ---------------------------------------------------------------------------
// Handler implementations (exported for direct unit testing)
// ---------------------------------------------------------------------------

export function listProfiles(): ConnectionProfile[] {
  return storageListProfiles().map(rowToProfile);
}

export async function saveProfile(p: ConnectionProfile): Promise<{ id: string }> {
  if (typeof p?.id !== 'string' || p.id.length === 0) {
    throw new Error('saveProfile: profile.id is required');
  }
  const existing = storageGetProfile(p.id);
  if (existing === null) {
    storageInsertProfile(profileToInsert(p));
  } else {
    storageUpdateProfile(p.id, profileToPatch(p));
  }
  // Drop the secret of any method this profile no longer uses. Both deletes
  // are queued before the first await, so they run ahead of any secret the
  // caller sets next.
  const unused: Promise<void>[] = [];
  if (p.authMethod !== 'keypair') {
    unused.push(deleteSecret(privateKeyPassphraseKey(p.id)));
  }
  if (!PASSWORD_KEY_METHODS.has(p.authMethod)) {
    unused.push(deleteSecret(passwordKey(p.id)));
  }
  await Promise.all(unused);
  return { id: p.id };
}

export async function deleteProfile(id: string): Promise<void> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('deleteProfile: id is required');
  }
  // Storage delete first. If it throws (e.g. FK violation) we leave secrets
  // alone — a still-existing profile with a missing password would actively
  // break user flows, whereas orphaned secrets are inert.
  storageDeleteProfile(id);

  const prefix = profilePrefix(id);
  const keys = await listKeys();
  // safeStorage serializes writes through its own mutex, so the sequential
  // loop here is purely for readability — Promise.all would behave the same.
  for (const key of keys) {
    if (key.startsWith(prefix)) {
      await deleteSecret(key);
    }
  }
}

export async function setPasswordForProfile(profileId: string, password: string): Promise<void> {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new Error('setPassword: profileId is required');
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('setPassword: password must be a non-empty string');
  }
  if (storageGetProfile(profileId) === null) {
    throw new Error(`setPassword: profile not found: ${profileId}`);
  }
  await setSecret(passwordKey(profileId), password);
}

export async function clearPasswordForProfile(profileId: string): Promise<void> {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new Error('clearPassword: profileId is required');
  }
  await deleteSecret(passwordKey(profileId));
}

export async function hasPasswordForProfile(profileId: string): Promise<boolean> {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    return false;
  }
  const stored = await getSecret(passwordKey(profileId));
  return stored !== null;
}

export async function setPrivateKeyPassphraseForProfile(
  profileId: string,
  passphrase: string
): Promise<void> {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new Error('setPrivateKeyPassphrase: profileId is required');
  }
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('setPrivateKeyPassphrase: passphrase must be a non-empty string');
  }
  const row = storageGetProfile(profileId);
  if (row === null) {
    throw new Error(`setPrivateKeyPassphrase: profile not found: ${profileId}`);
  }
  if (row.auth_method !== 'keypair') {
    throw new Error(`setPrivateKeyPassphrase: profile ${profileId} does not use key-pair auth`);
  }
  await setSecret(privateKeyPassphraseKey(profileId), passphrase);
}

export async function clearPrivateKeyPassphraseForProfile(profileId: string): Promise<void> {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new Error('clearPrivateKeyPassphrase: profileId is required');
  }
  await deleteSecret(privateKeyPassphraseKey(profileId));
}

/** Checks the key list only, so answering never decrypts the passphrase. */
export async function hasPrivateKeyPassphraseForProfile(profileId: string): Promise<boolean> {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    return false;
  }
  const keys = await listKeys();
  return keys.includes(privateKeyPassphraseKey(profileId));
}

/**
 * Parses a key file for the wizard. A typed `passphrase` wins; without
 * one, `profileId` selects that profile's stored passphrase, so an edited
 * profile validates without its passphrase ever reaching the renderer.
 */
export async function checkPrivateKey(
  filePath: string,
  passphrase?: string,
  profileId?: string
): Promise<PrivateKeyCheck> {
  const typed = typeof passphrase === 'string' && passphrase !== '' ? passphrase : undefined;
  const stored =
    typed === undefined && typeof profileId === 'string' && profileId.length > 0
      ? ((await getSecret(privateKeyPassphraseKey(profileId))) ?? undefined)
      : undefined;
  const result = await checkPrivateKeyFile(
    typeof filePath === 'string' ? filePath : '',
    typed ?? stored
  );
  if (!result.ok && result.problem === 'wrong_passphrase' && stored !== undefined) {
    return {
      ...result,
      message:
        'The stored passphrase does not unlock this private key (or the key file is damaged). ' +
        'Enter its passphrase.'
    };
  }
  return result;
}

/**
 * Native file picker for the private key, modal to `requester`'s window;
 * resolves `null` when cancelled.
 */
export async function pickPrivateKeyFile(
  requester: WebContents | null = null
): Promise<string | null> {
  const result = await openDialog(
    {
      title: 'Choose your Snowflake private key',
      // Keys usually live in dot-directories such as ~/.ssh or ~/.snowflake.
      properties: ['openFile', 'showHiddenFiles'],
      filters: [
        { name: 'Private keys (*.p8, *.pem)', extensions: ['p8', 'pem'] },
        { name: 'All files', extensions: ['*'] }
      ]
    },
    requester
  );
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
}

export async function testConnection(
  profileId: string,
  passcode?: string
): Promise<TestResult> {
  const startedAt = Date.now();

  if (typeof profileId !== 'string' || profileId.length === 0) {
    return {
      ok: false,
      message: 'test: profileId is required',
      durationMs: Date.now() - startedAt
    };
  }

  let row: ConnectionProfileRow | null;
  try {
    row = storageGetProfile(profileId);
  } catch (err) {
    return {
      ok: false,
      message: `Failed to load profile: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startedAt
    };
  }
  if (row === null) {
    return {
      ok: false,
      message: `Profile not found: ${profileId}`,
      durationMs: Date.now() - startedAt
    };
  }

  let password: string | undefined;
  if (
    row.auth_method === 'password' ||
    row.auth_method === 'password_mfa' ||
    row.auth_method === 'pat'
  ) {
    const secretName = row.auth_method === 'pat' ? 'Personal Access Token' : 'password';
    let stored: string | null;
    try {
      stored = await getSecret(passwordKey(profileId));
    } catch (err) {
      return {
        ok: false,
        message: `Failed to read ${secretName} from secrets store: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startedAt
      };
    }
    if (stored === null) {
      return {
        ok: false,
        message: `No ${secretName} stored for this profile. Edit the profile and enter your Snowflake ${secretName}, then try again.`,
        durationMs: Date.now() - startedAt
      };
    }
    password = stored;
  }

  // Key-pair: `password` carries the key passphrase (see buildConnectOptions).
  let keyFingerprint: string | undefined;
  if (row.auth_method === 'keypair') {
    try {
      const keyPair = await prepareKeyPairAuth(profileId, row.private_key_path);
      password = keyPair.passphrase;
      keyFingerprint = keyPair.fingerprint;
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt
      };
    }
  }

  const lite = rowToLite(row);
  const options: OpenSessionOptions = {};
  if (password !== undefined) options.password = password;
  if (passcode !== undefined && passcode.trim().length > 0) options.passcode = passcode.trim();
  // Empty session context — the profile's defaults are baked into the
  // connect options by `buildConnectOptions`. Running USE statements on top
  // would just duplicate work and turn a missing-default into a noisier
  // failure than the connect-time error the SDK already produces.
  const initialContext: SessionContext = {};

  let session: Session | null = null;
  try {
    session = await getSessionFactory()(lite, initialContext, options);
    await runTinyQuery(session, TEST_QUERY_SQL, TEST_QUERY_TIMEOUT_MS);
    return {
      ok: true,
      durationMs: Date.now() - startedAt
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: snowflakeErrorHint(raw, keyFingerprint),
      durationMs: Date.now() - startedAt
    };
  } finally {
    if (session !== null) {
      try {
        await session.close();
      } catch (closeErr) {
        // Closing a failed/partially-open session is best-effort; surface to
        // logs but don't override the test result the caller already saw.
        console.warn('[connections] session.close failed during test', closeErr);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// IPC registration adapter
// ---------------------------------------------------------------------------

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.connections.listProfiles, () => listProfiles());
  ipcMain.handle(CHANNELS.connections.saveProfile, (_event, profile: ConnectionProfile) =>
    saveProfile(profile)
  );
  ipcMain.handle(CHANNELS.connections.deleteProfile, (_event, id: string) =>
    deleteProfile(id)
  );
  ipcMain.handle(
    CHANNELS.connections.test,
    (_event, profileId: string, passcode?: string) => testConnection(profileId, passcode)
  );
  ipcMain.handle(
    CHANNELS.connections.setPassword,
    (_event, profileId: string, password: string) =>
      setPasswordForProfile(profileId, password)
  );
  ipcMain.handle(CHANNELS.connections.clearPassword, (_event, profileId: string) =>
    clearPasswordForProfile(profileId)
  );
  ipcMain.handle(CHANNELS.connections.hasPassword, (_event, profileId: string) =>
    hasPasswordForProfile(profileId)
  );
  ipcMain.handle(CHANNELS.connections.pickPrivateKeyFile, (event) =>
    pickPrivateKeyFile(event.sender)
  );
  ipcMain.handle(
    CHANNELS.connections.checkPrivateKey,
    (_event, filePath: string, passphrase?: string, profileId?: string) =>
      checkPrivateKey(filePath, passphrase, profileId)
  );
  ipcMain.handle(
    CHANNELS.connections.setPrivateKeyPassphrase,
    (_event, profileId: string, passphrase: string) =>
      setPrivateKeyPassphraseForProfile(profileId, passphrase)
  );
  ipcMain.handle(CHANNELS.connections.clearPrivateKeyPassphrase, (_event, profileId: string) =>
    clearPrivateKeyPassphraseForProfile(profileId)
  );
  ipcMain.handle(CHANNELS.connections.hasPrivateKeyPassphrase, (_event, profileId: string) =>
    hasPrivateKeyPassphraseForProfile(profileId)
  );
}
