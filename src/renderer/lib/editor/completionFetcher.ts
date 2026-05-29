import type { CompletionCache, CompletionPath } from './completionCache';
import type { SnowboyApi, SessionId } from '../../../main/types';

export interface CompletionFetcher {
  ensure(sessionId: SessionId, profileId: string, path: CompletionPath): Promise<void>;
}

type SchemaApi = Pick<SnowboyApi, 'schema'>;

function planFetch(path: CompletionPath): (api: SchemaApi, sessionId: SessionId) => Promise<string[]> {
  if (path.length === 1 && path[0] === 'databases') {
    return (api, sid) => api.schema.listDatabases(sid);
  }
  if (path.length === 2 && path[0] === 'schemas') {
    const db = path[1]!;
    return (api, sid) => api.schema.listSchemas(sid, db);
  }
  if (path.length === 3 && path[0] === 'tables') {
    const db = path[1]!;
    const schema = path[2]!;
    return async (api, sid) => {
      const objects = await api.schema.listObjects(sid, db, schema);
      return objects.filter((o) => o.kind === 'table').map((o) => o.name);
    };
  }
  if (path.length === 4 && path[0] === 'columns') {
    const db = path[1]!;
    const schema = path[2]!;
    const table = path[3]!;
    return async (api, sid) => {
      const columns = await api.schema.getColumns(sid, {
        database: db,
        schema,
        name: table,
        kind: 'table'
      });
      return columns.map((c) => c.name);
    };
  }
  throw new Error(`[completionFetcher] unknown completion path shape: [${path.join(', ')}]`);
}

function keyOf(profileId: string, path: CompletionPath): string {
  return `${profileId}\u0000${path.join('\u0001')}`;
}

export function createCompletionFetcher(
  cache: CompletionCache,
  snowboyApi: SchemaApi
): CompletionFetcher {
  const inFlight = new Map<string, Promise<void>>();

  return {
    ensure(sessionId, profileId, path) {
      const fetch = planFetch(path);
      if (cache.get(profileId, path) !== null) {
        return Promise.resolve();
      }

      const key = keyOf(profileId, path);
      const pending = inFlight.get(key);
      if (pending) {
        return pending;
      }

      const promise = (async () => {
        try {
          const items = await fetch(snowboyApi, sessionId);
          cache.set(profileId, path, items);
        } catch (err) {
          console.warn('[completionFetcher] fetch failed for', path, err);
          cache.set(profileId, path, []);
        } finally {
          inFlight.delete(key);
        }
      })();

      inFlight.set(key, promise);
      return promise;
    }
  };
}
