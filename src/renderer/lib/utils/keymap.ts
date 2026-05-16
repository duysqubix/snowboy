import { panes as panesSingleton, type PaneTreeStore } from '../stores/panes.svelte';

/**
 * Installs cmd/ctrl-\, cmd/ctrl-shift-\, and cmd/ctrl-w handlers driving the
 * supplied pane store. Defaults to the singleton when no per-tab store is
 * provided. Bucket D re-installs this when the active tab changes.
 */
export function installKeymap(paneStore: PaneTreeStore = panesSingleton): () => void {
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

    if (cmdOrCtrl && e.key === '\\') {
      e.preventDefault();
      if (e.shiftKey) {
        paneStore.splitActive('h');
      } else {
        paneStore.splitActive('v');
      }
    } else if (cmdOrCtrl && e.key.toLowerCase() === 'w' && !inEditable) {
      e.preventDefault();
      paneStore.closeActive();
    }
  }

  window.addEventListener('keydown', handleKeyDown);

  return () => {
    window.removeEventListener('keydown', handleKeyDown);
  };
}
