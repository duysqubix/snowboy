import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IpcMain, OpenDialogOptions } from 'electron';

import { CHANNELS } from '../../../src/main/ipc/channels';
import {
  checkPrivateKey,
  clearPasswordForProfile,
  clearPrivateKeyPassphraseForProfile,
  deleteProfile,
  hasPasswordForProfile,
  hasPrivateKeyPassphraseForProfile,
  listProfiles,
  pickPrivateKeyFile,
  register,
  saveProfile,
  setPasswordForProfile,
  setPrivateKeyPassphraseForProfile,
  testConnection,
  __setOpenDialogForTesting,
  __setSessionFactoryForTesting,
  type SessionFactory
} from '../../../src/main/ipc/connections';
import {
  __setSafeStorageForTesting,
  __setStoragePathForTesting,
  listKeys,
  setSecret,
  type SafeStorageImpl
} from '../../../src/main/secrets/safeStorage';
import { closeDatabase, openDatabase } from '../../../src/main/storage/db';
import { insertProfile } from '../../../src/main/storage/profiles';
import type { Session } from '../../../src/main/snowflake/session';
import type {
  QueryCompleteEvent,
  StreamingCallbacks,
  StreamingHandle
} from '../../../src/main/snowflake/types';
import type { ConnectionProfile } from '../../../src/main/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../../../src/main/storage/migrations');

