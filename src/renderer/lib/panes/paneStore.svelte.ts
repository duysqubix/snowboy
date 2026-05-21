import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { QueryId } from '../../../main/types';

export class PaneStateFacade {
  readonly worksheetId: string;
  role = $state<string | undefined>(undefined);
  warehouse = $state<string | undefined>(undefined);
  database = $state<string | undefined>(undefined);
  schema = $state<string | undefined>(undefined);
  dirty = $state<boolean>(false);
  hydrated = $state<boolean>(false);
  body = $state<string>('');
  title = $state<string>('Untitled');
  cursorLine = $state<number | null>(null);
  cursorCol = $state<number | null>(null);
  scrollTop = $state<number | null>(null);
  currentQueryIds = $state<QueryId[]>([]);
  currentStatements = $state<string[]>([]);
  activeResultIndex = $state<number>(0);

  constructor(worksheetId: string) {
    this.worksheetId = worksheetId;
  }

  get currentQueryId(): QueryId | null {
    return this.currentQueryIds[this.activeResultIndex] ?? null;
  }
}

const registry = new SvelteMap<string, PaneStateFacade>();

export function getOrCreatePaneState(paneId: string, worksheetId: string): PaneStateFacade {
  return untrack(() => {
    let state = registry.get(paneId);
    if (state === undefined) {
      state = new PaneStateFacade(worksheetId);
      registry.set(paneId, state);
    }
    return state;
  });
}

export function getPaneState(paneId: string): PaneStateFacade | null {
  return registry.get(paneId) ?? null;
}

export function deletePaneState(paneId: string): void {
  registry.delete(paneId);
}

export function __clearPaneRegistryForTesting(): void {
  registry.clear();
}
