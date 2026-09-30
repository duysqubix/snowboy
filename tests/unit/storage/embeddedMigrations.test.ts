/**
 * The packaged app runs only the migrations registered in
 * `embedded-migrations.ts` (imported with Vite's `?raw`, which Bun can't
 * load), while unit tests read `migrations/` from disk. A file added to the
 * directory but not to the map passes every other test and never runs in
 * the app, so this checks the registration as text.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = resolve(HERE, '../../../src/main/storage');
const MIGRATIONS_DIR = resolve(STORAGE_DIR, 'migrations');

/** What's wrong with how `source` registers `files`; empty when nothing is. */
function registrationProblems(source: string, files: string[]): string[] {
  const bindings = new Map<string, string>();
  for (const m of source.matchAll(/^import (\w+) from '\.\/migrations\/([\w.-]+\.sql)\?raw';$/gm)) {
    bindings.set(m[2]!, m[1]!);
  }
  const problems: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const binding = bindings.get(file);
    if (binding === undefined) {
      problems.push(`${file}: not imported`);
    } else if (!new RegExp(`^\\s*'${version}': ${binding},?$`, 'm').test(source)) {
      problems.push(`${file}: '${version}' is not mapped to ${binding}`);
    }
  }
  return problems;
}

describe('EMBEDDED_MIGRATIONS', () => {
  test('registers every migration file under its version key', () => {
    const source = readFileSync(resolve(STORAGE_DIR, 'embedded-migrations.ts'), 'utf8');
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    expect(registrationProblems(source, files)).toEqual([]);
  });

  test('the check catches a missing import, a commented-out entry, and a wrong binding', () => {
    const files = ['001_a.sql', '002_b.sql'];
    const good =
      "import a from './migrations/001_a.sql?raw';\n" +
      "import b from './migrations/002_b.sql?raw';\n\n" +
      "export const EMBEDDED_MIGRATIONS = {\n  '001_a': a,\n  '002_b': b\n};\n";
    expect(registrationProblems(good, files)).toEqual([]);

    expect(registrationProblems(good, [...files, '003_c.sql'])).toEqual([
      '003_c.sql: not imported'
    ]);
    expect(registrationProblems(good.replace("  '002_b': b", "  // '002_b': b"), files)).toEqual([
      "002_b.sql: '002_b' is not mapped to b"
    ]);
    expect(registrationProblems(good.replace("'002_b': b", "'002_b': a"), files)).toEqual([
      "002_b.sql: '002_b' is not mapped to b"
    ]);
  });
});
