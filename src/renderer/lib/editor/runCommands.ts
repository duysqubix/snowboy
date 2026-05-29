import type { EditorView } from '@codemirror/view';
import { splitSqlSegments, statementAtOffset } from './splitSql';

export interface RunStatementSegment {
  text: string;
  segmentStart: number;
  segmentEnd: number;
}

export interface RunAtCursorPayload {
  selectionFrom: number;
  selectionTo: number;
  statements: RunStatementSegment[];
}

export interface RunCommandCallbacks {
  onRunAtCursor?: (payload: RunAtCursorPayload) => void;
  onNoStatementAtCursor?: () => void;
  onRunAll?: () => void;
}

type ViewLike = Pick<EditorView, 'state'>;

export function runAtCursorCommand(
  callbacks: RunCommandCallbacks
): (view: ViewLike) => boolean {
  return (view) => {
    const { from, to } = view.state.selection.main;
    const doc = view.state.doc.toString();

    let statements: RunStatementSegment[];
    if (from === to) {
      const seg = statementAtOffset(doc, from);
      if (seg === null) {
        callbacks.onNoStatementAtCursor?.();
        return true;
      }
      statements = [{ text: seg.text, segmentStart: seg.start, segmentEnd: seg.end }];
    } else {
      statements = splitSqlSegments(doc)
        .filter((s) => s.kind === 'stmt' && s.start < to && s.end > from)
        .map((s) => ({ text: s.text, segmentStart: s.start, segmentEnd: s.end }));
      if (statements.length === 0) {
        callbacks.onNoStatementAtCursor?.();
        return true;
      }
    }

    callbacks.onRunAtCursor?.({
      selectionFrom: from,
      selectionTo: to,
      statements
    });
    return true;
  };
}

export function runAllCommand(
  callbacks: RunCommandCallbacks
): () => boolean {
  return () => {
    callbacks.onRunAll?.();
    return true;
  };
}
