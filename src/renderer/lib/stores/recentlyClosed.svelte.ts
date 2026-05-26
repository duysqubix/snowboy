export interface RecentlyClosed {
  worksheetId: string;
  title: string;
  closedAt: number;
}

export function createRecentlyClosedStore() {
  let items = $state<RecentlyClosed[]>([]);
  let menuOpen = $state<boolean>(false);

  function push(entry: RecentlyClosed) {
    items = [entry, ...items].slice(0, 5);
  }

  function pop(worksheetId: string): RecentlyClosed | null {
    const index = items.findIndex(item => item.worksheetId === worksheetId);
    if (index === -1) return null;
    const entry = items[index] as RecentlyClosed;
    items = [...items.slice(0, index), ...items.slice(index + 1)];
    return entry;
  }

  function clear() {
    items = [];
  }

  return {
    get items() { return items; },
    get menuOpen() { return menuOpen; },
    set menuOpen(v: boolean) { menuOpen = v; },
    push,
    pop,
    clear
  };
}

export const recentlyClosed = createRecentlyClosedStore();
