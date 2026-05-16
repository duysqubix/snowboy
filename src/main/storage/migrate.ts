/**
 * Forward-only schema migration runner.
 *
 * Discovers SQL files under `migrations/` lexicographically, applies any
 * that haven't been recorded in `schema_migrations` yet, and records the
 * applied version. Each migration runs inside a single transaction —
 * either every statement lands or none of them do.
 *
 * Idempotency: re-running this on an already-up-to-date database is a
 * no-op. `schema_migrations` is the source of truth; the `.sql` filename
 * (minus extension) is the version key.
 *
 * Migration files MUST be additive and ordered. Never edit a shipped
 * migration; add a new one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type BetterSqlite3 from 'better-sqlite3';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = join(HERE, 'migrations');

export interface RunMigrationsOptions {
  /**
   * Absolute path to the directory containing `.sql` migration files.
   * Defaults to the sibling `migrations/` directory of this module — which
   * resolves correctly both for the source tree (`src/main/storage/migrations/`)
   * and for the built output once a build step copies the SQL files
   * alongside the bundled main module.
   */
  migrationsDir?: string;
  /**
   * Pre-loaded `version → SQL` map. Bypasses the `migrationsDir` disk scan
   * entirely. Used by the production main bundle (which loads SQL via
   * Vite's `?raw` import so the bundled `out/main/index.js` carries the
   * DDL inline, with no sibling `migrations/` directory required).
   * When provided, `migrationsDir` is ignored.
   */
  migrations?: Record<string, string>;
}

interface MigrationRow {
  version: string;
}

export function runMigrations(
  db: BetterSqlite3.Database,
  opts: RunMigrationsOptions = {}
): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (' +
      'version TEXT PRIMARY KEY, ' +
      'applied_at INTEGER NOT NULL' +
      ')'
  );

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as MigrationRow[];
  const applied = new Set(appliedRows.map((r) => r.version));

  const recordStmt = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)'
  );

  const pending = opts.migrations
    ? Object.entries(opts.migrations).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    : loadFromDisk(opts.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);

  for (const [version, sql] of pending) {
    if (applied.has(version)) {
      continue;
    }
    const tx = db.transaction(() => {
      db.exec(sql);
      recordStmt.run(version, Date.now());
    });
    tx();
  }
}

function loadFromDisk(dir: string): Array<[string, string]> {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((file) => [file.replace(/\.sql$/, ''), readFileSync(join(dir, file), 'utf8')]);
}
