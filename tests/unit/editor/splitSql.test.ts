import { describe, expect, test } from 'bun:test';
import { previewStatement, splitSql } from '../../../src/renderer/lib/editor/splitSql';

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
