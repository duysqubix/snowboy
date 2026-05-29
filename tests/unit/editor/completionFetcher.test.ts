import { describe, expect, test } from 'bun:test';
import { createCompletionCache } from '../../../src/renderer/lib/editor/completionCache';
import { createCompletionFetcher } from '../../../src/renderer/lib/editor/completionFetcher';
import type { Column, ListObjectsOptions, SchemaObject, SessionId } from '../../../src/main/types';

const SID = 'sess-1' as SessionId;
const PROFILE = 'profile-1';

interface SchemaCall {
  method: 'listDatabases' | 'listSchemas' | 'listObjects' | 'getColumns';
  args: unknown[];
}

interface MockApi {
  schema: {
    listDatabases: (sessionId: SessionId) => Promise<string[]>;
    listSchemas: (sessionId: SessionId, db: string) => Promise<string[]>;
    listObjects: (
      sessionId: SessionId,
      db: string,
      schema: string,
      options?: ListObjectsOptions
    ) => Promise<SchemaObject[]>;
    getColumns: (sessionId: SessionId, obj: unknown) => Promise<Column[]>;
  };
  calls: SchemaCall[];
}

function makeApi(overrides: Partial<MockApi['schema']> = {}): MockApi {
  const calls: SchemaCall[] = [];
  const schema = {
    listDatabases: async (sessionId: SessionId) => {
      calls.push({ method: 'listDatabases', args: [sessionId] });
      return ['DB_A', 'DB_B'];
    },
    listSchemas: async (sessionId: SessionId, db: string) => {
      calls.push({ method: 'listSchemas', args: [sessionId, db] });
      return ['PUBLIC', 'PRIVATE'];
    },
    listObjects: async (
      sessionId: SessionId,
      db: string,
      sch: string,
      options?: ListObjectsOptions
    ): Promise<SchemaObject[]> => {
      calls.push({ method: 'listObjects', args: [sessionId, db, sch, options] });
      return [
        { name: 'CUSTOMERS', kind: 'table' },
        { name: 'ORDERS', kind: 'table' },
        { name: 'CUSTOMER_VIEW', kind: 'view' }
      ];
    },
    getColumns: async (sessionId: SessionId, obj: unknown): Promise<Column[]> => {
      calls.push({ method: 'getColumns', args: [sessionId, obj] });
      return [
        { name: 'ID', dataType: 'NUMBER', nullable: false },
        { name: 'NAME', dataType: 'TEXT', nullable: true }
      ];
    },
    ...overrides
  };
  return { schema, calls };
}

