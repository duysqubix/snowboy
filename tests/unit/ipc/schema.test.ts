import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getColumns,
  getDDL,
  listDatabases,
  listObjects,
  listSchemas
} from '../../../src/main/ipc/schema';
import {
  __clearSessionsForTesting,
  __setSessionFactoryForTesting,
  openSession,
  type SessionFactory
} from '../../../src/main/ipc/sessions';
import {
  __setSafeStorageForTesting,
  __setStoragePathForTesting,
  type SafeStorageImpl
} from '../../../src/main/secrets/safeStorage';
import { closeDatabase, openDatabase } from '../../../src/main/storage/db';
import { insertProfile } from '../../../src/main/storage/profiles';

import type { Session } from '../../../src/main/snowflake/session';
import type {
  ColumnMeta,
  RowBatch,
  StreamingCallbacks,
  StreamingHandle
} from '../../../src/main/snowflake/types';
import type { ObjectRef, SessionId } from '../../../src/main/types';

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

interface QueryResult {
  columns: ColumnMeta[];
  rows: unknown[][];
}

interface QueryStub {
  match: RegExp;
  result: QueryResult | (() => QueryResult);
}

interface FakeSessionConfig {
  id?: string;
  profileId?: string;
  stubs: QueryStub[];
  executed?: string[];
  onError?: Error;
}

function makeFakeSession(config: FakeSessionConfig): Session {
  const sessionId = config.id ?? 'fake-session';
  const profileId = config.profileId ?? 'p1';
  const recorded = config.executed ?? [];
  const fake = {
    getId: () => sessionId,
    getProfileId: () => profileId,
    close: async () => {},
    setContext: async () => {},
    runStreaming: (
      sql: string,
      _opts: unknown,
      callbacks: StreamingCallbacks
    ): StreamingHandle => {
      recorded.push(sql);
      queueMicrotask(() => {
        if (config.onError) {
          callbacks.onError(config.onError);
          return;
        }
        const stub = config.stubs.find((s) => s.match.test(sql));
        if (stub === undefined) {
          callbacks.onError(new Error(`fake session: no stub matched SQL: ${sql}`));
          return;
        }
        const data = typeof stub.result === 'function' ? stub.result() : stub.result;
        const batch: RowBatch = {
          rows: data.rows,
          columns: data.columns,
          offset: 0
        };
        callbacks.onBatch(batch);
        callbacks.onComplete({
          queryId: 'fake-qid',
          rowCount: data.rows.length,
          bytesScanned: 0,
          warehouseUsed: ''
        });
      });
      return {
        cancel: () => {},
        queryId: '',
        queryIdPromise: Promise.resolve('fake-qid')
      };
    }
  };
  return fake as unknown as Session;
}

let tmpRoot: string;
let executed: string[];

beforeEach(async () => {
  openDatabase({ path: ':memory:', migrationsDir: MIGRATIONS_DIR });
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'snowboy-schema-ipc-'));
  __setStoragePathForTesting(path.join(tmpRoot, 'secrets.json'));
  __setSafeStorageForTesting(makeMockSafeStorage());
  executed = [];
});

afterEach(async () => {
  __setSessionFactoryForTesting(null);
  __clearSessionsForTesting();
  __setSafeStorageForTesting(null);
  __setStoragePathForTesting(null);
  closeDatabase();
  await rm(tmpRoot, { recursive: true, force: true });
});

function seedProfile(id: string = 'p1'): void {
  insertProfile({
    id,
    name: `Profile ${id}`,
    account_url: 'https://example.snowflakecomputing.com',
    auth_method: 'externalbrowser',
    username: 'analyst',
    default_role: null,
    default_warehouse: null,
    default_database: null,
    default_schema: null
  });
}

async function openWithStubs(
  stubs: QueryStub[],
  profileId: string = 'p1'
): Promise<SessionId> {
  const factory: SessionFactory = async () =>
    makeFakeSession({
      id: `session-${profileId}`,
      profileId,
      stubs,
      executed
    });
  __setSessionFactoryForTesting(factory);
  return openSession(profileId, {});
}

const nameColumn: ColumnMeta = { name: 'name', type: 'VARCHAR', nullable: false };
const commentColumn: ColumnMeta = { name: 'comment', type: 'VARCHAR', nullable: true };