function makeMockSafeStorage(): SafeStorageImpl {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc::${s}`, 'utf8'),
    decryptString: (b) => {
      const s = b.toString('utf8');
      if (!s.startsWith('enc::')) throw new Error('mock: bad ciphertext');
      return s.slice('enc::'.length);
    },
    getSelectedStorageBackend: () => 'gnome_libsecret'
  };
}

function profileFixture(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: 'p1',
    name: 'Test Profile',
    accountUrl: 'https://example.snowflakecomputing.com',
    authMethod: 'externalbrowser',
    username: 'analyst',
    defaultRole: 'SYSADMIN',
    defaultWarehouse: 'WH_XS',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides
  };
}

interface FakeSessionConfig {
  onRun?: (sql: string) => void;
  completeWith?: QueryCompleteEvent;
  errorOn?: Error;
  closeImpl?: () => void;
}

function makeFakeSession(config: FakeSessionConfig = {}): Session {
  const session = {
    runStreaming: (
      sql: string,
      _opts: unknown,
      callbacks: StreamingCallbacks
    ): StreamingHandle => {
      config.onRun?.(sql);
      queueMicrotask(() => {
        if (config.errorOn) {
          callbacks.onError(config.errorOn);
          return;
        }
        callbacks.onComplete(
          config.completeWith ?? {
            queryId: 'fake-query-id',
            rowCount: 1,
            bytesScanned: 0,
            warehouseUsed: 'WH_XS'
          }
        );
      });
      return {
        cancel: () => {},
        queryId: '',
        queryIdPromise: Promise.resolve('fake-query-id')
      };
    },
    close: async () => {
      config.closeImpl?.();
    }
  };
  return session as unknown as Session;
}

let tmpRoot: string;
let secretsPath: string;

beforeEach(async () => {
  openDatabase({ path: ':memory:', migrationsDir: MIGRATIONS_DIR });
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'snowboy-conn-ipc-'));
  secretsPath = path.join(tmpRoot, 'secrets.json');
  __setStoragePathForTesting(secretsPath);
  __setSafeStorageForTesting(makeMockSafeStorage());
});

afterEach(async () => {
  __setSessionFactoryForTesting(null);
  __setOpenDialogForTesting(null);
  __setSafeStorageForTesting(null);
  __setStoragePathForTesting(null);
  closeDatabase();
  await rm(tmpRoot, { recursive: true, force: true });
});

afterAll(() => {
  closeDatabase();
});

describe('listProfiles', () => {
  test('returns [] on a fresh database', () => {
    expect(listProfiles()).toEqual([]);
  });

  test('returns persisted profiles in name order with snake→camel translation', () => {
    insertProfile({
      id: 'b',
      name: 'Beta',
      account_url: 'https://b.snowflakecomputing.com',
      auth_method: 'password',
      username: 'b@example.com',
      default_role: 'B_ROLE',
      default_warehouse: null,
      default_database: null,
      default_schema: null,
      private_key_path: null
    });
    insertProfile({
      id: 'a',
      name: 'Alpha',
      account_url: 'https://a.snowflakecomputing.com',
      auth_method: 'externalbrowser',
      username: 'a@example.com',
      default_role: null,
      default_warehouse: 'WH',
      default_database: 'DB',
      default_schema: 'S',
      private_key_path: null
    });

    const list = listProfiles();
    expect(list.map((p) => p.id)).toEqual(['a', 'b']);

    const alpha = list[0]!;
    expect(alpha.accountUrl).toBe('https://a.snowflakecomputing.com');
    expect(alpha.authMethod).toBe('externalbrowser');
    expect(alpha.defaultWarehouse).toBe('WH');
    expect(alpha.defaultDatabase).toBe('DB');
    expect(alpha.defaultSchema).toBe('S');
    expect(alpha.defaultRole).toBeUndefined();

    const beta = list[1]!;
    expect(beta.defaultRole).toBe('B_ROLE');
    expect(beta.defaultWarehouse).toBeUndefined();
  });
});

describe('saveProfile', () => {
  test('inserts a new profile when id is unseen', async () => {
    const r = await saveProfile(profileFixture());
    expect(r).toEqual({ id: 'p1' });
    const list = listProfiles();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Test Profile');
    expect(list[0]?.defaultRole).toBe('SYSADMIN');
  });

  test('updates an existing profile when id already exists', async () => {
    await saveProfile(profileFixture());
    await saveProfile(profileFixture({ name: 'Renamed', defaultRole: 'POWER_USER' }));

    const list = listProfiles();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Renamed');
    expect(list[0]?.defaultRole).toBe('POWER_USER');
  });

  test('normalizes empty/whitespace optional fields to undefined', async () => {
    await saveProfile(
      profileFixture({
        defaultRole: '   ',
        defaultSchema: '',
        defaultWarehouse: undefined
      })
    );
    const stored = listProfiles()[0]!;
    expect(stored.defaultRole).toBeUndefined();
    expect(stored.defaultSchema).toBeUndefined();
    expect(stored.defaultWarehouse).toBeUndefined();
  });

  test('rejects calls without an id', async () => {
    await expect(saveProfile({ ...profileFixture(), id: '' } as ConnectionProfile)).rejects.toThrow(
      /id is required/
    );
  });
});

describe('deleteProfile', () => {
  test('removes the row from storage', async () => {
    await saveProfile(profileFixture());
    expect(listProfiles()).toHaveLength(1);

    await deleteProfile('p1');
    expect(listProfiles()).toEqual([]);
  });

  test('cleans up every profile:${id}:* secret and leaves other profiles alone', async () => {
    await saveProfile(profileFixture({ id: 'p1' }));
    await saveProfile(profileFixture({ id: 'p2', name: 'Second' }));
    await setSecret('profile:p1:password', 'hunter2');
    await setSecret('profile:p1:refresh_token', 'xyz');
    await setSecret('profile:p2:password', 'untouched');
    await setSecret('unrelated', 'leave-me');

    await deleteProfile('p1');

    const keys = await listKeys();
    expect(keys.sort()).toEqual(['profile:p2:password', 'unrelated']);
  });

  test('succeeds when no secrets are stored for the profile', async () => {
    await saveProfile(profileFixture());
    await deleteProfile('p1');
    expect(listProfiles()).toEqual([]);
  });
});

describe('testConnection', () => {
  test('returns ok=false with a clear message when the profile does not exist', async () => {
    const r = await testConnection('does-not-exist');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not found/i);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('returns ok=false when password-auth profile has no stored password', async () => {
    await saveProfile(profileFixture({ authMethod: 'password' }));
    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/password/i);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('returns ok=true and runs SELECT CURRENT_ROLE() through the injected session', async () => {
    await saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

    const executed: string[] = [];
    const factory: SessionFactory = async (profile) => {
      expect(profile.accountUrl).toBe('https://example.snowflakecomputing.com');
      expect(profile.authMethod).toBe('externalbrowser');
      expect(profile.defaultRole).toBe('SYSADMIN');
      return makeFakeSession({ onRun: (sql) => executed.push(sql) });
    };
    __setSessionFactoryForTesting(factory);

    const r = await testConnection('p1');
    expect(r.ok).toBe(true);
    expect(executed).toEqual(['SELECT CURRENT_ROLE() AS ROLE']);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('returns ok=false when session factory throws (auth failure)', async () => {
    await saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

    __setSessionFactoryForTesting(async () => {
      throw new Error('Auth failed: invalid token');
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Auth failed/);
  });

  test('returns ok=false and still closes the session when the test query errors', async () => {
    await saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

    let closed = false;
    __setSessionFactoryForTesting(async () =>
      makeFakeSession({
        errorOn: new Error('Network broken'),
        closeImpl: () => {
          closed = true;
        }
      })
    );

    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Network broken/);
    expect(closed).toBe(true);
  });

  test('forwards the stored password to session.open for password-auth profiles', async () => {
    await saveProfile(profileFixture({ authMethod: 'password' }));
    await setSecret('profile:p1:password', 'stored-pw');

    let receivedPassword: string | undefined;
    __setSessionFactoryForTesting(async (_p, _ctx, options) => {
      receivedPassword = options.password;
      return makeFakeSession();
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(true);
    expect(receivedPassword).toBe('stored-pw');
  });

  test('does not request a password for externalbrowser-auth profiles', async () => {
    await saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

    let receivedOptionsKeys: string[] = [];
    __setSessionFactoryForTesting(async (_p, _ctx, options) => {
      receivedOptionsKeys = Object.keys(options);
      return makeFakeSession();
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(true);
    expect(receivedOptionsKeys).not.toContain('password');
  });

  test('never throws across the boundary — string error becomes ok:false message', async () => {
    await saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

    __setSessionFactoryForTesting(async () => {
      throw 'string-error-not-an-Error-instance';
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toBe('string-error-not-an-Error-instance');
  });

  test('Snowflake 390190 (no SSO configured) -> friendly hint about switching auth method', async () => {
    await saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

    __setSessionFactoryForTesting(async () => {
      throw new Error(
        'Authentication failed. Error code: 390190, message: There was an error related to the SAML Identity Provider account parameter. Contact Snowflake support.'
      );
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('does not have SSO');
    expect(r.message).toContain('Password');
    expect(r.message).not.toContain('Contact Snowflake support');
  });

  test('Snowflake 390100 (bad password) -> friendly hint', async () => {
    await saveProfile(profileFixture({ authMethod: 'password' }));
    await setSecret('profile:p1:password', 'secret');

    __setSessionFactoryForTesting(async () => {
      throw new Error('Error code: 390100, Incorrect username or password.');
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Incorrect username or password');
    expect(r.message).toContain('Double-check');
  });

  test('DNS error -> friendly hint about the Account URL', async () => {
    await saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

    __setSessionFactoryForTesting(async () => {
      throw new Error('getaddrinfo ENOTFOUND nonsense.snowflakecomputing.com');
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Cannot reach Snowflake');
    expect(r.message).toContain('Account URL');
  });
});

describe('setPasswordForProfile / hasPasswordForProfile / clearPasswordForProfile', () => {
  test('round-trips a password through safeStorage keyed by profile id', async () => {
    await saveProfile(profileFixture({ authMethod: 'password' }));

    expect(await hasPasswordForProfile('p1')).toBe(false);

    await setPasswordForProfile('p1', 'hunter2');

    expect(await hasPasswordForProfile('p1')).toBe(true);
    const keys = await listKeys();
    expect(keys).toContain('profile:p1:password');
  });

  test('clearPasswordForProfile deletes only the matching key', async () => {
    await saveProfile(profileFixture({ authMethod: 'password' }));
    await setPasswordForProfile('p1', 'hunter2');
    await setSecret('other-key', 'unrelated');

    await clearPasswordForProfile('p1');

    expect(await hasPasswordForProfile('p1')).toBe(false);
    const keys = await listKeys();
    expect(keys).toContain('other-key');
    expect(keys).not.toContain('profile:p1:password');
  });

  test('setPasswordForProfile rejects empty profile id or password', async () => {
    await saveProfile(profileFixture({ authMethod: 'password' }));

    await expect(setPasswordForProfile('', 'hunter2')).rejects.toThrow(
      /profileId is required/
    );
    await expect(setPasswordForProfile('p1', '')).rejects.toThrow(
      /password must be a non-empty string/
    );
  });

  test('setPasswordForProfile rejects unknown profile id', async () => {
    await expect(setPasswordForProfile('ghost', 'hunter2')).rejects.toThrow(
      /profile not found/
    );
  });

  test('testConnection succeeds after setPasswordForProfile -> session factory receives the password', async () => {
    await saveProfile(profileFixture({ authMethod: 'password' }));
    await setPasswordForProfile('p1', 'hunter2');

    let receivedPassword: string | undefined;
    __setSessionFactoryForTesting(async (_lite, _ctx, options) => {
      receivedPassword = options.password;
      return makeFakeSession();
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(true);
    expect(receivedPassword).toBe('hunter2');
  });

  test('testConnection error message no longer references T3.2', async () => {
    await saveProfile(profileFixture({ authMethod: 'password' }));
    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).not.toContain('T3.2');
    expect(r.message).toContain('Edit the profile and enter your Snowflake password');
  });

  test('testConnection password_mfa without passcode + no cached token -> SDK error surfaces', async () => {
    await saveProfile(profileFixture({ authMethod: 'password_mfa' }));
    await setPasswordForProfile('p1', 'hunter2');

    __setSessionFactoryForTesting(async () => {
      throw new Error(
        'Failed to authenticate: MFA with TOTP is required. To authenticate, provide both your password and a current TOTP passcode.'
      );
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('TOTP');
  });

  test('testConnection password_mfa passes passcode through to the session factory', async () => {
    await saveProfile(profileFixture({ authMethod: 'password_mfa' }));
    await setPasswordForProfile('p1', 'hunter2');

    let receivedPassword: string | undefined;
    let receivedPasscode: string | undefined;
    __setSessionFactoryForTesting(async (_lite, _ctx, options) => {
      receivedPassword = options.password;
      receivedPasscode = options.passcode;
      return makeFakeSession();
    });

    const r = await testConnection('p1', '123456');
    expect(r.ok).toBe(true);
    expect(receivedPassword).toBe('hunter2');
    expect(receivedPasscode).toBe('123456');
  });

  test('testConnection trims whitespace from passcode', async () => {
    await saveProfile(profileFixture({ authMethod: 'password_mfa' }));
    await setPasswordForProfile('p1', 'hunter2');

    let receivedPasscode: string | undefined;
    __setSessionFactoryForTesting(async (_lite, _ctx, options) => {
      receivedPasscode = options.passcode;
      return makeFakeSession();
    });

    const r = await testConnection('p1', '  123456  ');
    expect(r.ok).toBe(true);
    expect(receivedPasscode).toBe('123456');
  });

  test('testConnection pat without stored token returns a PAT-specific error', async () => {
    await saveProfile(profileFixture({ authMethod: 'pat' }));
    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Personal Access Token');
  });

  test('testConnection pat with stored token forwards it to the session factory', async () => {
    await saveProfile(profileFixture({ authMethod: 'pat' }));
    await setPasswordForProfile('p1', 'pat-secret-xyz');

    let receivedPassword: string | undefined;
    __setSessionFactoryForTesting(async (_lite, _ctx, options) => {
      receivedPassword = options.password;
      return makeFakeSession();
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(true);
    expect(receivedPassword).toBe('pat-secret-xyz');
  });
});

describe('key-pair auth (M2.1b)', () => {
  const PASSPHRASE = 'correct horse battery staple';
  let keyDir: string;
  let plainKey: string;
  let encryptedKey: string;
  let fingerprint: string;

  beforeAll(async () => {
    keyDir = await mkdtemp(path.join(tmpdir(), 'snowboy-conn-keys-'));
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    plainKey = path.join(keyDir, 'plain.p8');
    encryptedKey = path.join(keyDir, 'encrypted.p8');
    await writeFile(plainKey, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await writeFile(
      encryptedKey,
      privateKey.export({
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: PASSPHRASE
      })
    );
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    fingerprint = `SHA256:${createHash('sha256').update(spki).digest('base64')}`;
  });

  afterAll(async () => {
    await rm(keyDir, { recursive: true, force: true });
  });

  function keyPairFixture(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
    return profileFixture({
      authMethod: 'keypair',
      username: 'svc_loader',
      privateKeyPath: encryptedKey,
      ...overrides
    });
  }

  describe('profile storage', () => {
    test('saveProfile/listProfiles round-trip the private key path', async () => {
      await saveProfile(keyPairFixture());
      const stored = listProfiles()[0]!;
      expect(stored.authMethod).toBe('keypair');
      expect(stored.privateKeyPath).toBe(encryptedKey);
    });

    test('keeps the path only for keypair profiles; switching away clears it', async () => {
      await saveProfile(
        profileFixture({ authMethod: 'password', privateKeyPath: '/stale/key.p8' })
      );
      expect(listProfiles()[0]!.privateKeyPath).toBeUndefined();

      await saveProfile(keyPairFixture());
      expect(listProfiles()[0]!.privateKeyPath).toBe(encryptedKey);

      await saveProfile(keyPairFixture({ authMethod: 'externalbrowser' }));
      expect(listProfiles()[0]!.privateKeyPath).toBeUndefined();
    });

    test('rejects a relative key path instead of storing it', async () => {
      await expect(
        saveProfile(keyPairFixture({ privateKeyPath: 'keys/rsa_key.p8' }))
      ).rejects.toThrow(/absolute/);
      expect(listProfiles()).toEqual([]);
    });
  });

  describe('secret cleanup when saving (auth-method switch)', () => {
    test('switching to key-pair deletes the stored password or PAT', async () => {
      await saveProfile(profileFixture({ authMethod: 'pat' }));
      await setPasswordForProfile('p1', 'pat-secret');

      await saveProfile(keyPairFixture());

      expect(await listKeys()).toEqual([]);
    });

    test('switching away from key-pair deletes the stored passphrase', async () => {
      await saveProfile(keyPairFixture());
      await setPrivateKeyPassphraseForProfile('p1', PASSPHRASE);

      await saveProfile(keyPairFixture({ authMethod: 'password' }));

      expect(await listKeys()).toEqual([]);
    });

    test("keeps the secret the profile's method uses", async () => {
      await saveProfile(keyPairFixture());
      await setPrivateKeyPassphraseForProfile('p1', PASSPHRASE);
      await saveProfile(keyPairFixture({ name: 'Renamed' }));
      expect(await listKeys()).toEqual(['profile:p1:private_key_passphrase']);

      for (const authMethod of ['password', 'password_mfa', 'pat'] as const) {
        await saveProfile(profileFixture({ id: authMethod, name: authMethod, authMethod }));
        await setPasswordForProfile(authMethod, 'secret');
        await saveProfile(
          profileFixture({ id: authMethod, name: `${authMethod} renamed`, authMethod })
        );
        expect(await listKeys()).toContain(`profile:${authMethod}:password`);
      }
    });

    test('an SSO profile keeps neither secret', async () => {
      await saveProfile(keyPairFixture());
      await setPrivateKeyPassphraseForProfile('p1', PASSPHRASE);
      await setSecret('profile:p1:password', 'left over');
      await setSecret('profile:p2:password', 'another profile');

      await saveProfile(keyPairFixture({ authMethod: 'externalbrowser' }));

      expect(await listKeys()).toEqual(['profile:p2:password']);
    });
  });

  describe('passphrase secret', () => {
    test('is stored under profile:${id}:private_key_passphrase, apart from the password', async () => {
      await saveProfile(keyPairFixture());
      expect(await hasPrivateKeyPassphraseForProfile('p1')).toBe(false);

      await setPrivateKeyPassphraseForProfile('p1', PASSPHRASE);

      expect(await hasPrivateKeyPassphraseForProfile('p1')).toBe(true);
      expect(await hasPasswordForProfile('p1')).toBe(false);
      expect(await listKeys()).toEqual(['profile:p1:private_key_passphrase']);
    });

    test('clearPrivateKeyPassphraseForProfile deletes only the passphrase', async () => {
      await saveProfile(keyPairFixture());
      await setPrivateKeyPassphraseForProfile('p1', PASSPHRASE);
      await setSecret('other-key', 'unrelated');

      await clearPrivateKeyPassphraseForProfile('p1');

      expect(await hasPrivateKeyPassphraseForProfile('p1')).toBe(false);
      expect(await listKeys()).toEqual(['other-key']);
    });

    test('rejects an empty passphrase, an unknown profile, and a non-keypair profile', async () => {
      await saveProfile(keyPairFixture());
      await saveProfile(profileFixture({ id: 'pw', name: 'Password', authMethod: 'password' }));

      await expect(setPrivateKeyPassphraseForProfile('p1', '')).rejects.toThrow(/non-empty/);
      await expect(setPrivateKeyPassphraseForProfile('ghost', PASSPHRASE)).rejects.toThrow(
        /profile not found/
      );
      await expect(setPrivateKeyPassphraseForProfile('pw', PASSPHRASE)).rejects.toThrow(/key-pair/);
      expect(await listKeys()).toEqual([]);
    });

    test('deleteProfile removes the stored passphrase', async () => {
      await saveProfile(keyPairFixture());
      await setPrivateKeyPassphraseForProfile('p1', PASSPHRASE);

      await deleteProfile('p1');

      expect(await listKeys()).toEqual([]);
    });
  });

  describe('checkPrivateKey', () => {
    test('uses a typed passphrase', async () => {
      const result = await checkPrivateKey(encryptedKey, PASSPHRASE);
      expect(result).toEqual({ ok: true, encrypted: true, fingerprint });
    });

    test('falls back to the stored passphrase when given a profileId', async () => {
      await saveProfile(keyPairFixture());
      await setPrivateKeyPassphraseForProfile('p1', PASSPHRASE);

      const result = await checkPrivateKey(encryptedKey, undefined, 'p1');
      expect(result).toEqual({ ok: true, encrypted: true, fingerprint });
    });

    test('says so when the stored passphrase is the one that fails', async () => {
      await saveProfile(keyPairFixture());
      await setPrivateKeyPassphraseForProfile('p1', 'passphrase of an older key');

      const result = await checkPrivateKey(encryptedKey, undefined, 'p1');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problem).toBe('wrong_passphrase');
      expect(result.message).toMatch(/stored passphrase/i);
    });

    test('a typed passphrase wins over the stored one', async () => {
      await saveProfile(keyPairFixture());
      await setPrivateKeyPassphraseForProfile('p1', PASSPHRASE);

      const result = await checkPrivateKey(encryptedKey, 'typo', 'p1');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problem).toBe('wrong_passphrase');
    });

    test('refuses relative and non-string paths without reading anything', async () => {
      const relative = await checkPrivateKey('rsa_key.p8');
      expect(relative.ok).toBe(false);
      if (relative.ok) return;
      expect(relative.problem).toBe('not_found');
      expect(relative.message).toMatch(/absolute/i);

      const notAString = await checkPrivateKey(42 as unknown as string);
      expect(notAString.ok).toBe(false);
      if (notAString.ok) return;
      expect(notAString.problem).toBe('not_found');
    });

    test('reports a missing passphrase and a missing file specifically', async () => {
      const noPass = await checkPrivateKey(encryptedKey);
      expect(noPass.ok).toBe(false);
      if (noPass.ok) return;
      expect(noPass.problem).toBe('passphrase_required');

      const missing = await checkPrivateKey(path.join(keyDir, 'gone.p8'));
      expect(missing.ok).toBe(false);
      if (missing.ok) return;
      expect(missing.problem).toBe('not_found');
    });
  });

  describe('testConnection', () => {
    test('passes the key path and the stored passphrase to the session factory', async () => {
      await saveProfile(keyPairFixture());
      await setPrivateKeyPassphraseForProfile('p1', PASSPHRASE);

      let receivedPath: string | undefined;
      let receivedMethod: string | undefined;
      let receivedPassphrase: string | undefined;
      __setSessionFactoryForTesting(async (lite, _ctx, options) => {
        receivedMethod = lite.authMethod;
        receivedPath = lite.privateKeyPath;
        receivedPassphrase = options.password;
        return makeFakeSession();
      });

      const r = await testConnection('p1');
      expect(r.ok).toBe(true);
      expect(receivedMethod).toBe('keypair');
      expect(receivedPath).toBe(encryptedKey);
      expect(receivedPassphrase).toBe(PASSPHRASE);
    });

    test('does not forward a stored passphrase for an unencrypted key', async () => {
      await saveProfile(keyPairFixture({ privateKeyPath: plainKey }));
      await setPrivateKeyPassphraseForProfile('p1', 'left over from an older key');

      let receivedOptionsKeys: string[] = [];
      __setSessionFactoryForTesting(async (_lite, _ctx, options) => {
        receivedOptionsKeys = Object.keys(options);
        return makeFakeSession();
      });

      const r = await testConnection('p1');
      expect(r.ok).toBe(true);
      expect(receivedOptionsKeys).not.toContain('password');
    });

    test('fails before connecting when no key file is set', async () => {
      await saveProfile(keyPairFixture({ privateKeyPath: undefined }));
      let connected = false;
      __setSessionFactoryForTesting(async () => {
        connected = true;
        return makeFakeSession();
      });

      const r = await testConnection('p1');
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/private key file/i);
      expect(connected).toBe(false);
    });

    test('fails before connecting when the key file is missing', async () => {
      const gone = path.join(keyDir, 'moved-away.p8');
      await saveProfile(keyPairFixture({ privateKeyPath: gone }));
      let connected = false;
      __setSessionFactoryForTesting(async () => {
        connected = true;
        return makeFakeSession();
      });

      const r = await testConnection('p1');
      expect(r.ok).toBe(false);
      expect(r.message).toContain('not found');
      expect(r.message).toContain(gone);
      expect(connected).toBe(false);
    });

    test('fails before connecting when the key is encrypted and no passphrase is stored', async () => {
      await saveProfile(keyPairFixture());
      let connected = false;
      __setSessionFactoryForTesting(async () => {
        connected = true;
        return makeFakeSession();
      });

      const r = await testConnection('p1');
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/encrypted/i);
      expect(r.message).toMatch(/Edit the profile/);
      expect(connected).toBe(false);
    });

    test('fails before connecting when the stored passphrase is wrong', async () => {
      await saveProfile(keyPairFixture());
      await setPrivateKeyPassphraseForProfile('p1', 'not the passphrase');
      let connected = false;
      __setSessionFactoryForTesting(async () => {
        connected = true;
        return makeFakeSession();
      });

      const r = await testConnection('p1');
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/passphrase/i);
      expect(r.message).not.toContain('not the passphrase');
      expect(connected).toBe(false);
    });

    test('"JWT token is invalid" -> key registration hint naming the key fingerprint', async () => {
      await saveProfile(keyPairFixture({ privateKeyPath: plainKey }));
      __setSessionFactoryForTesting(async () => {
        throw new Error('JWT token is invalid. [7f2c9a1e-0b44-4c3d-9a55-2e8b1f6d0c11]');
      });

      const r = await testConnection('p1');
      expect(r.ok).toBe(false);
      expect(r.message).toContain('RSA_PUBLIC_KEY_FP');
      expect(r.message).toContain(fingerprint);
      expect(r.message).toContain('ALTER USER');
      expect(r.message).not.toMatch(/expired/i);
    });

    test('Snowflake code 390144 alone maps to the same hint', async () => {
      await saveProfile(keyPairFixture({ privateKeyPath: plainKey }));
      __setSessionFactoryForTesting(async () => {
        throw new Error('Failed to connect to DB. Error code: 390144');
      });

      const r = await testConnection('p1');
      expect(r.ok).toBe(false);
      expect(r.message).toContain('RSA_PUBLIC_KEY_FP');
    });
  });

  describe('pickPrivateKeyFile', () => {
    test('returns the path chosen in the native dialog', async () => {
      __setOpenDialogForTesting(async () => ({
        canceled: false,
        filePaths: ['/home/me/.snowflake/rsa_key.p8']
      }));
      expect(await pickPrivateKeyFile()).toBe('/home/me/.snowflake/rsa_key.p8');
    });

    test('asks for one file, filtered to .p8/.pem with an all-files fallback', async () => {
      let seen: OpenDialogOptions | undefined;
      __setOpenDialogForTesting(async (options) => {
        seen = options;
        return { canceled: true, filePaths: [] };
      });

      await pickPrivateKeyFile();

      expect(seen?.properties).toContain('openFile');
      expect(seen?.properties).not.toContain('multiSelections');
      expect(seen?.filters?.[0]?.extensions).toEqual(['p8', 'pem']);
      expect(seen?.filters?.some((f) => f.extensions.includes('*'))).toBe(true);
    });

    test('returns null when the dialog is cancelled', async () => {
      __setOpenDialogForTesting(async () => ({ canceled: true, filePaths: [] }));
      expect(await pickPrivateKeyFile()).toBeNull();
    });

    test('register() wires the picker and the other key-pair channels', async () => {
      const handlers = new Map<string, (...args: unknown[]) => unknown>();
      const fakeIpcMain = {
        handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
          handlers.set(channel, fn);
        }
      } as unknown as IpcMain;

      register(fakeIpcMain);

      for (const channel of [
        CHANNELS.connections.pickPrivateKeyFile,
        CHANNELS.connections.checkPrivateKey,
        CHANNELS.connections.setPrivateKeyPassphrase,
        CHANNELS.connections.clearPrivateKeyPassphrase,
        CHANNELS.connections.hasPrivateKeyPassphrase
      ]) {
        expect(handlers.has(channel)).toBe(true);
      }

      let requester: unknown = null;
      __setOpenDialogForTesting(async (_options, sender) => {
        requester = sender;
        return { canceled: false, filePaths: [plainKey] };
      });
      const sender = { id: 7 };
      const pick = handlers.get(CHANNELS.connections.pickPrivateKeyFile)!;
      expect(await pick({ sender })).toBe(plainKey);
      // The dialog is parented to the window whose renderer asked for it.
      expect(requester).toBe(sender);

      await saveProfile(keyPairFixture());
      const setPassphrase = handlers.get(CHANNELS.connections.setPrivateKeyPassphrase)!;
      await setPassphrase({}, 'p1', PASSPHRASE);
      const check = handlers.get(CHANNELS.connections.checkPrivateKey)!;
      expect(await check({}, encryptedKey, undefined, 'p1')).toEqual({
        ok: true,
        encrypted: true,
        fingerprint
      });
      const hasPassphrase = handlers.get(CHANNELS.connections.hasPrivateKeyPassphrase)!;
      expect(await hasPassphrase({}, 'p1')).toBe(true);
      const clearPassphrase = handlers.get(CHANNELS.connections.clearPrivateKeyPassphrase)!;
      await clearPassphrase({}, 'p1');
      expect(await hasPassphrase({}, 'p1')).toBe(false);
    });
  });
});
