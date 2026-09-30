import { describe, expect, test } from 'bun:test';
import { quoteIdent, sqlStringLiteral } from '../../../src/main/snowflake/sqlText';

// String.raw keeps backslashes literal, so expected SQL reads exactly as Snowflake receives it.

const SINGLE_CHAR_ESCAPES: Record<string, string> = {
  "'": "'",
  '"': '"',
  '\\': '\\',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t'
};

/**
 * Reads the single-quoted string constant at the start of `sql` the way Snowflake does and
 * returns its value plus the index just past the closing quote. Models `''`, the
 * single-character backslash escapes, and the rule that a backslash before any other
 * character is dropped (`'\z'` reads as `z`). Numeric escapes (`\ooo`, `\xhh`, `\uhhhh`)
 * are out of scope and throw.
 * https://docs.snowflake.com/en/sql-reference/data-types-text#escape-sequences-in-single-quoted-string-constants
 */
function readStringConstant(sql: string): { value: string; end: number } {
  if (sql.charAt(0) !== "'") throw new Error('expected a single-quoted string constant');
  let value = '';
  let i = 1;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    const next = sql.charAt(i + 1);
    if (ch === '\\') {
      if (next === '') break;
      if (/[0-7xu]/.test(next)) throw new Error('numeric escapes are not modelled');
      value += SINGLE_CHAR_ESCAPES[next] ?? next;
      i += 2;
    } else if (ch === "'" && next === "'") {
      value += "'";
      i += 2;
    } else if (ch === "'") {
      return { value, end: i + 1 };
    } else {
      value += ch;
      i += 1;
    }
  }
  throw new Error('unterminated string constant');
}

describe('sqlStringLiteral', () => {
  test('wraps a plain value in single quotes', () => {
    expect(sqlStringLiteral('PUBLIC')).toBe("'PUBLIC'");
  });

  test("doubles an embedded single quote (O'Reilly)", () => {
    expect(sqlStringLiteral("O'Reilly")).toBe("'O''Reilly'");
  });

  test('escapes a trailing backslash so it cannot escape the closing quote', () => {
    expect(sqlStringLiteral('a\\')).toBe(String.raw`'a\\'`);
  });

  test("escapes the backslash in a\\'b before doubling the quote", () => {
    expect(sqlStringLiteral(String.raw`a\'b`)).toBe(String.raw`'a\\''b'`);
  });

  test('keeps the backslash in a\\z, which Snowflake would otherwise drop', () => {
    expect(sqlStringLiteral(String.raw`a\z`)).toBe(String.raw`'a\\z'`);
  });

  test('renders the empty string as an empty literal', () => {
    expect(sqlStringLiteral('')).toBe("''");
  });

  test('leaves double quotes untouched', () => {
    expect(sqlStringLiteral('"DB"."PUBLIC"."T"')).toBe(`'"DB"."PUBLIC"."T"'`);
  });

  test('Snowflake reads each literal back as the original value and ends at its closing quote', () => {
    const values = [
      '',
      'PUBLIC',
      "O'Reilly",
      'a\\',
      String.raw`a\'b`,
      String.raw`a\z`,
      String.raw`C:\temp\new`,
      String.raw`x\' OR 1=1 --`,
      String.raw`"DB"."a\"."a\'b"`
    ];
    for (const value of values) {
      const literal = sqlStringLiteral(value);
      expect(readStringConstant(literal)).toEqual({ value, end: literal.length });
    }
  });
});

describe('quoteIdent', () => {
  test('wraps a name in double quotes', () => {
    expect(quoteIdent('PUBLIC')).toBe('"PUBLIC"');
  });

  test('doubles an embedded double quote', () => {
    expect(quoteIdent('weird"name')).toBe('"weird""name"');
  });

  test('leaves backslashes and single quotes alone: quoted identifiers have no backslash escapes', () => {
    expect(quoteIdent(String.raw`a\'b`)).toBe(String.raw`"a\'b"`);
  });

  test('throws on an empty name instead of emitting a zero-length "" identifier', () => {
    expect(() => quoteIdent('')).toThrow('quoteIdent: identifier is empty');
  });
});
