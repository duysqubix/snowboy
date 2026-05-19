/**
 * T3.1 — connections.* IPC handlers.
 *
 * Wires the renderer's connection-profile surface (`window.snowboy.connections`)
 * into Wave 1's storage (`profiles.ts`), secrets vault (`safeStorage`), and
 * Snowflake driver (`Session`). Handler functions are exported as plain
 * async functions so the unit suite can drive them without standing up
 * `ipcMain`; `register()` is the thin adapter that wires those functions
 * onto Electron's invoke channels.
 *
 * Translation layer: storage rows are snake_case + `string | null`; the IPC
 * surface (shared with the renderer) is camelCase + `string | undefined`.
 * `rowToProfile`, `profileToInsert`, `profileToPatch`, and `rowToLite` are
 * the only places where the two shapes meet — keep them collocated so
 * future schema drift surfaces in one diff.
 *
 * Secret material: passwords for the two password-based auth methods are
 * keyed `profile:${profileId}:password` in safeStorage. v0.1's wizard does
 * NOT collect passwords yet (T3.2's session.open flow owns that), so
 * password-auth profiles fail `test()` with a clear message instead of
 * triggering a confusing SDK error. `deleteProfile` cleans up every
 * `profile:${id}:*` key so deletion can never leak orphaned credentials.
 *
 * Session test: `test()` opens a one-shot Session with empty session
 * context (the profile's defaults are already baked into the connect
 * options by `buildConnectOptions`), runs `SELECT CURRENT_ROLE()`, and
 * always closes — including in the failure path. The handler NEVER
 * throws across the IPC boundary; every error is captured into a
 * structured `TestResult` so the renderer can render a single toast.
 */

import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import {
  deleteProfile as storageDeleteProfile,
  getProfile as storageGetProfile,
  insertProfile as storageInsertProfile,
  listProfiles as storageListProfiles,
  updateProfile as storageUpdateProfile,
  type ConnectionProfilePatch,
  type ConnectionProfileRow,
  type NewConnectionProfile
} from '../storage/profiles';
import {
  deleteSecret,
  getSecret,
  listKeys,
  setSecret
} from '../secrets/safeStorage';
import {
  Session,
  type OpenSessionOptions
} from '../snowflake/session';
import type {
  ConnectionProfileLite,
  SessionContext
} from '../snowflake/types';
import type { ConnectionProfile, TestResult } from '../types';

const TEST_QUERY_SQL = 'SELECT CURRENT_ROLE() AS ROLE';
const TEST_QUERY_TIMEOUT_MS = 30_000;

/**
 * Translates known-confusing Snowflake error codes into actionable messages.
 * The codes Snowflake returns are stable across SDK versions, but the raw
 * messages tell users to "Contact Snowflake support" — not useful when the
 * fix is on the user's side (wrong auth method, missing role, etc.).
 *
 * Pattern: detect the code in the raw error text, return a replacement
 * message that explains the cause + next step. Falls through to the raw
 * message when nothing matches.
 */
function snowflakeErrorHint(raw: string): string {
  if (raw.includes('390190') || raw.includes('SAML Identity Provider account parameter')) {
    return (
      'This Snowflake account does not have SSO (SAML) configured, so ' +
      'externalbrowser authentication cannot be used. Switch the profile to ' +
      'Password or Password+MFA, or configure SAML SSO in Snowflake first ' +
      '(see https://docs.snowflake.com/en/user-guide/admin-security-fed-auth-overview).'
    );
  }
  if (raw.includes('390100') || raw.includes('Incorrect username or password')) {
    return (
      'Incorrect username or password. Double-check the username on the ' +
      'profile and the stored password.'
    );
  }
  if (raw.includes('390101') || raw.includes('User is locked')) {
    return (
      'This Snowflake user is locked. An account admin needs to unlock the ' +
      'user before sign-in can succeed.'
    );
  }
  if (raw.includes('390114') || raw.includes('JWT token is invalid')) {
    return (
      'The Snowflake JWT for key-pair auth is invalid or expired. Re-register ' +
      'the public key on the user, or regenerate the key pair.'
    );
  }
  if (raw.includes('ENOTFOUND') || raw.includes('getaddrinfo')) {
    return (
      'Cannot reach Snowflake. Check the Account URL on the profile and ' +
      'confirm the host resolves.'
    );
  }
  return raw;
}

/**
 * Session factory shape — matches `Session.open`. The indirection exists
 * so unit tests can inject a stub that never touches snowflake-sdk; in
 * production this resolves to `Session.open.bind(Session)`.
 */
