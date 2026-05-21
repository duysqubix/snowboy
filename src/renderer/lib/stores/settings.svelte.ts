/**
 * Reactive settings store.
 *
 * Seed: pulled synchronously from `window.snowboySettingsBoot`, which
 * the preload script populates before renderer hydration. This means
 * `settings.current` is valid on the very first render — there is no
 * "loading" state to model in the UI.
 *
 * Writes: `set(partial)` updates `current` optimistically, then fires
 * `snowboy.settings.set`. The IPC handler also broadcasts the merged
 * payload via `onChanged`, so we re-apply it on receipt to converge
 * with any clamping the storage layer performed (e.g. user passed
 * `fontSize: 200` → main clamps to 24 → broadcast → store reads 24).
 *
 * Coherence: `onChanged` subscription stays live for the process
 * lifetime so writes from other windows (e.g. a settings dialog in
 * a second BrowserWindow) propagate without polling.
 */

import type { Settings } from '../../../main/types';
import { snowboy } from '../ipc/client';

function readBoot(): Settings {
  const boot = (window as unknown as { snowboySettingsBoot?: Settings })
    .snowboySettingsBoot;
  if (boot && typeof boot === 'object') {
    return boot;
  }
  return {
    theme: 'system',
    fontSize: 14,
    tabWidth: 2,
    wordWrap: true,
    telemetryEnabled: false,
    dataDir: ''
  };
}

class SettingsStore {
  #current = $state<Settings>(readBoot());

  constructor() {
    snowboy.settings.onChanged((payload) => {
      this.#current = payload;
    });
  }

  get current(): Settings {
    return this.#current;
  }

  async set(partial: Partial<Settings>): Promise<Settings> {
    const optimistic: Settings = { ...this.#current, ...partial };
    this.#current = optimistic;
    const merged = await snowboy.settings.set(partial);
    this.#current = merged;
    return merged;
  }
}

export const settings = new SettingsStore();
