import { describe, expect, test } from 'bun:test';
import {
  previewStatement,
  splitSql,
  splitSqlSegments,
  statementAtOffset
} from '../../../src/renderer/lib/editor/splitSql';

describe('splitSql', () => {
  test('empty input -> []', () => {
    expect(splitSql('')).toEqual([]);
    expect(splitSql('   ')).toEqual([]);
    expect(splitSql(';;;')).toEqual([]);
  });

  test('single statement, no trailing ;', () => {
    expect(splitSql('SELECT 1')).toEqual(['SELECT 1']);
  });

  test('single statement, with trailing ;', () => {
    expect(splitSql('SELECT 1;')).toEqual(['SELECT 1']);
  });

  test('two simple statements split on ;', () => {
    expect(splitSql('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  test('multi-line statements with blank lines between', () => {
    expect(splitSql('select 123 as n;\n\nselect 456 as t;')).toEqual([
      'select 123 as n',
      'select 456 as t'
    ]);
  });

  test('semicolon inside single-quoted string is NOT a terminator', () => {
    expect(splitSql("SELECT 'a;b;c' AS x;")).toEqual(["SELECT 'a;b;c' AS x"]);
  });

  test("doubled single-quote ('') is an in-string escape, not a string close", () => {
    expect(splitSql("SELECT 'a''b;c' AS x; SELECT 1;")).toEqual([
      "SELECT 'a''b;c' AS x",
      'SELECT 1'
    ]);
  });

  test('semicolon inside double-quoted identifier is NOT a terminator', () => {
    expect(splitSql('SELECT "weird;col" FROM t;')).toEqual(['SELECT "weird;col" FROM t']);
  });

  test('semicolon inside line comment is NOT a terminator', () => {
    expect(splitSql('SELECT 1 -- this; is; a; comment\n; SELECT 2;')).toEqual([
      'SELECT 1 -- this; is; a; comment',
      'SELECT 2'
    ]);
  });

  test('semicolon inside block comment is NOT a terminator', () => {
    expect(splitSql('SELECT 1 /* a;b;c */; SELECT 2;')).toEqual([
      'SELECT 1 /* a;b;c */',
      'SELECT 2'
    ]);
  });

  test('semicolon inside $$-quoted block is NOT a terminator', () => {
    expect(splitSql('SELECT $$one; two; three$$ AS x; SELECT 1;')).toEqual([
      'SELECT $$one; two; three$$ AS x',
      'SELECT 1'
    ]);
  });

  test('semicolon inside $tag$-quoted block is NOT a terminator', () => {
    expect(splitSql('SELECT $foo$one; two$foo$ AS x; SELECT 1;')).toEqual([
      'SELECT $foo$one; two$foo$ AS x',
      'SELECT 1'
    ]);
  });

  test('bare $ (not opening a dollar-quote) is preserved literally', () => {
    expect(splitSql('SELECT $1 + $2; SELECT 1;')).toEqual([
      'SELECT $1 + $2',
      'SELECT 1'
    ]);
  });

  test('comment-only statement is dropped', () => {
    // A `;` inside a line comment is part of the comment, so `--foo;\nSELECT`
    // becomes ONE statement that opens with a comment line. The terminator
    // is the explicit `;` after SELECT.
    expect(splitSql('-- comment only\n; SELECT 1;')).toEqual(['SELECT 1']);
    expect(splitSql('/* block only */;')).toEqual([]);
  });

  test('common multi-statement DDL + SELECT', () => {
    const sql = `USE WAREHOUSE compute_wh;
USE DATABASE my_db;
SELECT current_role() AS role,
       current_warehouse() AS wh;`;
    expect(splitSql(sql)).toEqual([
      'USE WAREHOUSE compute_wh',
      'USE DATABASE my_db',
      'SELECT current_role() AS role,\n       current_warehouse() AS wh'
    ]);
  });

  test('unterminated string consumes rest of input gracefully', () => {
    expect(splitSql("SELECT 'unterminated; SELECT 1;")).toEqual([
      "SELECT 'unterminated; SELECT 1;"
    ]);
  });
});

describe('previewStatement', () => {
  test('collapses whitespace and truncates with ellipsis', () => {
    expect(previewStatement('select  1\n  as\tn', 40)).toBe('select 1 as n');
    const long = 'SELECT col1, col2, col3, col4, col5 FROM very_long_table_name';
    expect(previewStatement(long, 30)).toBe('SELECT col1, col2, col3, col4…');
  });
});

describe('splitSqlSegments', () => {
  test('empty input -> []', () => {
    expect(splitSqlSegments('')).toEqual([]);
  });

  test('single statement spans through trailing ;', () => {
    const segs = splitSqlSegments('SELECT 1;');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ start: 0, end: 9, text: 'SELECT 1;', kind: 'stmt' });
  });

  test('two statements split with ws segment between', () => {
    const segs = splitSqlSegments('SELECT 1; SELECT 2;');
    expect(segs.map((s) => s.kind)).toEqual(['stmt', 'ws', 'stmt']);
    expect(segs[0]!.text).toBe('SELECT 1;');
    expect(segs[1]!.text).toBe(' ');
    expect(segs[2]!.text).toBe('SELECT 2;');
  });

  test('leading line comment is its own comment segment', () => {
    const segs = splitSqlSegments('-- header\nSELECT 1;');
    expect(segs.map((s) => s.kind)).toEqual(['comment', 'ws', 'stmt']);
    expect(segs[0]!.text).toBe('-- header');
    expect(segs[2]!.text).toBe('SELECT 1;');
  });

  test('inline comment inside a statement stays part of the stmt segment', () => {
    const segs = splitSqlSegments('SELECT 1 -- inline\n  AS x;');
    expect(segs.map((s) => s.kind)).toEqual(['stmt']);
    expect(segs[0]!.text).toBe('SELECT 1 -- inline\n  AS x;');
  });

  test('unterminated statement at EOF still emits a stmt segment', () => {
    const segs = splitSqlSegments('SELECT 1');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe('stmt');
    expect(segs[0]!.text).toBe('SELECT 1');
  });
});

