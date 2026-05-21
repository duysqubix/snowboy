/**
 * Main-process event bus for settings mutations. `ipc/settings.ts` emits
 * `changed` after a successful `writeSettings(...)`; consumers (theme.ts,
 * future watchers) subscribe here instead of monkey-patching the broadcaster.
 */
import { EventEmitter } from 'node:events';
import type { Settings } from '../types';

export interface SettingsEventMap {
  changed: [Settings];
}

class TypedSettingsEmitter extends EventEmitter {
  override emit<E extends keyof SettingsEventMap>(
    event: E,
    ...args: SettingsEventMap[E]
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<E extends keyof SettingsEventMap>(
    event: E,
    listener: (...args: SettingsEventMap[E]) => void
  ): this {
    return super.on(event, listener);
  }

  override off<E extends keyof SettingsEventMap>(
    event: E,
    listener: (...args: SettingsEventMap[E]) => void
  ): this {
    return super.off(event, listener);
  }
}

export const settingsEvents = new TypedSettingsEmitter();
