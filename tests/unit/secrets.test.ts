import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  __setSafeStorageForTesting,
  __setStoragePathForTesting,
  deleteSecret,
  getEncryptionBackend,
  getSecret,
  isEncryptionAvailable,
  listKeys,
  setSecret,
  type SafeStorageImpl
} from '../../src/main/secrets/safeStorage';

// Round-trip mock: prepends a tag so we can prove decrypt matches the
// matching encrypt and not a smuggled plaintext. Buffer in/out matches
// Electron's real API contract.
function makeMock(
  overrides: Partial<SafeStorageImpl> = {}
): SafeStorageImpl & { encryptCalls: number; decryptCalls: number } {
  const state = { encryptCalls: 0, decryptCalls: 0 };
  const base: SafeStorageImpl = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => {
      state.encryptCalls += 1;
      return Buffer.from(`enc::${plain}`, 'utf8');
    },
    decryptString: (buf) => {
      state.decryptCalls += 1;
      const s = buf.toString('utf8');
      if (!s.startsWith('enc::')) throw new Error('mock: invalid ciphertext');
      return s.slice('enc::'.length);
    },
    getSelectedStorageBackend: () => 'gnome_libsecret'
  };
  return Object.assign({}, base, overrides, state);
}

let tmpRoot: string;
let secretsPath: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'snowboy-secrets-'));
  secretsPath = path.join(tmpRoot, 'secrets.json');
  __setStoragePathForTesting(secretsPath);
  __setSafeStorageForTesting(makeMock());
});

afterEach(async () => {
  __setSafeStorageForTesting(null);
  __setStoragePathForTesting(null);
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('safeStorage credential module', () => {
  test('round-trips a secret through set + get', async () => {
    await setSecret('profile:abc', 'hunter2');
    const value = await getSecret('profile:abc');
    expect(value).toBe('hunter2');
  });

  test('persists multiple secrets and surfaces them via listKeys (sorted)', async () => {
    await setSecret('beta', 'two');
    await setSecret('alpha', 'one');
    await setSecret('gamma', 'three');

    const keys = await listKeys();
    expect(keys).toEqual(['alpha', 'beta', 'gamma']);

    expect(await getSecret('alpha')).toBe('one');
    expect(await getSecret('beta')).toBe('two');
    expect(await getSecret('gamma')).toBe('three');
  });

  test('overwrites an existing key on repeat set', async () => {
    await setSecret('k', 'first');
    await setSecret('k', 'second');
    expect(await getSecret('k')).toBe('second');
    expect(await listKeys()).toEqual(['k']);
  });

  test('deleteSecret removes the entry and is a no-op when key is absent', async () => {
    await setSecret('a', 'one');
    await setSecret('b', 'two');

    await deleteSecret('a');
    expect(await getSecret('a')).toBeNull();
    expect(await listKeys()).toEqual(['b']);

    await deleteSecret('does-not-exist');
    expect(await listKeys()).toEqual(['b']);
  });

  test('getSecret returns null for unknown keys', async () => {
    expect(await getSecret('nope')).toBeNull();
    await setSecret('real', 'value');
    expect(await getSecret('still-nope')).toBeNull();
  });

  test('treats a missing secrets.json as an empty store', async () => {
    expect(await listKeys()).toEqual([]);
    expect(await getSecret('anything')).toBeNull();
  });

  test('treats an empty secrets.json file as an empty store', async () => {
    await fs.writeFile(secretsPath, '', 'utf8');
    expect(await listKeys()).toEqual([]);
    expect(await getSecret('anything')).toBeNull();

    await setSecret('post-empty', 'works');
    expect(await getSecret('post-empty')).toBe('works');
  });

  test('persists snapshot in the documented JSON shape', async () => {
    await setSecret('snowflake', 'token-xyz');
    const raw = await fs.readFile(secretsPath, 'utf8');
    const parsed = JSON.parse(raw) as { version: number; entries: Record<string, string> };
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.entries)).toEqual(['snowflake']);
    // Stored value must be base64 ciphertext, not the plain string.
    expect(parsed.entries['snowflake']).not.toBe('token-xyz');
    // And decoding it must reproduce the mock's `enc::` envelope.
    const decoded = Buffer.from(parsed.entries['snowflake']!, 'base64').toString('utf8');
    expect(decoded).toBe('enc::token-xyz');
  });

  test('serializes concurrent setSecret calls without losing entries', async () => {
    const ops: Array<Promise<void>> = [];
    for (let i = 0; i < 20; i += 1) {
      ops.push(setSecret(`k${i}`, `v${i}`));
    }
    await Promise.all(ops);

    const keys = await listKeys();
    expect(keys.length).toBe(20);
    for (let i = 0; i < 20; i += 1) {
      expect(await getSecret(`k${i}`)).toBe(`v${i}`);
    }
  });

  test('isEncryptionAvailable proxies the underlying impl', () => {
    __setSafeStorageForTesting(makeMock({ isEncryptionAvailable: () => true }));
    __setStoragePathForTesting(secretsPath);
    expect(isEncryptionAvailable()).toBe(true);

    __setSafeStorageForTesting(makeMock({ isEncryptionAvailable: () => false }));
    __setStoragePathForTesting(secretsPath);
    expect(isEncryptionAvailable()).toBe(false);
  });

  test('getEncryptionBackend classifies keyring, basic-fallback, and unavailable', () => {
    // Linux + libsecret -> os-keychain
    __setSafeStorageForTesting(
      makeMock({
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'gnome_libsecret'
      })
    );
    __setStoragePathForTesting(secretsPath);
    expect(getEncryptionBackend()).toBe(process.platform === 'linux' ? 'os-keychain' : 'os-keychain');

    // Encryption unavailable -> 'unavailable' on every platform
    __setSafeStorageForTesting(
      makeMock({
        isEncryptionAvailable: () => false,
        getSelectedStorageBackend: () => 'unknown'
      })
    );
    __setStoragePathForTesting(secretsPath);
    expect(getEncryptionBackend()).toBe('unavailable');

    // Linux + basic_text -> basic-fallback (only when running on Linux);
    // on other platforms `getSelectedStorageBackend` is ignored.
    __setSafeStorageForTesting(
      makeMock({
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'basic_text'
      })
    );
    __setStoragePathForTesting(secretsPath);
    if (process.platform === 'linux') {
      expect(getEncryptionBackend()).toBe('basic-fallback');
    } else {
      expect(getEncryptionBackend()).toBe('os-keychain');
    }
  });

  test('basic-fallback warning fires at most once per process', async () => {
    if (process.platform !== 'linux') {
      // The warning is Linux-only by design; nothing to assert elsewhere.
      return;
    }
    const originalWarn = console.warn;
    const calls: string[] = [];
    console.warn = (...args: unknown[]) => {
      calls.push(args.map(String).join(' '));
    };
    try {
      __setSafeStorageForTesting(
        makeMock({
          isEncryptionAvailable: () => true,
          getSelectedStorageBackend: () => 'basic_text'
        })
      );
      __setStoragePathForTesting(secretsPath);

      await listKeys();
      await setSecret('k', 'v');
      await getSecret('k');
      await deleteSecret('k');

      const warnings = calls.filter((line) => line.includes('OS keyring unavailable'));
      expect(warnings.length).toBe(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('atomic write does not leave a .tmp file behind on success', async () => {
    await setSecret('only', 'one');
    const dirEntries = await fs.readdir(tmpRoot);
    expect(dirEntries).toContain('secrets.json');
    expect(dirEntries.some((name) => name.endsWith('.tmp'))).toBe(false);
  });
});
