/**
 * Renderer-side session registry.
 *
 * Bridges the `profiles` store (which knows the active profile) and the
 * main-process session map (T3.2) so consumers like ObjectBrowser can
 * just read `sessions.activeSessionId` and submit IPC calls.
 *
 * One session per profile in v0.1 — every consumer shares the same
 * underlying Snowflake connection. Per-pane sessions are a Wave 4
 * concern (different roles per pane). When the active profile changes,
 * we open a session for the new profile lazily, but DO NOT close the
 * outgoing one — the user might switch back and we want to skip the
 * SSO round-trip. `closeAll()` is exposed for shutdown and manual reset.
 *
 * Errors during `open` are surfaced via `lastError` rather than thrown
 * so callers can read state synchronously. The store retries on the
 * next activeProfileId change.
 */

import type { SessionContext, SessionId } from '../../../main/types';
import { snowboy } from '../ipc/client';
import { profiles } from './profiles.svelte';

interface SessionEntry {
  sessionId: SessionId;
  openedAt: number;
}

type SessionStatus = 'idle' | 'opening' | 'ready' | 'error' | 'needs-mfa';

class SessionsStore {
  #byProfile = $state<Map<string, SessionEntry>>(new Map());
  #status = $state<SessionStatus>('idle');
  #activeProfileId = $state<string | null>(null);
  #lastError = $state<string | null>(null);
  #pendingProfileId: string | null = null;

  get activeSessionId(): SessionId | null {
    if (this.#activeProfileId === null) return null;
    return this.#byProfile.get(this.#activeProfileId)?.sessionId ?? null;
  }

  get status(): SessionStatus {
    return this.#status;
  }

  get lastError(): string | null {
    return this.#lastError;
  }

  /**
   * Called from a Svelte `$effect` that watches `profiles.activeProfileId`.
   * If a session for the new profile already exists, just mark it active.
   * For `password_mfa` profiles without a cached session, status becomes
   * `'needs-mfa'` so a prompt can collect a fresh TOTP code — auto-open
   * with a stale or missing passcode would always fail. All other auth
   * methods auto-open.
   */
  async syncToActiveProfile(profileId: string | null): Promise<void> {
    this.#activeProfileId = profileId;
    if (profileId === null) {
      this.#status = 'idle';
      this.#lastError = null;
      return;
    }
    if (this.#byProfile.has(profileId)) {
      this.#status = 'ready';
      this.#lastError = null;
      return;
    }

    const profile = profiles.list.find((p) => p.id === profileId);
    if (profile && profile.authMethod === 'password_mfa') {
      this.#status = 'needs-mfa';
      this.#lastError = null;
      return;
    }

    if (this.#pendingProfileId === profileId) return;
    this.#pendingProfileId = profileId;
    this.#status = 'opening';
    this.#lastError = null;
    const initialContext: SessionContext = {};
    try {
      const sessionId = await snowboy.sessions.open(profileId, initialContext);
      // Bail if the active profile changed mid-open — keep the freshly
      // opened session in the map (so a switch-back is instant) but
      // don't promote it to active.
      this.#byProfile.set(profileId, { sessionId, openedAt: Date.now() });
      if (this.#activeProfileId === profileId) {
        this.#status = 'ready';
      }
    } catch (err) {
      this.#lastError = err instanceof Error ? err.message : String(err);
      if (this.#activeProfileId === profileId) {
        this.#status = 'error';
      }
    } finally {
      if (this.#pendingProfileId === profileId) {
        this.#pendingProfileId = null;
      }
    }
  }

  /**
   * Discard the cached session for a profile (e.g. on connection error
   * or explicit user action). The next call to `syncToActiveProfile`
   * for the same profile will re-open. Best-effort close — failures are
   * swallowed since the renderer cannot do anything with them.
   */
  /**
   * Open a session for the active profile using a one-shot MFA passcode.
   * Use this when `status === 'needs-mfa'` after the user supplies a TOTP
   * code. Throws on failure so the caller can surface a per-attempt
   * error (wrong/expired code) without polluting `lastError`.
   */
  async openWithPasscode(profileId: string, passcode: string): Promise<void> {
    if (this.#byProfile.has(profileId)) {
      await this.forget(profileId);
    }
    this.#pendingProfileId = profileId;
    this.#status = 'opening';
    this.#lastError = null;
    try {
      const sessionId = await snowboy.sessions.open(profileId, {}, passcode);
      this.#byProfile.set(profileId, { sessionId, openedAt: Date.now() });
      if (this.#activeProfileId === profileId) {
        this.#status = 'ready';
      }
    } catch (err) {
      this.#lastError = err instanceof Error ? err.message : String(err);
      if (this.#activeProfileId === profileId) {
        this.#status = 'needs-mfa';
      }
      throw err;
    } finally {
      if (this.#pendingProfileId === profileId) {
        this.#pendingProfileId = null;
      }
    }
  }

  async forget(profileId: string): Promise<void> {
    const entry = this.#byProfile.get(profileId);
    if (entry === undefined) return;
    this.#byProfile.delete(profileId);
    if (this.#activeProfileId === profileId) {
      this.#status = 'idle';
    }
    try {
      await snowboy.sessions.close(entry.sessionId);
    } catch (err) {
      console.warn('[sessions] close failed for', profileId, err);
    }
  }

  async closeAll(): Promise<void> {
    const entries = Array.from(this.#byProfile.values());
    this.#byProfile.clear();
    this.#status = 'idle';
    await Promise.all(
      entries.map(async (e) => {
        try {
          await snowboy.sessions.close(e.sessionId);
        } catch (err) {
          console.warn('[sessions] close failed:', err);
        }
      })
    );
  }
}

export const sessions = new SessionsStore();

/**
 * Install the `profiles.activeProfileId -> sessions.syncToActiveProfile`
 * bridge as a Svelte `$effect`. Call once from a component (App.svelte).
 * Returns a cleanup function that closes all open sessions, suitable for
 * `onDestroy`.
 */
export function installSessionsBridge(): () => void {
  $effect(() => {
    const id = profiles.activeProfileId;
    void sessions.syncToActiveProfile(id);
  });
  return () => {
    void sessions.closeAll();
  };
}
