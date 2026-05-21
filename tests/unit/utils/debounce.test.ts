import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { debounce } from '../../../src/renderer/lib/utils/debounce';

const FLUSH_WINDOW_MS = 50;

describe('debounce', () => {
  let originalSetTimeout: typeof setTimeout;
  let originalClearTimeout: typeof clearTimeout;

  beforeEach(() => {
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  test('trailing-edge: invokes once after the wait window with the last args', async () => {
    const calls: number[] = [];
    const fn = debounce((n: number) => {
      calls.push(n);
    }, FLUSH_WINDOW_MS);

    fn(1);
    fn(2);
    fn(3);
    expect(calls).toEqual([]);

    await new Promise((r) => setTimeout(r, FLUSH_WINDOW_MS + 10));
    expect(calls).toEqual([3]);
  });

  test('flush() runs the pending invocation immediately', async () => {
    const calls: string[] = [];
    const fn = debounce((s: string) => {
      calls.push(s);
    }, 500);

    fn('a');
    fn('b');
    expect(fn.isPending).toBe(true);
    fn.flush();
    expect(calls).toEqual(['b']);
    expect(fn.isPending).toBe(false);

    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual(['b']);
  });

  test('flush() with nothing pending is a no-op', () => {
    const calls: number[] = [];
    const fn = debounce((n: number) => {
      calls.push(n);
    }, 50);
    expect(() => fn.flush()).not.toThrow();
    expect(calls).toEqual([]);
  });

  test('cancel() discards the pending invocation without running it', async () => {
    const calls: number[] = [];
    const fn = debounce((n: number) => {
      calls.push(n);
    }, FLUSH_WINDOW_MS);

    fn(1);
    fn(2);
    fn.cancel();
    expect(fn.isPending).toBe(false);

    await new Promise((r) => setTimeout(r, FLUSH_WINDOW_MS + 10));
    expect(calls).toEqual([]);
  });

  test('subsequent invocation after a flush starts a new debounce window', async () => {
    const calls: number[] = [];
    const fn = debounce((n: number) => {
      calls.push(n);
    }, FLUSH_WINDOW_MS);

    fn(1);
    fn.flush();
    expect(calls).toEqual([1]);

    fn(2);
    expect(fn.isPending).toBe(true);
    await new Promise((r) => setTimeout(r, FLUSH_WINDOW_MS + 10));
    expect(calls).toEqual([1, 2]);
  });
});
