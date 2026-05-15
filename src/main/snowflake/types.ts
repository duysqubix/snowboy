/**
 * T1.4 — Snowflake driver types.
 *
 * Lives in `src/main/snowflake/` (Wave 1 parallel with T1.1, which owns
 * `src/main/types.ts`). `ConnectionProfileLite` is the structural subset
 * the driver needs; T1.3's `ConnectionProfileRow` is the storage shape,
 * reconciled in Wave 3.
 *
 * Row values arrive as `unknown[][]` because `streaming.ts` requests
 * `rowMode: 'array'`. Column-typed coercion belongs to the renderer.
 */

declare const sessionIdBrand: unique symbol;

export type SessionId = string & { readonly [sessionIdBrand]: 'SessionId' };

export function asSessionId(value: string): SessionId {
  return value as SessionId;
}

export type SnowflakeAuthMethod = 'externalbrowser' | 'password_mfa' | 'password';

export interface ConnectionProfileLite {
  readonly id: string;
  /**
   * User-entered URL such as `https://ab12345.us-east-1.snowflakecomputing.com`.
   * `Session.open` parses the host portion into the `account` value the
   * snowflake-sdk expects and throws on malformed input.
   */
  readonly accountUrl: string;
  readonly authMethod: SnowflakeAuthMethod;
  readonly username?: string;
  readonly defaultRole?: string;
  readonly defaultWarehouse?: string;
  readonly defaultDatabase?: string;
  readonly defaultSchema?: string;
}

export interface SessionContext {
  readonly role?: string;
  readonly warehouse?: string;
  readonly database?: string;
  readonly schema?: string;
}

export interface RunOptions {
  readonly batchSize?: number;
  /** Maps to `STATEMENT_TIMEOUT_IN_SECONDS` as a per-query parameter override. */
  readonly timeoutMs?: number;
}

export interface ColumnMeta {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
}

export interface RowBatch {
  readonly rows: readonly unknown[][];
  readonly columns: readonly ColumnMeta[];
  readonly offset: number;
}

/**
 * `bytesScanned` is a placeholder — snowflake-sdk's Statement does not
 * surface it directly. v0.2 should backfill from `INFORMATION_SCHEMA.QUERY_HISTORY`.
 */
export interface QueryCompleteEvent {
  readonly queryId: string;
  readonly rowCount: number;
  readonly bytesScanned: number;
  readonly warehouseUsed: string;
}

export interface StreamingCallbacks {
  onBatch: (batch: RowBatch) => void;
  onComplete: (event: QueryCompleteEvent) => void;
  onError: (error: Error) => void;
  onCancel: () => void;
}

/**
 * `queryId` is mutated by reference once the SDK assigns it (during the
 * `execute` complete callback, before any `onBatch` fires). The empty-string
 * sentinel is observable only on the synchronous return path between
 * `execute()` and Snowflake's first acknowledgement; `queryIdPromise`
 * gives callers a strict await.
 */
export interface StreamingHandle {
  readonly cancel: () => void;
  queryId: string;
  readonly queryIdPromise: Promise<string>;
}
