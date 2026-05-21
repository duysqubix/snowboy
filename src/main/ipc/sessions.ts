/**
 * T3.2 — sessions.* IPC handlers.
 *
 * Owns a process-local registry mapping `SessionId` → live `Session` so
 * the renderer can address its panes' Snowflake connections through an
 * opaque string handle. The renderer never sees a Session object; it
 * passes the id back on every subsequent call (`query.run`, `schema.*`,
 * `sessions.setContext`, `sessions.close`).
 *
 * `open(profileId, context)` reads the profile row, materializes the
 * `ConnectionProfileLite` shape the driver expects, fetches a password
 * from `safeStorage` when the auth method requires one, calls
 * `Session.open(lite, context, options)`, and registers the result.
 *
 * `close(sessionId)` is idempotent — a stale id (already closed, or
 * never registered) is a no-op rather than an error. The renderer
 * does best-effort cleanup on tab/pane disposal and we'd rather swallow
 * a duplicate close than surface a confusing "session not found" toast.
 *
 * `setContext(sessionId, partial)` forwards to `Session.setContext`,
 * which internally issues the matching `USE ROLE / WAREHOUSE / DATABASE
 * / SCHEMA` statements. A missing id throws — that signals a caller
 * bug, not a recoverable user action.
 *
 * On `before-quit` we call `closeAllSessions()` so the Snowflake side
 * sees a clean disconnect instead of waiting for the connection idle
 * timeout. Errors during shutdown close are logged and swallowed; the
 * app is exiting either way.
 */

import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import { notImplemented } from './errors';
import { getProfile as storageGetProfile } from '../storage/profiles';
import { getSecret } from '../secrets/safeStorage';
import { Session, type OpenSessionOptions } from '../snowflake/session';
import type {
  ConnectionProfileLite,
  SessionContext as DriverSessionContext,
  SessionId as DriverSessionId
} from '../snowflake/types';
import type { SessionContext, SessionId } from '../types';

/**
 * Session factory shape — matches `Session.open`. The indirection
 * mirrors T3.1's pattern so unit tests can swap in a stub that never
 * touches snowflake-sdk; in production this resolves to
 * `Session.open.bind(Session)`.
 */
export type SessionFactory = (
  profile: ConnectionProfileLite,
  context: DriverSessionContext,
  options: OpenSessionOptions
) => Promise<Session>;

let sessionFactoryOverride: SessionFactory | null = null;

/**
 * Test-only: install a fake `Session.open`. Pass `null` to revert to the
 * real driver. Named with `__` so it cannot be mistaken for runtime API.
 */
export function __setSessionFactoryForTesting(factory: SessionFactory | null): void {
  sessionFactoryOverride = factory;
}

/**
 * Test-only: drop every entry from the live registry without calling
 * `Session.close()`. Tests use this in `afterEach` to avoid leaking
 * fake sessions between cases.
 */
export function __clearSessionsForTesting(): void {
  sessions.clear();
}

