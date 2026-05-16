/**
 * T3.5 — schema.* IPC handlers.
 *
 * Backs the object-browser tree and the DDL viewer. Each handler resolves
 * a `SessionId` to a live `Session` via the registry T3.2 owns, then
 * issues a Snowflake-side enumeration:
 *
 *   listDatabases  -> SHOW DATABASES                       (cached)
 *   listSchemas    -> SHOW SCHEMAS IN DATABASE "<db>"      (cached)
 *   listObjects    -> SHOW TABLES + SHOW VIEWS (parallel)  (cached)
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
 * Wave 1's `schemaCache` exposes opaque-payload reads only — it returns
 * the JSON we put in, with no `fetched_at` field. To enforce the 5-minute
 * TTL the plan asks for, we wrap our payloads in `{ fetchedAt, data }`
 * envelopes here. Tree-shape data (databases, schemas, tables, views)
 * is cached; per-object metadata (columns, DDL) is not — they are fast
 * single queries and `getColumns` rarely runs twice in a row.
 *
 * Function objects are NOT enumerated in v0.1. The shared `SchemaObjectKind`
 * is `'table' | 'view' | 'database' | 'schema' | 'column'`; widening it
 * touches `src/main/types.ts` which Bucket Y also mutates this wave, so
 * we defer functions to v0.2.
 *
 * The `invalidate` channel that pairs with the user-facing "Refresh"
 * action is intentionally NOT added here — it touches `types.ts` and
 * `channels.ts` which the orchestrator will reconcile post-merge.
 */

import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import { getCached, setCached } from '../storage/schemaCache';
import type { Session } from '../snowflake/session';
import type { ColumnMeta } from '../snowflake/types';
import type { Column, ObjectRef, SchemaObject, SessionId } from '../types';
import { requireSession } from './sessions';

const SCHEMA_QUERY_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

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
// Cache envelope (TTL wrapping)
// ---------------------------------------------------------------------------

interface CachedEnvelope<T> {
  fetchedAt: number;
  data: T;
}

function isEnvelope<T>(value: unknown): value is CachedEnvelope<T> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['fetchedAt'] === 'number' && 'data' in candidate;
}

function readFresh<T>(
  profileId: string,
  database: string,
  schema: string | null,
  objectType: string
): T | null {
  const stored = getCached(profileId, database, schema, objectType);
  if (stored === null || !isEnvelope<T>(stored)) return null;
  if (Date.now() - stored.fetchedAt > CACHE_TTL_MS) return null;
  return stored.data;
}

function writeFresh<T>(
  profileId: string,
  database: string,
  schema: string | null,
  objectType: string,
  data: T
): void {
  const envelope: CachedEnvelope<T> = { fetchedAt: Date.now(), data };
  setCached(profileId, database, schema, objectType, envelope);
}

async function getOrFetch<T>(
  profileId: string,
  database: string,
  schema: string | null,
  objectType: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = readFresh<T>(profileId, database, schema, objectType);
  if (cached !== null) return cached;
  const fresh = await fetcher();
  writeFresh(profileId, database, schema, objectType, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Fetchers (raw Snowflake-side enumeration; cache wrapping happens above)
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
  return getOrFetch(profileId, '', null, 'database', () => fetchDatabaseNames(session));
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
  return getOrFetch(profileId, database, null, 'schema', () =>
    fetchSchemaNames(session, database)
  );
}

export async function listObjects(
  sessionId: SessionId,
  database: string,
  schema: string
): Promise<SchemaObject[]> {
  if (typeof database !== 'string' || database.length === 0) {
    throw new Error('schema.listObjects: database is required');
  }
  if (typeof schema !== 'string' || schema.length === 0) {
    throw new Error('schema.listObjects: schema is required');
  }
  const session = requireSession(sessionId);
  const profileId = session.getProfileId();
  // Tables and views are cached under separate object_type keys so a future
  // narrow invalidation (only views changed) does not have to evict tables.
  const [tables, views] = await Promise.all([
    getOrFetch<SchemaObject[]>(profileId, database, schema, 'table', () =>
      fetchObjectsOfKind(session, database, schema, 'TABLES', 'table')
    ),
    getOrFetch<SchemaObject[]>(profileId, database, schema, 'view', () =>
      fetchObjectsOfKind(session, database, schema, 'VIEWS', 'view')
    )
  ]);
  return [...tables, ...views];
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
    (_event, sessionId: SessionId, database: string, schema: string) =>
      listObjects(sessionId, database, schema)
  );
  ipcMain.handle(
    CHANNELS.schema.getColumns,
    (_event, sessionId: SessionId, obj: ObjectRef) => getColumns(sessionId, obj)
  );
  ipcMain.handle(
    CHANNELS.schema.getDDL,
    (_event, sessionId: SessionId, obj: ObjectRef) => getDDL(sessionId, obj)
  );
}
