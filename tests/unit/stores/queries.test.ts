import { describe, expect, test } from 'bun:test';
import type {
  QueryCompleteEvent,
  QueryErrorEvent,
  QueryId,
  QueryRowBatchEvent,
  ResultColumn
} from '../../../src/main/types';
import {
  QueriesStore,
  type QueryEventSource
} from '../../../src/renderer/lib/stores/queries.svelte';

// The store coalesces row batches on a ~30 fps timer (33 ms).
const FLUSH_WAIT_MS = 60;

const COLUMNS: ResultColumn[] = [{ name: 'N', dataType: 'fixed', nullable: false }];

interface FakeQueryEvents extends QueryEventSource {
  batch(queryId: QueryId, rows: Record<string, unknown>[]): void;
  complete(queryId: QueryId): void;
  error(queryId: QueryId, message: string): void;
}

function createFakeEvents(): FakeQueryEvents {
  const batchHandlers = new Set<(event: QueryRowBatchEvent) => void>();
  const completeHandlers = new Set<(event: QueryCompleteEvent) => void>();
  const errorHandlers = new Set<(event: QueryErrorEvent) => void>();

  function subscribe<E>(handlers: Set<(event: E) => void>) {
    return (handler: (event: E) => void): (() => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    };
  }

  function emit<E>(handlers: Set<(event: E) => void>, event: E): void {
    for (const handler of [...handlers]) handler(event);
  }

  return {
    onRowBatch: subscribe(batchHandlers),
    onComplete: subscribe(completeHandlers),
    onError: subscribe(errorHandlers),
    batch: (queryId, rows) => emit(batchHandlers, { queryId, rows, columns: COLUMNS }),
    complete: (queryId) => emit(completeHandlers, { queryId, totalRows: 0, durationMs: 5 }),
    error: (queryId, message) => emit(errorHandlers, { queryId, message })
  };
}

function qid(value: string): QueryId {
  return value as QueryId;
}

function waitForFlush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));
}

describe('QueriesStore', () => {
  test('events that arrive before register() still create the query state', () => {
    const events = createFakeEvents();
    const store = new QueriesStore(events);

    events.error(qid('q1'), 'syntax error');

    const state = store.get(qid('q1'));
    expect(state?.status).toBe('error');
    expect(store.register(qid('q1'))).toBe(state!);
  });

  test('clear() releases a completed query and its rows', () => {
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    store.register(qid('q1'));
    events.batch(qid('q1'), [{ N: 1 }, { N: 2 }]);
    events.complete(qid('q1'));
    expect(store.get(qid('q1'))?.rows).toHaveLength(2);

    store.clear(qid('q1'));

    expect(store.get(qid('q1'))).toBeNull();
  });

  test('a late row batch for a cleared query does not recreate its state', async () => {
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    store.register(qid('q1'));
    store.clear(qid('q1'));

    events.batch(qid('q1'), [{ N: 1 }]);
    await waitForFlush();

    expect(store.get(qid('q1'))).toBeNull();
  });

  test('a late complete for a cleared query does not recreate its state', () => {
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    store.register(qid('q1'));
    store.clear(qid('q1'));

    events.complete(qid('q1'));

    expect(store.get(qid('q1'))).toBeNull();
  });

  test('a late error after the terminal event of a cleared query is dropped', () => {
    // A failed server-side cancel reports an error after the stream has
    // already ended with "Query cancelled".
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    store.register(qid('q1'));
    events.error(qid('q1'), 'Query cancelled');
    store.clear(qid('q1'));

    events.error(qid('q1'), 'cancel request failed');

    expect(store.get(qid('q1'))).toBeNull();
  });

  test('rows buffered before clear() are never flushed', async () => {
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    store.register(qid('q1'));
    events.batch(qid('q1'), [{ N: 1 }]);

    store.clear(qid('q1'));
    await waitForFlush();

    expect(store.get(qid('q1'))).toBeNull();
  });

  test('clearing one query leaves other queries streaming', async () => {
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    store.register(qid('old'));
    store.register(qid('new'));
    store.clear(qid('old'));

    events.batch(qid('new'), [{ N: 1 }]);
    await waitForFlush();

    expect(store.get(qid('new'))?.rows).toEqual([{ N: 1 }]);
  });

  test('register() after clear() tracks the id again', () => {
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    store.register(qid('q1'));
    store.clear(qid('q1'));

    store.register(qid('q1'));
    events.complete(qid('q1'));

    expect(store.get(qid('q1'))?.status).toBe('success');
  });

  test('waitForCompletion resolves when the query completes', async () => {
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    store.register(qid('q1'));
    const done = store.waitForCompletion(qid('q1'));

    events.complete(qid('q1'));

    await expect(done).resolves.toBeUndefined();
  });

  test('waitForCompletion rejects with the error message', async () => {
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    store.register(qid('q1'));
    const done = store.waitForCompletion(qid('q1'));

    events.error(qid('q1'), 'syntax error');

    await expect(done).rejects.toThrow('syntax error');
  });

  test('waitForCompletion settles at once when the terminal event came first', async () => {
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    events.complete(qid('q1'));
    store.register(qid('q1'));

    await expect(store.waitForCompletion(qid('q1'))).resolves.toBeUndefined();
  });

  test('waitForCompletion still settles after the query is cleared', async () => {
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    store.register(qid('q1'));
    const done = store.waitForCompletion(qid('q1'));
    store.clear(qid('q1'));

    events.complete(qid('q1'));

    await expect(done).resolves.toBeUndefined();
  });

  test('a flush assigns a new rows array instead of mutating the old one', async () => {
    // `rows` is `$state.raw`: an in-place push would not re-render, so every
    // append must assign a new array.
    const events = createFakeEvents();
    const store = new QueriesStore(events);
    const state = store.register(qid('q1'));
    events.batch(qid('q1'), [{ N: 1 }]);
    await waitForFlush();
    const firstRows = state.rows;

    events.batch(qid('q1'), [{ N: 2 }]);
    events.complete(qid('q1'));

    expect(state.rows).not.toBe(firstRows);
    expect(firstRows).toEqual([{ N: 1 }]);
    expect(state.rows).toEqual([{ N: 1 }, { N: 2 }]);
  });
});
