/**
 * T1.4 unit tests — mocked snowflake-sdk. No network, no real credentials.
 *
 * The Session and SessionPool both accept an injected SDK factory so tests
 * never touch the real driver. Streaming is exercised via a fake Statement
 * that emits known row windows through an in-memory Readable.
 */
import { describe, expect, mock, test } from 'bun:test';
import { Readable } from 'node:stream';
import {
  buildConnectOptions,
  parseAccountIdentifier,
} from '../../src/main/snowflake/auth';
import { Session, type SnowflakeSdkLike } from '../../src/main/snowflake/session';
import { SessionPool } from '../../src/main/snowflake/pool';
import type {
  ColumnMeta,
  ConnectionProfileLite,
  QueryCompleteEvent,
  RowBatch,
  SessionContext,
  SessionId,
} from '../../src/main/snowflake/types';

type ExecuteOptions = {
  sqlText: string;
  streamResult?: boolean;
  rowMode?: 'array' | 'object';
  parameters?: Record<string, unknown>;
  complete?: (err: Error | undefined, stmt: FakeStatement) => void;
};

interface FakeStatement {
  getQueryId(): string;
  getNumRows(): number;
  getColumns(): FakeColumn[] | undefined;
  getSessionState(): object | undefined;
  streamRows(opts?: { start?: number; end?: number }): Readable;
}

interface FakeColumn {
  getName(): string;
  getType(): string;
  isNullable(): boolean;
}

function fakeColumn(name: string, type: string, nullable = true): FakeColumn {
  return {
    getName: () => name,
    getType: () => type,
    isNullable: () => nullable,
  };
}

interface FakeConnectionBehavior {
  connectError?: Error;
  destroyError?: Error;
  executeImpl?: (opts: ExecuteOptions, sql: string) => FakeStatement;
  suppressAutoComplete?: boolean;
}

function makeFakeSdk(behavior: FakeConnectionBehavior = {}): {
  sdk: SnowflakeSdkLike;
  log: Array<{ kind: 'connect' | 'destroy' | 'execute'; sql?: string; options?: ExecuteOptions }>;
  optionsSeen: Record<string, unknown> | null;
} {
  const log: Array<{ kind: 'connect' | 'destroy' | 'execute'; sql?: string; options?: ExecuteOptions }> = [];
  let optionsSeen: Record<string, unknown> | null = null;

  const sdk: SnowflakeSdkLike = {
    createConnection: (opts) => {
      optionsSeen = opts;
      const connection = {
        connect(cb: (err: Error | undefined, conn: unknown) => void) {
          log.push({ kind: 'connect' });
          queueMicrotask(() => cb(behavior.connectError, connection));
          return connection;
        },
        execute(execOpts: ExecuteOptions) {
          log.push({ kind: 'execute', sql: execOpts.sqlText, options: execOpts });
          const stmt = behavior.executeImpl
            ? behavior.executeImpl(execOpts, execOpts.sqlText)
            : defaultStmt();
          if (execOpts.complete && !behavior.suppressAutoComplete) {
            queueMicrotask(() => execOpts.complete!(undefined, stmt));
          }
          return stmt;
        },
        destroy(cb: (err: Error | undefined) => void) {
          log.push({ kind: 'destroy' });
          queueMicrotask(() => cb(behavior.destroyError));
        },
      };
      return connection as unknown as ReturnType<SnowflakeSdkLike['createConnection']>;
    },
  };

  return {
    sdk,
    log,
    get optionsSeen() {
      return optionsSeen;
    },
  };
}

function defaultStmt(): FakeStatement {
  return {
    getQueryId: () => 'q-default',
    getNumRows: () => 0,
    getColumns: () => undefined,
    getSessionState: () => undefined,
    streamRows: () => Readable.from([]),
  };
}

function profileFixture(overrides: Partial<ConnectionProfileLite> = {}): ConnectionProfileLite {
  return {
    id: 'p1',
    accountUrl: 'https://ab12345.us-east-1.snowflakecomputing.com',
    authMethod: 'password',
    username: 'tester',
    ...overrides,
  };
}