describe('completionFetcher', () => {
  test('ensure resolves immediately when cache already has the path (no IPC)', async () => {
    const cache = createCompletionCache();
    cache.set(PROFILE, ['databases'], ['CACHED']);
    const api = makeApi();
    const fetcher = createCompletionFetcher(cache, api);

    await fetcher.ensure(SID, PROFILE, ['databases']);

    expect(api.calls).toHaveLength(0);
    expect(cache.get(PROFILE, ['databases'])).toEqual(['CACHED']);
  });

  test('ensure fires listDatabases on a cache miss and writes the result back', async () => {
    const cache = createCompletionCache();
    const api = makeApi();
    const fetcher = createCompletionFetcher(cache, api);

    await fetcher.ensure(SID, PROFILE, ['databases']);

    expect(api.calls).toEqual([{ method: 'listDatabases', args: [SID] }]);
    expect(cache.get(PROFILE, ['databases'])).toEqual(['DB_A', 'DB_B']);
  });

  test('ensure fires listSchemas with the database for a schemas path', async () => {
    const cache = createCompletionCache();
    const api = makeApi();
    const fetcher = createCompletionFetcher(cache, api);

    await fetcher.ensure(SID, PROFILE, ['schemas', 'DB_A']);

    expect(api.calls).toEqual([{ method: 'listSchemas', args: [SID, 'DB_A'] }]);
    expect(cache.get(PROFILE, ['schemas', 'DB_A'])).toEqual(['PUBLIC', 'PRIVATE']);
  });

  test('ensure lists objects for a tables path and caches only table-kind names', async () => {
    const cache = createCompletionCache();
    const api = makeApi();
    const fetcher = createCompletionFetcher(cache, api);

    await fetcher.ensure(SID, PROFILE, ['tables', 'DB_A', 'PUBLIC']);

    expect(api.calls).toEqual([
      { method: 'listObjects', args: [SID, 'DB_A', 'PUBLIC', { source: 'completion' }] }
    ]);
    expect(cache.get(PROFILE, ['tables', 'DB_A', 'PUBLIC'])).toEqual(['CUSTOMERS', 'ORDERS']);
  });

  test('ensure fetches columns with a fully-formed ObjectRef and caches column names', async () => {
    const cache = createCompletionCache();
    const api = makeApi();
    const fetcher = createCompletionFetcher(cache, api);

    await fetcher.ensure(SID, PROFILE, ['columns', 'DB_A', 'PUBLIC', 'CUSTOMERS']);

    expect(api.calls).toEqual([
      {
        method: 'getColumns',
        args: [SID, { database: 'DB_A', schema: 'PUBLIC', name: 'CUSTOMERS', kind: 'table' }]
      }
    ]);
    expect(cache.get(PROFILE, ['columns', 'DB_A', 'PUBLIC', 'CUSTOMERS'])).toEqual(['ID', 'NAME']);
  });

  test('ensure deduplicates concurrent cache-miss requests into a single IPC call', async () => {
    const cache = createCompletionCache();
    let resolveDbs!: (v: string[]) => void;
    const api = makeApi({
      listDatabases: async () => {
        api.calls.push({ method: 'listDatabases', args: [SID] });
        return new Promise<string[]>((res) => {
          resolveDbs = res;
        });
      }
    });
    const fetcher = createCompletionFetcher(cache, api);

    const p1 = fetcher.ensure(SID, PROFILE, ['databases']);
    const p2 = fetcher.ensure(SID, PROFILE, ['databases']);
    const p3 = fetcher.ensure(SID, PROFILE, ['databases']);

    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    expect(api.calls).toHaveLength(1);

    resolveDbs(['DB_A', 'DB_B']);
    await Promise.all([p1, p2, p3]);

    expect(api.calls).toHaveLength(1);
    expect(cache.get(PROFILE, ['databases'])).toEqual(['DB_A', 'DB_B']);
  });

  test('ensure caches an empty array and warns when the IPC rejects', async () => {
    const cache = createCompletionCache();
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const api = makeApi({
        listDatabases: async () => {
          api.calls.push({ method: 'listDatabases', args: [SID] });
          throw new Error('ipc boom');
        }
      });
      const fetcher = createCompletionFetcher(cache, api);

      await fetcher.ensure(SID, PROFILE, ['databases']);

      expect(cache.get(PROFILE, ['databases'])).toEqual([]);
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(String(warnings[0]![0])).toContain('[completionFetcher]');
    } finally {
      console.warn = originalWarn;
    }
  });

  test('ensure does not retry after an error until the cache is invalidated', async () => {
    const cache = createCompletionCache();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const api = makeApi({
        listDatabases: async () => {
          api.calls.push({ method: 'listDatabases', args: [SID] });
          throw new Error('ipc boom');
        }
      });
      const fetcher = createCompletionFetcher(cache, api);

      await fetcher.ensure(SID, PROFILE, ['databases']);
      await fetcher.ensure(SID, PROFILE, ['databases']);

      expect(api.calls).toHaveLength(1);
      expect(cache.get(PROFILE, ['databases'])).toEqual([]);

      cache.invalidate(PROFILE, ['databases']);
      await fetcher.ensure(SID, PROFILE, ['databases']);

      expect(api.calls).toHaveLength(2);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('ensure triggers a fresh fetch after a successful result is invalidated', async () => {
    const cache = createCompletionCache();
    const api = makeApi();
    const fetcher = createCompletionFetcher(cache, api);

    await fetcher.ensure(SID, PROFILE, ['databases']);
    await fetcher.ensure(SID, PROFILE, ['databases']);
    expect(api.calls).toHaveLength(1);

    cache.invalidate(PROFILE, ['databases']);
    await fetcher.ensure(SID, PROFILE, ['databases']);

    expect(api.calls).toHaveLength(2);
  });

  test('ensure keys dedup by profile so two profiles each get their own IPC call', async () => {
    const cache = createCompletionCache();
    const api = makeApi();
    const fetcher = createCompletionFetcher(cache, api);

    await Promise.all([
      fetcher.ensure(SID, 'profile-a', ['databases']),
      fetcher.ensure(SID, 'profile-b', ['databases'])
    ]);

    expect(api.calls).toHaveLength(2);
    expect(cache.get('profile-a', ['databases'])).toEqual(['DB_A', 'DB_B']);
    expect(cache.get('profile-b', ['databases'])).toEqual(['DB_A', 'DB_B']);
  });

  test('ensure throws synchronously for an unknown path shape', () => {
    const cache = createCompletionCache();
    const api = makeApi();
    const fetcher = createCompletionFetcher(cache, api);

    expect(() => fetcher.ensure(SID, PROFILE, ['bogus', 'x'])).toThrow(/unknown completion path/);
    expect(api.calls).toHaveLength(0);
  });
});
