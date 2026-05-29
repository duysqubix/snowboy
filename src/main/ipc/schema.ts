/**
 * T3.5 — schema.* IPC handlers (B1: SQLite-backed cache wired in).
 *
 * Backs the object-browser tree and the DDL viewer. Each handler resolves
 * a `SessionId` to a live `Session` via the registry T3.2 owns, then
 * issues a Snowflake-side enumeration:
 *
 *   listDatabases  -> SHOW DATABASES                       (cached, 5-min TTL)
 *   listSchemas    -> SHOW SCHEMAS IN DATABASE "<db>"      (cached, 5-min TTL)
 *   listObjects    -> SHOW TABLES + SHOW VIEWS (parallel)  (cached, 5-min TTL)
 *   getColumns     -> INFORMATION_SCHEMA.COLUMNS           (no cache)
 *   getDDL         -> SELECT GET_DDL(...)                  (no cache)
 *
 * `SHOW` is preferred over `INFORMATION_SCHEMA.*` for the tree because it
 * does not require an active warehouse and returns faster on large
 * accounts (SNOWFLAKE_WAVE3_REFERENCE §2). `INFORMATION_SCHEMA.COLUMNS`
 * is used for `getColumns` because `SHOW COLUMNS` returns its result
 * inside a `data_type` JSON blob that is awkward to parse.
 *
 * Caching:
 *
 * `schemaCache` stores opaque JSON payloads keyed by
 * (profile_id, database_name, schema_name, object_type). We wrap every
 * cached value in a `{ fetchedAt, data }` envelope so the IPC layer can
 * enforce a 5-minute TTL without round-tripping `fetched_at` through the
 * row. On read, an expired envelope is treated as a miss and a fresh
 * fetch is issued. Per-object metadata (columns, DDL) is NOT cached —
 * single-row queries with high churn potential.
 *
 * The DB-list cache key uses the sentinel database name `'__all__'` since
 * `listDatabases` is profile-scoped rather than database-scoped. The
 * sentinel is shared with `invalidateByProfile` (which drops every row,
 * sentinel included) so user-facing Refresh always wipes it.
 *
 * Function objects are NOT enumerated in v0.1. The shared `SchemaObjectKind`
 * is `'table' | 'view' | 'database' | 'schema' | 'column'`; widening it
 * touches `src/main/types.ts` which Bucket Y also mutates this wave, so
 * we defer functions to v0.2.
 */

import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import type { Session } from '../snowflake/session';
import type { ColumnMeta } from '../snowflake/types';
import type { Column, ListObjectsOptions, ObjectRef, SchemaObject, SessionId } from '../types';
import { onSessionClose, requireSession } from './sessions';
import {
  getCached,
  invalidateByProfile as cacheInvalidateByProfile,
  invalidateByProfileDb as cacheInvalidateByProfileDb,
  invalidateByProfileDbSchema as cacheInvalidateByProfileDbSchema,
  setCached,
  type ObjectType
} from '../storage/schemaCache';

const SCHEMA_QUERY_TIMEOUT_MS = 30_000;
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
const DB_LIST_SENTINEL = '__all__';

interface CacheEnvelope<T> {
  fetchedAt: number;
  data: T;
}

function isEnvelope<T>(value: unknown): value is CacheEnvelope<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fetchedAt' in value &&
    'data' in value &&
    typeof (value as { fetchedAt: unknown }).fetchedAt === 'number'
  );
}

async function getOrFetch<T>(
  profileId: string,
  database: string,
  schema: string | null,
  objectType: ObjectType,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = getCached(profileId, database, schema, objectType);
  if (isEnvelope<T>(cached)) {
    if (Date.now() - cached.fetchedAt <= SCHEMA_CACHE_TTL_MS) {
      return cached.data;
    }
  }
  const fresh = await fetcher();
  const envelope: CacheEnvelope<T> = { fetchedAt: Date.now(), data: fresh };
  setCached(profileId, database, schema, objectType, envelope);
  return fresh;
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteQualifiedName(database: string, schema: string, name: string): string {
  return `${quoteIdent(database)}.${quoteIdent(schema)}.${quoteIdent(name)}`;
}

// ---------------------------------------------------------------------------
// Streaming → all-rows helper
// ---------------------------------------------------------------------------

interface QueryRows {
  rows: readonly unknown[][];
  columns: readonly ColumnMeta[];
}

async function runQueryRows(
  session: Session,
  sql: string,
  timeoutMs: number = SCHEMA_QUERY_TIMEOUT_MS
): Promise<QueryRows> {
  return new Promise((resolve, reject) => {
    const collected: unknown[][] = [];
    let columns: readonly ColumnMeta[] = [];
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    session.runStreaming(
      sql,
      { timeoutMs },
      {
        onBatch: (batch) => {
          if (columns.length === 0) columns = batch.columns;
          for (const row of batch.rows) collected.push(row.slice() as unknown[]);
        },
        onComplete: () => settle(() => resolve({ rows: collected, columns })),
        onError: (err) => settle(() => reject(err)),
        onCancel: () => settle(() => reject(new Error('Schema query was cancelled')))
      }
    );
  });
}

function columnIndex(columns: readonly ColumnMeta[], name: string): number {
  const target = name.toLowerCase();
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col !== undefined && col.name.toLowerCase() === target) {
      return i;
    }
  }
  return -1;
}

