export type Column = {
  name: string;
  dataType?: string;
  width?: number;
};

export type Row = Record<string, unknown>;

export type ExportCsvOptions = {
  /**
   * Append a trailing CRLF after the final record.
   *
   * Default `false` so the output ends on the last character of the last row.
   * RFC 4180 allows but does not require a trailing terminator; some downstream
   * consumers (notably Excel) accept either form.
   */
  trailingNewline?: boolean;
};

/**
 * RFC 4180-compliant CSV serializer for Snowflake query results.
 *
 * Record terminator is CRLF (`\r\n`). Required for Excel-on-Windows, which
 * misparses bare LF as a literal cell character when fields are quoted.
 *
 * Serialization rules per JS runtime type:
 *
 * | Input                | Output                                                |
 * |----------------------|-------------------------------------------------------|
 * | `null` / `undefined` | empty (unquoted) — indistinguishable from empty string|
 * | `string`             | raw; quoted+escaped if it contains `"`, `,`, CR or LF |
 * | `number` (finite)    | `String(n)`                                           |
 * | `number` (NaN/±Inf)  | empty — Excel convention; CSV has no canonical form   |
 * | `bigint`             | `String(n)` — lossless decimal string, no marker       |
 * | `boolean`            | `"true"` / `"false"`                                  |
 * | `Date` (valid)       | `date.toISOString()` — always UTC ISO 8601            |
 * | `Date` (invalid)     | empty                                                 |
 * | `object` / array     | `JSON.stringify(v)` then string-escape (one layer)    |
 * | other                | `String(v)` then string-escape                        |
 *
 * The string-escape rule is the RFC 4180 escape: if the field contains a
 * double quote, comma, CR, or LF, wrap in double quotes and double any
 * internal quote (`"` → `""`). Otherwise emit raw.
 *
 * For objects we apply CSV escaping *once* on the JSON output rather than
 * recursively re-escaping JSON's own quote escapes — this avoids the
 * double-escape collision that produced unparseable output in v1.
 */
export function exportCsv(
  columns: Column[],
  rows: Row[],
  options: ExportCsvOptions = {}
): string {
  const trailingNewline = options.trailingNewline ?? false;

  const header = columns.map((c) => escapeCsvField(c.name)).join(',');
  const body = rows
    .map((row) => columns.map((c) => serializeValue(row[c.name])).join(','))
    .join('\r\n');

  const trailing = trailingNewline ? '\r\n' : '';
  if (rows.length === 0) {
    return header + trailing;
  }
  return `${header}\r\n${body}${trailing}`;
}

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return escapeCsvField(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  if (typeof value === 'object') {
    return escapeCsvField(JSON.stringify(value));
  }
  return escapeCsvField(String(value));
}

function escapeCsvField(str: string): string {
  if (
    str.indexOf('"') !== -1 ||
    str.indexOf(',') !== -1 ||
    str.indexOf('\n') !== -1 ||
    str.indexOf('\r') !== -1
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
