import { describe, expect, test } from 'bun:test';
import { Virtualizer } from '@tanstack/virtual-core';
import { exportCsv } from '../../../src/renderer/lib/results/exportCsv';
import {
  getRowHeight,
  parseMultilineCell
} from '../../../src/renderer/lib/results/gridHelpers';

type FakeRect = { width: number; height: number };

type VirtualizerHarness = {
  virtualizer: Virtualizer<HTMLElement, HTMLElement>;
  pushRect: (rect: FakeRect) => void;
  pushOffset: (offset: number) => void;
};

function makeVirtualizer(opts: {
  count: number;
  rowHeight: number;
  viewportHeight?: number;
  overscan?: number;
}): VirtualizerHarness {
  const fakeScrollEl = {} as HTMLElement;
  let rectCb: ((rect: FakeRect) => void) | null = null;
  let offsetCb: ((offset: number, isScrolling: boolean) => void) | null = null;

  const virtualizer = new Virtualizer<HTMLElement, HTMLElement>({
    count: opts.count,
    getScrollElement: () => fakeScrollEl,
    estimateSize: () => opts.rowHeight,
    overscan: opts.overscan ?? 5,
    observeElementRect: (_inst, cb) => {
      rectCb = cb;
      cb({ width: 800, height: opts.viewportHeight ?? 400 });
      return () => {};
    },
    observeElementOffset: (_inst, cb) => {
      offsetCb = cb;
      cb(0, false);
      return () => {};
    },
    scrollToFn: () => {}
  });

  virtualizer._didMount();
  virtualizer._willUpdate();

  return {
    virtualizer,
    pushRect: (rect: FakeRect) => rectCb?.(rect),
    pushOffset: (offset: number) => {
      offsetCb?.(offset, false);
      virtualizer._willUpdate();
    }
  };
}

describe('getRowHeight', () => {
  test('default font size 14 yields 20px (ceil(14 * 1.4))', () => {
    expect(getRowHeight(14)).toBe(20);
  });

  test('odd font sizes round UP — 13 → 19, 17 → 24', () => {
    expect(getRowHeight(13)).toBe(19);
    expect(getRowHeight(17)).toBe(24);
  });

  test('font size 12 → 17, font size 20 → 28', () => {
    expect(getRowHeight(12)).toBe(17);
    expect(getRowHeight(20)).toBe(28);
  });

  test('non-finite, zero, and negative fontSize fall back to default', () => {
    expect(getRowHeight(Number.NaN)).toBe(20);
    expect(getRowHeight(Number.POSITIVE_INFINITY)).toBe(20);
    expect(getRowHeight(0)).toBe(20);
    expect(getRowHeight(-5)).toBe(20);
  });

  test('row height monotonically increases with font size', () => {
    const prev = getRowHeight(10);
    const next = getRowHeight(11);
    expect(next).toBeGreaterThanOrEqual(prev);
  });
});

describe('parseMultilineCell', () => {
  test('non-string input is treated as single-line', () => {
    expect(parseMultilineCell(null)).toEqual({
      isMultiline: false,
      firstLine: '',
      extraLines: 0
    });
    expect(parseMultilineCell(undefined)).toEqual({
      isMultiline: false,
      firstLine: '',
      extraLines: 0
    });
    expect(parseMultilineCell(42)).toEqual({
      isMultiline: false,
      firstLine: '',
      extraLines: 0
    });
    expect(parseMultilineCell({ foo: 1 })).toEqual({
      isMultiline: false,
      firstLine: '',
      extraLines: 0
    });
  });

  test('single-line string returns isMultiline=false and full content', () => {
    expect(parseMultilineCell('hello world')).toEqual({
      isMultiline: false,
      firstLine: 'hello world',
      extraLines: 0
    });
  });

  test('two-line string returns first line + extraLines=1', () => {
    expect(parseMultilineCell('a\nb')).toEqual({
      isMultiline: true,
      firstLine: 'a',
      extraLines: 1
    });
  });

  test('three-line string returns first line + extraLines=2', () => {
    expect(parseMultilineCell('a\nb\nc')).toEqual({
      isMultiline: true,
      firstLine: 'a',
      extraLines: 2
    });
  });

  test('trailing newline still flags multiline with extraLines=1', () => {
    expect(parseMultilineCell('a\n')).toEqual({
      isMultiline: true,
      firstLine: 'a',
      extraLines: 1
    });
  });

  test('blank line between content is counted', () => {
    expect(parseMultilineCell('a\n\nb')).toEqual({
      isMultiline: true,
      firstLine: 'a',
      extraLines: 2
    });
  });

  test('leading newline yields empty firstLine but multiline=true', () => {
    expect(parseMultilineCell('\nb')).toEqual({
      isMultiline: true,
      firstLine: '',
      extraLines: 1
    });
  });

  test('empty string is single-line with empty firstLine', () => {
    expect(parseMultilineCell('')).toEqual({
      isMultiline: false,
      firstLine: '',
      extraLines: 0
    });
  });
});

