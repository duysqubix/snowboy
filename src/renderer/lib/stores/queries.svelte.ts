/**
 * T3.4 — renderer-side row buffer for in-flight + completed queries.
 *
 * One subscription to `snowboy.queryEvents.*` is installed in the
 * constructor and demuxed by `queryId`. Row batches arrive at whatever
 * rate Snowflake + the IPC bridge can deliver; the store coalesces
 * appends into a single `setTimeout`-driven flush bounded to ~30 fps
 * (`FLUSH_INTERVAL_MS`) so Svelte's reactivity does not chase every
 * batch. A 100k-row stream that arrives in 50 batches becomes O(N/3)
 * UI updates instead of O(N).
 *
 * Per-query lifecycle:
 *   `register(qid)` → renderer pre-creates a `running` row before the
 *                     first batch shows up so the worksheet pane can
 *                     paint a loading state.
 *   onRowBatch       → append to a non-reactive buffer; schedule flush.
 *   flush            → splice buffer into reactive `rows`; clear buffer.
 *   onComplete       → set status='success', durationMs, warehouse.
 *   onError          → set status='error', message.
 *   "Cancelled" comes back via `onError` with message='Query cancelled';
 *   the store classifies that as status='cancelled' for nicer UI.
 *
 * Memory: this store grows unboundedly with completed queries. v0.1
 * acceptable; Wave 4 should add an eviction policy keyed by pane
 * unmount / explicit clear.
 */

import { SvelteMap } from 'svelte/reactivity';
import type {
  QueryCompleteEvent,
  QueryErrorEvent,
  QueryId,
  QueryRowBatchEvent,
  ResultColumn
} from '../../../main/types';
import { snowboy } from '../ipc/client';

export type QueryStatus = 'running' | 'success' | 'error' | 'cancelled';

export type ResultRow = Record<string, unknown>;

const FLUSH_INTERVAL_MS = 33;

const CANCEL_MESSAGE = 'Query cancelled';

export class QueryState {
  columns = $state<ResultColumn[]>([]);
  rows = $state<ResultRow[]>([]);
  status = $state<QueryStatus>('running');
  durationMs = $state<number | null>(null);
  warehouse = $state<string | null>(null);
  error = $state<string | null>(null);
  startedAt = $state<number>(Date.now());
}

class QueriesStore {
  #map = new SvelteMap<QueryId, QueryState>();
  #pending = new Map<QueryId, ResultRow[]>();
  #flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    snowboy.queryEvents.onRowBatch((event) => this.handleBatch(event));
    snowboy.queryEvents.onComplete((event) => this.handleComplete(event));
    snowboy.queryEvents.onError((event) => this.handleError(event));
  }

  get(queryId: QueryId | null): QueryState | null {
    if (queryId === null) return null;
    return this.#map.get(queryId) ?? null;
  }

  register(queryId: QueryId): QueryState {
    return this.ensureState(queryId);
  }

  clear(queryId: QueryId): void {
    this.#map.delete(queryId);
    this.#pending.delete(queryId);
  }

  waitForCompletion(queryId: QueryId): Promise<void> {
    return new Promise((resolve, reject) => {
      const state = this.#map.get(queryId);
      if (state !== undefined) {
        if (state.status === 'success') {
          resolve();
          return;
        }
        if (state.status === 'error' || state.status === 'cancelled') {
          reject(new Error(state.error ?? state.status));
          return;
        }
      }
      const offComplete = snowboy.queryEvents.onComplete((event) => {
        if (event.queryId !== queryId) return;
        offComplete();
        offError();
        resolve();
      });
      const offError = snowboy.queryEvents.onError((event) => {
        if (event.queryId !== queryId) return;
        offComplete();
        offError();
        reject(new Error(event.message));
      });
    });
  }

  private handleBatch(event: QueryRowBatchEvent): void {
    const state = this.ensureState(event.queryId);
    if (state.columns.length === 0 && event.columns.length > 0) {
      state.columns = [...event.columns];
    }
    if (event.rows.length === 0) {
      return;
    }
    const pending = this.#pending.get(event.queryId) ?? [];
    for (const row of event.rows) {
      pending.push(row);
    }
    this.#pending.set(event.queryId, pending);
    this.scheduleFlush();
  }

  private handleComplete(event: QueryCompleteEvent): void {
    this.flushAll();
    const state = this.ensureState(event.queryId);
    state.status = 'success';
    state.durationMs = event.durationMs;
    state.warehouse = event.warehouse ?? null;
  }

  private handleError(event: QueryErrorEvent): void {
    this.flushAll();
    const state = this.ensureState(event.queryId);
    const cancelled = event.message === CANCEL_MESSAGE;
    state.status = cancelled ? 'cancelled' : 'error';
    state.error = event.message;
  }

  private ensureState(queryId: QueryId): QueryState {
    let state = this.#map.get(queryId);
    if (state === undefined) {
      state = new QueryState();
      this.#map.set(queryId, state);
    }
    return state;
  }

  private scheduleFlush(): void {
    if (this.#flushTimer !== null) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.flushAll();
    }, FLUSH_INTERVAL_MS);
  }

  private flushAll(): void {
    if (this.#pending.size === 0) return;
    for (const [qid, buffered] of this.#pending) {
      if (buffered.length === 0) continue;
      const state = this.#map.get(qid);
      if (state === undefined) continue;
      state.rows = state.rows.concat(buffered);
    }
    this.#pending.clear();
  }
}

export const queries = new QueriesStore();
