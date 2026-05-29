import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import {
  runAtCursorCommand,
  runAllCommand,
  type RunAtCursorPayload
} from '../../../src/renderer/lib/editor/runCommands';

function viewLikeFromState(state: EditorState) {
  return { state };
}

function withCursor(doc: string, head: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: head, head } });
}

function withSelection(doc: string, from: number, to: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: from, head: to } });
}

describe('runAtCursorCommand', () => {
  test('fires onRunAtCursor with the segment payload when cursor is inside a statement', () => {
    let captured: RunAtCursorPayload | null = null;
    let noStmtCount = 0;
    const cmd = runAtCursorCommand({
      onRunAtCursor: (p) => {
        captured = p;
      },
      onNoStatementAtCursor: () => {
        noStmtCount += 1;
      }
    });

    const sql = 'SELECT 1; SELECT 2; SELECT 3;';
    const state = withCursor(sql, 13);

    expect(cmd(viewLikeFromState(state))).toBe(true);
    expect(noStmtCount).toBe(0);
    expect(captured).not.toBeNull();
    expect(captured!.statements).toHaveLength(1);
    expect(captured!.statements[0]!.text).toBe('SELECT 2;');
    expect(captured!.statements[0]!.segmentStart).toBe(10);
    expect(captured!.statements[0]!.segmentEnd).toBe(19);
    expect(captured!.selectionFrom).toBe(13);
    expect(captured!.selectionTo).toBe(13);
  });

  test('cursor in between-statement whitespace runs the NEXT statement', () => {
    let captured: RunAtCursorPayload | null = null;
    const cmd = runAtCursorCommand({
      onRunAtCursor: (p) => {
        captured = p;
      }
    });

    const sql = 'SELECT 1;   SELECT 2;';
    const state = withCursor(sql, 10);

    expect(cmd(viewLikeFromState(state))).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured!.statements).toHaveLength(1);
    expect(captured!.statements[0]!.text).toBe('SELECT 2;');
  });

  test('cursor inside a -- comment fires onNoStatementAtCursor, NOT onRunAtCursor', () => {
    let runCalled = false;
    let noStmtCalled = false;
    const cmd = runAtCursorCommand({
      onRunAtCursor: () => {
        runCalled = true;
      },
      onNoStatementAtCursor: () => {
        noStmtCalled = true;
      }
    });

    const sql = '-- DELETE FROM prod_data;\nSELECT 1;';
    const state = withCursor(sql, 5);

    expect(cmd(viewLikeFromState(state))).toBe(true);
    expect(runCalled).toBe(false);
    expect(noStmtCalled).toBe(true);
  });

  test('cursor inside a /* block */ comment also fires onNoStatementAtCursor', () => {
    let runCalled = false;
    let noStmtCalled = false;
    const cmd = runAtCursorCommand({
      onRunAtCursor: () => {
        runCalled = true;
      },
      onNoStatementAtCursor: () => {
        noStmtCalled = true;
      }
    });

    const sql = '/* DROP TABLE prod_orders; */ SELECT 1;';
    const state = withCursor(sql, 10);

    expect(cmd(viewLikeFromState(state))).toBe(true);
    expect(runCalled).toBe(false);
    expect(noStmtCalled).toBe(true);
  });

  test('returns true (consumes the key event) even when no callbacks are set', () => {
    const cmd = runAtCursorCommand({});
    const state = withCursor('SELECT 1;', 4);
    expect(cmd(viewLikeFromState(state))).toBe(true);
  });

  test('cursor at end of doc returns the last stmt (natural cursor position after typing)', () => {
    let captured: RunAtCursorPayload | null = null;
    let noStmtCalled = false;
    const cmd = runAtCursorCommand({
      onRunAtCursor: (p) => {
        captured = p;
      },
      onNoStatementAtCursor: () => {
        noStmtCalled = true;
      }
    });

    const sql = 'SELECT 1;';
    const state = withCursor(sql, 9);

    expect(cmd(viewLikeFromState(state))).toBe(true);
    expect(noStmtCalled).toBe(false);
    expect(captured!.statements).toHaveLength(1);
    expect(captured!.statements[0]!.text).toBe('SELECT 1;');
    expect(captured!.selectionFrom).toBe(9);
  });

  test('cursor at end of doc inside trailing comment fires onNoStatementAtCursor', () => {
    let noStmtCalled = false;
    const cmd = runAtCursorCommand({
      onNoStatementAtCursor: () => {
        noStmtCalled = true;
      }
    });

    const sql = 'SELECT 1;\n-- trailing';
    const state = withCursor(sql, sql.length);

    expect(cmd(viewLikeFromState(state))).toBe(true);
    expect(noStmtCalled).toBe(true);
  });

  test('payload offset matches selection.main.head exactly', () => {
    let captured: RunAtCursorPayload | null = null;
    const cmd = runAtCursorCommand({
      onRunAtCursor: (p) => {
        captured = p;
      }
    });

    const sql = 'SELECT a, b, c FROM t;';
    const state = withCursor(sql, 7);

    expect(cmd(viewLikeFromState(state))).toBe(true);
    expect(captured!.statements).toHaveLength(1);
    expect(captured!.statements[0]!.text).toBe('SELECT a, b, c FROM t;');
    expect(captured!.statements[0]!.segmentStart).toBe(0);
    expect(captured!.statements[0]!.segmentEnd).toBe(22);
    expect(captured!.selectionFrom).toBe(7);
    expect(captured!.selectionTo).toBe(7);
  });

  test('REGRESSION: selection spanning multiple statements returns ALL of them (user-reported bug)', () => {
    let captured: RunAtCursorPayload | null = null;
    const cmd = runAtCursorCommand({
      onRunAtCursor: (p) => {
        captured = p;
      }
    });

    const sql = 'select 123;\nselect 456;';
    const state = withSelection(sql, 0, sql.length);

    expect(cmd(viewLikeFromState(state))).toBe(true);
    expect(captured!.statements).toHaveLength(2);
    expect(captured!.statements[0]!.text).toBe('select 123;');
    expect(captured!.statements[1]!.text).toBe('select 456;');
    expect(captured!.selectionFrom).toBe(0);
    expect(captured!.selectionTo).toBe(sql.length);
  });

  test('selection entirely inside one statement returns just that statement', () => {
    let captured: RunAtCursorPayload | null = null;
    const cmd = runAtCursorCommand({
      onRunAtCursor: (p) => {
        captured = p;
      }
    });

    const sql = 'SELECT 1; SELECT 2;';
    const state = withSelection(sql, 12, 18);

    expect(cmd(viewLikeFromState(state))).toBe(true);
    expect(captured!.statements).toHaveLength(1);
    expect(captured!.statements[0]!.text).toBe('SELECT 2;');
  });

  test('selection partially overlapping two statements returns both', () => {
    let captured: RunAtCursorPayload | null = null;
    const cmd = runAtCursorCommand({
      onRunAtCursor: (p) => {
        captured = p;
      }
    });

    const sql = 'SELECT 1; SELECT 2;';
    const state = withSelection(sql, 5, 14);

    expect(cmd(viewLikeFromState(state))).toBe(true);
    expect(captured!.statements).toHaveLength(2);
    expect(captured!.statements[0]!.text).toBe('SELECT 1;');
    expect(captured!.statements[1]!.text).toBe('SELECT 2;');
  });

  test('selection containing only whitespace + comments fires onNoStatementAtCursor', () => {
    let noStmtCalled = false;
    const cmd = runAtCursorCommand({
      onNoStatementAtCursor: () => {
        noStmtCalled = true;
      }
    });

    const sql = 'SELECT 1;\n-- comment\nSELECT 2;';
    const state = withSelection(sql, 9, 20);

    expect(cmd(viewLikeFromState(state))).toBe(true);
    expect(noStmtCalled).toBe(true);
  });
});

describe('runAllCommand', () => {
  test('invokes onRunAll callback and consumes the key event', () => {
    let calls = 0;
    const cmd = runAllCommand({
      onRunAll: () => {
        calls += 1;
      }
    });

    expect(cmd()).toBe(true);
    expect(calls).toBe(1);
  });

  test('returns true even when callback is undefined (does not crash)', () => {
    const cmd = runAllCommand({});
    expect(cmd()).toBe(true);
  });
});
