/**
 * Theme bridge between Electron's `nativeTheme`, the persisted settings, and
 * every renderer window. Effective theme is derived (`light`/`dark`) from the
 * stored `ThemeMode` (`light`/`dark`/`system`) plus, when mode is `system`,
 * `nativeTheme.shouldUseDarkColors`.
 *
 * Three surfaces:
 *
 * - `theme.get` (invoke): returns the current effective theme. Renderer
 *   stores call this on hydration to seed initial state.
 * - `theme.boot` (sendSync): synchronous lookup used by the preload script
 *   to compute the boot-time `documentElement.classList` BEFORE first paint.
 *   Sync IPC is normally an anti-pattern but the boot-time FOUC fix requires
 *   sub-paint latency, and the call happens once per preload execution.
 * - `themeEvents.changed` (broadcast): fan-out on every effective-theme
 *   change. Triggered by `nativeTheme.on('updated')` AND by
 *   `settingsEvents.changed` (user toggled theme mode in settings).
 *
 * The `nativeTheme.on('updated')` listener is installed inside `register()`,
 * not at module import time, so it runs after `app.whenReady()`. Wiring it
 * earlier produces unreliable callbacks per Electron's docs.
 */

import { createRequire } from 'node:module';
import type { BrowserWindow, IpcMain, IpcMainEvent, NativeTheme } from 'electron';

import type { EffectiveTheme, Settings, ThemeChangedEvent, ThemeMode } from '../types';
import { readSettings } from '../storage/settings';
import { settingsEvents } from '../storage/settingsEvents';
import { CHANNELS } from './channels';

const nodeRequire = createRequire(import.meta.url);

function effectiveFromMode(mode: ThemeMode, native: NativeThemeLike): EffectiveTheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return native.shouldUseDarkColors ? 'dark' : 'light';
}

function currentChangedEvent(native: NativeThemeLike): ThemeChangedEvent {
  const mode = readSettings().theme;
  return { mode, effective: effectiveFromMode(mode, native) };
}

function defaultBroadcaster(payload: ThemeChangedEvent): void {
  try {
    type ElectronModule = { BrowserWindow?: typeof BrowserWindow };
    const mod = nodeRequire('electron') as ElectronModule;
    if (mod?.BrowserWindow === undefined) return;
    for (const win of mod.BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(CHANNELS.themeEvents.changed, payload);
    }
  } catch (err) {
    console.warn(`[theme] broadcast failed: ${(err as Error).message}`);
  }
}

type ThemeBroadcaster = (payload: ThemeChangedEvent) => void;
type NativeThemeLike = Pick<NativeTheme, 'shouldUseDarkColors' | 'on' | 'off'>;

let broadcaster: ThemeBroadcaster = defaultBroadcaster;
let nativeThemeImpl: NativeThemeLike | null = null;

function loadNativeTheme(): NativeThemeLike {
  if (nativeThemeImpl !== null) return nativeThemeImpl;
  type ElectronModule = { nativeTheme?: NativeThemeLike };
  const mod = nodeRequire('electron') as ElectronModule;
  if (!mod?.nativeTheme) {
    throw new Error('[theme] electron.nativeTheme is unavailable');
  }
  return mod.nativeTheme;
}

export function __setBroadcasterForTesting(fn: ThemeBroadcaster | null): void {
  broadcaster = fn ?? defaultBroadcaster;
}

export function __setNativeThemeForTesting(impl: NativeThemeLike | null): void {
  nativeThemeImpl = impl;
}

export function register(ipcMain: IpcMain): void {
  const native = loadNativeTheme();

  ipcMain.handle(CHANNELS.theme.get, (): EffectiveTheme => {
    return effectiveFromMode(readSettings().theme, native);
  });

  ipcMain.on('theme.boot', (event: IpcMainEvent) => {
    try {
      event.returnValue = native.shouldUseDarkColors ? 'dark' : 'light';
    } catch (err) {
      console.error(
        `[theme] boot read threw: ${(err as Error).message}; defaulting to light`
      );
      event.returnValue = 'light';
    }
  });

  let lastBroadcast: ThemeChangedEvent | null = null;
  const broadcastIfChanged = (next: ThemeChangedEvent): void => {
    if (
      lastBroadcast !== null &&
      lastBroadcast.effective === next.effective &&
      lastBroadcast.mode === next.mode
    ) {
      return;
    }
    lastBroadcast = next;
    broadcaster(next);
  };

  lastBroadcast = currentChangedEvent(native);

  native.on('updated', () => {
    broadcastIfChanged(currentChangedEvent(native));
  });

  settingsEvents.on('changed', (next: Settings) => {
    broadcastIfChanged({
      mode: next.theme,
      effective: effectiveFromMode(next.theme, native)
    });
  });
}
