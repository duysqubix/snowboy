import { describe, expect, test } from 'bun:test';
import { getFetchPath, buildSchemaConfig } from '../../../src/renderer/lib/editor/schemaCompletion';
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

      const config = buildSchemaConfig('profile1', 'db1', 'schema1', cache) as any;

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
});
