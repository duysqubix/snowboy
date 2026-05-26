import type { EditorView } from '@codemirror/view';
import { statementAtOffset } from './splitSql';

export interface RunAtCursorPayload {
  offset: number;
  statement: string;
  segmentStart: number;
  segmentEnd: number;
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
    const offset = view.state.selection.main.head;
    const doc = view.state.doc.toString();
    const seg = statementAtOffset(doc, offset);
    if (seg === null) {
      callbacks.onNoStatementAtCursor?.();
      return true;
    }
    callbacks.onRunAtCursor?.({
      offset,
      statement: seg.text,
      segmentStart: seg.start,
      segmentEnd: seg.end
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
