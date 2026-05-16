import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  __clearSessionsForTesting,
  __setSessionFactoryForTesting,
  closeAllSessions,
  closeSession,
  getSession,
  openSession,
  setSessionContext,
  type SessionFactory
} from '../../../src/main/ipc/sessions';
import {
  __setSafeStorageForTesting,
  __setStoragePathForTesting,
  setSecret,
  type SafeStorageImpl
} from '../../../src/main/secrets/safeStorage';
import { closeDatabase, openDatabase } from '../../../src/main/storage/db';
import { insertProfile } from '../../../src/main/storage/profiles';
import type { Session } from '../../../src/main/snowflake/session';
import type {
  ConnectionProfileLite,
  SessionContext as DriverSessionContext
} from '../../../src/main/snowflake/types';
import type { SessionId } from '../../../src/main/types';

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

interface FakeSessionConfig {
  id?: string;
  profileId?: string;
  closeImpl?: () => Promise<void> | void;
  setContextImpl?: (patch: Partial<DriverSessionContext>) => Promise<void> | void;
}

function makeFakeSession(config: FakeSessionConfig = {}): Session {
  const sessionId = config.id ?? `fake-session-${Math.random().toString(36).slice(2, 10)}`;
  const profileId = config.profileId ?? 'p1';
  const fake = {
    getId: () => sessionId,
    getProfileId: () => profileId,
    close: async () => {
      await config.closeImpl?.();
    },
    setContext: async (patch: Partial<DriverSessionContext>) => {
      await config.setContextImpl?.(patch);
    }
  };
  return fake as unknown as Session;
}

let tmpRoot: string;

beforeEach(async () => {
  openDatabase({ path: ':memory:', migrationsDir: MIGRATIONS_DIR });
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'snowboy-sess-ipc-'));
  __setStoragePathForTesting(path.join(tmpRoot, 'secrets.json'));
  __setSafeStorageForTesting(makeMockSafeStorage());
});

afterEach(async () => {
  __setSessionFactoryForTesting(null);
  __clearSessionsForTesting();
  __setSafeStorageForTesting(null);
  __setStoragePathForTesting(null);
  closeDatabase();
  await rm(tmpRoot, { recursive: true, force: true });
});

function seedProfile(overrides: Partial<Parameters<typeof insertProfile>[0]> = {}): void {
  insertProfile({
    id: 'p1',
    name: 'Test Profile',
    account_url: 'https://example.snowflakecomputing.com',
    auth_method: 'externalbrowser',
    username: 'analyst',
    default_role: 'SYSADMIN',
    default_warehouse: 'WH_XS',
    default_database: null,
    default_schema: null,
    ...overrides
  });
}

describe('openSession', () => {
  test('opens a session and registers it in the registry', async () => {
    seedProfile();

    let factoryArgs: {
      profile: ConnectionProfileLite;
      context: DriverSessionContext;
      options: { password?: string };
    } | null = null;
    const factory: SessionFactory = async (profile, context, options) => {
      factoryArgs = { profile, context, options };
      return makeFakeSession({ id: 'session-1', profileId: 'p1' });
    };
    __setSessionFactoryForTesting(factory);

    const id = await openSession('p1', { role: 'POWER_USER' });

    expect(id).toBe('session-1' as SessionId);
    expect(getSession(id)).toBeDefined();
    expect(factoryArgs).not.toBeNull();
    expect(factoryArgs!.profile.id).toBe('p1');
    expect(factoryArgs!.profile.accountUrl).toBe('https://example.snowflakecomputing.com');
    expect(factoryArgs!.profile.defaultRole).toBe('SYSADMIN');
    expect(factoryArgs!.context).toEqual({ role: 'POWER_USER' });
    expect(factoryArgs!.options.password).toBeUndefined();
  });

  test('throws when profileId is missing or empty', async () => {
    await expect(openSession('', {})).rejects.toThrow(/profileId is required/);
  });

  test('throws when the profile does not exist', async () => {
    await expect(openSession('does-not-exist', {})).rejects.toThrow(/profile not found/);
  });

  test('throws with a clear message when password-auth profile has no stored password', async () => {
    seedProfile({ auth_method: 'password' });
    __setSessionFactoryForTesting(async () => makeFakeSession());

    await expect(openSession('p1', {})).rejects.toThrow(/no password stored/);
  });

  test('forwards the stored password to the factory for password-auth profiles', async () => {
    seedProfile({ auth_method: 'password' });
    await setSecret('profile:p1:password', 'hunter2');

    let receivedPassword: string | undefined;
    __setSessionFactoryForTesting(async (_p, _ctx, options) => {
      receivedPassword = options.password;
      return makeFakeSession({ id: 'session-2' });
    });

    const id = await openSession('p1', {});
    expect(id).toBe('session-2' as SessionId);
    expect(receivedPassword).toBe('hunter2');
  });

  test('omits password from options for externalbrowser auth', async () => {
    seedProfile({ auth_method: 'externalbrowser' });

    let receivedOptionsKeys: string[] = [];
    __setSessionFactoryForTesting(async (_p, _ctx, options) => {
      receivedOptionsKeys = Object.keys(options);
      return makeFakeSession({ id: 'session-3' });
    });

    await openSession('p1', {});
    expect(receivedOptionsKeys).not.toContain('password');
  });

  test('translates an empty SessionContext into an empty driver context', async () => {
    seedProfile();

    let receivedContext: DriverSessionContext | null = null;
    __setSessionFactoryForTesting(async (_p, ctx) => {
      receivedContext = ctx;
      return makeFakeSession({ id: 'session-4' });
    });

    await openSession('p1', {});
    expect(receivedContext).toEqual({});
  });
});

