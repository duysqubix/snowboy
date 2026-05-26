import { panes as panesSingleton, type PaneTreeStore } from '../stores/panes.svelte';
import { recentlyClosed } from '../stores/recentlyClosed.svelte';

export type ShortcutScope =
  | 'global-allow-editor'   // fires everywhere (e.g. cmd+\)
  | 'global-block-editor'   // suppressed inside .cm-editor (e.g. cmd+w)
  | 'editor-only';           // documented but NOT window-installed (cmd+enter handled by CM keymap)

export type ShortcutCombo = {
  cmdOrCtrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  code: string;  // e.g. 'Backslash', 'KeyW', 'Slash', 'Enter'
};

export type Shortcut = {
  id: string;
  combo: ShortcutCombo;
  scope: ShortcutScope;
  handler: (e: KeyboardEvent) => void;
  description: string;
};

const registry: Shortcut[] = [];
let isListenerInstalled = false;

function handleKeyDown(e: KeyboardEvent) {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

  // Ignore when focus is inside an editable field — let cmd+w in inputs propagate as character entry
  const target = e.target as HTMLElement | null;
  const inEditable =
    !!target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.closest('.cm-editor') != null);

  for (const shortcut of registry) {
    if (shortcut.scope === 'editor-only') continue;
    if (shortcut.scope === 'global-block-editor' && inEditable) continue;

    const combo = shortcut.combo;
    if (
      combo.code === e.code &&
      !!combo.cmdOrCtrl === cmdOrCtrl &&
      !!combo.shift === e.shiftKey &&
      !!combo.alt === e.altKey
    ) {
      shortcut.handler(e);
    }
  }
}

export function registerShortcut(shortcut: Shortcut): () => void {
  registry.push(shortcut);

  if (!isListenerInstalled) {
    window.addEventListener('keydown', handleKeyDown);
    isListenerInstalled = true;
  }

  return () => {
    const idx = registry.indexOf(shortcut);
    if (idx !== -1) {
      registry.splice(idx, 1);
    }
    if (registry.length === 0 && isListenerInstalled) {
      window.removeEventListener('keydown', handleKeyDown);
      isListenerInstalled = false;
    }
  };
}

export function listShortcuts(): readonly Shortcut[] {
  return registry;
}

export function formatCombo(combo: ShortcutCombo): string {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const parts: string[] = [];

  if (combo.cmdOrCtrl) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (combo.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }
  if (combo.shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }

  let key = combo.code;
  if (key.startsWith('Key')) {
    key = key.substring(3);
  } else if (key.startsWith('Digit')) {
    key = key.substring(5);
  } else if (key === 'Backslash') {
    key = '\\';
  } else if (key === 'Slash') {
    key = '/';
  } else if (key === 'Comma') {
    key = ',';
  } else if (key === 'BracketRight') {
    key = ']';
  } else if (key === 'BracketLeft') {
    key = '[';
  }

  parts.push(key);
  return parts.join('+');
}

/**
 * Installs cmd/ctrl-\, cmd/ctrl-shift-\, and cmd/ctrl-w handlers driving the
 * supplied pane store. Defaults to the singleton when no per-tab store is
 * provided. Bucket D re-installs this when the active tab changes.
 */
export function installKeymap(paneStore: PaneTreeStore = panesSingleton): () => void {
  const cleanups = [
    registerShortcut({
      id: 'pane.split-vertical',
      combo: { cmdOrCtrl: true, alt: true, code: 'Backslash' },
      scope: 'global-allow-editor',
      description: 'Split pane vertically',
      handler: (e) => {
        e.preventDefault();
        paneStore.splitActive('v');
      }
    }),
    registerShortcut({
      id: 'pane.split-horizontal',
      combo: { cmdOrCtrl: true, alt: true, shift: true, code: 'Backslash' },
      scope: 'global-allow-editor',
      description: 'Split pane horizontally',
      handler: (e) => {
        e.preventDefault();
        paneStore.splitActive('h');
      }
    }),
    registerShortcut({
      id: 'pane.close',
      combo: { cmdOrCtrl: true, code: 'KeyW' },
      scope: 'global-allow-editor',
      description: 'Close active pane',
      handler: (e) => {
        e.preventDefault();
        paneStore.closeActive();
      }
    }),
    registerShortcut({
      id: 'pane.recently-closed',
      combo: { cmdOrCtrl: true, shift: true, code: 'KeyT' },
      scope: 'global-allow-editor',
      description: 'Recently closed panes',
      handler: (e) => {
        e.preventDefault();
        recentlyClosed.menuOpen = true;
      }
    })
  ];

  return () => cleanups.forEach((c) => c());
}
