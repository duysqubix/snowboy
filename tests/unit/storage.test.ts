import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  closeDatabase,
  getDatabase,
  openDatabase,
  type Database
} from '../../src/main/storage/db';
import { runMigrations } from '../../src/main/storage/migrate';
import {
  deleteProfile,
  getProfile,
  insertProfile,
  listProfiles,
  updateProfile,
  type ConnectionProfileRow
} from '../../src/main/storage/profiles';
import {
  deleteWorksheet,
  getWorksheet,
  insertWorksheet,
  listWorksheets,
  updateWorksheet
} from '../../src/main/storage/worksheets';
import {
  deleteHistory,
  getHistory,
  insertHistory,
  listHistory,
  updateHistory,
  type QueryHistoryRow
} from '../../src/main/storage/history';
import { DEFAULT_WORKSPACE_ID, getLayout, setLayout } from '../../src/main/storage/layout';
import { getCached, invalidate, setCached } from '../../src/main/storage/schemaCache';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../../src/main/storage/migrations');

function openFreshDb(): Database {
  return openDatabase({ path: ':memory:', migrationsDir: MIGRATIONS_DIR });
}

function makeProfileFixture(id: string): ConnectionProfileRow {
  return insertProfile({
    id,
    name: `profile-${id}`,
    account_url: 'https://example.snowflakecomputing.com',
    auth_method: 'externalbrowser',
    username: 'analyst',
    default_role: 'ANALYST',
    default_warehouse: 'WH_XS',
    default_database: 'DB_ANALYTICS',
    default_schema: 'PUBLIC'
  });
}

afterAll(() => {
  closeDatabase();
});

describe('migrate', () => {
  afterEach(() => closeDatabase());

  test('applies 001_initial.sql on a fresh in-memory database', () => {
    const db = openFreshDb();
    const tableRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = new Set(tableRows.map((r) => r.name));
    expect(names.has('connection_profiles')).toBe(true);
    expect(names.has('worksheets')).toBe(true);
    expect(names.has('query_history')).toBe(true);
    expect(names.has('pane_layout')).toBe(true);
    expect(names.has('schema_cache')).toBe(true);
    expect(names.has('schema_migrations')).toBe(true);

    const indexRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all() as Array<{ name: string }>;
    const indexNames = new Set(indexRows.map((r) => r.name));
    expect(indexNames.has('idx_history_started')).toBe(true);
    expect(indexNames.has('idx_history_worksheet')).toBe(true);

    const applied = db.prepare('SELECT version FROM schema_migrations').all() as Array<{
      version: string;
    }>;
    expect(applied.map((r) => r.version)).toContain('001_initial');
  });

  test('running migrations a second time is a no-op (idempotent)', () => {
    const db = openFreshDb();
    runMigrations(db, { migrationsDir: MIGRATIONS_DIR });
    runMigrations(db, { migrationsDir: MIGRATIONS_DIR });
    const applied = db.prepare('SELECT version FROM schema_migrations').all() as Array<{
      version: string;
    }>;
    expect(applied.filter((r) => r.version === '001_initial')).toHaveLength(1);
  });

  test('foreign_keys pragma is ON after openDatabase', () => {
    const db = openFreshDb();
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });

  test('getDatabase throws before openDatabase, returns connection after', () => {
    expect(() => getDatabase()).toThrow(/not open/);
    const db = openFreshDb();
    expect(getDatabase()).toBe(db);
  });

  test('openDatabase rejects a second open without close', () => {
    openFreshDb();
    expect(() => openFreshDb()).toThrow(/already open/);
  });
});

describe('profiles', () => {
  beforeEach(() => {
    openFreshDb();
  });
  afterEach(() => closeDatabase());

  test('round-trips a profile through insert/get/list/update/delete', () => {
    expect(listProfiles()).toEqual([]);

    const inserted = makeProfileFixture('p1');
    expect(inserted.id).toBe('p1');
    expect(inserted.created_at).toBe(inserted.updated_at);

    const fetched = getProfile('p1');
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe('profile-p1');

    const list = listProfiles();
    expect(list).toHaveLength(1);
    expect(list[0]?.username).toBe('analyst');

    const updated = updateProfile('p1', { default_role: 'POWER_USER', name: 'renamed' });
    expect(updated.default_role).toBe('POWER_USER');
    expect(updated.name).toBe('renamed');
    expect(updated.updated_at).toBeGreaterThanOrEqual(inserted.updated_at);

    expect(deleteProfile('p1')).toBe(true);
    expect(getProfile('p1')).toBeNull();
    expect(deleteProfile('p1')).toBe(false);
  });

  test('updateProfile throws when the row is missing', () => {
    expect(() => updateProfile('nope', { name: 'x' })).toThrow(/no row/);
  });

  test('nullable defaults round-trip as null', () => {
    insertProfile({
      id: 'p2',
      name: 'minimal',
      account_url: 'https://example.snowflakecomputing.com',
      auth_method: 'password',
      username: 'svc'
    });
    const row = getProfile('p2');
    expect(row?.default_role).toBeNull();
    expect(row?.default_warehouse).toBeNull();
    expect(row?.default_database).toBeNull();
    expect(row?.default_schema).toBeNull();
  });
});

