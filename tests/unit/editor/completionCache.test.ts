import { describe, expect, test } from 'bun:test';
import { createCompletionCache } from '../../../src/renderer/lib/editor/completionCache';

describe('completionCache', () => {
  test('empty cache returns null on get', () => {
    const cache = createCompletionCache();
    expect(cache.get('profile-1', ['databases'])).toBe(null);
  });

  test('after set, get returns the items for the same profile + path', () => {
    const cache = createCompletionCache();
    cache.set('profile-1', ['databases'], ['CALIBER_DWH', 'SNOWFLAKE']);
    expect(cache.get('profile-1', ['databases'])).toEqual(['CALIBER_DWH', 'SNOWFLAKE']);
  });

  test('items written to one profile are NOT visible from another profile', () => {
    const cache = createCompletionCache();
    cache.set('profile-1', ['databases'], ['ONLY_FOR_ONE']);
    expect(cache.get('profile-2', ['databases'])).toBe(null);
  });

  test('invalidate(profileId) wipes all entries for that profile, leaves other profiles intact', () => {
    const cache = createCompletionCache();
    cache.set('profile-1', ['databases'], ['DB_A']);
    cache.set('profile-1', ['schemas', 'DB_A'], ['PUBLIC']);
    cache.set('profile-2', ['databases'], ['DB_B']);
    cache.invalidate('profile-1');
    expect(cache.get('profile-1', ['databases'])).toBe(null);
    expect(cache.get('profile-1', ['schemas', 'DB_A'])).toBe(null);
    expect(cache.get('profile-2', ['databases'])).toEqual(['DB_B']);
  });

  test('invalidate(profileId, partialPath) wipes entries whose path starts with partialPath, leaves siblings intact', () => {
    const cache = createCompletionCache();
    cache.set('p', ['databases'], ['DB_A']);
    cache.set('p', ['schemas', 'DB_A'], ['PUBLIC', 'PRIVATE']);
    cache.set('p', ['schemas', 'DB_A', 'extra'], ['nested']);
    cache.set('p', ['schemas', 'DB_B'], ['ANALYTICS']);
    cache.invalidate('p', ['schemas', 'DB_A']);
    expect(cache.get('p', ['schemas', 'DB_A'])).toBe(null);
    expect(cache.get('p', ['schemas', 'DB_A', 'extra'])).toBe(null);
    expect(cache.get('p', ['databases'])).toEqual(['DB_A']);
    expect(cache.get('p', ['schemas', 'DB_B'])).toEqual(['ANALYTICS']);
  });

  test('onChange handler fires when set writes a new entry', () => {
    const cache = createCompletionCache();
    const notifications: { profileId: string; path: readonly string[] }[] = [];
    cache.onChange((profileId, path) => notifications.push({ profileId, path }));
    cache.set('p', ['databases'], ['X']);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.profileId).toBe('p');
    expect(notifications[0]!.path).toEqual(['databases']);
  });

  test('onChange handler fires for each path cleared by invalidate', () => {
    const cache = createCompletionCache();
    cache.set('p', ['databases'], ['X']);
    cache.set('p', ['schemas', 'X'], ['Y']);
    const cleared: string[][] = [];
    cache.onChange((_pid, path) => cleared.push([...path]));
    cache.invalidate('p');
    expect(cleared).toHaveLength(2);
  });

  test('onChange deregister stops further notifications', () => {
    const cache = createCompletionCache();
    let count = 0;
    const off = cache.onChange(() => (count += 1));
    cache.set('p', ['databases'], ['X']);
    off();
    cache.set('p', ['databases'], ['Y']);
    expect(count).toBe(1);
  });
});
