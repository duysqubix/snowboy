import type { SessionContext } from '../../../main/types';

export interface PaneState extends SessionContext {
  dirty: boolean;
  body: string;
  title: string;
}

export function createPaneState() {
  const state = $state<PaneState>({
    role: undefined,
    warehouse: undefined,
    database: undefined,
    schema: undefined,
    dirty: false,
    body: '',
    title: 'Untitled'
  });

  return {
    get role() { return state.role; },
    set role(v) { state.role = v; },
    get warehouse() { return state.warehouse; },
    set warehouse(v) { state.warehouse = v; },
    get database() { return state.database; },
    set database(v) { state.database = v; },
    get schema() { return state.schema; },
    set schema(v) { state.schema = v; },
    get dirty() { return state.dirty; },
    set dirty(v) { state.dirty = v; },
    get body() { return state.body; },
    set body(v) { state.body = v; },
    get title() { return state.title; },
    set title(v) { state.title = v; }
  };
}
