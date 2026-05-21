import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  __activeCountForTesting,
  __clearActiveForTesting,
  __setMainWindowGetterForTesting,
  cancel,
  run
} from '../../../src/main/ipc/query';
import {
  __clearSessionsForTesting,
  __setSessionFactoryForTesting,
  openSession
} from '../../../src/main/ipc/sessions';
import { closeDatabase, openDatabase } from '../../../src/main/storage/db';
import { getHistory, listHistory } from '../../../src/main/storage/history';
import { insertProfile } from '../../../src/main/storage/profiles';
import { CHANNELS } from '../../../src/main/ipc/channels';
import type { Session } from '../../../src/main/snowflake/session';
import type {
  QueryCompleteEvent,
  RowBatch,
  StreamingCallbacks,
  StreamingHandle
} from '../../../src/main/snowflake/types';
import { asSessionId } from '../../../src/main/snowflake/types';
import type { SessionId as IpcSessionId } from '../../../src/main/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../../../src/main/storage/migrations');

interface SentEvent {
  channel: string;
  payload: unknown;
}

interface FakeWindow {
  sent: SentEvent[];
  webContents: { send: (channel: string, payload: unknown) => void };
  isDestroyed: () => boolean;
}

function makeFakeWindow(): FakeWindow {
  const sent: SentEvent[] = [];
  return {
    sent,
    webContents: {
      send: (channel, payload) => {
        sent.push({ channel, payload });
      }
    },
    isDestroyed: () => false
  };
}

interface FakeSessionHooks {
  onRun?: (sql: string, opts: unknown, callbacks: StreamingCallbacks) => void;
  cancelHook?: () => void;
}

interface CapturedSession extends Session {
  __callbacks: () => StreamingCallbacks | null;
  __invalidateCount: () => number;
}

function makeFakeSession(
  id: string,
  profileId: string,
  hooks: FakeSessionHooks = {}
): CapturedSession {
  const sid = asSessionId(id);
  let captured: StreamingCallbacks | null = null;
  let invalidateCount = 0;
  const fake = {
    getId: () => sid,
    getProfileId: () => profileId,
    getContext: () => ({
      role: 'ANALYST',
      warehouse: 'WH_XS',
      database: 'DB',
      schema: 'PUBLIC'
    }),
    isRunning: () => false,
    isClosed: () => false,
    runStreaming: (
      sql: string,
      opts: unknown,
      callbacks: StreamingCallbacks
    ): StreamingHandle => {
      captured = callbacks;
      hooks.onRun?.(sql, opts, callbacks);
      return {
        cancel: () => {
          hooks.cancelHook?.();
        },
        queryId: 'snowflake-query-id',
        queryIdPromise: Promise.resolve('snowflake-query-id')
      };
    },
    setContext: async () => {},
    cancelQuery: async () => {},
    close: async () => {},
    invalidateEffectiveContext: () => {
      invalidateCount += 1;
    },
    __callbacks: () => captured,
    __invalidateCount: () => invalidateCount
  };
  return fake as unknown as CapturedSession;
}

function fakeBatch(rows: unknown[][]): RowBatch {
  return {
    rows,
    columns: [
      { name: 'C1', type: 'NUMBER', nullable: false },
      { name: 'C2', type: 'TEXT', nullable: true }
    ],
    offset: 0
  };
}

function fakeCompleteEvent(overrides: Partial<QueryCompleteEvent> = {}): QueryCompleteEvent {
  return {
    queryId: 'snowflake-query-id',
    rowCount: 2,
    bytesScanned: 1024,
    warehouseUsed: 'WH_XS',
    ...overrides
  };
}

async function openTestSession(session: Session): Promise<IpcSessionId> {
  __setSessionFactoryForTesting(async () => session);
  const id = await openSession('prof-1', {});
  return id as unknown as IpcSessionId;
}

let fakeWindow: FakeWindow;

beforeEach(() => {
  openDatabase({ path: ':memory:', migrationsDir: MIGRATIONS_DIR });
  fakeWindow = makeFakeWindow();
  __setMainWindowGetterForTesting(() => fakeWindow as unknown as Electron.BrowserWindow);
  insertProfile({
    id: 'prof-1',
    name: 'P1',
    account_url: 'https://x.snowflakecomputing.com',
    auth_method: 'externalbrowser',
    username: 'u',
    default_role: null,
    default_warehouse: null,
    default_database: null,
    default_schema: null
  });
});

afterEach(() => {
  __clearActiveForTesting();
  __clearSessionsForTesting();
  __setSessionFactoryForTesting(null);
  __setMainWindowGetterForTesting(null);
  closeDatabase();
});