describe('worksheets', () => {
  beforeEach(() => {
    openFreshDb();
  });
  afterEach(() => closeDatabase());

  test('round-trip with parsed context payload', () => {
    const context = { role: 'ANALYST', warehouse: 'WH_XS', database: 'DB', schema: 'PUBLIC' };
    const row = insertWorksheet({
      id: 'w1',
      title: 'Untitled',
      body: 'SELECT 1;',
      cursor_line: 1,
      cursor_col: 9,
      last_session_context: context
    });
    expect(row.last_session_context_json).toBe(JSON.stringify(context));

    const fetched = getWorksheet('w1');
    expect(fetched).not.toBeNull();
    expect(fetched?.body).toBe('SELECT 1;');

    const updated = updateWorksheet('w1', { body: 'SELECT 2;', cursor_line: 2 });
    expect(updated.body).toBe('SELECT 2;');
    expect(updated.cursor_line).toBe(2);
    expect(updated.last_session_context_json).toBe(JSON.stringify(context));

    expect(listWorksheets()).toHaveLength(1);
    expect(deleteWorksheet('w1')).toBe(true);
    expect(getWorksheet('w1')).toBeNull();
  });

  test('explicit last_session_context_json overrides convenience field', () => {
    const row = insertWorksheet({
      id: 'w2',
      title: 'preset',
      body: '',
      last_session_context_json: '{"raw":true}',
      last_session_context: { ignored: true }
    });
    expect(row.last_session_context_json).toBe('{"raw":true}');
  });
});

describe('history', () => {
  beforeEach(() => {
    openFreshDb();
    makeProfileFixture('p1');
    makeProfileFixture('p2');
  });
  afterEach(() => closeDatabase());

  function makeHistory(id: string, overrides: Partial<QueryHistoryRow> = {}): QueryHistoryRow {
    return insertHistory({
      id,
      worksheet_id: null,
      profile_id: 'p1',
      role: 'ANALYST',
      warehouse: 'WH_XS',
      database_name: 'DB',
      schema_name: 'PUBLIC',
      sql: 'SELECT 1',
      started_at: Date.now(),
      status: 'running',
      ...overrides
    });
  }

  test('insert, get, update lifecycle', () => {
    const inserted = makeHistory('h1', { sql: 'SELECT user_id FROM users' });
    expect(inserted.status).toBe('running');
    expect(inserted.ended_at).toBeNull();

    const fetched = getHistory('h1');
    expect(fetched?.sql).toBe('SELECT user_id FROM users');

    const finalised = updateHistory('h1', {
      status: 'success',
      ended_at: inserted.started_at + 250,
      row_count: 42,
      bytes_scanned: 1024,
      query_id: 'sf-query-abc'
    });
    expect(finalised.status).toBe('success');
    expect(finalised.row_count).toBe(42);
    expect(finalised.query_id).toBe('sf-query-abc');
  });

  test('listHistory orders by started_at DESC and honors limit/profile/search', () => {
    const t0 = Date.now();
    makeHistory('h1', { profile_id: 'p1', started_at: t0 - 3000, sql: 'select alpha' });
    makeHistory('h2', { profile_id: 'p2', started_at: t0 - 2000, sql: 'select beta' });
    makeHistory('h3', { profile_id: 'p1', started_at: t0 - 1000, sql: 'INSERT into events' });

    const all = listHistory();
    expect(all.map((r) => r.id)).toEqual(['h3', 'h2', 'h1']);

    expect(listHistory({ limit: 2 }).map((r) => r.id)).toEqual(['h3', 'h2']);
    expect(listHistory({ profileId: 'p1' }).map((r) => r.id)).toEqual(['h3', 'h1']);

    const searchHits = listHistory({ search: 'beta' });
    expect(searchHits.map((r) => r.id)).toEqual(['h2']);

    const insertHits = listHistory({ search: 'INSERT' });
    expect(insertHits.map((r) => r.id)).toEqual(['h3']);
  });

  test('deleteHistory removes the row', () => {
    makeHistory('h-del');
    expect(deleteHistory('h-del')).toBe(true);
    expect(getHistory('h-del')).toBeNull();
    expect(deleteHistory('h-del')).toBe(false);
  });
});

