import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { get, list } from '../../../src/main/ipc/history';
import { closeDatabase, openDatabase } from '../../../src/main/storage/db';
import {
  insertHistory,
  type NewQueryHistory,
  type QueryStatus
} from '../../../src/main/storage/history';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../../../src/main/storage/migrations');

function rowFixture(overrides: Partial<NewQueryHistory> = {}): NewQueryHistory {
  return {
    id: 'q-1',
    worksheet_id: null,
    profile_id: 'prof-1',
    role: 'ANALYST',
    warehouse: 'WH_XS',
    database_name: 'DB',
    schema_name: 'PUBLIC',
    sql: 'SELECT 1',
    started_at: 1000,
    ended_at: 1500,
    status: 'success' as QueryStatus,
    row_count: 7,
    bytes_scanned: 1024,
    query_id: 'snowflake-uuid-1',
    error_message: null,
    ...overrides
  };
}

beforeEach(() => {
  openDatabase({ path: ':memory:', migrationsDir: MIGRATIONS_DIR });
});

afterEach(() => {
  closeDatabase();
});

describe('history.list', () => {
  test('returns [] on a fresh database', () => {
    expect(list()).toEqual([]);
  });

  test('returns rows in started_at DESC order with snake -> camel translation', () => {
    insertHistory(rowFixture({ id: 'q-old', started_at: 100, sql: 'OLD' }));
    insertHistory(rowFixture({ id: 'q-new', started_at: 500, sql: 'NEW' }));

    const entries = list();
    expect(entries.map((e) => e.id)).toEqual(['q-new', 'q-old']);
    const first = entries[0]!;
    expect(first.sql).toBe('NEW');
    expect(first.profileId).toBe('prof-1');
    expect(first.role).toBe('ANALYST');
    expect(first.warehouse).toBe('WH_XS');
    expect(first.databaseName).toBe('DB');
    expect(first.schemaName).toBe('PUBLIC');
    expect(first.queryId).toBe('snowflake-uuid-1');
    expect(first.rowCount).toBe(7);
    expect(first.bytesScanned).toBe(1024);
  });

  test('excludes rows with status="running" from the IPC surface', () => {
    insertHistory(rowFixture({ id: 'q-done', status: 'success' as QueryStatus }));
    insertHistory(rowFixture({ id: 'q-live', status: 'running' as QueryStatus }));

    const entries = list();
    expect(entries.map((e) => e.id)).toEqual(['q-done']);
  });

  test('omits null snake_case fields entirely on the camel side', () => {
    insertHistory(
      rowFixture({
        id: 'q-bare',
        worksheet_id: null,
        role: null,
        warehouse: null,
        database_name: null,
        schema_name: null,
        ended_at: null,
        row_count: null,
        bytes_scanned: null,
        query_id: null,
        error_message: null
      })
    );

    const [entry] = list();
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('q-bare');
    expect(entry!.worksheetId).toBeUndefined();
    expect(entry!.role).toBeUndefined();
    expect(entry!.warehouse).toBeUndefined();
    expect(entry!.databaseName).toBeUndefined();
    expect(entry!.schemaName).toBeUndefined();
    expect(entry!.endedAt).toBeUndefined();
    expect(entry!.rowCount).toBeUndefined();
    expect(entry!.bytesScanned).toBeUndefined();
    expect(entry!.queryId).toBeUndefined();
    expect(entry!.errorMessage).toBeUndefined();
  });

  test('filters by profileId', () => {
    insertHistory(rowFixture({ id: 'q-a', profile_id: 'A' }));
    insertHistory(rowFixture({ id: 'q-b', profile_id: 'B' }));

    const entries = list({ profileId: 'A' });
    expect(entries.map((e) => e.id)).toEqual(['q-a']);
  });

  test('filters by status', () => {
    insertHistory(rowFixture({ id: 'q-ok', status: 'success' as QueryStatus }));
    insertHistory(rowFixture({ id: 'q-bad', status: 'error' as QueryStatus, error_message: 'boom' }));
    insertHistory(rowFixture({ id: 'q-cancel', status: 'cancelled' as QueryStatus }));

    expect(list({ status: 'error' }).map((e) => e.id)).toEqual(['q-bad']);
    expect(list({ status: 'cancelled' }).map((e) => e.id)).toEqual(['q-cancel']);
  });

  test('filters by since / until window', () => {
    insertHistory(rowFixture({ id: 'q-early', started_at: 100 }));
    insertHistory(rowFixture({ id: 'q-mid', started_at: 500 }));
    insertHistory(rowFixture({ id: 'q-late', started_at: 1000 }));

    const within = list({ since: 200, until: 800 });
    expect(within.map((e) => e.id)).toEqual(['q-mid']);
  });

  test('filters by worksheetId', () => {
    insertHistory(rowFixture({ id: 'q-1', worksheet_id: 'ws-A' }));
    insertHistory(rowFixture({ id: 'q-2', worksheet_id: 'ws-B' }));
    insertHistory(rowFixture({ id: 'q-3', worksheet_id: null }));

    const entries = list({ worksheetId: 'ws-A' });
    expect(entries.map((e) => e.id)).toEqual(['q-1']);
  });

  test('applies offset after filtering', () => {
    insertHistory(rowFixture({ id: 'q-a', started_at: 100 }));
    insertHistory(rowFixture({ id: 'q-b', started_at: 200 }));
    insertHistory(rowFixture({ id: 'q-c', started_at: 300 }));

    const entries = list({ offset: 1 });
    expect(entries.map((e) => e.id)).toEqual(['q-b', 'q-a']);
  });

  test('applies limit', () => {
    for (let i = 0; i < 10; i++) {
      insertHistory(rowFixture({ id: `q-${i}`, started_at: i }));
    }
    const entries = list({ limit: 3 });
    expect(entries.length).toBe(3);
  });
});

describe('history.get', () => {
  test('returns the matching entry', () => {
    insertHistory(rowFixture({ id: 'q-target' }));
    const entry = get('q-target');
    expect(entry.id).toBe('q-target');
    expect(entry.sql).toBe('SELECT 1');
  });

  test('throws when the id is missing', () => {
    expect(() => get('does-not-exist')).toThrow(/no entry/);
  });

  test('throws when the id is empty', () => {
    expect(() => get('')).toThrow(/id is required/);
  });

  test('throws when the row is still running', () => {
    insertHistory(rowFixture({ id: 'q-live', status: 'running' as QueryStatus }));
    expect(() => get('q-live')).toThrow(/still running/);
  });
});
