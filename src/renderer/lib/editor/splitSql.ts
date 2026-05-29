/**
 * Snowflake SQL tokenizer + segment splitter.
 *
 * The tokenizer respects every Snowflake lexical context so a semicolon
 * inside one of them is NOT treated as a statement terminator:
 *   - single-quoted strings `'...'` (escape: doubled `''`)
 *   - double-quoted identifiers `"..."` (escape: doubled `""`)
 *   - dollar-quoted strings `$$ ... $$` and `$tag$ ... $tag$`
 *   - line comments `-- ... \n`
 *   - block comments `/* ... *\/` (non-nesting per Snowflake)
 *
 * Offsets are UTF-16 code unit indices (JavaScript native string indices).
 * They line up with CodeMirror's `EditorState.doc` offsets and stay valid
 * across surrogate pairs (emojis in comments don't drift the math).
 */

export interface Segment {
  start: number;
  end: number;
  text: string;
  kind: 'stmt' | 'comment' | 'ws';
}

type RawTokenKind =
  | 'ws'
  | 'line_comment'
  | 'block_comment'
  | 'string'
  | 'ident_quote'
  | 'dollar_quote'
  | 'semicolon'
  | 'other';

interface RawToken {
  kind: RawTokenKind;
  start: number;
  end: number;
}

function isWsChar(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
}

function isTagChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