describe('parseAccountIdentifier', () => {
  test('strips https:// and .snowflakecomputing.com suffix', () => {
    expect(parseAccountIdentifier('https://ab12345.us-east-1.snowflakecomputing.com')).toBe(
      'ab12345.us-east-1',
    );
    expect(parseAccountIdentifier('https://orgname-account.snowflakecomputing.com')).toBe(
      'orgname-account',
    );
  });

  test('throws on empty or malformed input', () => {
    expect(() => parseAccountIdentifier('')).toThrow(/empty/);
    expect(() => parseAccountIdentifier('not-a-url')).toThrow(/valid URL|must end/);
    expect(() => parseAccountIdentifier('https://example.com')).toThrow(/must end with/);
    expect(() => parseAccountIdentifier('https://.snowflakecomputing.com')).toThrow(/account identifier/);
  });
});

describe('buildConnectOptions', () => {
  test('externalbrowser sets EXTERNALBROWSER and omits password', () => {
    const opts = buildConnectOptions(
      profileFixture({ authMethod: 'externalbrowser', username: 'tester' }),
    );
    expect(opts['authenticator']).toBe('EXTERNALBROWSER');
    expect(opts['password']).toBeUndefined();
    expect(opts['account']).toBe('ab12345.us-east-1');
  });

  test('password_mfa sets USERNAME_PASSWORD_MFA and requires creds', () => {
    expect(() => buildConnectOptions(profileFixture({ authMethod: 'password_mfa' }))).toThrow(
      /password/,
    );
    expect(() =>
      buildConnectOptions(profileFixture({ authMethod: 'password_mfa', username: '' }), 'pw'),
    ).toThrow(/username/);
    const ok = buildConnectOptions(profileFixture({ authMethod: 'password_mfa' }), 'pw');
    expect(ok['authenticator']).toBe('USERNAME_PASSWORD_MFA');
    expect(ok['password']).toBe('pw');
  });

  test('password sets SNOWFLAKE and forwards creds', () => {
    const ok = buildConnectOptions(profileFixture({ authMethod: 'password' }), 'pw');
    expect(ok['authenticator']).toBe('SNOWFLAKE');
    expect(ok['password']).toBe('pw');
    expect(ok['username']).toBe('tester');
  });

  test('forwards default role/warehouse/db/schema', () => {
    const opts = buildConnectOptions(
      profileFixture({
        authMethod: 'password',
        defaultRole: 'SYSADMIN',
        defaultWarehouse: 'COMPUTE_WH',
        defaultDatabase: 'DEMO_DB',
        defaultSchema: 'PUBLIC',
      }),
      'pw',
    );
    expect(opts['role']).toBe('SYSADMIN');
    expect(opts['warehouse']).toBe('COMPUTE_WH');
    expect(opts['database']).toBe('DEMO_DB');
    expect(opts['schema']).toBe('PUBLIC');
  });
});

describe('Session.open', () => {
  test('connects then issues USE statements for the initial context', async () => {
    const ctl = makeFakeSdk();
    const session = await Session.open(
      profileFixture(),
      { role: 'SYSADMIN', warehouse: 'COMPUTE_WH', database: 'DEMO_DB', schema: 'PUBLIC' },
      { password: 'pw', sdk: ctl.sdk },
    );
    try {
      expect(ctl.log[0]?.kind).toBe('connect');
      const executes = ctl.log.filter((e) => e.kind === 'execute').map((e) => e.sql);
      expect(executes).toEqual([
        'USE ROLE "SYSADMIN"',
        'USE WAREHOUSE "COMPUTE_WH"',
        'USE DATABASE "DEMO_DB"',
        'USE SCHEMA "PUBLIC"',
      ]);
      expect(session.getContext()).toEqual({
        role: 'SYSADMIN',
        warehouse: 'COMPUTE_WH',
        database: 'DEMO_DB',
        schema: 'PUBLIC',
      });
    } finally {
      await session.close();
    }
  });

  test('escapes embedded quotes in identifiers', async () => {
    const ctl = makeFakeSdk();
    const session = await Session.open(
      profileFixture(),
      { role: 'has"quote' },
      { password: 'pw', sdk: ctl.sdk },
    );
    try {
      const executes = ctl.log.filter((e) => e.kind === 'execute').map((e) => e.sql);
      expect(executes).toContain('USE ROLE "has""quote"');
    } finally {
      await session.close();
    }
  });

  test('propagates SDK connect errors', async () => {
    const ctl = makeFakeSdk({ connectError: new Error('AUTH_FAILED') });
    await expect(
      Session.open(profileFixture(), {}, { password: 'pw', sdk: ctl.sdk }),
    ).rejects.toThrow(/AUTH_FAILED/);
  });

  test('rejects malformed accountUrl before opening a connection', async () => {
    const ctl = makeFakeSdk();
    await expect(
      Session.open(
        profileFixture({ accountUrl: 'https://example.com' }),
        {},
        { password: 'pw', sdk: ctl.sdk },
      ),
    ).rejects.toThrow(/snowflakecomputing\.com/);
    expect(ctl.log).toHaveLength(0);
  });
});

