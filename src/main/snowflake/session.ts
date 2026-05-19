import { randomUUID } from 'node:crypto';
import { buildConnectOptions } from './auth';
import {
  type ColumnMeta,
  type ConnectionProfileLite,
  type RunOptions,
  type SessionContext,
  type SessionId,
  type StreamingCallbacks,
  type StreamingHandle,
  asSessionId,
} from './types';

type SessionContextPatch = { -readonly [K in keyof SessionContext]?: SessionContext[K] };
import {
  type SnowflakeStatementLike,
  getWarehouseFromState,
  mapColumns,
  streamWindows,
} from './streaming';

interface SnowflakeConnectionLike {
  connect(callback: (err: Error | undefined, conn: SnowflakeConnectionLike) => void): unknown;
  connectAsync?(
    callback: (err: Error | undefined, conn: SnowflakeConnectionLike) => void,
  ): Promise<unknown>;
  execute(options: {
    sqlText: string;
    streamResult?: boolean;
    rowMode?: 'array' | 'object';
    parameters?: Record<string, unknown>;
    complete?: (err: Error | undefined, stmt: SnowflakeStatementLike) => void;
  }): SnowflakeStatementLike;
  destroy(callback: (err: Error | undefined) => void): void;
}

export interface SnowflakeSdkLike {
  createConnection: (options: Record<string, unknown>) => SnowflakeConnectionLike;
}

export interface OpenSessionOptions {
  password?: string;
  passcode?: string;
  sdk?: SnowflakeSdkLike;
}

const DEFAULT_BATCH_SIZE = 1000;

/**
 * Lazily loads the real snowflake-sdk. Wrapped in a function so unit tests
 * never trigger the SDK's heavy initialization (it pulls in the AWS SDK,
 * OCSP machinery, etc.) when they inject a mock factory.
 */
