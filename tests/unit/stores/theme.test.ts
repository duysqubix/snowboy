import { describe, test, expect } from 'bun:test';
import type { ThemeChangedEvent } from '../../../src/main/types';
import {
  ThemeStore,
  type ThemeChangeSource
} from '../../../src/renderer/lib/stores/theme.svelte';

interface ClassListMock {
  contains(cls: string): boolean;
  toggle(cls: string, force?: boolean): boolean;
  add(cls: string): void;
  remove(cls: string): void;
}

function installClassListMock(initialHasDark: boolean): Set<string> {
  const classes = new Set<string>();
  if (initialHasDark) classes.add('dark');
  const mock: ClassListMock = {
    contains: (c) => classes.has(c),
    toggle: (c, force) => {
      const present = classes.has(c);
      const shouldHave = force === undefined ? !present : force;
      if (shouldHave) {
        classes.add(c);
        return true;
      }
      classes.delete(c);
      return false;
    },
    add: (c) => {
      classes.add(c);
    },
    remove: (c) => {
      classes.delete(c);
    }
  };
  type DocLike = { documentElement: { classList?: ClassListMock } };
  const doc = (globalThis as unknown as { document: DocLike }).document;
  doc.documentElement.classList = mock;
  return classes;
}

interface FakeSource extends ThemeChangeSource {
  emit(evt: ThemeChangedEvent): void;
  handlerCount(): number;
}

function createFakeSource(): FakeSource {
  const handlers = new Set<(evt: ThemeChangedEvent) => void>();
  return {
    onChanged: (h) => {
      handlers.add(h);
      return () => {
        handlers.delete(h);
      };
    },
    emit: (evt) => {
      for (const h of handlers) h(evt);
    },
    handlerCount: () => handlers.size
  };
}

describe('ThemeStore', () => {
  test('seeds effective to "light" when documentElement has no .dark class', () => {
    installClassListMock(false);
    const store = new ThemeStore(null);
    expect(store.effective).toBe('light');
  });

  test('seeds effective to "dark" when documentElement has .dark class', () => {
    installClassListMock(true);
    const store = new ThemeStore(null);
    expect(store.effective).toBe('dark');
  });

  test('onChanged event updates effective and toggles classList', () => {
    const classes = installClassListMock(false);
    const source = createFakeSource();
    const store = new ThemeStore(source);

    expect(store.effective).toBe('light');
    expect(classes.has('dark')).toBe(false);

    source.emit({ mode: 'dark', effective: 'dark' });
    expect(store.effective).toBe('dark');
    expect(classes.has('dark')).toBe(true);

    source.emit({ mode: 'light', effective: 'light' });
    expect(store.effective).toBe('light');
    expect(classes.has('dark')).toBe(false);
  });

  test('repeated identical events are no-ops', () => {
    const classes = installClassListMock(false);
    const source = createFakeSource();
    const store = new ThemeStore(source);

    source.emit({ mode: 'dark', effective: 'dark' });
    expect(store.effective).toBe('dark');
    expect(classes.has('dark')).toBe(true);

    source.emit({ mode: 'dark', effective: 'dark' });
    expect(store.effective).toBe('dark');
    expect(classes.has('dark')).toBe(true);
  });

  test('subscribes to source on construct and unsubscribes on destroy', () => {
    installClassListMock(false);
    const source = createFakeSource();
    expect(source.handlerCount()).toBe(0);

    const store = new ThemeStore(source);
    expect(source.handlerCount()).toBe(1);

    store.destroy();
    expect(source.handlerCount()).toBe(0);
  });

  test('null source skips subscription without crashing', () => {
    installClassListMock(true);
    const store = new ThemeStore(null);
    expect(store.effective).toBe('dark');
    store.destroy();
    expect(store.effective).toBe('dark');
  });

  test('set() ignores no-op transitions', () => {
    const classes = installClassListMock(true);
    const store = new ThemeStore(null);
    expect(store.effective).toBe('dark');

    store.set('dark');
    expect(store.effective).toBe('dark');
    expect(classes.has('dark')).toBe(true);

    store.set('light');
    expect(store.effective).toBe('light');
    expect(classes.has('dark')).toBe(false);
  });
});
