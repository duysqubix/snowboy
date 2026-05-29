import { describe, expect, test } from 'bun:test';
import {
  cacheColumns,
  cacheDatabases,
  cacheSchemas,
  cacheTables
} from '../../../src/renderer/lib/browser/completionCacheSync';
import { completionCache } from '../../../src/renderer/lib/editor/completionCacheSingleton';
import { createCompletionFetcher } from '../../../src/renderer/lib/editor/completionFetcher';
import { createCompletionCache } from '../../../src/renderer/lib/editor/completionCache';
import type { Column, SchemaObject, SessionId } from '../../../src/main/types';

const SID = 'sess-1' as SessionId;

describe('completionCacheSync helpers', () => {
  test('cacheDatabases writes the databases path', () => {
    const cache = createCompletionCache();
    cacheDatabases(cache, 'p', ['CALIBER_DWH', 'SNOWFLAKE']);
    expect(cache.get('p', ['databases'])).toEqual(['CALIBER_DWH', 'SNOWFLAKE']);
  });

  test('cacheSchemas writes the per-database schemas path', () => {
    const cache = createCompletionCache();
    cacheSchemas(cache, 'p', 'CALIBER_DWH', ['ANALYTICS', 'PUBLIC']);
    expect(cache.get('p', ['schemas', 'CALIBER_DWH'])).toEqual(['ANALYTICS', 'PUBLIC']);
  });

  test('cacheTables writes only table objects (views excluded) under the tables path', () => {
    const cache = createCompletionCache();
    const objects: SchemaObject[] = [
      { name: 'CUSTOMERS', kind: 'table' },
      { name: 'ORDERS', kind: 'table' },
      { name: 'CUSTOMER_VIEW', kind: 'view' }
    ];
    cacheTables(cache, 'p', 'DB', 'SCH', objects);
    expect(cache.get('p', ['tables', 'DB', 'SCH'])).toEqual(['CUSTOMERS', 'ORDERS']);
  });

  test('cacheColumns writes column names under the columns path', () => {
    const cache = createCompletionCache();
    const cols: Column[] = [
      { name: 'ID', dataType: 'NUMBER', nullable: false },
      { name: 'NAME', dataType: 'TEXT', nullable: true }
    ];
    cacheColumns(cache, 'p', 'DB', 'SCH', 'CUSTOMERS', cols);
    expect(cache.get('p', ['columns', 'DB', 'SCH', 'CUSTOMERS'])).toEqual(['ID', 'NAME']);
  });
});

describe('completionCache singleton', () => {
  test('exports a shared CompletionCache instance', () => {
    expect(typeof completionCache.get).toBe('function');
    expect(typeof completionCache.set).toBe('function');
    expect(typeof completionCache.invalidate).toBe('function');
  });

  test('browser writes are readable on the same singleton instance', () => {
    const profileId = 'singleton-write-read';
    completionCache.invalidate(profileId);
    cacheSchemas(completionCache, profileId, 'CALIBER_DWH', ['ANALYTICS']);
    expect(completionCache.get(profileId, ['schemas', 'CALIBER_DWH'])).toEqual(['ANALYTICS']);
    completionCache.invalidate(profileId);
  });
});

describe('Object Browser -> completion cache flow (via shared singleton)', () => {
  test('a browsed schema is served to the editor read side with zero IPC', async () => {
    const profileId = 'flow-schemas';
    completionCache.invalidate(profileId);

    cacheSchemas(completionCache, profileId, 'CALIBER_DWH', ['ANALYTICS', 'PUBLIC']);

    let ipcCalls = 0;
    const fetcher = createCompletionFetcher(completionCache, {
      schema: {
        listDatabases: async () => {
          ipcCalls += 1;
          return [];
        },
        listSchemas: async () => {
          ipcCalls += 1;
          return [];
        },
        listObjects: async () => {
          ipcCalls += 1;
          return [];
        },
        getColumns: async () => {
          ipcCalls += 1;
          return [];
        }
      }
    } as never);

    await fetcher.ensure(SID, profileId, ['schemas', 'CALIBER_DWH']);

    expect(ipcCalls).toBe(0);
    expect(completionCache.get(profileId, ['schemas', 'CALIBER_DWH'])).toEqual([
      'ANALYTICS',
      'PUBLIC'
    ]);
    completionCache.invalidate(profileId);
  });

  test('a browsed table exposes its columns to the editor with zero IPC', async () => {
    const profileId = 'flow-columns';
    completionCache.invalidate(profileId);

    cacheColumns(completionCache, profileId, 'DB', 'SCH', 'CUSTOMERS', [
      { name: 'ID', dataType: 'NUMBER', nullable: false },
      { name: 'EMAIL', dataType: 'TEXT', nullable: true }
    ]);

    let ipcCalls = 0;
    const fetcher = createCompletionFetcher(completionCache, {
      schema: {
        listDatabases: async () => [],
        listSchemas: async () => [],
        listObjects: async () => [],
        getColumns: async () => {
          ipcCalls += 1;
          return [];
        }
      }
    } as never);

    await fetcher.ensure(SID, profileId, ['columns', 'DB', 'SCH', 'CUSTOMERS']);

    expect(ipcCalls).toBe(0);
    expect(completionCache.get(profileId, ['columns', 'DB', 'SCH', 'CUSTOMERS'])).toEqual([
      'ID',
      'EMAIL'
    ]);
    completionCache.invalidate(profileId);
  });

  test('refresh invalidate clears the slice; next browse re-populates', () => {
    const profileId = 'flow-refresh';
    completionCache.invalidate(profileId);

    cacheDatabases(completionCache, profileId, ['DB_A']);
    cacheSchemas(completionCache, profileId, 'DB_A', ['PUBLIC']);
    expect(completionCache.get(profileId, ['databases'])).toEqual(['DB_A']);

    completionCache.invalidate(profileId);
    expect(completionCache.get(profileId, ['databases'])).toBe(null);
    expect(completionCache.get(profileId, ['schemas', 'DB_A'])).toBe(null);

    cacheDatabases(completionCache, profileId, ['DB_A', 'DB_B']);
    expect(completionCache.get(profileId, ['databases'])).toEqual(['DB_A', 'DB_B']);
    completionCache.invalidate(profileId);
  });
});
