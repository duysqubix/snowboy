/**
 * Splits a SQL script into individual statements.
 *
 * State machine that respects Snowflake SQL lexical contexts so a semicolon
 * inside one of them is NOT a statement terminator:
 *   - single-quoted strings `'...'` (escape: doubled `''`)
 *   - double-quoted identifiers `"..."` (escape: doubled `""`)
 *   - dollar-quoted strings `$$ ... $$` and `$tag$ ... $tag$`
 *   - line comments `-- ... \n`
 *   - block comments `/* ... *\/` (non-nesting per Snowflake)
 *
 * Trailing semicolons are optional; an empty input yields `[]`. Whitespace and
 * comment-only statements are dropped — they're not interesting to run and
 * Snowflake would reject them anyway.
 */
export function splitSql(input: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i] ?? '';
    const next = input[i + 1] ?? '';

    if (ch === '-' && next === '-') {
      current += '--';
      i += 2;
      while (i < n && input[i] !== '\n') {
        current += input[i];
        i++;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      current += '/*';
      i += 2;
      while (i < n) {
        if (input[i] === '*' && input[i + 1] === '/') {
          current += '*/';
          i += 2;
          break;
        }
        current += input[i];
        i++;
      }
      continue;
    }

    if (ch === "'") {
      current += "'";
      i++;
      while (i < n) {
        if (input[i] === "'") {
          if (input[i + 1] === "'") {
            current += "''";
            i += 2;
          } else {
            current += "'";
            i++;
            break;
          }
        } else {
          current += input[i];
          i++;
        }
      }
      continue;
    }

    if (ch === '"') {
      current += '"';
      i++;
      while (i < n) {
        if (input[i] === '"') {
          if (input[i + 1] === '"') {
            current += '""';
            i += 2;
          } else {
            current += '"';
            i++;
            break;
          }
        } else {
          current += input[i];
          i++;
        }
      }
      continue;
    }

    if (ch === '$') {
      let tagEnd = i + 1;
      while (tagEnd < n && /[A-Za-z0-9_]/.test(input[tagEnd] ?? '')) {
        tagEnd++;
      }
      if (tagEnd < n && input[tagEnd] === '$') {
        const tag = input.slice(i, tagEnd + 1);
        current += tag;
        i = tagEnd + 1;
        const closingIdx = input.indexOf(tag, i);
        if (closingIdx === -1) {
          current += input.slice(i);
          i = n;
        } else {
          current += input.slice(i, closingIdx + tag.length);
          i = closingIdx + tag.length;
        }
        continue;
      }
      current += '$';
      i++;
      continue;
    }

    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0 && !isCommentOnly(trimmed)) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0 && !isCommentOnly(trimmed)) {
    statements.push(trimmed);
  }

  return statements;
}

function isCommentOnly(stmt: string): boolean {
  const stripped = stmt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .trim();
  return stripped.length === 0;
}

/**
 * Single-line preview of a statement for tab labels. Collapses whitespace and
 * truncates at `maxLength` with an ellipsis.
 */
export function previewStatement(sql: string, maxLength = 40): string {
  const collapsed = sql.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength
    ? collapsed.slice(0, maxLength - 1) + '…'
    : collapsed;
}