function requireColumnIndex(
  columns: readonly ColumnMeta[],
  name: string,
  context: string
): number {
  const idx = columnIndex(columns, name);
  if (idx === -1) {
    const have = columns.map((c) => c.name).join(', ');
    throw new Error(
      `${context}: expected column "${name}" not present in result (got: ${have})`
    );
  }
  return idx;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// ---------------------------------------------------------------------------
// Fetchers (raw Snowflake-side enumeration; caching is deferred to Wave 4)
// ---------------------------------------------------------------------------

async function fetchDatabaseNames(session: Session): Promise<string[]> {
  const { rows, columns } = await runQueryRows(session, 'SHOW DATABASES');
  const nameIdx = requireColumnIndex(columns, 'name', 'schema.listDatabases');
  return rows
    .map((row) => row[nameIdx])
    .filter((v): v is string => typeof v === 'string');
}

async function fetchSchemaNames(session: Session, database: string): Promise<string[]> {
  const sql = `SHOW SCHEMAS IN DATABASE ${quoteIdent(database)}`;
  const { rows, columns } = await runQueryRows(session, sql);
  const nameIdx = requireColumnIndex(columns, 'name', 'schema.listSchemas');
  return rows
    .map((row) => row[nameIdx])
    .filter((v): v is string => typeof v === 'string')
    .filter((name) => name !== 'INFORMATION_SCHEMA');
}

async function fetchRoleNames(session: Session): Promise<string[]> {
  const { rows, columns } = await runQueryRows(session, 'SHOW ROLES');
  const nameIdx = requireColumnIndex(columns, 'name', 'schema.listRoles');
  return rows
    .map((row) => row[nameIdx])
    .filter((v): v is string => typeof v === 'string');
}

async function fetchWarehouseNames(session: Session): Promise<string[]> {
  const { rows, columns } = await runQueryRows(session, 'SHOW WAREHOUSES');
  const nameIdx = requireColumnIndex(columns, 'name', 'schema.listWarehouses');
  return rows
    .map((row) => row[nameIdx])
    .filter((v): v is string => typeof v === 'string');
}

async function fetchObjectsOfKind(
  session: Session,
  database: string,
  schema: string,
  command: 'TABLES' | 'VIEWS',
  kind: 'table' | 'view'
): Promise<SchemaObject[]> {
  const sql = `SHOW ${command} IN SCHEMA ${quoteIdent(database)}.${quoteIdent(schema)}`;
  const { rows, columns } = await runQueryRows(session, sql);
  const nameIdx = requireColumnIndex(columns, 'name', `schema.listObjects(${command})`);
  const commentIdx = columnIndex(columns, 'comment');
  const out: SchemaObject[] = [];
  for (const row of rows) {
    const name = row[nameIdx];
    if (typeof name !== 'string') continue;
    const obj: SchemaObject = { name, kind };
    if (commentIdx !== -1) {
      const comment = stringOrEmpty(row[commentIdx]);
      if (comment.length > 0) obj.comment = comment;
    }
    out.push(obj);
  }
  return out;
}

function isSnowflakeObjectDoesNotExistError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const fields = err as { code?: unknown; sqlState?: unknown; message?: unknown };
  if (fields.code === '002043' || fields.sqlState === '02000') return true;
  return typeof fields.message === 'string' && fields.message.includes('Object does not exist');
}

async function fetchObjectsOfKindOrEmptyForMissingSchema(
  session: Session,
  database: string,
  schema: string,
  command: 'TABLES' | 'VIEWS',
  kind: 'table' | 'view',
  downgradeMissingSchema: boolean
): Promise<SchemaObject[]> {
  try {
    return await fetchObjectsOfKind(session, database, schema, command, kind);
  } catch (err) {
    if (downgradeMissingSchema && isSnowflakeObjectDoesNotExistError(err)) {
      console.warn(
        `[schema] listObjects: ${database}.${schema} does not exist while fetching ${kind}s`
      );
      return [];
    }
    throw err;
  }
}

