import { Session, type OpenSessionOptions } from './session';
import type { ConnectionProfileLite, SessionContext, SessionId } from './types';

export const POOL_CAP = 8;
export const POOL_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type SessionFactory = (
  profile: ConnectionProfileLite,
  context: SessionContext,
  options: OpenSessionOptions,
) => Promise<Session>;

interface PoolEntry {
  session: Session;
  key: string;
  profileId: string;
  refcount: number;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface QueuedAcquire {
  profileId: string;
  context: SessionContext;
  options: OpenSessionOptions;
  resolve: (session: Session) => void;
  reject: (err: Error) => void;
}

export interface SessionPoolOptions {
  factory?: SessionFactory;
  cap?: number;
  idleTimeoutMs?: number;
  now?: () => number;
}

export interface AcquireOptions extends OpenSessionOptions {
  profile?: ConnectionProfileLite;
}

/**
 * Pool keyed by `(profileId, role, warehouse)` per plan §5.3 / spec point 2.
 *
 * Cap is total live sessions, NOT per caller. Sessions are shared across
 * concurrent acquires for the same key (refcounted) — closing only happens
 * after refcount drops to 0 AND the 30-min idle timer fires.
 *
 * Over-cap policy: a new acquire that would push us past the cap evicts
 * the LRU refcount-zero session. If no session is at refcount zero (all
 * eight are checked out), the new acquire is queued and resolves when a
 * release frees a slot.
 */
export class SessionPool {
  private readonly cap: number;
  private readonly idleTimeoutMs: number;
  private readonly factory: SessionFactory;
  private readonly now: () => number;

  private readonly entries = new Map<SessionId, PoolEntry>();
  private readonly byKey = new Map<string, SessionId>();
  private readonly waiters: QueuedAcquire[] = [];

  constructor(options: SessionPoolOptions = {}) {
    this.cap = options.cap ?? POOL_CAP;
    this.idleTimeoutMs = options.idleTimeoutMs ?? POOL_IDLE_TIMEOUT_MS;
    this.factory = options.factory ?? Session.open.bind(Session);
    this.now = options.now ?? (() => Date.now());
  }

  size(): number {
    return this.entries.size;
  }

  keys(): readonly string[] {
    return Array.from(this.byKey.keys());
  }

  hasKey(profileId: string, context: SessionContext): boolean {
    return this.byKey.has(buildKey(profileId, context));
  }

  async acquire(
    profileId: string,
    context: SessionContext,
    options: AcquireOptions = {},
  ): Promise<Session> {
    const key = buildKey(profileId, context);
    const existing = this.byKey.get(key);
    if (existing !== undefined) {
      const entry = this.entries.get(existing);
      if (entry && !entry.session.isClosed()) {
        return this.checkOut(entry, context);
      }
      this.byKey.delete(key);
      if (entry) this.entries.delete(existing);
    }

    if (this.entries.size >= this.cap) {
      const evicted = this.evictLruIdle();
      if (!evicted) {
        return this.queueAcquire(profileId, context, options);
      }
    }

    return this.openAndRegister(key, profileId, context, options);
  }

  release(sessionId: SessionId): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.refcount = Math.max(0, entry.refcount - 1);
    entry.lastUsed = this.now();
    if (entry.refcount === 0) {
      this.scheduleIdleClose(entry);
    }
    this.flushWaiters();
  }

  async closeAll(): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
      }
    }
    const pending = this.waiters.splice(0);
    for (const w of pending) {
      w.reject(new Error('SessionPool closed'));
    }
    const closes = Array.from(this.entries.values()).map((entry) =>
      entry.session.close().catch(() => undefined),
    );
    this.entries.clear();
    this.byKey.clear();
    await Promise.all(closes);
  }

  private async openAndRegister(
    key: string,
    profileId: string,
    context: SessionContext,
    options: AcquireOptions,
  ): Promise<Session> {
    const profile = options.profile ?? buildFallbackProfile(profileId);
    const session = await this.factory(profile, context, {
      ...(options.password !== undefined ? { password: options.password } : {}),
      ...(options.sdk !== undefined ? { sdk: options.sdk } : {}),
    });
    const entry: PoolEntry = {
      session,
      key,
      profileId,
      refcount: 1,
      lastUsed: this.now(),
      idleTimer: null,
    };
    this.entries.set(session.getId(), entry);
    this.byKey.set(key, session.getId());
    return session;
  }

  private async checkOut(entry: PoolEntry, context: SessionContext): Promise<Session> {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    entry.refcount += 1;
    entry.lastUsed = this.now();
    const current = entry.session.getContext();
    const patch: { -readonly [K in keyof SessionContext]?: SessionContext[K] } = {};
    if (context.database !== undefined && context.database !== current.database) {
      patch.database = context.database;
    }
    if (context.schema !== undefined && context.schema !== current.schema) {
      patch.schema = context.schema;
    }
    if (Object.keys(patch).length > 0) {
      await entry.session.setContext(patch);
    }
    return entry.session;
  }

  private evictLruIdle(): boolean {
    let target: PoolEntry | null = null;
    for (const entry of this.entries.values()) {
      if (entry.refcount > 0) continue;
      if (entry.session.isRunning()) continue;
      if (!target || entry.lastUsed < target.lastUsed) {
        target = entry;
      }
    }
    if (!target) return false;
    this.removeEntry(target);
    return true;
  }

  private removeEntry(entry: PoolEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    this.entries.delete(entry.session.getId());
    this.byKey.delete(entry.key);
    void entry.session.close().catch(() => undefined);
  }

  private scheduleIdleClose(entry: PoolEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      const live = this.entries.get(entry.session.getId());
      if (!live || live !== entry) return;
      if (entry.refcount > 0) return;
      this.removeEntry(entry);
    }, this.idleTimeoutMs);
    if (typeof entry.idleTimer === 'object' && entry.idleTimer !== null && 'unref' in entry.idleTimer) {
      (entry.idleTimer as { unref?: () => void }).unref?.();
    }
  }

  private queueAcquire(
    profileId: string,
    context: SessionContext,
    options: AcquireOptions,
  ): Promise<Session> {
    return new Promise<Session>((resolve, reject) => {
      this.waiters.push({ profileId, context, options, resolve, reject });
    });
  }

  private flushWaiters(): void {
    while (this.waiters.length > 0 && this.entries.size < this.cap) {
      const waiter = this.waiters.shift();
      if (!waiter) break;
      const key = buildKey(waiter.profileId, waiter.context);
      const existing = this.byKey.get(key);
      if (existing !== undefined) {
        const entry = this.entries.get(existing);
        if (entry && !entry.session.isClosed()) {
          this.checkOut(entry, waiter.context).then(waiter.resolve, waiter.reject);
          continue;
        }
      }
      this.openAndRegister(key, waiter.profileId, waiter.context, waiter.options).then(
        waiter.resolve,
        waiter.reject,
      );
    }
    if (this.waiters.length > 0 && this.entries.size >= this.cap) {
      const evicted = this.evictLruIdle();
      if (evicted) this.flushWaiters();
    }
  }
}

function buildKey(profileId: string, context: SessionContext): string {
  const role = context.role ?? '';
  const warehouse = context.warehouse ?? '';
  return `${profileId}\u0000${role}\u0000${warehouse}`;
}

function buildFallbackProfile(profileId: string): ConnectionProfileLite {
  return {
    id: profileId,
    accountUrl: 'https://placeholder.snowflakecomputing.com',
    authMethod: 'password',
  };
}