describe('query.run', () => {
  test('rejects when sessionId is missing', async () => {
    await expect(run('' as IpcSessionId, 'SELECT 1')).rejects.toThrow(/sessionId is required/);
  });

  test('rejects when sql is empty', async () => {
    await expect(run('x' as IpcSessionId, '')).rejects.toThrow(/sql is required/);
  });

  test('rejects when sessionId is not in the registry', async () => {
    await expect(run('ghost' as IpcSessionId, 'SELECT 1')).rejects.toThrow(/unknown sessionId/);
  });

  test('inserts a running history row and returns a queryId', async () => {
    const session = makeFakeSession('s-1', 'prof-1');
    const sessionId = await openTestSession(session);

    const queryId = await run(sessionId, 'SELECT 1');
    expect(typeof queryId).toBe('string');
    expect(queryId.length).toBeGreaterThan(0);

    const row = getHistory(queryId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('running');
    expect(row?.sql).toBe('SELECT 1');
    expect(row?.profile_id).toBe('prof-1');
    expect(row?.role).toBe('ANALYST');
    expect(row?.warehouse).toBe('WH_XS');
    expect(row?.ended_at).toBeNull();
  });

  test('forwards row batches to the renderer via webContents.send', async () => {
    const session = makeFakeSession('s-2', 'prof-1');
    const sessionId = await openTestSession(session);

    const queryId = await run(sessionId, 'SELECT 1');
    session.__callbacks()!.onBatch(
      fakeBatch([
        [1, 'a'],
        [2, 'b']
      ])
    );

    const batchEvents = fakeWindow.sent.filter(
      (e) => e.channel === CHANNELS.queryEvents.rowBatch
    );
    expect(batchEvents.length).toBe(1);
    const payload = batchEvents[0]!.payload as {
      queryId: string;
      rows: Record<string, unknown>[];
      columns: { name: string; dataType: string; nullable: boolean }[];
    };
    expect(payload.queryId).toBe(queryId);
    expect(payload.columns).toEqual([
      { name: 'C1', dataType: 'NUMBER', nullable: false },
      { name: 'C2', dataType: 'TEXT', nullable: true }
    ]);
    expect(payload.rows).toEqual([
      { C1: 1, C2: 'a' },
      { C1: 2, C2: 'b' }
    ]);
  });

  test('on complete: updates history to success and sends complete event', async () => {
    const session = makeFakeSession('s-3', 'prof-1');
    const sessionId = await openTestSession(session);
    const queryId = await run(sessionId, 'SELECT 1');
    expect(__activeCountForTesting()).toBe(1);

    session.__callbacks()!.onComplete(fakeCompleteEvent({ rowCount: 42, bytesScanned: 999 }));

    expect(__activeCountForTesting()).toBe(0);
    const row = getHistory(queryId);
    expect(row?.status).toBe('success');
    expect(row?.row_count).toBe(42);
    expect(row?.bytes_scanned).toBe(999);
    expect(row?.query_id).toBe('snowflake-query-id');
    expect(row?.ended_at).not.toBeNull();

    const completeEvents = fakeWindow.sent.filter(
      (e) => e.channel === CHANNELS.queryEvents.complete
    );
    expect(completeEvents.length).toBe(1);
    const payload = completeEvents[0]!.payload as {
      queryId: string;
      totalRows: number;
      durationMs: number;
      warehouse?: string;
    };
    expect(payload.queryId).toBe(queryId);
    expect(payload.totalRows).toBe(42);
    expect(payload.warehouse).toBe('WH_XS');
    expect(typeof payload.durationMs).toBe('number');
  });

  test('on error: updates history to error and sends error event', async () => {
    const session = makeFakeSession('s-4', 'prof-1');
    const sessionId = await openTestSession(session);
    const queryId = await run(sessionId, 'SELECT 1');

    session.__callbacks()!.onError(new Error('SQL compilation error: invalid column'));

    expect(__activeCountForTesting()).toBe(0);
    const row = getHistory(queryId);
    expect(row?.status).toBe('error');
    expect(row?.error_message).toMatch(/SQL compilation error/);

    const errorEvents = fakeWindow.sent.filter(
      (e) => e.channel === CHANNELS.queryEvents.error
    );
    expect(errorEvents.length).toBe(1);
    const payload = errorEvents[0]!.payload as { queryId: string; message: string };
    expect(payload.queryId).toBe(queryId);
    expect(payload.message).toMatch(/SQL compilation error/);
  });

  test('on cancel: updates history to cancelled', async () => {
    const session = makeFakeSession('s-5', 'prof-1');
    const sessionId = await openTestSession(session);
    const queryId = await run(sessionId, 'SELECT 1');

    session.__callbacks()!.onCancel();

    expect(__activeCountForTesting()).toBe(0);
    const row = getHistory(queryId);
    expect(row?.status).toBe('cancelled');
    expect(row?.ended_at).not.toBeNull();
  });
});

describe('query.cancel', () => {
  test('calls handle.cancel on the active entry', async () => {
    let cancelCalls = 0;
    const session = makeFakeSession('s-6', 'prof-1', {
      cancelHook: () => {
        cancelCalls++;
      }
    });
    const sessionId = await openTestSession(session);
    const queryId = await run(sessionId, 'SELECT 1');

    await cancel(queryId);
    expect(cancelCalls).toBe(1);
  });

  test('is idempotent for unknown queryIds', async () => {
    await expect(cancel('does-not-exist')).resolves.toBeUndefined();
  });

  test('is idempotent on empty input', async () => {
    await expect(cancel('')).resolves.toBeUndefined();
  });

  test('does nothing once the query has already completed', async () => {
    let cancelCalls = 0;
    const session = makeFakeSession('s-7', 'prof-1', {
      cancelHook: () => {
        cancelCalls++;
      }
    });
    const sessionId = await openTestSession(session);
    const queryId = await run(sessionId, 'SELECT 1');
    session.__callbacks()!.onComplete(fakeCompleteEvent());

    await cancel(queryId);
    expect(cancelCalls).toBe(0);
  });
});

describe('query lifecycle history (T3.6 round-trip)', () => {
  test('every run produces exactly one history row', async () => {
    const session = makeFakeSession('s-8', 'prof-1');
    const sessionId = await openTestSession(session);

    const before = listHistory({ limit: 1000 }).length;
    const q1 = await run(sessionId, 'SELECT 1');
    const q2 = await run(sessionId, 'SELECT 2');
    const after = listHistory({ limit: 1000 }).length;

    expect(after - before).toBe(2);
    expect(getHistory(q1)?.sql).toBe('SELECT 1');
    expect(getHistory(q2)?.sql).toBe('SELECT 2');
  });

  test('window send is a no-op when no window is registered', async () => {
    __setMainWindowGetterForTesting(() => null);
    const session = makeFakeSession('s-9', 'prof-1');
    const sessionId = await openTestSession(session);
    const queryId = await run(sessionId, 'SELECT 1');

    expect(() => session.__callbacks()!.onBatch(fakeBatch([[1, 'a']]))).not.toThrow();
    expect(() => session.__callbacks()!.onComplete(fakeCompleteEvent())).not.toThrow();
    expect(getHistory(queryId)?.status).toBe('success');
  });
});

describe('USE-statement post-execute hook (B3)', () => {
  test('USE DATABASE invalidates effective context and broadcasts change', async () => {
    const session = makeFakeSession('s-use-db', 'prof-1');
    const sessionId = await openTestSession(session);
    await run(sessionId, 'USE DATABASE FOO');

    expect(session.__invalidateCount()).toBe(0);
    session.__callbacks()!.onComplete(fakeCompleteEvent());

    expect(session.__invalidateCount()).toBe(1);
    const changeEvents = fakeWindow.sent.filter(
      (e) => e.channel === CHANNELS.sessionsExt.events.effectiveContextChanged
    );
    expect(changeEvents.length).toBe(1);
    expect(changeEvents[0]!.payload).toEqual({ sessionId });
  });

  test('USE WAREHOUSE / SCHEMA / ROLE all trigger the hook', async () => {
    for (const sql of [
      'USE WAREHOUSE WH_XL',
      'USE SCHEMA PUBLIC',
      'USE ROLE SYSADMIN',
      '  use database lower_ok'
    ]) {
      const session = makeFakeSession(`s-${sql.length}`, 'prof-1');
      const sessionId = await openTestSession(session);
      await run(sessionId, sql);
      session.__callbacks()!.onComplete(fakeCompleteEvent());
      expect(session.__invalidateCount()).toBe(1);
      __clearSessionsForTesting();
      __setSessionFactoryForTesting(null);
      void sessionId;
    }
  });

  test('non-USE statements do not invalidate effective context', async () => {
    const session = makeFakeSession('s-select', 'prof-1');
    const sessionId = await openTestSession(session);
    await run(sessionId, 'SELECT 1');

    session.__callbacks()!.onComplete(fakeCompleteEvent());

    expect(session.__invalidateCount()).toBe(0);
    const changeEvents = fakeWindow.sent.filter(
      (e) => e.channel === CHANNELS.sessionsExt.events.effectiveContextChanged
    );
    expect(changeEvents.length).toBe(0);
  });

  test('USE-looking identifiers do not trigger the hook (word boundary)', async () => {
    const session = makeFakeSession('s-useless', 'prof-1');
    const sessionId = await openTestSession(session);
    await run(sessionId, 'SELECT * FROM USEFUL_DATA');

    session.__callbacks()!.onComplete(fakeCompleteEvent());

    expect(session.__invalidateCount()).toBe(0);
  });
});