describe('Session.runStreaming', () => {
  test('batches rows into 1000-row chunks and emits onComplete', async () => {
    const totalRows = 2500;
    const allRows: unknown[][] = Array.from({ length: totalRows }, (_, i) => [i, `row-${i}`]);
    const columns = [fakeColumn('ID', 'NUMBER', false), fakeColumn('NAME', 'TEXT', true)];

    const ctl = makeFakeSdk({
      executeImpl: (opts) => {
        if (opts.sqlText.startsWith('SELECT')) {
          return {
            getQueryId: () => 'qid-abc',
            getNumRows: () => totalRows,
            getColumns: () => columns,
            getSessionState: () => ({ current_warehouse: 'TEST_WH' }),
            streamRows: ({ start, end } = {}) => {
              const s = start ?? 0;
              const e = end ?? totalRows - 1;
              return Readable.from(allRows.slice(s, e + 1));
            },
          };
        }
        return defaultStmt();
      },
    });

    const session = await Session.open(profileFixture(), {}, { password: 'pw', sdk: ctl.sdk });
    try {
      const batches: RowBatch[] = [];
      const completed: QueryCompleteEvent[] = [];
      const handle = session.runStreaming(
        'SELECT * FROM big',
        {},
        {
          onBatch: (b) => batches.push(b),
          onComplete: (e) => completed.push(e),
          onError: (err) => {
            throw err;
          },
          onCancel: () => {
            throw new Error('should not cancel');
          },
        },
      );

      const qid = await handle.queryIdPromise;
      expect(qid).toBe('qid-abc');

      await waitFor(() => completed.length === 1);

      expect(batches.length).toBe(3);
      expect(batches[0]!.rows.length).toBe(1000);
      expect(batches[0]!.offset).toBe(0);
      expect(batches[1]!.rows.length).toBe(1000);
      expect(batches[1]!.offset).toBe(1000);
      expect(batches[2]!.rows.length).toBe(500);
      expect(batches[2]!.offset).toBe(2000);

      const colsSent: readonly ColumnMeta[] = batches[0]!.columns;
      expect(colsSent).toEqual([
        { name: 'ID', type: 'NUMBER', nullable: false },
        { name: 'NAME', type: 'TEXT', nullable: true },
      ]);

      expect(completed[0]).toEqual({
        queryId: 'qid-abc',
        rowCount: totalRows,
        bytesScanned: 0,
        warehouseUsed: 'TEST_WH',
      });
      expect(handle.queryId).toBe('qid-abc');
    } finally {
      await session.close();
    }
  });

  test('emits onComplete with rowCount=0 for empty results', async () => {
    const ctl = makeFakeSdk({
      executeImpl: (opts) => {
        if (opts.sqlText.startsWith('SELECT')) {
          return {
            getQueryId: () => 'empty',
            getNumRows: () => 0,
            getColumns: () => [fakeColumn('X', 'NUMBER')],
            getSessionState: () => undefined,
            streamRows: () => Readable.from([]),
          };
        }
        return defaultStmt();
      },
    });

    const session = await Session.open(profileFixture(), {}, { password: 'pw', sdk: ctl.sdk });
    try {
      const batches: RowBatch[] = [];
      const completed: QueryCompleteEvent[] = [];
      const handle = session.runStreaming(
        'SELECT 1 WHERE 0=1',
        {},
        {
          onBatch: (b) => batches.push(b),
          onComplete: (e) => completed.push(e),
          onError: (err) => {
            throw err;
          },
          onCancel: () => {},
        },
      );
      await handle.queryIdPromise;
      await waitFor(() => completed.length === 1);
      expect(batches).toHaveLength(0);
      expect(completed[0]?.rowCount).toBe(0);
    } finally {
      await session.close();
    }
  });

  test('propagates execute errors via onError', async () => {
    const ctl = makeFakeSdk({
      suppressAutoComplete: true,
      executeImpl: (opts) => {
        if (opts.sqlText.startsWith('BAD')) {
          if (opts.complete) {
            queueMicrotask(() =>
              opts.complete!(new Error('SQL compile error'), defaultStmt()),
            );
          }
          return defaultStmt();
        }
        if (opts.complete) {
          queueMicrotask(() => opts.complete!(undefined, defaultStmt()));
        }
        return defaultStmt();
      },
    });

    const session = await Session.open(profileFixture(), {}, { password: 'pw', sdk: ctl.sdk });
    try {
      let captured: Error | null = null;
      session.runStreaming(
        'BAD QUERY',
        {},
        {
          onBatch: () => {
            throw new Error('no batches');
          },
          onComplete: () => {
            throw new Error('no complete');
          },
          onError: (err) => {
            captured = err;
          },
          onCancel: () => {},
        },
      );
      await waitFor(() => captured !== null);
      expect((captured as unknown as Error).message).toMatch(/SQL compile/);
    } finally {
      await session.close();
    }
  });

  test('cancel() issues SYSTEM$CANCEL_QUERY on the same connection', async () => {
    const ctl = makeFakeSdk({
      executeImpl: (opts) => {
        if (opts.sqlText.startsWith('SELECT')) {
          return {
            getQueryId: () => 'cancelme',
            getNumRows: () => 5,
            getColumns: () => [fakeColumn('X', 'NUMBER')],
            getSessionState: () => undefined,
            streamRows: () => Readable.from([[1], [2], [3], [4], [5]]),
          };
        }
        return defaultStmt();
      },
    });

    const session = await Session.open(profileFixture(), {}, { password: 'pw', sdk: ctl.sdk });
    try {
      let cancelled = false;
      const handle = session.runStreaming(
        'SELECT * FROM big',
        {},
        {
          onBatch: () => {},
          onComplete: () => {},
          onError: () => {},
          onCancel: () => {
            cancelled = true;
          },
        },
      );
      await handle.queryIdPromise;
      handle.cancel();
      await waitFor(() => cancelled);
      const cancelExecs = ctl.log.filter(
        (e) => e.kind === 'execute' && typeof e.sql === 'string' && e.sql.includes('SYSTEM$CANCEL_QUERY'),
      );
      expect(cancelExecs).toHaveLength(1);
      expect(cancelExecs[0]?.sql).toBe("SELECT SYSTEM$CANCEL_QUERY('cancelme')");
    } finally {
      await session.close();
    }
  });

  test('cancelQuery method escapes single quotes', async () => {
    const ctl = makeFakeSdk();
    const session = await Session.open(profileFixture(), {}, { password: 'pw', sdk: ctl.sdk });
    try {
      await session.cancelQuery("evil'id");
      const cancelExecs = ctl.log.filter(
        (e) => e.kind === 'execute' && typeof e.sql === 'string' && e.sql.includes('SYSTEM$CANCEL_QUERY'),
      );
      expect(cancelExecs).toHaveLength(1);
      expect(cancelExecs[0]?.sql).toBe("SELECT SYSTEM$CANCEL_QUERY('evil''id')");
    } finally {
      await session.close();
    }
  });

  test('timeoutMs maps to STATEMENT_TIMEOUT_IN_SECONDS', async () => {
    const ctl = makeFakeSdk({
      executeImpl: () => ({
        getQueryId: () => 't',
        getNumRows: () => 0,
        getColumns: () => undefined,
        getSessionState: () => undefined,
        streamRows: () => Readable.from([]),
      }),
    });

    const session = await Session.open(profileFixture(), {}, { password: 'pw', sdk: ctl.sdk });
    try {
      const handle = session.runStreaming(
        'SELECT 1',
        { timeoutMs: 30_000 },
        {
          onBatch: () => {},
          onComplete: () => {},
          onError: () => {},
          onCancel: () => {},
        },
      );
      await handle.queryIdPromise;
      const exec = ctl.log.find((e) => e.kind === 'execute' && e.sql === 'SELECT 1');
      expect(exec?.options?.parameters?.['STATEMENT_TIMEOUT_IN_SECONDS']).toBe(30);
    } finally {
      await session.close();
    }
  });
});