describe('closeSession', () => {
  test('removes the session from the registry and calls close on it', async () => {
    seedProfile();

    let closed = false;
    __setSessionFactoryForTesting(async () =>
      makeFakeSession({
        id: 'session-x',
        closeImpl: () => {
          closed = true;
        }
      })
    );

    const id = await openSession('p1', {});
    expect(getSession(id)).toBeDefined();

    await closeSession(id);

    expect(getSession(id)).toBeUndefined();
    expect(closed).toBe(true);
  });

  test('is idempotent on a missing id', async () => {
    await expect(closeSession('never-opened' as SessionId)).resolves.toBeUndefined();
  });

  test('rejects when sessionId is empty', async () => {
    await expect(closeSession('' as SessionId)).rejects.toThrow(/sessionId is required/);
  });

  test('removes the session from the registry even if close throws', async () => {
    seedProfile();
    __setSessionFactoryForTesting(async () =>
      makeFakeSession({
        id: 'session-y',
        closeImpl: () => {
          throw new Error('boom on close');
        }
      })
    );

    const id = await openSession('p1', {});

    await closeSession(id);

    expect(getSession(id)).toBeUndefined();
  });
});

describe('setSessionContext', () => {
  test('forwards a partial context to Session.setContext', async () => {
    seedProfile();

    let received: Partial<DriverSessionContext> | null = null;
    __setSessionFactoryForTesting(async () =>
      makeFakeSession({
        id: 'session-ctx',
        setContextImpl: (patch) => {
          received = patch;
        }
      })
    );

    const id = await openSession('p1', {});
    await setSessionContext(id, { warehouse: 'WH_LARGE', schema: 'PUBLIC' });

    expect(received).toEqual({ warehouse: 'WH_LARGE', schema: 'PUBLIC' });
  });

  test('throws when sessionId is unknown', async () => {
    await expect(
      setSessionContext('unknown' as SessionId, { role: 'X' })
    ).rejects.toThrow(/Session not found/);
  });

  test('throws when sessionId is empty', async () => {
    await expect(setSessionContext('' as SessionId, {})).rejects.toThrow(
      /sessionId is required/
    );
  });
});

describe('closeAllSessions', () => {
  test('closes and removes every registered session', async () => {
    seedProfile();
    seedProfile({ id: 'p2', name: 'Second' });

    const closedIds: string[] = [];
    let nextId = 0;
    __setSessionFactoryForTesting(async (profile) => {
      const id = `session-${nextId++}`;
      return makeFakeSession({
        id,
        profileId: profile.id,
        closeImpl: () => {
          closedIds.push(id);
        }
      });
    });

    const id1 = await openSession('p1', {});
    const id2 = await openSession('p2', {});

    await closeAllSessions();

    expect(closedIds.sort()).toEqual(['session-0', 'session-1']);
    expect(getSession(id1)).toBeUndefined();
    expect(getSession(id2)).toBeUndefined();
  });

  test('continues draining when an individual close throws', async () => {
    seedProfile();
    seedProfile({ id: 'p2', name: 'Second' });

    let succeededCloses = 0;
    let nextId = 0;
    __setSessionFactoryForTesting(async () => {
      const id = `session-${nextId++}`;
      return makeFakeSession({
        id,
        closeImpl:
          id === 'session-0'
            ? () => {
                throw new Error('first close failed');
              }
            : () => {
                succeededCloses += 1;
              }
      });
    });

    const id1 = await openSession('p1', {});
    const id2 = await openSession('p2', {});

    await closeAllSessions();

    expect(succeededCloses).toBe(1);
    expect(getSession(id1)).toBeUndefined();
    expect(getSession(id2)).toBeUndefined();
  });
});