export type SessionFactory = (
  profile: ConnectionProfileLite,
  context: SessionContext,
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

function getSessionFactory(): SessionFactory {
  return sessionFactoryOverride ?? Session.open.bind(Session);
}

function passwordKey(profileId: string): string {
  return `profile:${profileId}:password`;
}

function profilePrefix(profileId: string): string {
  return `profile:${profileId}:`;
}

// ---------------------------------------------------------------------------
// Row <-> IPC translation
// ---------------------------------------------------------------------------

function rowToProfile(row: ConnectionProfileRow): ConnectionProfile {
  const profile: ConnectionProfile = {
    id: row.id,
    name: row.name,
    accountUrl: row.account_url,
    authMethod: row.auth_method,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  // Optional fields: storage keeps `null`, IPC contract is `string | undefined`.
  // Empty strings collapse to undefined as well so a wizard-cleared field
  // round-trips deterministically.
  if (row.default_role !== null && row.default_role !== '') {
    profile.defaultRole = row.default_role;
  }
  if (row.default_warehouse !== null && row.default_warehouse !== '') {
    profile.defaultWarehouse = row.default_warehouse;
  }
  if (row.default_database !== null && row.default_database !== '') {
    profile.defaultDatabase = row.default_database;
  }
  if (row.default_schema !== null && row.default_schema !== '') {
    profile.defaultSchema = row.default_schema;
  }
  return profile;
}

function normalizeOptional(v: string | undefined): string | null {
  if (v === undefined) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function profileToInsert(p: ConnectionProfile): NewConnectionProfile {
  return {
    id: p.id,
    name: p.name,
    account_url: p.accountUrl,
    auth_method: p.authMethod,
    username: p.username,
    default_role: normalizeOptional(p.defaultRole),
    default_warehouse: normalizeOptional(p.defaultWarehouse),
    default_database: normalizeOptional(p.defaultDatabase),
    default_schema: normalizeOptional(p.defaultSchema)
  };
}

function profileToPatch(p: ConnectionProfile): ConnectionProfilePatch {
  return {
    name: p.name,
    account_url: p.accountUrl,
    auth_method: p.authMethod,
    username: p.username,
    default_role: normalizeOptional(p.defaultRole),
    default_warehouse: normalizeOptional(p.defaultWarehouse),
    default_database: normalizeOptional(p.defaultDatabase),
    default_schema: normalizeOptional(p.defaultSchema)
  };
}

function rowToLite(row: ConnectionProfileRow): ConnectionProfileLite {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs a one-shot streaming query and resolves when `onComplete` fires.
 * `runStreaming` is event-driven (callbacks) but `test()` needs a single
 * Promise — this is the thin wrapper. `onError`/`onCancel` reject so the
 * caller never silently hangs.
 */
async function runTinyQuery(
  session: Session,
  sql: string,
  timeoutMs: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    session.runStreaming(
      sql,
      { timeoutMs },
      {
        onBatch: () => {
          /* row content discarded — `test()` only cares whether the round-trip succeeds */
        },
        onComplete: () => settle(() => resolve()),
        onError: (err) => settle(() => reject(err)),
        onCancel: () =>
          settle(() => reject(new Error('Test query was cancelled')))
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Handler implementations (exported for direct unit testing)
// ---------------------------------------------------------------------------

export function listProfiles(): ConnectionProfile[] {
  return storageListProfiles().map(rowToProfile);
}

export function saveProfile(p: ConnectionProfile): { id: string } {
  if (typeof p?.id !== 'string' || p.id.length === 0) {
    throw new Error('saveProfile: profile.id is required');
  }
  const existing = storageGetProfile(p.id);
  if (existing === null) {
    storageInsertProfile(profileToInsert(p));
  } else {
    storageUpdateProfile(p.id, profileToPatch(p));
  }
  return { id: p.id };
}

export async function deleteProfile(id: string): Promise<void> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('deleteProfile: id is required');
  }
  // Storage delete first. If it throws (e.g. FK violation) we leave secrets
  // alone — a still-existing profile with a missing password would actively
  // break user flows, whereas orphaned secrets are inert.
  storageDeleteProfile(id);

  const prefix = profilePrefix(id);
  const keys = await listKeys();
  // safeStorage serializes writes through its own mutex, so the sequential
  // loop here is purely for readability — Promise.all would behave the same.
  for (const key of keys) {
    if (key.startsWith(prefix)) {
      await deleteSecret(key);
    }
  }
}

export async function setPasswordForProfile(profileId: string, password: string): Promise<void> {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new Error('setPassword: profileId is required');
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('setPassword: password must be a non-empty string');
  }
  if (storageGetProfile(profileId) === null) {
    throw new Error(`setPassword: profile not found: ${profileId}`);
  }
  await setSecret(passwordKey(profileId), password);
}

export async function clearPasswordForProfile(profileId: string): Promise<void> {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new Error('clearPassword: profileId is required');
  }
  await deleteSecret(passwordKey(profileId));
}

export async function hasPasswordForProfile(profileId: string): Promise<boolean> {
  if (typeof profileId !== 'string' || profileId.length === 0) {
    return false;
  }
  const stored = await getSecret(passwordKey(profileId));
  return stored !== null;
}

export async function testConnection(
  profileId: string,
  passcode?: string
): Promise<TestResult> {
  const startedAt = Date.now();

  if (typeof profileId !== 'string' || profileId.length === 0) {
    return {
      ok: false,
      message: 'test: profileId is required',
      durationMs: Date.now() - startedAt
    };
  }

  let row: ConnectionProfileRow | null;
  try {
    row = storageGetProfile(profileId);
  } catch (err) {
    return {
      ok: false,
      message: `Failed to load profile: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startedAt
    };
  }
  if (row === null) {
    return {
      ok: false,
      message: `Profile not found: ${profileId}`,
      durationMs: Date.now() - startedAt
    };
  }

  let password: string | undefined;
  if (row.auth_method === 'password' || row.auth_method === 'password_mfa') {
    let stored: string | null;
    try {
      stored = await getSecret(passwordKey(profileId));
    } catch (err) {
      return {
        ok: false,
        message: `Failed to read password from secrets store: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startedAt
      };
    }
    if (stored === null) {
      return {
        ok: false,
        message:
          'No password stored for this profile. Edit the profile and enter your Snowflake password, then try again.',
        durationMs: Date.now() - startedAt
      };
    }
    password = stored;
  }

  if (row.auth_method === 'password_mfa' && (passcode === undefined || passcode.trim().length === 0)) {
    return {
      ok: false,
      message:
        'This profile requires an MFA passcode. Enter the 6-digit code from your authenticator app, then try again.',
      durationMs: Date.now() - startedAt
    };
  }

  const lite = rowToLite(row);
  const options: OpenSessionOptions = {};
  if (password !== undefined) options.password = password;
  if (passcode !== undefined && passcode.trim().length > 0) options.passcode = passcode.trim();
  // Empty session context — the profile's defaults are baked into the
  // connect options by `buildConnectOptions`. Running USE statements on top
  // would just duplicate work and turn a missing-default into a noisier
  // failure than the connect-time error the SDK already produces.
  const initialContext: SessionContext = {};

  let session: Session | null = null;
  try {
    session = await getSessionFactory()(lite, initialContext, options);
    await runTinyQuery(session, TEST_QUERY_SQL, TEST_QUERY_TIMEOUT_MS);
    return {
      ok: true,
      durationMs: Date.now() - startedAt
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: snowflakeErrorHint(raw),
      durationMs: Date.now() - startedAt
    };
  } finally {
    if (session !== null) {
      try {
        await session.close();
      } catch (closeErr) {
        // Closing a failed/partially-open session is best-effort; surface to
        // logs but don't override the test result the caller already saw.
        console.warn('[connections] session.close failed during test', closeErr);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// IPC registration adapter
// ---------------------------------------------------------------------------

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.connections.listProfiles, () => listProfiles());
  ipcMain.handle(CHANNELS.connections.saveProfile, (_event, profile: ConnectionProfile) =>
    saveProfile(profile)
  );
  ipcMain.handle(CHANNELS.connections.deleteProfile, (_event, id: string) =>
    deleteProfile(id)
  );
  ipcMain.handle(
    CHANNELS.connections.test,
    (_event, profileId: string, passcode?: string) => testConnection(profileId, passcode)
  );
  ipcMain.handle(
    CHANNELS.connections.setPassword,
    (_event, profileId: string, password: string) =>
      setPasswordForProfile(profileId, password)
  );
  ipcMain.handle(CHANNELS.connections.clearPassword, (_event, profileId: string) =>
    clearPasswordForProfile(profileId)
  );
  ipcMain.handle(CHANNELS.connections.hasPassword, (_event, profileId: string) =>
    hasPasswordForProfile(profileId)
  );
}