async function defaultSnowflakeSdk(): Promise<SnowflakeSdkLike> {
  type Mod = { createConnection: SnowflakeSdkLike['createConnection']; default?: { createConnection: SnowflakeSdkLike['createConnection'] } };
  const mod = (await import('snowflake-sdk')) as unknown as Mod;
  const ns = mod.default ?? mod;
  if (typeof ns.createConnection !== 'function') {
    throw new Error('snowflake-sdk did not expose createConnection');
  }
  return { createConnection: ns.createConnection };
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Runtime wrapper around a single snowflake-sdk Connection.
 *
 * One Session ↔ one Snowflake connection ↔ one `(profile, role, warehouse)`
 * pool slot. Database/schema switch via cheap `USE` statements; role and
 * warehouse can also be re-set without re-opening per plan §5.3.
 */
export class Session {
  private readonly id: SessionId;
  private readonly profile: ConnectionProfileLite;
  private readonly connection: SnowflakeConnectionLike;
  private context: SessionContext;
  private closed = false;
  private running = false;

  private constructor(
    id: SessionId,
    profile: ConnectionProfileLite,
    connection: SnowflakeConnectionLike,
    context: SessionContext,
  ) {
    this.id = id;
    this.profile = profile;
    this.connection = connection;
    this.context = { ...context };
  }

  static async open(
    profile: ConnectionProfileLite,
    context: SessionContext,
    options: OpenSessionOptions = {},
  ): Promise<Session> {
    const sdk = options.sdk ?? (await defaultSnowflakeSdk());
    const connectOptions = buildConnectOptions(profile, options.password, options.passcode);
    const connection = sdk.createConnection(connectOptions);

    await new Promise<void>((resolve, reject) => {
      const cb = (err: Error | undefined): void => {
        if (err) reject(err);
        else resolve();
      };
      if (profile.authMethod === 'externalbrowser' && typeof connection.connectAsync === 'function') {
        void connection.connectAsync(cb);
      } else {
        connection.connect(cb);
      }
    });

    const session = new Session(asSessionId(randomUUID()), profile, connection, context);
    await session.applyInitialContext(context);
    return session;
  }

  getId(): SessionId {
    return this.id;
  }

  getProfileId(): string {
    return this.profile.id;
  }

  getContext(): SessionContext {
    return { ...this.context };
  }

  isRunning(): boolean {
    return this.running;
  }

  isClosed(): boolean {
    return this.closed;
  }

  async setContext(patch: SessionContextPatch): Promise<void> {
    this.ensureOpen();
    const statements: string[] = [];
    if (patch.role !== undefined) {
      statements.push(`USE ROLE ${quoteIdent(patch.role)}`);
    }
    if (patch.warehouse !== undefined) {
      statements.push(`USE WAREHOUSE ${quoteIdent(patch.warehouse)}`);
    }
    if (patch.database !== undefined) {
      statements.push(`USE DATABASE ${quoteIdent(patch.database)}`);
    }
    if (patch.schema !== undefined) {
      statements.push(`USE SCHEMA ${quoteIdent(patch.schema)}`);
    }
    for (const sql of statements) {
      await this.executePromise(sql);
    }
    this.context = { ...this.context, ...patch };
  }

  async cancelQuery(queryId: string): Promise<void> {
    this.ensureOpen();
    if (queryId === '') {
      throw new Error('cancelQuery: queryId is empty');
    }
    const escaped = queryId.replace(/'/g, "''");
    await this.executePromise(`SELECT SYSTEM$CANCEL_QUERY('${escaped}')`);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await new Promise<void>((resolve) => {
      this.connection.destroy(() => {
        resolve();
      });
    });
  }

  /**
   * Issues `sql` with snowflake-sdk in streaming mode and drives windowed
   * batches via `streamWindows`. Returns a handle whose `queryId` is the
   * Snowflake-side identifier — mutated by reference once the SDK's
   * complete callback fires, awaitable via `queryIdPromise`.
   *
   * `cancel()` is safe to call before `queryId` is assigned; it waits on
   * `queryIdPromise` then issues `SYSTEM$CANCEL_QUERY` via a SECOND
   * execute on the SAME connection per task spec MUST DO #5.
   */
  runStreaming(
    sql: string,
    opts: RunOptions,
    callbacks: StreamingCallbacks,
  ): StreamingHandle {
    this.ensureOpen();
    this.running = true;

    const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    let cancelled = false;
    let resolveQueryId!: (value: string) => void;
    let rejectQueryId!: (err: Error) => void;
    const queryIdPromise = new Promise<string>((res, rej) => {
      resolveQueryId = res;
      rejectQueryId = rej;
    });
    queryIdPromise.catch(() => undefined);

    const handle: { cancel: () => void; queryId: string; queryIdPromise: Promise<string> } = {
      cancel: () => {},
      queryId: '',
      queryIdPromise,
    };

    const params: Record<string, unknown> = {};
    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      params['STATEMENT_TIMEOUT_IN_SECONDS'] = Math.max(1, Math.floor(opts.timeoutMs / 1000));
    }

    const completeHandler = (err: Error | undefined, stmt: SnowflakeStatementLike): void => {
      if (err) {
        this.running = false;
        rejectQueryId(err);
        callbacks.onError(err);
        return;
      }

      const assignedId = stmt.getQueryId() ?? '';
      handle.queryId = assignedId;
      resolveQueryId(assignedId);

      const columns: ColumnMeta[] = mapColumns(stmt.getColumns());

      void streamWindows(
        stmt,
        batchSize,
        columns,
        (batch) => callbacks.onBatch(batch),
        () => cancelled,
      )
        .then((emitted) => {
          this.running = false;
          if (cancelled) {
            callbacks.onCancel();
            return;
          }
          callbacks.onComplete({
            queryId: assignedId,
            rowCount: stmt.getNumRows() || emitted,
            bytesScanned: 0,
            warehouseUsed:
              getWarehouseFromState(stmt.getSessionState()) ||
              this.context.warehouse ||
              this.profile.defaultWarehouse ||
              '',
          });
        })
        .catch((streamErr: unknown) => {
          this.running = false;
          const e = streamErr instanceof Error ? streamErr : new Error(String(streamErr));
          callbacks.onError(e);
        });
    };

    try {
      this.connection.execute({
        sqlText: sql,
        streamResult: true,
        rowMode: 'array',
        ...(Object.keys(params).length > 0 ? { parameters: params } : {}),
        complete: completeHandler,
      });
    } catch (executeErr) {
      this.running = false;
      const e = executeErr instanceof Error ? executeErr : new Error(String(executeErr));
      rejectQueryId(e);
      callbacks.onError(e);
      return handle;
    }

    handle.cancel = () => {
      if (cancelled) return;
      cancelled = true;
      queryIdPromise
        .then((qid) => {
          if (qid === '') return;
          return this.cancelQuery(qid);
        })
        .catch((cancelErr: unknown) => {
          const e = cancelErr instanceof Error ? cancelErr : new Error(String(cancelErr));
          callbacks.onError(e);
        });
    };

    return handle;
  }

  private async applyInitialContext(context: SessionContext): Promise<void> {
    const patch: SessionContextPatch = {};
    if (context.role !== undefined) patch.role = context.role;
    if (context.warehouse !== undefined) patch.warehouse = context.warehouse;
    if (context.database !== undefined) patch.database = context.database;
    if (context.schema !== undefined) patch.schema = context.schema;
    if (Object.keys(patch).length > 0) {
      await this.setContext(patch);
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error(`Session ${this.id} is closed`);
    }
  }

  private executePromise(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.connection.execute({
          sqlText: sql,
          complete: (err) => {
            if (err) reject(err);
            else resolve();
          },
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
