/**
 * Loading a pane's stored worksheet, and the save gate that depends on it.
 *
 * A pane may save only after its load has succeeded. Otherwise a failed
 * load would leave an empty editor whose first keystroke saves that empty
 * body over the stored SQL.
 */
import type { Worksheet } from '../../../main/types';

/** The parts of a pane's state that a load fills in. */
export interface WorksheetLoadTarget {
  readonly worksheetId: string;
  body: string;
  title: string;
  cursorLine: number | null;
  cursorCol: number | null;
  scrollTop: number | null;
  /** True only once a load has succeeded. */
  hydrated: boolean;
}

export type WorksheetLoadResult =
  | { status: 'loaded' }
  | { status: 'failed'; error: string }
  | { status: 'cancelled' };

/**
 * Loads the stored worksheet into `target` and marks it hydrated. A failure
 * leaves `target` as it was, so it stays unsaveable until a retry succeeds.
 * If `isCancelled()` is true once the load settles, the outcome is dropped.
 */
export async function loadWorksheetInto(
  target: WorksheetLoadTarget,
  getWorksheet: (id: string) => Promise<Worksheet | null>,
  isCancelled: () => boolean
): Promise<WorksheetLoadResult> {
  let stored: Worksheet | null;
  try {
    stored = await getWorksheet(target.worksheetId);
  } catch (err) {
    if (isCancelled()) return { status: 'cancelled' };
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
  if (isCancelled()) return { status: 'cancelled' };
  if (stored !== null) {
    target.body = stored.body;
    target.title = stored.title;
    target.cursorLine = stored.cursorLine ?? null;
    target.cursorCol = stored.cursorCol ?? null;
    target.scrollTop = stored.scrollTop ?? null;
  }
  target.hydrated = true;
  return { status: 'loaded' };
}

/** Every save path checks this: nothing is written before a load succeeds. */
export function canSaveWorksheet(target: Pick<WorksheetLoadTarget, 'hydrated'>): boolean {
  return target.hydrated;
}
