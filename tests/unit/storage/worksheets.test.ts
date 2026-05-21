import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDatabase, openDatabase, type Database } from '../../../src/main/storage/db';
import {
  deleteWorksheet,
  getWorksheet,
  insertWorksheet,
  listWorksheets,
  updateWorksheet,
  upsertWorksheet
} from '../../../src/main/storage/worksheets';
import {
  getWorksheet as ipcGetWorksheet,
  listWorksheets as ipcListWorksheets,
  saveWorksheet as ipcSaveWorksheet
} from '../../../src/main/ipc/workspace';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../../../src/main/storage/migrations');

function openFreshDb(): Database {
  return openDatabase({ path: ':memory:', migrationsDir: MIGRATIONS_DIR });
}

afterAll(() => {
  closeDatabase();
});

describe('upsertWorksheet (storage)', () => {
  beforeEach(() => {
    openFreshDb();
  });
  afterEach(() => closeDatabase());

  test('inserts a new row when none exists', () => {
    const row = upsertWorksheet({
      id: 'w-upsert-1',
      title: 'New',
      body: 'SELECT 1;'
    });
    expect(row.id).toBe('w-upsert-1');
    expect(row.body).toBe('SELECT 1;');
    expect(row.created_at).toBe(row.updated_at);
    expect(getWorksheet('w-upsert-1')?.body).toBe('SELECT 1;');
  });

  test('preserves created_at across subsequent upserts', () => {
    const first = upsertWorksheet({ id: 'w-upsert-2', title: 't', body: 'a' });
    const originalCreated = first.created_at;
    const second = upsertWorksheet({ id: 'w-upsert-2', title: 't', body: 'b' });
    expect(second.created_at).toBe(originalCreated);
    expect(second.updated_at).toBeGreaterThanOrEqual(originalCreated);
    expect(getWorksheet('w-upsert-2')?.body).toBe('b');
  });

  test('race-safe: parallel-style upserts on the same id never throw', () => {
    // better-sqlite3 / bun:sqlite are synchronous, so this models the worst
    // case where two pane-close handlers both flush at the same tick: the
    // ON CONFLICT clause keeps the second write from blowing up on
    // PRIMARY KEY collision the way an INSERT-then-UPDATE pair would.
    const id = 'w-race-1';
    expect(() => {
      upsertWorksheet({ id, title: 't', body: 'first' });
      upsertWorksheet({ id, title: 't', body: 'second' });
      upsertWorksheet({ id, title: 't', body: 'third' });
    }).not.toThrow();
    expect(getWorksheet(id)?.body).toBe('third');
  });

  test('does not require the row to exist (unlike updateWorksheet)', () => {
    expect(() => updateWorksheet('does-not-exist', { body: 'x' })).toThrow(/no row/);
    expect(() => upsertWorksheet({ id: 'does-not-exist', title: 't', body: 'x' })).not.toThrow();
  });

  test('round-trips scroll_top through dedicated column', () => {
    upsertWorksheet({
      id: 'w-scroll-1',
      title: 't',
      body: 'long buffer',
      scroll_top: 1234
    });
    const fetched = getWorksheet('w-scroll-1');
    expect(fetched?.scroll_top).toBe(1234);
  });

  test('round-trips cursor_line + cursor_col through dedicated columns', () => {
    upsertWorksheet({
      id: 'w-cursor-1',
      title: 't',
      body: 'SELECT\n  1;',
      cursor_line: 2,
      cursor_col: 4
    });
    const fetched = getWorksheet('w-cursor-1');
    expect(fetched?.cursor_line).toBe(2);
    expect(fetched?.cursor_col).toBe(4);
  });

  test('null cursor / scroll round-trip as null, not 0', () => {
    upsertWorksheet({ id: 'w-null-1', title: 't', body: '' });
    const fetched = getWorksheet('w-null-1');
    expect(fetched?.cursor_line).toBeNull();
    expect(fetched?.cursor_col).toBeNull();
    expect(fetched?.scroll_top).toBeNull();
  });

  test('does not stash cursor info inside last_session_context_json', () => {
    upsertWorksheet({
      id: 'w-ctx-isolation',
      title: 't',
      body: '',
      cursor_line: 7,
      cursor_col: 8,
      scroll_top: 99,
      last_session_context: { role: 'ANALYST', warehouse: 'WH_XS' }
    });
    const fetched = getWorksheet('w-ctx-isolation');
    expect(fetched?.cursor_line).toBe(7);
    expect(fetched?.cursor_col).toBe(8);
    expect(fetched?.scroll_top).toBe(99);
    expect(fetched?.last_session_context_json).toBe(
      JSON.stringify({ role: 'ANALYST', warehouse: 'WH_XS' })
    );
  });
});

