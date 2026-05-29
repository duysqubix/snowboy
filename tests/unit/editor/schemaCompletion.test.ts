import { describe, expect, test } from 'bun:test';
import {
  getFetchPath,
  buildSchemaConfig,
  withLoadingCompletion
} from '../../../src/renderer/lib/editor/schemaCompletion';
import { createCompletionCache } from '../../../src/renderer/lib/editor/completionCache';

describe('schemaCompletion', () => {
  describe('getFetchPath', () => {
    test('returns tables for current schema when typing at top level', () => {
      const cache = createCompletionCache();
      const path = getFetchPath('', 'db1', 'schema1', 'profile1', cache);
      expect(path).toEqual(['tables', 'db1', 'schema1']);
    });

    test('returns schemas when typing a known database', () => {
      const cache = createCompletionCache();
      cache.set('profile1', ['databases'], ['db1', 'db2']);
      const path = getFetchPath('db1.', 'db1', 'schema1', 'profile1', cache);
      expect(path).toEqual(['schemas', 'db1']);
    });

    test('returns tables when typing a known schema in current db', () => {
      const cache = createCompletionCache();
      cache.set('profile1', ['schemas', 'db1'], ['schema1', 'schema2']);
      const path = getFetchPath('schema2.', 'db1', 'schema1', 'profile1', cache);
      expect(path).toEqual(['tables', 'db1', 'schema2']);
    });

    test('returns columns when typing a known table in current schema', () => {
      const cache = createCompletionCache();
      cache.set('profile1', ['tables', 'db1', 'schema1'], ['table1', 'table2']);
      const path = getFetchPath('table1.', 'db1', 'schema1', 'profile1', cache);
      expect(path).toEqual(['columns', 'db1', 'schema1', 'table1']);
    });

    test('returns columns with a cached fallback schema when current schema is unknown', () => {
      const cache = createCompletionCache();
      cache.set('profile1', ['schemas', 'db1'], ['PUBLIC', 'ANALYTICS']);

      const path = getFetchPath('table1.', 'db1', undefined, 'profile1', cache);

      expect(path).toEqual(['columns', 'db1', 'PUBLIC', 'table1']);
    });

    test('does not fetch tables for a mid-typed schema fragment', () => {
      const cache = createCompletionCache();
      cache.set('profile1', ['databases'], ['CALIBER_DWH']);
      cache.set('profile1', ['schemas', 'CALIBER_DWH'], ['DS', 'PUBLIC']);

      const path = getFetchPath('CALIBER_DWH.X.', 'CALIBER_DWH', 'DS', 'profile1', cache);

      expect(path).toBe(null);
    });

    test('returns tables for a known fully-qualified schema', () => {
      const cache = createCompletionCache();
      cache.set('profile1', ['databases'], ['CALIBER_DWH']);
      cache.set('profile1', ['schemas', 'CALIBER_DWH'], ['DS', 'PUBLIC']);

      const path = getFetchPath('CALIBER_DWH.DS.', 'CALIBER_DWH', 'PUBLIC', 'profile1', cache);

      expect(path).toEqual(['tables', 'CALIBER_DWH', 'DS']);
    });

    test('returns columns when typing db.schema.table.', () => {
      const cache = createCompletionCache();
      const path = getFetchPath('db2.schema2.table2.', 'db1', 'schema1', 'profile1', cache);
      expect(path).toEqual(['columns', 'db2', 'schema2', 'table2']);
    });
  });

  describe('buildSchemaConfig', () => {
    test('schema source produces items ordered by concentric circles', () => {
      const cache = createCompletionCache();
      cache.set('profile1', ['databases'], ['db1', 'db2']);
      cache.set('profile1', ['schemas', 'db1'], ['schema1', 'schema2']);
      cache.set('profile1', ['tables', 'db1', 'schema1'], ['table1']);
      cache.set('profile1', ['tables', 'db1', 'schema2'], ['table2']);
      cache.set('profile1', ['schemas', 'db2'], ['schema3']);
      cache.set('profile1', ['tables', 'db2', 'schema3'], ['table3']);

      const config = buildSchemaConfig('profile1', 'db1', 'schema1', cache) as unknown as Record<string, { self: { boost: number } }>;

      // Current schema table should be at top level with boost 2
      expect(config['table1'].self.boost).toBe(2);
      
      // Current db schema should be at top level with boost 1
      expect(config['schema2'].self.boost).toBe(1);
      
      // Other db should be at top level with boost 0
      expect(config['db2'].self.boost).toBe(0);
      
      // Nested items
      expect(config['db1'].children['schema2'].children['table2'].self.boost).toBe(1);
    });
  });

  describe('withLoadingCompletion', () => {
    test('prepends the loading sentinel to an existing completion result', () => {
      const result = withLoadingCompletion({ from: 7, options: [{ label: 'ID', type: 'property' }] }, 7);

      expect(result.from).toBe(7);
      expect(result.options.map((option) => option.label)).toEqual(['Loading...', 'ID']);
      expect(result.options[0]?.info).toBe('Fetching schema data...');
    });

    test('returns only the loading sentinel when the SQL source has no result', () => {
      const result = withLoadingCompletion(null, 11);

      expect(result).toEqual({
        from: 11,
        options: [
          {
            label: 'Loading...',
            type: 'text',
            boost: 999,
            info: 'Fetching schema data...'
          }
        ]
      });
    });
  });
});