function tokenize(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  const n = input.length;
  let i = 0;

  while (i < n) {
    const ch = input[i] ?? '';
    const next = input[i + 1] ?? '';

    if (isWsChar(ch)) {
      const start = i;
      while (i < n && isWsChar(input[i] ?? '')) i++;
      tokens.push({ kind: 'ws', start, end: i });
      continue;
    }

    if (ch === '-' && next === '-') {
      const start = i;
      i += 2;
      while (i < n && input[i] !== '\n') i++;
      tokens.push({ kind: 'line_comment', start, end: i });
      continue;
    }

    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < n) {
        if (input[i] === '*' && input[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      tokens.push({ kind: 'block_comment', start, end: i });
      continue;
    }

    if (ch === "'") {
      const start = i;
      i++;
      while (i < n) {
        if (input[i] === "'") {
          if (input[i + 1] === "'") {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      tokens.push({ kind: 'string', start, end: i });
      continue;
    }

    if (ch === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (input[i] === '"') {
          if (input[i + 1] === '"') {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      tokens.push({ kind: 'ident_quote', start, end: i });
      continue;
    }

    if (ch === '$') {
      const start = i;
      let tagEnd = i + 1;
      while (tagEnd < n && isTagChar(input[tagEnd] ?? '')) tagEnd++;
      if (tagEnd < n && input[tagEnd] === '$') {
        const tag = input.slice(i, tagEnd + 1);
        i = tagEnd + 1;
        const closingIdx = input.indexOf(tag, i);
        if (closingIdx === -1) {
          i = n;
        } else {
          i = closingIdx + tag.length;
        }
        tokens.push({ kind: 'dollar_quote', start, end: i });
        continue;
      }
      // Bare $ (not a dollar-quote opener) is just another significant char.
      tokens.push({ kind: 'other', start, end: i + 1 });
      i++;
      continue;
    }

    if (ch === ';') {
      tokens.push({ kind: 'semicolon', start: i, end: i + 1 });
      i++;
      continue;
    }

    tokens.push({ kind: 'other', start: i, end: i + 1 });
    i++;
  }

  return tokens;
}

/**
 * Emit ALL segments of the input — statements, between-statement whitespace,
 * and standalone leading/trailing comments.
 *
 * A `stmt` segment spans from the first significant token of the statement
 * through (and including) its terminating `;` or EOF. Comments and whitespace
 * INSIDE a statement are part of that statement's range — they are NOT split
 * out as separate segments. Only comments / whitespace BETWEEN statements
 * (i.e. before any significant token of the next statement) are emitted as
 * their own segments.
 *
 * Bare `;` runs (no preceding significant token) coalesce into the surrounding
 * `ws` segment — they don't form their own `stmt`.
 */
export function splitSqlSegments(input: string): Segment[] {
  const tokens = tokenize(input);
  const segments: Segment[] = [];
  const n = input.length;

  let inStmt = false;
  let stmtStart = -1;
  let pending: RawToken[] = [];

  const flushPending = (): void => {
    for (const tok of pending) {
      const kind: Segment['kind'] =
        tok.kind === 'line_comment' || tok.kind === 'block_comment' ? 'comment' : 'ws';
      const prev = segments[segments.length - 1];
      if (prev && prev.kind === kind && prev.end === tok.start) {
        prev.end = tok.end;
        prev.text = input.slice(prev.start, prev.end);
      } else {
        segments.push({
          start: tok.start,
          end: tok.end,
          text: input.slice(tok.start, tok.end),
          kind
        });
      }
    }
    pending = [];
  };

  for (const tok of tokens) {
    if (inStmt) {
      if (tok.kind === 'semicolon') {
        segments.push({
          start: stmtStart,
          end: tok.end,
          text: input.slice(stmtStart, tok.end),
          kind: 'stmt'
        });
        inStmt = false;
        stmtStart = -1;
      }
      // Inline ws / comments / quoted bodies stay part of the statement.
      continue;
    }

    // Outside a statement: pending preamble collects ws / comments / bare `;`.
    if (
      tok.kind === 'ws' ||
      tok.kind === 'line_comment' ||
      tok.kind === 'block_comment' ||
      tok.kind === 'semicolon'
    ) {
      pending.push(tok);
      continue;
    }

    // Significant token — the preamble belongs to the gap before this stmt.
    flushPending();
    inStmt = true;
    stmtStart = tok.start;
  }

  if (inStmt) {
    segments.push({
      start: stmtStart,
      end: n,
      text: input.slice(stmtStart, n),
      kind: 'stmt'
    });
  } else {
    flushPending();
  }

  return segments;
}

/**
 * Splits a SQL script into individual statements (trimmed strings).
 *
 * Behaviorally identical to the pre-segment implementation: trailing
 * semicolons are optional, comment-only chunks are dropped, the empty /
 * whitespace-only input yields `[]`, and `;` characters that sit INSIDE a
 * lexical context (string, identifier quote, dollar-quote, comment) are
 * NOT treated as terminators — including the unterminated-string case
 * where the rest of the script is consumed by the open quote.
 */
export function splitSql(input: string): string[] {
  const tokens = tokenize(input);
  const out: string[] = [];
  let stmtStart = -1;

  for (const tok of tokens) {
    if (stmtStart === -1) {
      if (
        tok.kind === 'ws' ||
        tok.kind === 'line_comment' ||
        tok.kind === 'block_comment' ||
        tok.kind === 'semicolon'
      ) {
        continue;
      }
      stmtStart = tok.start;
      continue;
    }

    if (tok.kind === 'semicolon') {
      const body = input.slice(stmtStart, tok.start).trim();
      if (body.length > 0 && !isCommentOnly(body)) out.push(body);
      stmtStart = -1;
    }
  }

  if (stmtStart !== -1) {
    const body = input.slice(stmtStart, input.length).trim();
    if (body.length > 0 && !isCommentOnly(body)) out.push(body);
  }

  return out;
}

function isCommentOnly(stmt: string): boolean {
  const stripped = stmt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .trim();
  return stripped.length === 0;
}

/**
 * Look up the statement segment containing a cursor offset.
 *
 *   - cursor inside a `stmt` segment       → that stmt
 *   - cursor inside a `ws` segment         → next stmt (Snowsight parity);
 *                                            falls back to previous stmt
 *                                            if there is no next
 *   - cursor inside a `comment` segment    → null (caller should toast)
 *   - cursor at EOF (offset === length)    → last stmt segment (the natural
 *                                            cursor position after typing
 *                                            a query), null if the trailing
 *                                            segment is a comment
 *   - cursor at offset > length            → null
 *
 * Offsets are UTF-16 code unit indices (matching `EditorState.doc.length` /
 * `selection.main.head`). The `🚀` emoji is two UTF-16 units; offsets stay
 * aligned across surrogate pairs without any special handling.
 */
export function statementAtOffset(input: string, offset: number): Segment | null {
  if (offset < 0 || offset > input.length) return null;
  const segments = splitSqlSegments(input);
  if (segments.length === 0) return null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (offset >= seg.start && offset < seg.end) {
      if (seg.kind === 'stmt') return seg;
      if (seg.kind === 'comment') return null;
      for (let j = i + 1; j < segments.length; j++) {
        if (segments[j]!.kind === 'stmt') return segments[j]!;
      }
      for (let j = i - 1; j >= 0; j--) {
        if (segments[j]!.kind === 'stmt') return segments[j]!;
      }
      return null;
    }
  }

  // offset === input.length (cursor at EOF). Walk back to find the last
  // stmt; if a trailing comment is encountered first the cursor sits in
  // the trailing comment region and returns null.
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (seg.kind === 'stmt') return seg;
    if (seg.kind === 'comment') return null;
  }
  return null;
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