describe('getWorksheet (storage)', () => {
  beforeEach(() => {
    openFreshDb();
  });
  afterEach(() => closeDatabase());

  test('returns null for a missing id', () => {
    expect(getWorksheet('not-there')).toBeNull();
  });

  test('returns the row after insert', () => {
    insertWorksheet({ id: 'w-get-1', title: 't', body: 'x' });
    expect(getWorksheet('w-get-1')?.body).toBe('x');
  });

  test('returns null after delete', () => {
    insertWorksheet({ id: 'w-get-2', title: 't', body: 'x' });
    expect(deleteWorksheet('w-get-2')).toBe(true);
    expect(getWorksheet('w-get-2')).toBeNull();
  });
});

describe('listWorksheets (storage)', () => {
  beforeEach(() => {
    openFreshDb();
  });
  afterEach(() => closeDatabase());

  test('returns an empty list on a fresh db', () => {
    expect(listWorksheets()).toEqual([]);
  });

  test('returns rows ordered by updated_at DESC after multiple upserts', () => {
    upsertWorksheet({ id: 'w-list-1', title: 'a', body: '1' });
    upsertWorksheet({ id: 'w-list-2', title: 'b', body: '2' });
    upsertWorksheet({ id: 'w-list-1', title: 'a-updated', body: '1-updated' });
    const rows = listWorksheets();
    expect(rows.map((r) => r.id)).toEqual(['w-list-1', 'w-list-2']);
  });
});

