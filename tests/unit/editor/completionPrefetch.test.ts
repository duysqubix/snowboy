import { describe, expect, test } from 'bun:test';
import { createCompletionCache } from '../../../src/renderer/lib/editor/completionCache';
import {
  setupCompletionPrefetch,
  type PrefetchSessionsStore
} from '../../../src/renderer/lib/editor/completionPrefetch';
import type { CompletionFetcher } from '../../../src/renderer/lib/editor/completionFetcher';
import type { CompletionCache, CompletionPath } from '../../../src/renderer/lib/editor/completionCache';
import type { SessionId } from '../../../src/main/types';

const SID_A = 'sess-a' as SessionId;
const SID_B = 'sess-b' as SessionId;
const PROFILE_A = 'profile-a';
const PROFILE_B = 'profile-b';
const DBS = ['DB_ONE', 'DB_TWO'];

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface EnsureCall {
  sessionId: SessionId;
  profileId: string;
  path: string[];
}

interface MockFetcher {
  fetcher: CompletionFetcher;
  calls: EnsureCall[];
  release(path: CompletionPath): void;
}

function makeFetcher(cache: CompletionCache): MockFetcher {
  const calls: EnsureCall[] = [];
  const gates = new Map<string, () => void>();
  const fetcher: CompletionFetcher = {
    ensure(sessionId, profileId, path) {
      calls.push({ sessionId, profileId, path: [...path] });
      const d = deferred<void>();
      gates.set(path.join('\u0001'), () => {
        if (path[0] === 'databases') {
          cache.set(profileId, ['databases'], DBS);
        } else if (path[0] === 'schemas') {
          cache.set(profileId, path, ['PUBLIC', 'PRIVATE']);
        }
        d.resolve();
      });
      return d.promise;
    }
  };
  return {
    fetcher,
    calls,
    release(path) {
      const gate = gates.get(path.join('\u0001'));
      if (gate === undefined) throw new Error(`no in-flight fetch for [${path.join(', ')}]`);
      gate();
    }
  };
}

function makeStore(
  sessionId: SessionId | null,
  profileId: string | null
): PrefetchSessionsStore & { set(s: SessionId | null, p: string | null): void } {
  let sid = sessionId;
  let pid = profileId;
  return {
    get activeSessionId() {
      return sid;
    },
    get activeProfileId() {
      return pid;
    },
    set(s, p) {
      sid = s;
      pid = p;
    }
  };
}

function schemaCalls(calls: EnsureCall[]): EnsureCall[] {
  return calls.filter((c) => c.path[0] === 'schemas');
}

function dbCalls(calls: EnsureCall[]): EnsureCall[] {
  return calls.filter((c) => c.path[0] === 'databases');
}

describe('completionPrefetch', () => {
  test('warms databases then schemas-per-database on activation', async () => {
    const cache = createCompletionCache();
    const { fetcher, calls, release } = makeFetcher(cache);
    const store = makeStore(SID_A, PROFILE_A);
    const prefetch = setupCompletionPrefetch({ cache, fetcher, sessionsStore: store });

    prefetch.sync();

    expect(dbCalls(calls)).toHaveLength(1);
    expect(schemaCalls(calls)).toHaveLength(0);

    release(['databases']);
    await flush();

    const schemas = schemaCalls(calls);
    expect(schemas.map((c) => c.path[1]).sort()).toEqual([...DBS].sort());
    expect(schemas.every((c) => c.sessionId === SID_A && c.profileId === PROFILE_A)).toBe(true);
  });

  test('warms a session at most once per activation', async () => {
    const cache = createCompletionCache();
    const { fetcher, calls, release } = makeFetcher(cache);
    const store = makeStore(SID_A, PROFILE_A);
    const prefetch = setupCompletionPrefetch({ cache, fetcher, sessionsStore: store });

    prefetch.sync();
    prefetch.sync();
    release(['databases']);
    await flush();
    prefetch.sync();

    expect(dbCalls(calls)).toHaveLength(1);
  });

  test('does nothing when no session is active', () => {
    const cache = createCompletionCache();
    const { fetcher, calls } = makeFetcher(cache);
    const store = makeStore(null, null);
    const prefetch = setupCompletionPrefetch({ cache, fetcher, sessionsStore: store });

    prefetch.sync();

    expect(calls).toHaveLength(0);
  });

  test('cancels the old session warmup when the active session switches', async () => {
    const cache = createCompletionCache();
    const { fetcher, calls, release } = makeFetcher(cache);
    const store = makeStore(SID_A, PROFILE_A);
    const prefetch = setupCompletionPrefetch({ cache, fetcher, sessionsStore: store });

    prefetch.sync();
    store.set(SID_B, PROFILE_B);
    prefetch.sync();

    release(['databases']);
    await flush();

    expect(schemaCalls(calls).some((c) => c.sessionId === SID_A)).toBe(false);

    release(['databases']);
    await flush();

    const bSchemas = schemaCalls(calls).filter((c) => c.sessionId === SID_B);
    expect(bSchemas.map((c) => c.path[1]).sort()).toEqual([...DBS].sort());
    expect(bSchemas.every((c) => c.profileId === PROFILE_B)).toBe(true);
  });

  test('dispose stops an in-flight warmup before schemas fire', async () => {
    const cache = createCompletionCache();
    const { fetcher, calls, release } = makeFetcher(cache);
    const store = makeStore(SID_A, PROFILE_A);
    const prefetch = setupCompletionPrefetch({ cache, fetcher, sessionsStore: store });

    prefetch.sync();
    prefetch.dispose();
    release(['databases']);
    await flush();

    expect(schemaCalls(calls)).toHaveLength(0);
  });
});
