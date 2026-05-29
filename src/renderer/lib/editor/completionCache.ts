export type CompletionPath = readonly string[];

export type CompletionCacheListener = (
  profileId: string,
  path: CompletionPath
) => void;

export interface CompletionCache {
  get(profileId: string, path: CompletionPath): string[] | null;
  set(profileId: string, path: CompletionPath, items: string[]): void;
  invalidate(profileId: string, partialPath?: CompletionPath): void;
  onChange(listener: CompletionCacheListener): () => void;
}

interface Entry {
  profileId: string;
  path: CompletionPath;
  items: string[];
}

function keyOf(profileId: string, path: CompletionPath): string {
  return `${profileId}\u0000${path.join('\u0001')}`;
}

function pathStartsWith(path: CompletionPath, prefix: CompletionPath): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

export function createCompletionCache(): CompletionCache {
  const store = new Map<string, Entry>();
  const listeners = new Set<CompletionCacheListener>();

  const notify = (profileId: string, path: CompletionPath): void => {
    for (const listener of listeners) {
      try {
        listener(profileId, path);
      } catch (err) {
        console.error('[completionCache] listener threw', err);
      }
    }
  };

  return {
    get(profileId, path) {
      return store.get(keyOf(profileId, path))?.items ?? null;
    },
    set(profileId, path, items) {
      store.set(keyOf(profileId, path), { profileId, path, items });
      notify(profileId, path);
    },
    invalidate(profileId, partialPath) {
      const toDrop: Entry[] = [];
      for (const entry of store.values()) {
        if (entry.profileId !== profileId) continue;
        if (partialPath === undefined || pathStartsWith(entry.path, partialPath)) {
          toDrop.push(entry);
        }
      }
      for (const entry of toDrop) {
        store.delete(keyOf(entry.profileId, entry.path));
        notify(entry.profileId, entry.path);
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
