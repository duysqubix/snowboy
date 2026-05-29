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

export function setupCompletionPrefetch(
  deps: CompletionPrefetchDeps
): CompletionPrefetchController {
  const { cache, fetcher, sessionsStore } = deps;
  const warmedSessions = new Set<SessionId>();
  let activeToken = 0;
  let disposed = false;

  async function warmup(
    sessionId: SessionId,
    profileId: string,
    token: number
  ): Promise<void> {
    await fetcher.ensure(sessionId, profileId, ['databases']);
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
