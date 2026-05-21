/**
 * Tab state for the workspace. Each tab owns its own pane tree
 * (`PaneTreeStore`) so splitting/closing in tab A does not affect tab B.
 *
 * Bucket D (T2.5) wires this into App.svelte. Wave 3 will replace the
 * placeholder title with the first non-comment line of the active pane's
 * body once SqlEditor is mounted in WorksheetPane.
 */
import { nanoid } from 'nanoid';
import { createPaneTree, type PaneTreeStore } from './panes.svelte';
import { registerShortcut } from '../utils/keymap';

export interface Tab {
  id: string;
  title: string;
  dirty: boolean;
  paneTree: PaneTreeStore;
}

function newTab(index: number): Tab {
  return {
    id: nanoid(),
    title: `Worksheet ${index}`,
    dirty: false,
    paneTree: createPaneTree()
  };
}

function createTabsStore() {
  const initialTab = newTab(1);
  let tabsState = $state<Tab[]>([initialTab]);
  let activeIdState = $state<string>(initialTab.id);
  let nextIndex = 2;

  function add(): Tab {
    const t = newTab(nextIndex++);
    tabsState.push(t);
    activeIdState = t.id;
    return t;
  }

  function close(id: string) {
    const idx = tabsState.findIndex((t) => t.id === id);
    if (idx === -1) return;

    // Never close the last tab — reset it instead.
    if (tabsState.length === 1) {
      const fresh = newTab(nextIndex++);
      tabsState = [fresh];
      activeIdState = fresh.id;
      return;
    }

    tabsState.splice(idx, 1);

    if (activeIdState === id) {
      const fallback = tabsState[idx] ?? tabsState[idx - 1] ?? tabsState[0];
      if (fallback) activeIdState = fallback.id;
    }
  }

  function setActive(id: string) {
    if (tabsState.some((t) => t.id === id)) {
      activeIdState = id;
    }
  }

  function next() {
    const i = tabsState.findIndex((t) => t.id === activeIdState);
    const target = tabsState[(i + 1) % tabsState.length];
    if (target) activeIdState = target.id;
  }

  function prev() {
    const i = tabsState.findIndex((t) => t.id === activeIdState);
    const len = tabsState.length;
    const target = tabsState[(i - 1 + len) % len];
    if (target) activeIdState = target.id;
  }

  function switchTo(index: number) {
    const target = tabsState[index];
    if (target) activeIdState = target.id;
  }

  function activeTab(): Tab | null {
    return tabsState.find((t) => t.id === activeIdState) ?? null;
  }

  return {
    get list() { return tabsState; },
    get activeId() { return activeIdState; },
    get active() { return activeTab(); },
    add,
    close,
    setActive,
    next,
    prev,
    switchTo
  };
}

export type TabsStore = ReturnType<typeof createTabsStore>;

export const tabs = createTabsStore();

/**
 * Installs cmd/ctrl-T (new tab), cmd/ctrl-shift-] / cmd/ctrl-shift-[
 * (next / prev), and cmd/ctrl-1..9 (switch to tab N).
 */
export function installTabsKeymap(store: TabsStore = tabs): () => void {
  const cleanups = [
    registerShortcut({
      id: 'tab.new',
      combo: { cmdOrCtrl: true, code: 'KeyT' },
      scope: 'global-block-editor',
      description: 'New tab',
      handler: (e) => {
        e.preventDefault();
        store.add();
      }
    }),
    registerShortcut({
      id: 'tab.next',
      combo: { cmdOrCtrl: true, shift: true, code: 'BracketRight' },
      scope: 'global-block-editor',
      description: 'Next tab',
      handler: (e) => {
        e.preventDefault();
        store.next();
      }
    }),
    registerShortcut({
      id: 'tab.prev',
      combo: { cmdOrCtrl: true, shift: true, code: 'BracketLeft' },
      scope: 'global-block-editor',
      description: 'Previous tab',
      handler: (e) => {
        e.preventDefault();
        store.prev();
      }
    })
  ];

  for (let i = 1; i <= 9; i++) {
    cleanups.push(
      registerShortcut({
        id: `tab.switch-${i}`,
        combo: { cmdOrCtrl: true, code: `Digit${i}` },
        scope: 'global-block-editor',
        description: `Switch to tab ${i}`,
        handler: (e) => {
          e.preventDefault();
          store.switchTo(i - 1);
        }
      })
    );
  }

  return () => cleanups.forEach((c) => c());
}
