import type { CompletionCache } from './completionCache';
import type { CompletionFetcher } from './completionFetcher';
import type { SessionId } from '../../../main/types';

// Declared as an interface (not the concrete SessionsStore) so this module
// stays free of Svelte runes and is unit-testable under `bun test`, where
// runes are stubbed to no-ops. App.svelte drives sync() from an $effect.
export interface PrefetchSessionsStore {
  readonly activeSessionId: SessionId | null;
  readonly activeProfileId: string | null;
}

export interface CompletionPrefetchDeps {
  cache: CompletionCache;
  fetcher: CompletionFetcher;
  sessionsStore: PrefetchSessionsStore;
}

export interface CompletionPrefetchController {
  sync(): void;
  dispose(): void;
}

export interface SharedSchemaCatalog {
  ensureDatabases(sessionId: SessionId, profileId: string): Promise<string[]>;
}

function keyOf(sessionId: SessionId, profileId: string): string {
  return `${sessionId}\u0000${profileId}`;
}

export function createSharedSchemaCatalog(
  cache: CompletionCache,
  fetcher: CompletionFetcher
): SharedSchemaCatalog {
  const inFlightDatabases = new Map<string, Promise<string[]>>();

  return {
    ensureDatabases(sessionId, profileId) {
      const cached = cache.get(profileId, ['databases']);
      if (cached !== null) return Promise.resolve(cached);

      const key = keyOf(sessionId, profileId);
      const pending = inFlightDatabases.get(key);
      if (pending) return pending;

      const promise = fetcher.ensure(sessionId, profileId, ['databases']).then(() => {
        return cache.get(profileId, ['databases']) ?? [];
      });
      inFlightDatabases.set(key, promise);
      promise.finally(() => inFlightDatabases.delete(key));
      return promise;
    }
  };
}

export function setupCompletionPrefetch(
  deps: CompletionPrefetchDeps
): CompletionPrefetchController {
  const { cache, fetcher, sessionsStore } = deps;
  const catalog = createSharedSchemaCatalog(cache, fetcher);
  const warmedSessions = new Set<SessionId>();
  let activeToken = 0;
  let disposed = false;

  async function warmup(
    sessionId: SessionId,
    profileId: string,
    token: number
  ): Promise<void> {
    await catalog.ensureDatabases(sessionId, profileId);
    // Stale token => session switched/closed mid-fetch: stop before schemas.
    if (disposed || token !== activeToken) return;

    const databases = cache.get(profileId, ['databases']) ?? [];
    await Promise.all(
      databases.map((db) => fetcher.ensure(sessionId, profileId, ['schemas', db]))
    );
  }

  return {
    sync(): void {
      if (disposed) return;
      const sessionId = sessionsStore.activeSessionId;
      const profileId = sessionsStore.activeProfileId;
      if (sessionId === null || profileId === null) {
        // Deactivated: invalidate any warmup still in flight for the
        // outgoing session so it stops before fetching schemas.
        activeToken++;
        return;
      }
      if (warmedSessions.has(sessionId)) return; // once per activation.
      warmedSessions.add(sessionId);
      const token = ++activeToken;
      void warmup(sessionId, profileId, token);
    },
    dispose(): void {
      disposed = true;
      activeToken++;
      warmedSessions.clear();
    }
  };
}