describe('listDatabases', () => {
  test('runs SHOW DATABASES and extracts the name column', async () => {
    seedProfile();
    const id = await openWithStubs([
      {
        match: /^SHOW DATABASES$/,
        result: {
          columns: [
            { name: 'created_on', type: 'TIMESTAMP_LTZ', nullable: false },
            nameColumn
          ],
          rows: [
            ['ts1', 'DB_ANALYTICS'],
            ['ts2', 'DB_RAW']
          ]
        }
      }
    ]);

    const names = await listDatabases(id);
    expect(names).toEqual(['DB_ANALYTICS', 'DB_RAW']);
    expect(executed).toEqual(['SHOW DATABASES']);
  });

  test('re-runs SHOW DATABASES on each call (caching deferred to Wave 4)', async () => {
    seedProfile();
    const id = await openWithStubs([
      {
        match: /^SHOW DATABASES$/,
        result: { columns: [nameColumn], rows: [['DB1']] }
      },
      {
        match: /^SHOW DATABASES$/,
        result: { columns: [nameColumn], rows: [['DB1']] }
      }
    ]);

    await listDatabases(id);
    await listDatabases(id);

    expect(executed).toEqual(['SHOW DATABASES', 'SHOW DATABASES']);
  });
});

describe('listSchemas', () => {
  test('runs SHOW SCHEMAS IN DATABASE with the identifier double-quoted', async () => {
    seedProfile();
    const id = await openWithStubs([
      {
        match: /^SHOW SCHEMAS IN DATABASE "DB_ANALYTICS"$/,
        result: {
          columns: [nameColumn],
          rows: [['PUBLIC'], ['STAGING'], ['INFORMATION_SCHEMA']]
        }
      }
    ]);

    const names = await listSchemas(id, 'DB_ANALYTICS');
    expect(names).toEqual(['PUBLIC', 'STAGING']);
    expect(executed).toEqual(['SHOW SCHEMAS IN DATABASE "DB_ANALYTICS"']);
  });

  test('escapes embedded double quotes in the database identifier', async () => {
    seedProfile();
    const id = await openWithStubs([
      {
        match: /^SHOW SCHEMAS IN DATABASE "weird""name"$/,
        result: { columns: [nameColumn], rows: [['PUBLIC']] }
      }
    ]);

    await listSchemas(id, 'weird"name');
    expect(executed).toEqual(['SHOW SCHEMAS IN DATABASE "weird""name"']);
  });

  test('rejects empty database', async () => {
    seedProfile();
    const id = await openWithStubs([]);
    await expect(listSchemas(id, '')).rejects.toThrow(/database is required/);
  });
});

describe('listObjects', () => {
  test('issues SHOW TABLES and SHOW VIEWS and returns a merged list', async () => {
    seedProfile();
    const id = await openWithStubs([
      {
        match: /^SHOW TABLES IN SCHEMA "DB_ANALYTICS"\."PUBLIC"$/,
        result: {
          columns: [nameColumn, commentColumn],
          rows: [
            ['CUSTOMERS', 'Customer master'],
            ['ORDERS', '']
          ]
        }
      },
      {
        match: /^SHOW VIEWS IN SCHEMA "DB_ANALYTICS"\."PUBLIC"$/,
        result: {
          columns: [nameColumn, commentColumn],
          rows: [['V_RECENT_ORDERS', null]]
        }
      }
    ]);

    const objects = await listObjects(id, 'DB_ANALYTICS', 'PUBLIC');
    expect(objects).toEqual([
      { name: 'CUSTOMERS', kind: 'table', comment: 'Customer master' },
      { name: 'ORDERS', kind: 'table' },
      { name: 'V_RECENT_ORDERS', kind: 'view' }
    ]);
    expect(executed.sort()).toEqual(
      [
        'SHOW TABLES IN SCHEMA "DB_ANALYTICS"."PUBLIC"',
        'SHOW VIEWS IN SCHEMA "DB_ANALYTICS"."PUBLIC"'
      ].sort()
    );
  });

  test('rejects empty schema', async () => {
    seedProfile();
    const id = await openWithStubs([]);
    await expect(listObjects(id, 'DB', '')).rejects.toThrow(/schema is required/);
  });
});