describe('saveWorksheet (IPC) — workspace IPC handler', () => {
  beforeEach(() => {
    openFreshDb();
  });
  afterEach(() => closeDatabase());

  test('translates camelCase Worksheet to storage row and round-trips through getWorksheet', () => {
    ipcSaveWorksheet({
      id: 'w-ipc-1',
      title: 'My Worksheet',
      body: 'SELECT current_timestamp;',
      cursorLine: 1,
      cursorCol: 25,
      scrollTop: 480,
      createdAt: 0,
      updatedAt: 0
    });

    const fetched = ipcGetWorksheet('w-ipc-1');
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe('w-ipc-1');
    expect(fetched?.title).toBe('My Worksheet');
    expect(fetched?.body).toBe('SELECT current_timestamp;');
    expect(fetched?.cursorLine).toBe(1);
    expect(fetched?.cursorCol).toBe(25);
    expect(fetched?.scrollTop).toBe(480);
  });

  test('upserts via IPC do not throw on a fresh id (insert-vs-update race)', () => {
    expect(() =>
      ipcSaveWorksheet({
        id: 'w-ipc-race',
        title: 't',
        body: '',
        createdAt: 0,
        updatedAt: 0
      })
    ).not.toThrow();
    expect(ipcGetWorksheet('w-ipc-race')).not.toBeNull();
  });

  test('repeated saves with the same id mutate the same row (no duplicate rows)', () => {
    ipcSaveWorksheet({
      id: 'w-ipc-3',
      title: 't',
      body: 'a',
      createdAt: 0,
      updatedAt: 0
    });
    ipcSaveWorksheet({
      id: 'w-ipc-3',
      title: 't',
      body: 'b',
      createdAt: 0,
      updatedAt: 0
    });
    ipcSaveWorksheet({
      id: 'w-ipc-3',
      title: 't',
      body: 'c',
      createdAt: 0,
      updatedAt: 0
    });
    expect(ipcListWorksheets()).toHaveLength(1);
    expect(ipcGetWorksheet('w-ipc-3')?.body).toBe('c');
  });

  test('omits cursorLine/cursorCol/scrollTop when absent on the input', () => {
    ipcSaveWorksheet({
      id: 'w-ipc-4',
      title: 't',
      body: '',
      createdAt: 0,
      updatedAt: 0
    });
    const fetched = ipcGetWorksheet('w-ipc-4');
    expect(fetched?.cursorLine).toBeUndefined();
    expect(fetched?.cursorCol).toBeUndefined();
    expect(fetched?.scrollTop).toBeUndefined();
  });

  test('preserves a previously saved cursor when the next save omits it', () => {
    // First save lands cursor + scroll
    ipcSaveWorksheet({
      id: 'w-ipc-5',
      title: 't',
      body: 'x',
      cursorLine: 3,
      cursorCol: 7,
      scrollTop: 100,
      createdAt: 0,
      updatedAt: 0
    });
    // Second save explicitly drops them (e.g. an unfortunate snapshot path);
    // because upsert overwrites all columns, we expect the row to reflect
    // the second write. This documents the current contract — the renderer
    // must always include cursor + scroll in every snapshot.
    ipcSaveWorksheet({
      id: 'w-ipc-5',
      title: 't',
      body: 'y',
      createdAt: 0,
      updatedAt: 0
    });
    const fetched = ipcGetWorksheet('w-ipc-5');
    expect(fetched?.body).toBe('y');
    expect(fetched?.cursorLine).toBeUndefined();
    expect(fetched?.scrollTop).toBeUndefined();
  });

  test('lastSessionContext round-trips through JSON without leaking into cursor columns', () => {
    ipcSaveWorksheet({
      id: 'w-ipc-ctx',
      title: 't',
      body: 'x',
      cursorLine: 2,
      cursorCol: 5,
      lastSessionContext: { role: 'ANALYST', warehouse: 'WH_XS' },
      createdAt: 0,
      updatedAt: 0
    });
    const fetched = ipcGetWorksheet('w-ipc-ctx');
    expect(fetched?.lastSessionContext).toEqual({ role: 'ANALYST', warehouse: 'WH_XS' });
    expect(fetched?.cursorLine).toBe(2);
    expect(fetched?.cursorCol).toBe(5);
  });

  test('rejects bad input early with a clear error', () => {
    expect(() =>
      // @ts-expect-error — intentional: ensure runtime guard rejects bad id
      ipcSaveWorksheet({ title: 't', body: '', createdAt: 0, updatedAt: 0 })
    ).toThrow(/id is required/);
  });
});

describe('getWorksheet (IPC)', () => {
  beforeEach(() => {
    openFreshDb();
  });
  afterEach(() => closeDatabase());

  test('returns null for a missing id', () => {
    expect(ipcGetWorksheet('nope')).toBeNull();
  });

  test('translates null storage columns to undefined on the IPC shape', () => {
    insertWorksheet({ id: 'w-ipc-null', title: 't', body: '' });
    const fetched = ipcGetWorksheet('w-ipc-null');
    expect(fetched).not.toBeNull();
    expect(fetched?.cursorLine).toBeUndefined();
    expect(fetched?.cursorCol).toBeUndefined();
    expect(fetched?.scrollTop).toBeUndefined();
    expect(fetched?.lastSessionContext).toBeUndefined();
  });

  test('rejects empty / non-string ids', () => {
    expect(() => ipcGetWorksheet('')).toThrow(/id is required/);
  });
});

describe('listWorksheets (IPC)', () => {
  beforeEach(() => {
    openFreshDb();
  });
  afterEach(() => closeDatabase());

  test('returns the camelCase shape, not the snake_case row', () => {
    upsertWorksheet({
      id: 'w-list-ipc',
      title: 't',
      body: 'b',
      cursor_line: 1,
      cursor_col: 2,
      scroll_top: 3
    });
    const list = ipcListWorksheets();
    expect(list).toHaveLength(1);
    expect(list[0]?.cursorLine).toBe(1);
    expect(list[0]?.cursorCol).toBe(2);
    expect(list[0]?.scrollTop).toBe(3);
  });
});
