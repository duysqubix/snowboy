/**
 * Reactive effective-theme store. Seeded synchronously from the
 * `<html class="dark">` class that the preload's FOUC IIFE has already
 * written before this module loads. From then on, the main process drives
 * changes via `snowboy.theme.onChanged` (OS dark-mode flips when in `system`
 * mode, plus settings.theme mutations).
 *
 * The store keeps the DOM `classList` in sync with `effective` so anything
 * downstream — Tailwind `dark:` variants, CodeMirror's theme compartment
 * (T4.4b) — can subscribe via `theme.effective` without touching the DOM
 * directly.
 *
 * `ThemeStore` is exported (in addition to the `theme` singleton) so tests
 * can construct fresh instances with an injected change source.
 */
import type { EffectiveTheme, ThemeChangedEvent } from '../../../main/types';
import { snowboy } from '../ipc/client';

export interface ThemeChangeSource {
  onChanged(handler: (event: ThemeChangedEvent) => void): () => void;
}

function readBootEffective(): EffectiveTheme {
  if (typeof document === 'undefined') return 'light';
  const html = document.documentElement;
  if (!html?.classList) return 'light';
  return html.classList.contains('dark') ? 'dark' : 'light';
}

function applyEffective(next: EffectiveTheme): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (!html?.classList) return;
  html.classList.toggle('dark', next === 'dark');
}

function defaultSource(): ThemeChangeSource | null {
  const api = snowboy as { theme?: ThemeChangeSource } | undefined;
  return api?.theme ?? null;
}

export class ThemeStore {
  #effective = $state<EffectiveTheme>(readBootEffective());
  #unsubscribe: (() => void) | null = null;

  constructor(source: ThemeChangeSource | null = defaultSource()) {
    if (source) {
      this.#unsubscribe = source.onChanged((evt: ThemeChangedEvent) => {
        this.set(evt.effective);
      });
    }
  }

  get effective(): EffectiveTheme {
    return this.#effective;
  }

  set(next: EffectiveTheme): void {
    if (this.#effective === next) return;
    this.#effective = next;
    applyEffective(next);
  }

  destroy(): void {
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
  }
}

export const theme: ThemeStore = new ThemeStore();