async function fetchColumns(
  session: Session,
  obj: ObjectRef
): Promise<Column[]> {
  const sql =
    `SELECT column_name, data_type, is_nullable, comment ` +
    `FROM ${quoteIdent(obj.database)}.INFORMATION_SCHEMA.COLUMNS ` +
    `WHERE table_schema = ${quoteSqlLiteral(obj.schema)} ` +
    `AND table_name = ${quoteSqlLiteral(obj.name)} ` +
    `ORDER BY ordinal_position`;
  const { rows, columns } = await runQueryRows(session, sql);
  const nameIdx = requireColumnIndex(columns, 'column_name', 'schema.getColumns');
  const typeIdx = requireColumnIndex(columns, 'data_type', 'schema.getColumns');
  const nullableIdx = requireColumnIndex(columns, 'is_nullable', 'schema.getColumns');
  const commentIdx = columnIndex(columns, 'comment');
  const out: Column[] = [];
  for (const row of rows) {
    const name = row[nameIdx];
    const dataType = row[typeIdx];
    if (typeof name !== 'string' || typeof dataType !== 'string') continue;
    const nullableRaw = row[nullableIdx];
    // INFORMATION_SCHEMA returns IS_NULLABLE as 'YES' / 'NO' per ANSI SQL.
    const nullable =
      typeof nullableRaw === 'string'
        ? nullableRaw.trim().toUpperCase() === 'YES'
        : Boolean(nullableRaw);
    const column: Column = { name, dataType, nullable };
    if (commentIdx !== -1) {
      const comment = stringOrEmpty(row[commentIdx]);
      if (comment.length > 0) column.comment = comment;
    }
    out.push(column);
  }
  return out;
}

function ddlKindFor(kind: ObjectRef['kind']): string {
  switch (kind) {
    case 'table':
      return 'TABLE';
    case 'view':
      return 'VIEW';
    case 'schema':
      return 'SCHEMA';
    case 'database':
      return 'DATABASE';
    case 'column':
      throw new Error('schema.getDDL: GET_DDL is not defined for individual columns');
    default: {
      const exhaustive: never = kind;
      throw new Error(`schema.getDDL: unsupported kind ${String(exhaustive)}`);
    }
  }
}

async function fetchDDL(session: Session, obj: ObjectRef): Promise<string> {
  const ddlKind = ddlKindFor(obj.kind);
  // GET_DDL accepts a single string arg whose dots are the namespace
  // separator; quoting identifiers with double quotes inside that literal
  // preserves case + special characters per SNOWFLAKE_WAVE3_REFERENCE §1.
  const targetForDdl =
    obj.kind === 'database'
      ? quoteIdent(obj.name)
      : obj.kind === 'schema'
        ? `${quoteIdent(obj.database)}.${quoteIdent(obj.name)}`
        : quoteQualifiedName(obj.database, obj.schema, obj.name);
  const sql = `SELECT GET_DDL(${quoteSqlLiteral(ddlKind)}, ${quoteSqlLiteral(targetForDdl)})`;
  const { rows, columns } = await runQueryRows(session, sql);
  if (rows.length === 0 || columns.length === 0) {
    return '';
  }
  const firstRow = rows[0];
  if (firstRow === undefined) return '';
  const ddl = firstRow[0];
  return typeof ddl === 'string' ? ddl : '';
}

// ---------------------------------------------------------------------------
// Handler implementations (exported for direct unit testing)
// ---------------------------------------------------------------------------

export async function listDatabases(sessionId: SessionId): Promise<string[]> {
  const session = requireSession(sessionId);
  const profileId = session.getProfileId();
  const names = await getOrFetch<string[]>(
    profileId,
    DB_LIST_SENTINEL,
    null,
    'database',
    () => fetchDatabaseNames(session)
  );
  console.log(`[schema] listDatabases: returning ${names.length} databases`);
  return names;
}

export async function listSchemas(
  sessionId: SessionId,
  database: string
): Promise<string[]> {
  if (typeof database !== 'string' || database.length === 0) {
    throw new Error('schema.listSchemas: database is required');
  }
  const session = requireSession(sessionId);
  const profileId = session.getProfileId();
  return getOrFetch<string[]>(
    profileId,
    database,
    null,
    'schema',
    () => fetchSchemaNames(session, database)
  );
}

