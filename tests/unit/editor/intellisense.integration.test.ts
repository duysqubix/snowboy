// IntelliSense epic integration smoke (C6): exercises the WIRING between the
// burst's modules rather than each in isolation, so any silent contract drift
// between agents surfaces. C1 completionCache (real), C2 completionFetcher
// (real, over a typed mocked schema IPC), C4 schemaCompletion (real),
// C5 completionCacheSync (real). Seams: miss -> lazy fetch -> populate ->
// onChange; ObjectRef shape agreement; browser-write/editor-read path parity;
// concentric-circle ranking; in-flight dedup + cache-hit short-circuit.

import { describe, expect, test } from 'bun:test';
import { createCompletionCache } from '../../../src/renderer/lib/editor/completionCache';
import { createCompletionFetcher } from '../../../src/renderer/lib/editor/completionFetcher';
import { getFetchPath, buildSchemaConfig } from '../../../src/renderer/lib/editor/schemaCompletion';
import {
  cacheSchemas,
  cacheTables,
  cacheColumns
} from '../../../src/renderer/lib/browser/completionCacheSync';
import type { CompletionPath } from '../../../src/renderer/lib/editor/completionCache';
import type {
  Column,
  ObjectRef,
  SchemaObject,
  SessionId,
  SnowboyApi
} from '../../../src/main/types';

const SID = 'sess-int-1' as SessionId;
const PROFILE = 'profile-int';

type SchemaApi = Pick<SnowboyApi, 'schema'>;

interface SchemaCall {
  method: keyof SnowboyApi['schema'];
  args: unknown[];
}

interface MockSchemaApi extends SchemaApi {
  calls: SchemaCall[];
}

// All eight schema methods are implemented so the object satisfies
// Pick<SnowboyApi, 'schema'> structurally, avoiding an `as any` escape hatch;
// only the four the fetcher dispatches to carry meaningful behaviour.
function makeSchemaApi(
  overrides: Partial<SnowboyApi['schema']> = {}
): MockSchemaApi {
  const calls: SchemaCall[] = [];
  const schema: SnowboyApi['schema'] = {
    listDatabases: async (sessionId: SessionId) => {
      calls.push({ method: 'listDatabases', args: [sessionId] });
      return ['CALIBER_DWH', 'SNOWFLAKE'];
    },
    listSchemas: async (sessionId: SessionId, db: string) => {
      calls.push({ method: 'listSchemas', args: [sessionId, db] });
      return ['ANALYTICS', 'PUBLIC'];
    },
    listObjects: async (
      sessionId: SessionId,
      db: string,
      sch: string
    ): Promise<SchemaObject[]> => {
      calls.push({ method: 'listObjects', args: [sessionId, db, sch] });
      return [
        { name: 'CUSTOMERS', kind: 'table' },
        { name: 'ORDERS', kind: 'table' },
        { name: 'CUSTOMER_VIEW', kind: 'view' }
      ];
    },
    getColumns: async (sessionId: SessionId, obj: ObjectRef): Promise<Column[]> => {
      calls.push({ method: 'getColumns', args: [sessionId, obj] });
      return [
        { name: 'ID', dataType: 'NUMBER', nullable: false },
        { name: 'NAME', dataType: 'TEXT', nullable: true }
      ];
    },
    listRoles: async () => [],
    listWarehouses: async () => [],
    getDDL: async () => '',
    invalidate: async () => {},
    ...overrides
  };
  return { schema, calls };
}

