import { describe, expect, test } from 'bun:test';
import type { Worksheet } from '../../../src/main/types';
import {
  canSaveWorksheet,
  loadWorksheetInto,
  type WorksheetLoadTarget
} from '../../../src/renderer/lib/panes/worksheetLoad';

function makePane(): WorksheetLoadTarget {
  return {
    worksheetId: 'ws-1',
    body: '',
    title: 'Untitled',
    cursorLine: null,
    cursorCol: null,
    scrollTop: null,
    hydrated: false
  };
}

function storedWorksheet(body: string): Worksheet {
  return {
    id: 'ws-1',
    title: 'Saved',
    body,
    cursorLine: 2,
    cursorCol: 4,
    scrollTop: 30,
    createdAt: 1,
    updatedAt: 2
  };
}

async function failingLoad(): Promise<Worksheet | null> {
  throw new Error('storage unavailable');
}

const notCancelled = (): boolean => false;

describe('loadWorksheetInto', () => {
  test('a failed load keeps saving off and leaves the pane untouched', async () => {
    const pane = makePane();

    const result = await loadWorksheetInto(pane, failingLoad, notCancelled);

    expect(result).toEqual({ status: 'failed', error: 'storage unavailable' });
    expect(canSaveWorksheet(pane)).toBe(false);
    expect(pane.body).toBe('');
  });

  test('a retry that succeeds fills in the stored worksheet and allows saving', async () => {
    const pane = makePane();
    await loadWorksheetInto(pane, failingLoad, notCancelled);

    const result = await loadWorksheetInto(
      pane,
      async () => storedWorksheet("select 'saved';"),
      notCancelled
    );

    expect(result).toEqual({ status: 'loaded' });
    expect(canSaveWorksheet(pane)).toBe(true);
    expect(pane).toMatchObject({
      body: "select 'saved';",
      title: 'Saved',
      cursorLine: 2,
      cursorCol: 4,
      scrollTop: 30
    });
  });

  test('a worksheet with nothing stored yet loads empty and allows saving', async () => {
    const pane = makePane();

    const result = await loadWorksheetInto(pane, async () => null, notCancelled);

    expect(result).toEqual({ status: 'loaded' });
    expect(canSaveWorksheet(pane)).toBe(true);
    expect(pane.body).toBe('');
  });

  test('the load asks for the pane’s own worksheet', async () => {
    const pane = makePane();
    const requested: string[] = [];

    await loadWorksheetInto(
      pane,
      async (id) => {
        requested.push(id);
        return null;
      },
      notCancelled
    );

    expect(requested).toEqual(['ws-1']);
  });

  test('a load that settles after cancellation changes nothing', async () => {
    const pane = makePane();
    let cancelled = false;

    const result = await loadWorksheetInto(
      pane,
      async () => {
        cancelled = true;
        return storedWorksheet("select 'late';");
      },
      () => cancelled
    );

    expect(result).toEqual({ status: 'cancelled' });
    expect(canSaveWorksheet(pane)).toBe(false);
    expect(pane.body).toBe('');
  });

  test('a failure that settles after cancellation is not reported', async () => {
    const pane = makePane();
    let cancelled = false;

    const result = await loadWorksheetInto(
      pane,
      async () => {
        cancelled = true;
        throw new Error('storage unavailable');
      },
      () => cancelled
    );

    expect(result).toEqual({ status: 'cancelled' });
    expect(canSaveWorksheet(pane)).toBe(false);
  });
});