describe('Virtualizer integration — windowing invariants', () => {
  test('reports totalSize = count * rowHeight for a stable row size', () => {
    const { virtualizer } = makeVirtualizer({ count: 1_000_000, rowHeight: 20 });
    expect(virtualizer.getTotalSize()).toBe(20_000_000);
  });

  test('renders only an O(viewport / rowHeight + 2 * overscan) window for 1M rows', () => {
    const { virtualizer } = makeVirtualizer({
      count: 1_000_000,
      rowHeight: 20,
      viewportHeight: 400,
      overscan: 5
    });
    const items = virtualizer.getVirtualItems();
    expect(items.length).toBeLessThan(60);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.index).toBe(0);
  });

  test('scrolling shifts the visible window forward', () => {
    const h = makeVirtualizer({
      count: 1_000_000,
      rowHeight: 20,
      viewportHeight: 400,
      overscan: 5
    });
    h.pushOffset(20_000);
    const items = h.virtualizer.getVirtualItems();
    expect(items.length).toBeLessThan(60);
    const firstIndex = items[0]?.index ?? -1;
    expect(firstIndex).toBeGreaterThan(900);
    expect(firstIndex).toBeLessThan(1100);
  });

  test('count change extends totalSize linearly under stable rowHeight (streaming append)', () => {
    const h = makeVirtualizer({ count: 100, rowHeight: 20 });
    expect(h.virtualizer.getTotalSize()).toBe(2000);
    h.virtualizer.setOptions({ ...h.virtualizer.options, count: 1000 });
    h.virtualizer._willUpdate();
    expect(h.virtualizer.getTotalSize()).toBe(20_000);
  });

  test('bigger fontSize wires through getRowHeight into a bigger totalSize', () => {
    const small = makeVirtualizer({ count: 100, rowHeight: getRowHeight(14) });
    const big = makeVirtualizer({ count: 100, rowHeight: getRowHeight(20) });
    expect(small.virtualizer.getTotalSize()).toBe(100 * getRowHeight(14));
    expect(big.virtualizer.getTotalSize()).toBe(100 * getRowHeight(20));
    expect(big.virtualizer.getTotalSize()).toBeGreaterThan(
      small.virtualizer.getTotalSize()
    );
  });
});

describe('CSV export covers the full row set, not just the virtual window', () => {
  test('10k rows produce 10001 CRLF-separated records even when virtualizer only paints ~50', () => {
    const columns = [{ name: 'i' }];
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ i }));

    const { virtualizer } = makeVirtualizer({
      count: rows.length,
      rowHeight: 20,
      viewportHeight: 400,
      overscan: 5
    });
    expect(virtualizer.getVirtualItems().length).toBeLessThan(100);

    const csv = exportCsv(columns, rows);
    const records = csv.split('\r\n');
    expect(records.length).toBe(10_001);
    expect(records[0]).toBe('i');
    expect(records[1]).toBe('0');
    expect(records[records.length - 1]).toBe('9999');
  });

  test('CSV preserves embedded newline in multiline VARCHAR cells (Wave 3 contract)', () => {
    const columns = [{ name: 'note' }];
    const rows = [{ note: 'first\nsecond\nthird' }];
    const csv = exportCsv(columns, rows);
    expect(csv).toBe('note\r\n"first\nsecond\nthird"');
  });
});
