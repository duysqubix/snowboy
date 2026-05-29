import type { SQLNamespace } from '@codemirror/lang-sql';
import type { CompletionResult } from '@codemirror/autocomplete';
import type { CompletionCache } from './completionCache';

function firstCachedSchema(
  profileId: string,
  currentDb: string,
  cache: CompletionCache
): string | undefined {
  return cache.get(profileId, ['schemas', currentDb])?.[0];
}

function isIdentifier(value: string): boolean {
  return /^"(?:[^"]|"")+"$|^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(value);
}

export function getFetchPath(
  text: string,
  currentDb: string | undefined,
  currentSchema: string | undefined,
  profileId: string,
  cache: CompletionCache
): string[] | null {
  const parts = text.split('.');
  parts.pop(); // remove the part currently being typed
  
  if (parts.length === 0) {
    if (currentDb && currentSchema) return ['tables', currentDb, currentSchema];
    return null;
  }
  
  if (parts.length === 1) {
    const p = parts[0] as string;
    const dbs = cache.get(profileId, ['databases']) || [];
    if (dbs.includes(p)) return ['schemas', p];
    
    if (currentDb) {
      const schemas = cache.get(profileId, ['schemas', currentDb]) || [];
      if (schemas.includes(p)) return ['tables', currentDb, p];
       
      if (currentSchema) {
        const tables = cache.get(profileId, ['tables', currentDb, currentSchema]) || [];
        if (tables.includes(p)) return ['columns', currentDb, currentSchema, p];
        
        return ['columns', currentDb, currentSchema, p];
      }

      const fallbackSchema = firstCachedSchema(profileId, currentDb, cache);
      if (fallbackSchema && isIdentifier(p)) return ['columns', currentDb, fallbackSchema, p];
    }
    return null;
  }
  
  if (parts.length === 2) {
    const p1 = parts[0] as string;
    const p2 = parts[1] as string;
    const dbs = cache.get(profileId, ['databases']) || [];
    if (dbs.includes(p1)) {
      const schemas = cache.get(profileId, ['schemas', p1]) || [];
      if (p2 === '' || schemas.includes(p2)) return ['tables', p1, p2];
      return null;
    }
    
    if (currentDb) {
      const schemas = cache.get(profileId, ['schemas', currentDb]) || [];
      if (schemas.includes(p1)) return ['columns', currentDb, p1, p2];
    }
    
    return null;
  }
  
  if (parts.length === 3) {
    return ['columns', parts[0] as string, parts[1] as string, parts[2] as string];
  }
  
  return null;
}

export function withLoadingCompletion(
  result: CompletionResult | null,
  from: number
): CompletionResult {
  const loadingOption = {
    label: 'Loading...',
    type: 'text',
    boost: 999,
    info: 'Fetching schema data...'
  };

  if (result) {
    return {
      ...result,
      options: [loadingOption, ...result.options]
    };
  }

  return {
    from,
    options: [loadingOption]
  };
}

export function buildSchemaConfig(
  profileId: string,
  currentDb: string | undefined,
  currentSchema: string | undefined,
  cache: CompletionCache
): SQLNamespace {
  const tree: Record<string, unknown> = {};
  
  const dbs = cache.get(profileId, ['databases']) || [];
  
  for (const db of dbs) {
    const isCurrentDb = db === currentDb;
    const schemas = cache.get(profileId, ['schemas', db]) || [];
    
    const dbNode: Record<string, unknown> = {};
    
    for (const schema of schemas) {
      const isCurrentSchema = isCurrentDb && schema === currentSchema;
      const tables = cache.get(profileId, ['tables', db, schema]) || [];
      
      const schemaNode: Record<string, unknown> = {};
      
      for (const table of tables) {
        const cols = cache.get(profileId, ['columns', db, schema, table]) || [];
        const colCompletions = cols.map(c => ({ label: c, type: 'property' }));
        
        const tableNode = {
          self: { label: table, type: 'class', boost: isCurrentSchema ? 2 : (isCurrentDb ? 1 : 0) },
          children: colCompletions
        };
        
        schemaNode[table] = tableNode;
        
        if (isCurrentSchema) {
          tree[table] = tableNode;
        }
      }
      
      const schemaSelf = {
        self: { label: schema, type: 'namespace', boost: isCurrentDb ? 1 : 0 },
        children: schemaNode
      };
      
      dbNode[schema] = schemaSelf;
      
      if (isCurrentDb) {
        tree[schema] = schemaSelf;
      }
    }
    
    tree[db] = {
      self: { label: db, type: 'namespace', boost: 0 },
      children: dbNode
    };
  }
  
  return tree as SQLNamespace;
}