describe('IntelliSense integration (C1+C2+C4+C5 wiring)', () => {
  test('cache miss -> lazy fetch -> cache populated -> onChange fired', async () => {
    const cache = createCompletionCache();
    const api = makeSchemaApi();
    const fetcher = createCompletionFetcher(cache, api);

    const observed: Array<{ profileId: string; path: CompletionPath }> = [];
    const off = cache.onChange((profileId, path) => {
      observed.push({ profileId, path });
    });

    expect(cache.get(PROFILE, ['databases'])).toBeNull();

    await fetcher.ensure(SID, PROFILE, ['databases']);

    expect(api.calls).toEqual([{ method: 'listDatabases', args: [SID] }]);
    expect(cache.get(PROFILE, ['databases'])).toEqual(['CALIBER_DWH', 'SNOWFLAKE']);
    expect(observed).toEqual([{ profileId: PROFILE, path: ['databases'] }]);

    off();
  });

  test("C2's columns fetch produces the ObjectRef shape C4/C5 agree on", async () => {
    const cache = createCompletionCache();
    const api = makeSchemaApi();
    const fetcher = createCompletionFetcher(cache, api);

    await fetcher.ensure(SID, PROFILE, ['columns', 'CALIBER_DWH', 'ANALYTICS', 'CUSTOMERS']);

    expect(api.calls).toEqual([
      {
        method: 'getColumns',
        args: [
          SID,
          { database: 'CALIBER_DWH', schema: 'ANALYTICS', name: 'CUSTOMERS', kind: 'table' }
        ]
      }
    ]);
    expect(cache.get(PROFILE, ['columns', 'CALIBER_DWH', 'ANALYTICS', 'CUSTOMERS'])).toEqual([
      'ID',
      'NAME'
    ]);
  });

  test('C5 browser writes land on the paths C4 reads back, and fire onChange', () => {
    const cache = createCompletionCache();

    const events: CompletionPath[] = [];
    const off = cache.onChange((_pid, path) => {
      events.push(path);
    });

    const objects: SchemaObject[] = [
      { name: 'CUSTOMERS', kind: 'table' },
      { name: 'CUSTOMER_VIEW', kind: 'view' }
    ];
    cacheSchemas(cache, PROFILE, 'CALIBER_DWH', ['ANALYTICS']);
    cacheTables(cache, PROFILE, 'CALIBER_DWH', 'ANALYTICS', objects);

    const path = getFetchPath('CUSTOMERS.', 'CALIBER_DWH', 'ANALYTICS', PROFILE, cache);
    expect(path).toEqual(['columns', 'CALIBER_DWH', 'ANALYTICS', 'CUSTOMERS']);

    expect(cache.get(PROFILE, ['tables', 'CALIBER_DWH', 'ANALYTICS'])).toEqual(['CUSTOMERS']);

    expect(events).toEqual([
      ['schemas', 'CALIBER_DWH'],
      ['tables', 'CALIBER_DWH', 'ANALYTICS']
    ]);

    off();
  });

  test('buildSchemaConfig reflects cached data with concentric-circle ranking', async () => {
    const cache = createCompletionCache();
    const api = makeSchemaApi();
    const fetcher = createCompletionFetcher(cache, api);

    await fetcher.ensure(SID, PROFILE, ['databases']);

    cacheSchemas(cache, PROFILE, 'CALIBER_DWH', ['ANALYTICS', 'STAGING']);
    cacheTables(cache, PROFILE, 'CALIBER_DWH', 'ANALYTICS', [{ name: 'CUSTOMERS', kind: 'table' }]);
    cacheTables(cache, PROFILE, 'CALIBER_DWH', 'STAGING', [{ name: 'RAW_EVENTS', kind: 'table' }]);
    cacheSchemas(cache, PROFILE, 'SNOWFLAKE', ['ACCOUNT_USAGE']);
    cacheTables(cache, PROFILE, 'SNOWFLAKE', 'ACCOUNT_USAGE', [
      { name: 'QUERY_HISTORY', kind: 'table' }
    ]);
    cacheColumns(cache, PROFILE, 'CALIBER_DWH', 'ANALYTICS', 'CUSTOMERS', [
      { name: 'ID', dataType: 'NUMBER', nullable: false }
    ]);

    const config = buildSchemaConfig(PROFILE, 'CALIBER_DWH', 'ANALYTICS', cache) as unknown as Record<
      string,
      { self: { boost: number }; children: Record<string, { self: { boost: number } }> }
    >;

    expect(config['CUSTOMERS'].self.boost).toBe(2);
    expect(config['STAGING'].self.boost).toBe(1);
    expect(config['SNOWFLAKE'].self.boost).toBe(0);
    expect(config['CUSTOMERS'].self.boost).toBeGreaterThan(config['STAGING'].self.boost);
    expect(config['STAGING'].self.boost).toBeGreaterThan(config['SNOWFLAKE'].self.boost);
    expect(config['CALIBER_DWH'].children['STAGING'].self.boost).toBe(1);
  });

  test('a repeat ensure for an already-populated path is a no-op (dedup + cache hit)', async () => {
    const cache = createCompletionCache();
    const api = makeSchemaApi();
    const fetcher = createCompletionFetcher(cache, api);

    await fetcher.ensure(SID, PROFILE, ['databases']);
    expect(api.calls).toHaveLength(1);

    await fetcher.ensure(SID, PROFILE, ['databases']);
    expect(api.calls).toHaveLength(1);
  });

  test('concurrent cache-miss ensures collapse into a single in-flight IPC call', async () => {
    const cache = createCompletionCache();
    let resolveDbs!: (v: string[]) => void;
    const api = makeSchemaApi({
      listDatabases: async (sessionId: SessionId) => {
        api.calls.push({ method: 'listDatabases', args: [sessionId] });
        return new Promise<string[]>((res) => {
          resolveDbs = res;
        });
      }
    });
    const fetcher = createCompletionFetcher(cache, api);

    const p1 = fetcher.ensure(SID, PROFILE, ['databases']);
    const p2 = fetcher.ensure(SID, PROFILE, ['databases']);
    const p3 = fetcher.ensure(SID, PROFILE, ['databases']);

    expect(api.calls).toHaveLength(1);

    resolveDbs(['CALIBER_DWH']);
    await Promise.all([p1, p2, p3]);

    expect(api.calls).toHaveLength(1);
    expect(cache.get(PROFILE, ['databases'])).toEqual(['CALIBER_DWH']);
  });
});