describe('layout', () => {
  beforeEach(() => {
    openFreshDb();
  });
  afterEach(() => closeDatabase());

  test('getLayout returns null on a fresh database', () => {
    expect(getLayout()).toBeNull();
  });

  test('setLayout/getLayout round-trips a tree and supports overwrite', () => {
    const tree = {
      direction: 'horizontal',
      panes: [
        { id: 'a', worksheet_id: 'w1' },
        { id: 'b', worksheet_id: 'w2' }
      ]
    };
    setLayout(tree);
    expect(getLayout()).toEqual(tree);

    const replacement = { direction: 'vertical', panes: [] };
    setLayout(replacement);
    expect(getLayout()).toEqual(replacement);

    const row = getDatabase()
      .prepare('SELECT * FROM pane_layout WHERE workspace_id = ?')
      .get(DEFAULT_WORKSPACE_ID) as { workspace_id: string; tree_json: string };
    expect(row.workspace_id).toBe('default');
    expect(JSON.parse(row.tree_json)).toEqual(replacement);
  });
});

describe('schemaCache', () => {
  beforeEach(() => {
    openFreshDb();
  });
  afterEach(() => closeDatabase());

  test('roundtrips payload and overwrites on second setCached', () => {
    setCached('p1', 'DB_ANALYTICS', 'PUBLIC', 'table', { tables: ['users'] });
    expect(getCached('p1', 'DB_ANALYTICS', 'PUBLIC', 'table')).toEqual({ tables: ['users'] });

    setCached('p1', 'DB_ANALYTICS', 'PUBLIC', 'table', { tables: ['users', 'orders'] });
    expect(getCached('p1', 'DB_ANALYTICS', 'PUBLIC', 'table')).toEqual({
      tables: ['users', 'orders']
    });

    const rows = getDatabase()
      .prepare(
        'SELECT * FROM schema_cache WHERE profile_id = ? AND database_name = ? AND schema_name = ? AND object_type = ?'
      )
      .all('p1', 'DB_ANALYTICS', 'PUBLIC', 'table') as Array<{ payload_json: string }>;
    expect(rows).toHaveLength(1);
  });

  test('NULL schema_name upsert deduplicates via DELETE-then-INSERT', () => {
    setCached('p1', 'DB_ANALYTICS', null, 'schema', { schemas: ['PUBLIC'] });
    setCached('p1', 'DB_ANALYTICS', null, 'schema', { schemas: ['PUBLIC', 'STAGING'] });

    const got = getCached('p1', 'DB_ANALYTICS', null, 'schema');
    expect(got).toEqual({ schemas: ['PUBLIC', 'STAGING'] });

    const remaining = getDatabase()
      .prepare(
        'SELECT * FROM schema_cache WHERE profile_id = ? AND database_name = ? AND schema_name IS NULL AND object_type = ?'
      )
      .all('p1', 'DB_ANALYTICS', 'schema') as unknown[];
    expect(remaining).toHaveLength(1);
  });

  test('getCached returns null when no row matches', () => {
    expect(getCached('p1', 'DB_NOPE', null, 'schema')).toBeNull();
  });

  test('invalidate scopes to profile, profile+db, profile+db+schema', () => {
    setCached('p1', 'DB1', 'S1', 'table', {});
    setCached('p1', 'DB1', 'S2', 'table', {});
    setCached('p1', 'DB2', 'S1', 'table', {});
    setCached('p2', 'DB1', 'S1', 'table', {});

    expect(invalidate('p1', 'DB1', 'S1')).toBe(1);
    expect(getCached('p1', 'DB1', 'S1', 'table')).toBeNull();
    expect(getCached('p1', 'DB1', 'S2', 'table')).not.toBeNull();

    expect(invalidate('p1', 'DB1')).toBe(1);
    expect(getCached('p1', 'DB1', 'S2', 'table')).toBeNull();
    expect(getCached('p1', 'DB2', 'S1', 'table')).not.toBeNull();

    expect(invalidate('p1')).toBe(1);
    expect(getCached('p1', 'DB2', 'S1', 'table')).toBeNull();
    expect(getCached('p2', 'DB1', 'S1', 'table')).not.toBeNull();
  });
});
