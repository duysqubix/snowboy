import { snowboy } from '../ipc/client';
import { createCompletionFetcher } from './completionFetcher';
import { completionCache } from './completionCacheSingleton';
import { createSharedSchemaCatalog } from './completionPrefetch';

export const schemaFetcher = createCompletionFetcher(completionCache, snowboy);
export const sharedSchemaCatalog = createSharedSchemaCatalog(completionCache, schemaFetcher);