describe('getColumns', () => {
  test('runs INFORMATION_SCHEMA.COLUMNS with quoted database and escaped literals', async () => {
    seedProfile();
    const id = await openWithStubs([
      {
        match:
          /^SELECT column_name, data_type, is_nullable, comment FROM "DB_ANALYTICS"\.INFORMATION_SCHEMA\.COLUMNS WHERE table_schema = 'PUBLIC' AND table_name = 'CUSTOMERS' ORDER BY ordinal_position$/,
        result: {
          columns: [
            { name: 'column_name', type: 'VARCHAR', nullable: false },
            { name: 'data_type', type: 'VARCHAR', nullable: false },
            { name: 'is_nullable', type: 'VARCHAR', nullable: false },
            commentColumn
          ],
          rows: [
            ['ID', 'NUMBER', 'NO', null],
            ['NAME', 'VARCHAR', 'YES', 'Customer name'],
            ['EMAIL', 'VARCHAR', 'YES', '']
          ]
        }
      }
    ]);

    const obj: ObjectRef = {
      database: 'DB_ANALYTICS',
      schema: 'PUBLIC',
      name: 'CUSTOMERS',
      kind: 'table'
    };
    const cols = await getColumns(id, obj);
    expect(cols).toEqual([
      { name: 'ID', dataType: 'NUMBER', nullable: false },
      { name: 'NAME', dataType: 'VARCHAR', nullable: true, comment: 'Customer name' },
      { name: 'EMAIL', dataType: 'VARCHAR', nullable: true }
    ]);
  });

  test('escapes single quotes in schema/name to defend against malformed inputs', async () => {
    seedProfile();
    const id = await openWithStubs([
      {
        match:
          /WHERE table_schema = 'O''REILLY' AND table_name = 'CUST''S' ORDER BY ordinal_position$/,
        result: {
          columns: [
            { name: 'column_name', type: 'VARCHAR', nullable: false },
            { name: 'data_type', type: 'VARCHAR', nullable: false },
            { name: 'is_nullable', type: 'VARCHAR', nullable: false }
          ],
          rows: []
        }
      }
    ]);

    const obj: ObjectRef = {
      database: 'DB',
      schema: "O'REILLY",
      name: "CUST'S",
      kind: 'table'
    };
    await getColumns(id, obj);
    expect(
      executed[0]?.includes("table_schema = 'O''REILLY' AND table_name = 'CUST''S'")
    ).toBe(true);
  });
});

describe('getDDL', () => {
  test("returns GET_DDL output for a table with kind uppercased", async () => {
    seedProfile();
    const id = await openWithStubs([
      {
        match:
          /^SELECT GET_DDL\('TABLE', '"DB_ANALYTICS"\."PUBLIC"\."CUSTOMERS"'\)$/,
        result: {
          columns: [{ name: 'GET_DDL(...)', type: 'VARCHAR', nullable: true }],
          rows: [['create or replace TABLE "DB_ANALYTICS"."PUBLIC"."CUSTOMERS" (...);']]
        }
      }
    ]);

    const obj: ObjectRef = {
      database: 'DB_ANALYTICS',
      schema: 'PUBLIC',
      name: 'CUSTOMERS',
      kind: 'table'
    };
    const ddl = await getDDL(id, obj);
    expect(ddl).toContain('create or replace TABLE');
  });

  test('throws on column kind (GET_DDL is not defined for individual columns)', async () => {
    seedProfile();
    const id = await openWithStubs([]);
    const obj: ObjectRef = {
      database: 'DB',
      schema: 'PUBLIC',
      name: 'ID',
      kind: 'column'
    };
    await expect(getDDL(id, obj)).rejects.toThrow(/not defined for individual columns/);
  });

  test('schema kind uses the two-segment qualified name', async () => {
    seedProfile();
    const id = await openWithStubs([
      {
        match: /^SELECT GET_DDL\('SCHEMA', '"DB"\."PUBLIC"'\)$/,
        result: {
          columns: [{ name: 'GET_DDL(...)', type: 'VARCHAR', nullable: true }],
          rows: [['create or replace schema "DB"."PUBLIC";']]
        }
      }
    ]);

    const ddl = await getDDL(id, {
      database: 'DB',
      schema: 'IGNORED',
      name: 'PUBLIC',
      kind: 'schema'
    });
    expect(ddl).toContain('create or replace schema');
  });

  test('returns empty string when the result has no rows', async () => {
    seedProfile();
    const id = await openWithStubs([
      {
        match: /^SELECT GET_DDL/,
        result: {
          columns: [{ name: 'GET_DDL(...)', type: 'VARCHAR', nullable: true }],
          rows: []
        }
      }
    ]);
    const ddl = await getDDL(id, {
      database: 'DB',
      schema: 'PUBLIC',
      name: 'EMPTY',
      kind: 'table'
    });
    expect(ddl).toBe('');
  });
});

describe('unknown session', () => {
  test('listDatabases throws on a stale session id', async () => {
    await expect(listDatabases('stale' as SessionId)).rejects.toThrow(/Session not found/);
  });
});
