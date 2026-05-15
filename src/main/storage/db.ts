/**
 * better-sqlite3 lifecycle for snowboy's main process.
 *
 * Single process-wide connection. better-sqlite3 is synchronous and one
 * connection serialises writes correctly; opening N connections per call
 * would just contend on the same SQLite file with no upside.
 *
 * Migrations run exactly once, on `openDatabase`. Subsequent calls
 * without an intervening `closeDatabase` throw — that's a programming
 * error, not a recoverable condition.
 *
 * Runtime-selected SQLite driver:
 *   - Electron (production): `better-sqlite3`, rebuilt against Electron's
 *     bundled Node ABI by `scripts/rebuild-natives.ts`.
 *   - Bun (test runtime): `better-sqlite3` is explicitly blocked at the
 *     N-API loader level by Bun (see oven-sh/bun#4290). We fall back to
 *     the built-in `bun:sqlite`, which exposes a structurally compatible
 *     subset of the better-sqlite3 API for `prepare`, `exec`,
 *     `transaction`, and `close`. Storage code restricts itself to that
 *     subset and uses positional `?` placeholders so the same source
 *     compiles and runs in both contexts. `db.exec("PRAGMA …")` is the
 *     uniform way to set pragmas — we deliberately avoid the
 *     better-sqlite3-specific `.pragma()` helper.
 *
 * Tests pass `{ path: ':memory:' }` to get a fresh in-process database.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from './migrate';

const localRequire = createRequire(import.meta.url);

/**
 * The structural SQLite handle. Annotated against better-sqlite3 for
 * editor support; at runtime in tests it may be a `bun:sqlite` instance
 * which exposes the same call surface.
 */
export type Database = BetterSqlite3.Database;

export interface OpenDatabaseOptions {
  /** Override the on-disk database path. Pass `':memory:'` for tests. */
  path?: string;
  /** Override the migrations directory (mainly for build/testing flexibility). */
  migrationsDir?: string;
}

type DatabaseConstructor = new (filename: string) => Database;

let currentDb: Database | null = null;

export function openDatabase(opts: OpenDatabaseOptions = {}): Database {
  if (currentDb !== null) {
    throw new Error('Database is already open. Call closeDatabase() first.');
  }
  const dbPath = opts.path ?? defaultDatabasePath();
  const Ctor = loadDatabaseConstructor();
  const db = new Ctor(dbPath);

  // Apply pragmas via exec() so both better-sqlite3 and bun:sqlite accept
  // the same call. WAL is a no-op on in-memory databases but the call
  // itself is harmless.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');

  runMigrations(db, { migrationsDir: opts.migrationsDir });

  currentDb = db;
  return db;
}

export function closeDatabase(): void {
  if (currentDb !== null) {
    currentDb.close();
    currentDb = null;
  }
}

export function getDatabase(): Database {
  if (currentDb === null) {
    throw new Error('Database is not open. Call openDatabase() first.');
  }
  return currentDb;
}

function loadDatabaseConstructor(): DatabaseConstructor {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined') {
    // `bun:sqlite` is built into the Bun runtime; the string-keyed require
    // here is deliberately untyped because we don't take a dependency on
    // bun's ambient types from the main-process tsconfig.
    const mod = localRequire('bun:sqlite') as { Database: DatabaseConstructor };
    return mod.Database;
  }
  return localRequire('better-sqlite3') as DatabaseConstructor;
}

function defaultDatabasePath(): string {
  // Lazy require so non-Electron contexts (tests injecting `path`) never
  // touch the Electron API surface.
  type ElectronApi = typeof import('electron');
  const electronModule = localRequire('electron') as ElectronApi;
  return join(electronModule.app.getPath('userData'), 'snowboy.db');
}