describe('statementAtOffset', () => {
  test('cursor in middle of statement returns that statement', () => {
    const sql = 'SELECT 1; SELECT 2; SELECT 3;';
    const seg = statementAtOffset(sql, 13);
    expect(seg).not.toBeNull();
    expect(seg!.text).toBe('SELECT 2;');
  });

  test('cursor in whitespace between statements returns the NEXT statement (Snowsight parity)', () => {
    const sql = 'SELECT 1;   SELECT 2;';
    const seg = statementAtOffset(sql, 10);
    expect(seg).not.toBeNull();
    expect(seg!.text).toBe('SELECT 2;');
  });

  test('cursor in -- line comment returns null', () => {
    const sql = '-- DELETE FROM prod_data;\nSELECT 1;';
    const seg = statementAtOffset(sql, 5);
    expect(seg).toBeNull();
  });

  test('cursor in /* block */ comment returns null', () => {
    const sql = '/* DROP TABLE prod; */\nSELECT 1;';
    const seg = statementAtOffset(sql, 10);
    expect(seg).toBeNull();
  });

  test('cursor at EOF returns null (no statement)', () => {
    const sql = '';
    expect(statementAtOffset(sql, 0)).toBeNull();
  });

  test('cursor at offset > length returns null', () => {
    const sql = 'SELECT 1;';
    expect(statementAtOffset(sql, 999)).toBeNull();
  });

  test('cursor just AFTER last statement\u2019s ; returns null (does not return previous)', () => {
    const sql = 'SELECT 1; SELECT 2;';
    expect(sql.length).toBe(19);
    expect(statementAtOffset(sql, 19)).toBeNull();
  });

  test('cursor inside trailing whitespace after last stmt returns null (no next)', () => {
    const sql = 'SELECT 1;   ';
    expect(statementAtOffset(sql, 10)).toBeNull();
  });

  test('cursor at start of statement returns that statement', () => {
    const sql = 'SELECT 1; SELECT 2;';
    const seg = statementAtOffset(sql, 0);
    expect(seg).not.toBeNull();
    expect(seg!.text).toBe('SELECT 1;');
  });

  test('cursor inside leading whitespace returns the first statement', () => {
    const sql = '   SELECT 1;';
    const seg = statementAtOffset(sql, 1);
    expect(seg).not.toBeNull();
    expect(seg!.text).toBe('SELECT 1;');
  });

  test('cursor inside a leading comment of stmt 2 returns null', () => {
    const sql = 'SELECT 1;\n-- about to drop\nSELECT 2;';
    const commentStart = 'SELECT 1;\n'.length;
    const seg = statementAtOffset(sql, commentStart + 4);
    expect(seg).toBeNull();
  });

  test('cursor inside an INLINE comment (mid-statement) returns the surrounding statement', () => {
    const sql = 'SELECT 1 -- inline\n  AS x;';
    const inlineIdx = sql.indexOf('-- inline') + 3;
    const seg = statementAtOffset(sql, inlineIdx);
    expect(seg).not.toBeNull();
    expect(seg!.text).toBe('SELECT 1 -- inline\n  AS x;');
  });

  test('surrogate-pair safety: emoji in comment does not misalign offsets', () => {
    const sql = '-- \uD83D\uDE80 launch\nSELECT 1;';
    expect('\uD83D\uDE80'.length).toBe(2);
    const stmtStart = sql.indexOf('SELECT');
    expect(stmtStart).toBe(13);

    expect(statementAtOffset(sql, 4)).toBeNull();
    expect(statementAtOffset(sql, 5)).toBeNull();

    const seg = statementAtOffset(sql, stmtStart);
    expect(seg).not.toBeNull();
    expect(seg!.text).toBe('SELECT 1;');
    expect(seg!.start).toBe(stmtStart);
  });

  test('surrogate-pair safety: emoji inside a statement does not misalign stmt range', () => {
    const sql = "SELECT '\uD83D\uDE80' AS rocket;";
    const segs = splitSqlSegments(sql);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe('stmt');
    expect(segs[0]!.start).toBe(0);
    expect(segs[0]!.end).toBe(sql.length);
    expect(segs[0]!.text).toBe(sql);
  });

  test('semicolon inside a string is NOT a stmt boundary in segments', () => {
    const sql = "SELECT 'a;b'; SELECT 2;";
    const segs = splitSqlSegments(sql);
    expect(segs.map((s) => s.kind)).toEqual(['stmt', 'ws', 'stmt']);
    expect(segs[0]!.text).toBe("SELECT 'a;b';");
    expect(segs[2]!.text).toBe('SELECT 2;');
  });

  test('multiple leading semicolons coalesce into one ws segment', () => {
    const segs = splitSqlSegments(';;;SELECT 1;');
    expect(segs.map((s) => s.kind)).toEqual(['ws', 'stmt']);
    expect(segs[0]!.text).toBe(';;;');
    expect(segs[1]!.text).toBe('SELECT 1;');
  });

  test('splitSql output is unchanged when derived from segments', () => {
    expect(splitSql('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
    expect(splitSql('-- header only')).toEqual([]);
    expect(splitSql('SELECT 1 -- inline\n  AS x;')).toEqual([
      'SELECT 1 -- inline\n  AS x'
    ]);
  });
});
