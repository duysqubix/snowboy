import type { CompletionCache } from '../editor/completionCache';
import type { Column, SchemaObject } from '../../../main/types';

export function cacheDatabases(
  cache: CompletionCache,
  profileId: string,
  databases: string[]
): void {
  cache.set(profileId, ['databases'], databases);
}

export function cacheSchemas(
  cache: CompletionCache,
  profileId: string,
  database: string,
  schemas: string[]
): void {
  cache.set(profileId, ['schemas', database], schemas);
}

export function cacheTables(
  cache: CompletionCache,
  profileId: string,
  database: string,
  schema: string,
  objects: SchemaObject[]
): void {
  cache.set(
    profileId,
    ['tables', database, schema],
    objects.filter((o) => o.kind === 'table').map((o) => o.name)
  );
}

export function cacheColumns(
  cache: CompletionCache,
  profileId: string,
  database: string,
  schema: string,
  table: string,
  columns: Column[]
): void {
  cache.set(
    profileId,
    ['columns', database, schema, table],
    columns.map((c) => c.name)
  );
}