describe('SessionPool', () => {
  test('keys by (profileId, role, warehouse) and reuses sessions', async () => {
    let opens = 0;
    const fakeSession = (key: string): Session => {
      const id = ('sess-' + key) as unknown as SessionId;
      const partial = {
        getId: () => id,
        getProfileId: () => 'p1',
        getContext: () => ({}) as SessionContext,
        isRunning: () => false,
        isClosed: () => false,
        close: async () => undefined,
        setContext: async () => undefined,
      };
      return partial as unknown as Session;
    };

    const pool = new SessionPool({
      factory: async (profile, ctx) => {
        opens += 1;
        return fakeSession(`${profile.id}-${ctx.role ?? ''}-${ctx.warehouse ?? ''}-${opens}`);
      },
    });

    const ctx = { role: 'SYSADMIN', warehouse: 'WH1' };
    const profile = profileFixture();
    const s1 = await pool.acquire('p1', ctx, { profile });
    const s2 = await pool.acquire('p1', ctx, { profile });
    expect(s1.getId()).toBe(s2.getId());
    expect(opens).toBe(1);

    const s3 = await pool.acquire('p1', { ...ctx, warehouse: 'WH2' }, { profile });
    expect(s3.getId()).not.toBe(s1.getId());
    expect(opens).toBe(2);

    await pool.closeAll();
  });

  test('LRU eviction picks the least-recently-used idle session', async () => {
    const closedIds: string[] = [];
    let nextId = 0;
    const factory = async (profile: ConnectionProfileLite, ctx: SessionContext): Promise<Session> => {
      const id = `sess-${++nextId}` as unknown as SessionId;
      let isClosed = false;
      const partial = {
        getId: () => id,
        getProfileId: () => profile.id,
        getContext: () => ({ ...ctx }) as SessionContext,
        isRunning: () => false,
        isClosed: () => isClosed,
        close: async () => {
          isClosed = true;
          closedIds.push(id as unknown as string);
        },
        setContext: async () => undefined,
      };
      return partial as unknown as Session;
    };

    let now = 1000;
    const pool = new SessionPool({
      factory,
      cap: 2,
      now: () => now,
    });

    const profile = profileFixture();
    const ctxA = { role: 'A' };
    const ctxB = { role: 'B' };
    const ctxC = { role: 'C' };

    const a = await pool.acquire('p1', ctxA, { profile });
    now += 1;
    const b = await pool.acquire('p1', ctxB, { profile });
    now += 1;

    pool.release(a.getId());
    now += 5;
    pool.release(b.getId());
    now += 5;

    expect(pool.size()).toBe(2);

    const c = await pool.acquire('p1', ctxC, { profile });
    expect(c.getId()).toBe('sess-3');
    expect(closedIds).toEqual(['sess-1']);
    expect(pool.size()).toBe(2);

    await pool.closeAll();
  });

  test('queues acquire when all sessions are checked out, resolves on release', async () => {
    let nextId = 0;
    const factory = async (profile: ConnectionProfileLite): Promise<Session> => {
      const id = `q-${++nextId}` as unknown as SessionId;
      let isClosed = false;
      const partial = {
        getId: () => id,
        getProfileId: () => profile.id,
        getContext: () => ({}) as SessionContext,
        isRunning: () => false,
        isClosed: () => isClosed,
        close: async () => {
          isClosed = true;
        },
        setContext: async () => undefined,
      };
      return partial as unknown as Session;
    };

    const pool = new SessionPool({ factory, cap: 2 });
    const profile = profileFixture();
    const a = await pool.acquire('p1', { role: 'A' }, { profile });
    const b = await pool.acquire('p1', { role: 'B' }, { profile });

    let resolvedC: Session | null = null;
    const pending = pool.acquire('p1', { role: 'C' }, { profile }).then((s) => {
      resolvedC = s;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(resolvedC).toBeNull();
    expect(pool.size()).toBe(2);

    pool.release(a.getId());
    await pending;
    expect(resolvedC).not.toBeNull();
    expect(pool.size()).toBe(2);

    void b;
    await pool.closeAll();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for predicate');
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

void mock;
