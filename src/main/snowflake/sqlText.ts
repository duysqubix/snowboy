/**
 * Double-quoted identifier. Only `"` is special inside one (written `""`);
 * backslashes are literal. An empty name is a caller bug, so it throws here
 * instead of reaching Snowflake as a zero-length `""`.
 * https://docs.snowflake.com/en/sql-reference/identifiers-syntax
 */
export function quoteIdent(name: string): string {
  if (name.length === 0) throw new Error('quoteIdent: identifier is empty');
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Single-quoted string constant. Snowflake applies backslash escapes inside
 * these (`\'`, `\\`, `\n`, ...) and drops a backslash before any other
 * character (`'\z'` reads as `z`), so `\` is doubled first, then `'`.
 * https://docs.snowflake.com/en/sql-reference/data-types-text#escape-sequences-in-single-quoted-string-constants
 */
export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}
