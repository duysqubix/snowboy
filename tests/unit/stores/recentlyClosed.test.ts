import { describe, it, expect, beforeEach } from 'vitest';
import { createRecentlyClosedStore } from '../../../src/renderer/lib/stores/recentlyClosed.svelte';

describe('recentlyClosed store', () => {
  let store: ReturnType<typeof createRecentlyClosedStore>;

  beforeEach(() => {
    store = createRecentlyClosedStore();
  });

  it('pushes to head and evicts oldest at 5', () => {
    for (let i = 1; i <= 6; i++) {
      store.push({
        worksheetId: `w${i}`,
        title: `Title ${i}`,
        closedAt: i * 1000
      });
    }

    expect(store.items.length).toBe(5);
    expect(store.items[0]?.worksheetId).toBe('w6');
    expect(store.items[4]?.worksheetId).toBe('w2');
  });

  it('pops and removes the matching worksheetId', () => {
    store.push({ worksheetId: 'w1', title: 'T1', closedAt: 1000 });
    store.push({ worksheetId: 'w2', title: 'T2', closedAt: 2000 });

    const popped = store.pop('w1');
    expect(popped?.worksheetId).toBe('w1');
    expect(store.items.length).toBe(1);
    expect(store.items[0]?.worksheetId).toBe('w2');
  });

  it('returns null when popping non-existent worksheetId', () => {
    store.push({ worksheetId: 'w1', title: 'T1', closedAt: 1000 });
    const popped = store.pop('w2');
    expect(popped).toBeNull();
    expect(store.items.length).toBe(1);
  });

  it('clears all items', () => {
    store.push({ worksheetId: 'w1', title: 'T1', closedAt: 1000 });
    store.clear();
    expect(store.items.length).toBe(0);
  });
});