export async function listObjects(
  sessionId: SessionId,
  database: string,
  schema: string,
  options?: ListObjectsOptions
): Promise<SchemaObject[]> {
  if (typeof database !== 'string' || database.length === 0) {
    throw new Error('schema.listObjects: database is required');
  }
  if (typeof schema !== 'string' || schema.length === 0) {
    throw new Error('schema.listObjects: schema is required');
  }
  const session = requireSession(sessionId);
  const profileId = session.getProfileId();
  const downgradeMissingSchema = options?.source === 'completion';
  const [tables, views] = await Promise.all([
    getOrFetch<SchemaObject[]>(profileId, database, schema, 'table', () =>
      fetchObjectsOfKindOrEmptyForMissingSchema(
        session,
        database,
        schema,
        'TABLES',
        'table',
        downgradeMissingSchema
      )
    ),
    getOrFetch<SchemaObject[]>(profileId, database, schema, 'view', () =>
      fetchObjectsOfKindOrEmptyForMissingSchema(
        session,
        database,
        schema,
        'VIEWS',
        'view',
        downgradeMissingSchema
      )
    )
  ]);
  return [...tables, ...views];
}

export function invalidateSchemaCache(
  profileId: string,
  database?: string,
  schema?: string | null
): void {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new Error('schema.invalidate: profileId is required');
  }
  if (database === undefined || database === '') {
    cacheInvalidateByProfile(profileId);
    return;
  }
  if (schema === undefined || schema === null || schema === '') {
    cacheInvalidateByProfileDb(profileId, database);
    return;
  }
  cacheInvalidateByProfileDbSchema(profileId, database, schema);
}

export async function getColumns(
  sessionId: SessionId,
  obj: ObjectRef
): Promise<Column[]> {
  if (obj === null || typeof obj !== 'object') {
    throw new Error('schema.getColumns: obj is required');
  }
  const session = requireSession(sessionId);
  return fetchColumns(session, obj);
}

export async function getDDL(
  sessionId: SessionId,
  obj: ObjectRef
): Promise<string> {
  if (obj === null || typeof obj !== 'object') {
    throw new Error('schema.getDDL: obj is required');
  }
  const session = requireSession(sessionId);
  return fetchDDL(session, obj);
}

export async function listRoles(sessionId: SessionId): Promise<string[]> {
  const session = requireSession(sessionId);
  return fetchRoleNames(session);
}

export async function listWarehouses(sessionId: SessionId): Promise<string[]> {
  const session = requireSession(sessionId);
  return fetchWarehouseNames(session);
}

// ---------------------------------------------------------------------------
// IPC registration adapter
// ---------------------------------------------------------------------------

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.schema.listDatabases, (_event, sessionId: SessionId) =>
    listDatabases(sessionId)
  );
  ipcMain.handle(
    CHANNELS.schema.listSchemas,
    (_event, sessionId: SessionId, database: string) => listSchemas(sessionId, database)
  );
  ipcMain.handle(
    CHANNELS.schema.listObjects,
    (
      _event,
      sessionId: SessionId,
      database: string,
      schema: string,
      options?: ListObjectsOptions
    ) => listObjects(sessionId, database, schema, options)
  );
  ipcMain.handle(
    CHANNELS.schema.getColumns,
    (_event, sessionId: SessionId, obj: ObjectRef) => getColumns(sessionId, obj)
  );
  ipcMain.handle(
    CHANNELS.schema.getDDL,
    (_event, sessionId: SessionId, obj: ObjectRef) => getDDL(sessionId, obj)
  );
  ipcMain.handle(CHANNELS.schema.listRoles, (_event, sessionId: SessionId) =>
    listRoles(sessionId)
  );
  ipcMain.handle(CHANNELS.schema.listWarehouses, (_event, sessionId: SessionId) =>
    listWarehouses(sessionId)
  );
  ipcMain.handle(
    CHANNELS.schema.invalidate,
    (_event, profileId: string, database?: string, schema?: string) => {
      invalidateSchemaCache(profileId, database, schema);
    }
  );

  // Session close → full-profile cache wipe. A profile's only active
  // session closing means the next session-open should re-fetch from
  // Snowflake instead of trusting up to 5-min-old TTL entries that may
  // pre-date adds/drops the user did in another tool. Errors swallowed
  // so a single bad close doesn't block other handlers on the same
  // event.
  onSessionClose((profileId) => {
    try {
      cacheInvalidateByProfile(profileId);
    } catch (err) {
      console.warn('[schema] onSessionClose: cache invalidate failed', err);
    }
  });
}
