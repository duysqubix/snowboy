import { SvelteMap } from 'svelte/reactivity';
import type { QueryId } from '../../../main/types';

export class PaneStateFacade {
  role = $state<string | undefined>(undefined);
  warehouse = $state<string | undefined>(undefined);
  database = $state<string | undefined>(undefined);
  schema = $state<string | undefined>(undefined);
  dirty = $state<boolean>(false);
  body = $state<string>('');
  title = $state<string>('Untitled');
  currentQueryIds = $state<QueryId[]>([]);
  currentStatements = $state<string[]>([]);
  activeResultIndex = $state<number>(0);

  get currentQueryId(): QueryId | null {
    return this.currentQueryIds[this.activeResultIndex] ?? null;
  }
}

const registry = new SvelteMap<string, PaneStateFacade>();

export function getOrCreatePaneState(paneId: string): PaneStateFacade {
  let state = registry.get(paneId);
  if (state === undefined) {
    state = new PaneStateFacade();
    registry.set(paneId, state);
  }
  return state;
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
