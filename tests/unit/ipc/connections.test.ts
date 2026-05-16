import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  __setSessionFactoryForTesting,
  deleteProfile,
  listProfiles,
  saveProfile,
  testConnection,
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
      default_schema: null
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
      default_schema: 'S'
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
  test('inserts a new profile when id is unseen', () => {
    const r = saveProfile(profileFixture());
    expect(r).toEqual({ id: 'p1' });
    const list = listProfiles();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Test Profile');
    expect(list[0]?.defaultRole).toBe('SYSADMIN');
  });

  test('updates an existing profile when id already exists', () => {
    saveProfile(profileFixture());
    saveProfile(profileFixture({ name: 'Renamed', defaultRole: 'POWER_USER' }));

    const list = listProfiles();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Renamed');
    expect(list[0]?.defaultRole).toBe('POWER_USER');
  });

  test('normalizes empty/whitespace optional fields to undefined', () => {
    saveProfile(
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

  test('rejects calls without an id', () => {
    expect(() =>
      saveProfile({ ...profileFixture(), id: '' } as ConnectionProfile)
    ).toThrow(/id is required/);
  });
});

describe('deleteProfile', () => {
  test('removes the row from storage', async () => {
    saveProfile(profileFixture());
    expect(listProfiles()).toHaveLength(1);

    await deleteProfile('p1');
    expect(listProfiles()).toEqual([]);
  });

  test('cleans up every profile:${id}:* secret and leaves other profiles alone', async () => {
    saveProfile(profileFixture({ id: 'p1' }));
    saveProfile(profileFixture({ id: 'p2', name: 'Second' }));
    await setSecret('profile:p1:password', 'hunter2');
    await setSecret('profile:p1:refresh_token', 'xyz');
    await setSecret('profile:p2:password', 'untouched');
    await setSecret('unrelated', 'leave-me');

    await deleteProfile('p1');

    const keys = await listKeys();
    expect(keys.sort()).toEqual(['profile:p2:password', 'unrelated']);
  });

  test('succeeds when no secrets are stored for the profile', async () => {
    saveProfile(profileFixture());
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
    saveProfile(profileFixture({ authMethod: 'password' }));
    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/password/i);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('returns ok=true and runs SELECT CURRENT_ROLE() through the injected session', async () => {
    saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

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
    saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

    __setSessionFactoryForTesting(async () => {
      throw new Error('Auth failed: invalid token');
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Auth failed/);
  });

  test('returns ok=false and still closes the session when the test query errors', async () => {
    saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

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
    saveProfile(profileFixture({ authMethod: 'password' }));
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
    saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

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
    saveProfile(profileFixture({ authMethod: 'externalbrowser' }));

    __setSessionFactoryForTesting(async () => {
      throw 'string-error-not-an-Error-instance';
    });

    const r = await testConnection('p1');
    expect(r.ok).toBe(false);
    expect(r.message).toBe('string-error-not-an-Error-instance');
  });
});
