/**
 * IPC handlers for the settings store. Three surfaces:
 *
 * - `settings.get` (invoke): async fetch of the merged + clamped
 *   settings. Renderer stores call this once at hydration.
 * - `settings.set` (invoke): merge a `Partial<Settings>` into the
 *   on-disk JSON, then broadcast the full new payload to every
 *   renderer via `settingsEvents.changed`.
 * - `settings.boot` (sendSync): synchronous lookup used by the
 *   preload script to seed `window.snowboySettingsBoot` before the
 *   renderer hydrates. Sync IPC is normally an anti-pattern, but
 *   the boot-time theme decision requires sub-paint latency and
 *   the call only fires once per `BrowserWindow.loadURL`.
 */

import { createRequire } from 'node:module';
import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron';

import type { Settings } from '../types';
import { readSettings, writeSettings } from '../storage/settings';
import { settingsEvents } from '../storage/settingsEvents';
import { CHANNELS } from './channels';

const nodeRequire = createRequire(import.meta.url);

function defaultBroadcaster(payload: Settings): void {
  try {
    type ElectronModule = { BrowserWindow?: typeof BrowserWindow };
    const mod = nodeRequire('electron') as ElectronModule;
    if (mod?.BrowserWindow === undefined) return;
    for (const win of mod.BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(CHANNELS.settingsEvents.changed, payload);
    }
  } catch (err) {
    console.warn(`[settings] broadcast failed: ${(err as Error).message}`);
  }
}

type SettingsBroadcaster = (payload: Settings) => void;

let broadcaster: SettingsBroadcaster = defaultBroadcaster;

/**
 * Test-only: swap the broadcaster so tests can assert on
 * `settings.changed` payloads without spinning up real
 * `BrowserWindow` instances.
 */
export function __setBroadcasterForTesting(
  fn: SettingsBroadcaster | null
): void {
  broadcaster = fn ?? defaultBroadcaster;
}

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.settings.get, (): Settings => readSettings());

  ipcMain.handle(
    CHANNELS.settings.set,
    (_e, partial: Partial<Settings>): Settings => {
      const merged = writeSettings(partial);
      settingsEvents.emit('changed', merged);
      broadcaster(merged);
      return merged;
    }
  );

  ipcMain.on(CHANNELS.settings.boot, (event: IpcMainEvent) => {
    try {
      event.returnValue = readSettings();
    } catch (err) {
      console.error(
        `[settings] boot read threw: ${(err as Error).message}; returning defaults`
      );
      event.returnValue = readSettings();
    }
  });
}