function getSessionFactory(): SessionFactory {
  return sessionFactoryOverride ?? Session.open.bind(Session);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Live sessions keyed by their opaque id. Each `open()` adds an entry,
 * `close()` removes one, and `closeAllSessions()` drains the map on
 * shutdown.
 */
const sessions = new Map<SessionId, Session>();

export function getSession(sessionId: SessionId): Session | undefined {
  return sessions.get(sessionId);
}

export function requireSession(sessionId: SessionId): Session {
  const s = sessions.get(sessionId);
  if (s === undefined) {
    throw new Error(`Session not found: ${String(sessionId)}`);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

function passwordKey(profileId: string): string {
  return `profile:${profileId}:password`;
}

interface ProfileRowLike {
  id: string;
  account_url: string;
  auth_method: 'externalbrowser' | 'password_mfa' | 'password' | 'pat';
  username: string;
  default_role: string | null;
  default_warehouse: string | null;
  default_database: string | null;
  default_schema: string | null;
}

function rowToLite(row: ProfileRowLike): ConnectionProfileLite {
  return {
    id: row.id,
    accountUrl: row.account_url,
    authMethod: row.auth_method,
    username: row.username,
    ...(row.default_role !== null && row.default_role !== ''
      ? { defaultRole: row.default_role }
      : {}),
    ...(row.default_warehouse !== null && row.default_warehouse !== ''
      ? { defaultWarehouse: row.default_warehouse }
      : {}),
    ...(row.default_database !== null && row.default_database !== ''
      ? { defaultDatabase: row.default_database }
      : {}),
    ...(row.default_schema !== null && row.default_schema !== ''
      ? { defaultSchema: row.default_schema }
      : {})
  };
}

function toDriverContext(context: SessionContext): DriverSessionContext {
  // SessionContext shapes are structurally identical between IPC (mutable
  // optional) and the driver (readonly optional). Coerce explicitly so the
  // intent is visible in callsites and a future divergence trips here.
  return {
    ...(context.role !== undefined ? { role: context.role } : {}),
    ...(context.warehouse !== undefined ? { warehouse: context.warehouse } : {}),
    ...(context.database !== undefined ? { database: context.database } : {}),
    ...(context.schema !== undefined ? { schema: context.schema } : {})
  };
}

function toDriverContextPatch(partial: Partial<SessionContext>): Partial<DriverSessionContext> {
  return toDriverContext(partial);
}

// ---------------------------------------------------------------------------
// Handler implementations (exported for direct unit testing)
// ---------------------------------------------------------------------------

export async function openSession(
  profileId: string,
  context: SessionContext,
  passcode?: string
): Promise<SessionId> {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new Error('sessions.open: profileId is required');
  }

  const row = storageGetProfile(profileId);
  if (row === null) {
    throw new Error(`sessions.open: profile not found: ${profileId}`);
  }

  let password: string | undefined;
  if (
    row.auth_method === 'password' ||
    row.auth_method === 'password_mfa' ||
    row.auth_method === 'pat'
  ) {
    const stored = await getSecret(passwordKey(profileId));
    if (stored === null) {
      const secretName = row.auth_method === 'pat' ? 'Personal Access Token' : 'password';
      throw new Error(
        `sessions.open: no ${secretName} stored for profile ${profileId}. ` +
          `Edit the profile in the connection wizard and enter your Snowflake ${secretName} first.`
      );
    }
    password = stored;
  }

  const lite = rowToLite(row);
  const options: OpenSessionOptions = {};
  if (password !== undefined) options.password = password;
  if (passcode !== undefined && passcode.trim().length > 0) {
    options.passcode = passcode.trim();
  }
  const driverContext = toDriverContext(context ?? {});

  const session = await getSessionFactory()(lite, driverContext, options);
  // The driver's branded SessionId is structurally a string; cast once here
  // to the main-side branded type so callers don't see the driver brand.
  const id = session.getId() as unknown as SessionId;
  sessions.set(id, session);
  return id;
}

export async function closeSession(sessionId: SessionId): Promise<void> {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    // Reject obviously-malformed handles loudly; silent close on a stale
    // (but well-formed) id is fine and intentional below.
    throw new Error('sessions.close: sessionId is required');
  }
  const session = sessions.get(sessionId);
  if (session === undefined) {
    return;
  }
  sessions.delete(sessionId);
  try {
    await session.close();
  } catch (err) {
    // Best-effort: a failed close is logged but does not propagate. The
    // registry entry is already gone so the caller cannot re-use the id.
    console.warn('[sessions] session.close failed', err);
  }
}

export async function setSessionContext(
  sessionId: SessionId,
  partial: Partial<SessionContext>
): Promise<void> {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('sessions.setContext: sessionId is required');
  }
  const session = requireSession(sessionId);
  await session.setContext(toDriverContextPatch(partial ?? {}));
}

/**
 * Drain the registry on shutdown. Errors during individual closes are
 * logged but do not abort the loop — every session gets a chance to
 * disconnect cleanly before the process exits.
 */
export async function closeAllSessions(): Promise<void> {
  const all = Array.from(sessions.values());
  sessions.clear();
  await Promise.all(
    all.map(async (s) => {
      try {
        await s.close();
      } catch (err) {
        console.warn('[sessions] closeAllSessions: close failed', err);
      }
    })
  );
}

// ---------------------------------------------------------------------------
// IPC registration adapter
// ---------------------------------------------------------------------------

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(
    CHANNELS.sessions.open,
    (_event, profileId: string, context: SessionContext, passcode?: string) =>
      openSession(profileId, context, passcode)
  );
  ipcMain.handle(CHANNELS.sessions.close, (_event, sessionId: SessionId) =>
    closeSession(sessionId)
  );
  ipcMain.handle(
    CHANNELS.sessions.setContext,
    (_event, sessionId: SessionId, context: Partial<SessionContext>) =>
      setSessionContext(sessionId, context)
  );
  ipcMain.handle(CHANNELS.sessionsExt.getEffectiveContext, () =>
    notImplemented('sessions.getEffectiveContext', 'B3')
  );

  // The before-quit shutdown is owned by src/main/index.ts as part of the
  // T4.1 orchestrated flush protocol: requestFlush → wait for renderer ack
  // → closeAllSessions → closeDatabase → app.quit(). No per-module
  // before-quit hook here; it would race the orchestrator's preventDefault.
}

export type { DriverSessionId };
