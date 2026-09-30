/**
 * Shared types between main, preload, and renderer. Source of truth for the
 * `SnowboyApi` IPC surface (plan §5.2). Payload shapes for modules owned by
 * other Wave 1 tasks (`Worksheet`, `HistoryEntry`) are structural placeholders
 * here; Wave 3 wiring reconciles them when concrete types land.
 */

export type SessionId = string & { readonly __brand: 'SessionId' };
export type QueryId = string & { readonly __brand: 'QueryId' };

export type AuthMethod = 'externalbrowser' | 'password_mfa' | 'password' | 'pat' | 'keypair';

export interface ConnectionProfile {
  id: string;
  name: string;
  accountUrl: string;
  authMethod: AuthMethod;
  username: string;
  /**
   * `keypair` only: absolute path of the PEM private key. The app stores the
   * path, never the key; the optional passphrase lives in safeStorage.
   */
  privateKeyPath?: string;
  defaultRole?: string;
  defaultWarehouse?: string;
  defaultDatabase?: string;
  defaultSchema?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TestResult {
  ok: boolean;
  message?: string;
  durationMs?: number;
}

/**
 * Why a private key file can't be used for key-pair auth: the file is
 * missing or unreadable, it isn't a usable private key, or the passphrase
 * is missing or wrong.
 */
export type PrivateKeyProblem =
  | 'not_found'
  | 'unreadable'
  | 'not_private_key'
  | 'unsupported_format'
  | 'passphrase_required'
  | 'wrong_passphrase';

/**
 * Result of parsing a private key file in main. Never carries key material:
 * `fingerprint` is the SHA-256 of the public key, in the `SHA256:<base64>`
 * form Snowflake shows as `RSA_PUBLIC_KEY_FP` in `DESC USER`.
 */
export type PrivateKeyCheck =
  | { ok: true; encrypted: boolean; fingerprint: string }
  | { ok: false; problem: PrivateKeyProblem; message: string };

export interface SessionContext {
  role?: string;
  warehouse?: string;
  database?: string;
  schema?: string;
}

export interface RunOptions {
  timeoutMs?: number;
  fetchSize?: number;
  tag?: string;
}

/**
 * Column metadata as streamed across the IPC boundary for query results.
 * Mirrors the renderer's `Column` shape with an explicit `dataType` (matches
 * `snowflake-sdk`'s `getType()` strings such as `'NUMBER'`, `'TEXT'`,
 * `'TIMESTAMP_NTZ'`). Kept separate from the schema-inspection `Column`
 * type so result-set columns and schema columns can evolve independently.
 */
export interface ResultColumn {
  name: string;
  dataType: string;
  nullable: boolean;
}

export interface QueryRowBatchEvent {
  queryId: QueryId;
  rows: Record<string, unknown>[];
  columns: ResultColumn[];
}

export interface QueryCompleteEvent {
  queryId: QueryId;
  totalRows: number;
  durationMs: number;
  warehouse?: string;
}

export interface QueryErrorEvent {
  queryId: QueryId;
  message: string;
}

export type SchemaObjectKind = 'table' | 'view' | 'database' | 'schema' | 'column';

export interface SchemaObject {
  name: string;
  kind: SchemaObjectKind;
  comment?: string;
}

export interface ListObjectsOptions {
  source?: 'completion';
}

export interface Column {
  name: string;
  dataType: string;
  nullable: boolean;
  comment?: string;
}

export interface ObjectRef {
  database: string;
  schema: string;
  name: string;
  kind: SchemaObjectKind;
}

export type HistoryStatus = 'success' | 'error' | 'cancelled';

export interface HistoryFilter {
  worksheetId?: string;
  profileId?: string;
  status?: HistoryStatus;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export interface HistoryEntry {
  id: string;
  worksheetId?: string;
  profileId: string;
  role?: string;
  warehouse?: string;
  databaseName?: string;
  schemaName?: string;
  sql: string;
  startedAt: number;
  endedAt?: number;
  status: HistoryStatus;
  rowCount?: number;
  bytesScanned?: number;
  queryId?: string;
  errorMessage?: string;
}

export interface Worksheet {
  id: string;
  title: string;
  body: string;
  cursorLine?: number;
  cursorCol?: number;
  scrollTop?: number;
  lastSessionContext?: SessionContext;
  createdAt: number;
  updatedAt: number;
}

export type LayoutTree =
  | { kind: 'leaf'; paneId: string; worksheetId: string }
  | { kind: 'split'; direction: 'h' | 'v'; sizes: number[]; children: LayoutTree[] };

export interface LayoutTreeSerialized {
  version: 1 | 2;
  tree: LayoutTree;
}

export type ThemeMode = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

export interface Settings {
  theme: ThemeMode;
  fontSize: number;
  tabWidth: 2 | 4 | 8;
  wordWrap: boolean;
  telemetryEnabled: boolean;
  dataDir: string;
}

export interface ThemeChangedEvent {
  effective: EffectiveTheme;
  mode: ThemeMode;
}

export interface EffectiveContext {
  role?: string;
  warehouse?: string;
  database?: string;
  schema?: string;
}

export interface SnowboyApi {
  connections: {
    listProfiles(): Promise<ConnectionProfile[]>;
    saveProfile(p: ConnectionProfile): Promise<{ id: string }>;
    deleteProfile(id: string): Promise<void>;
    test(profileId: string, passcode?: string): Promise<TestResult>;
    setPassword(profileId: string, password: string): Promise<void>;
    clearPassword(profileId: string): Promise<void>;
    hasPassword(profileId: string): Promise<boolean>;
    /** Native open dialog for a private key file; resolves `null` if cancelled. */
    pickPrivateKeyFile(): Promise<string | null>;
    /**
     * Parses the key at `path`. Without a `passphrase`, a `profileId` makes
     * main use that profile's stored passphrase.
     */
    checkPrivateKey(
      path: string,
      passphrase?: string,
      profileId?: string
    ): Promise<PrivateKeyCheck>;
    setPrivateKeyPassphrase(profileId: string, passphrase: string): Promise<void>;
    clearPrivateKeyPassphrase(profileId: string): Promise<void>;
    hasPrivateKeyPassphrase(profileId: string): Promise<boolean>;
  };
  sessions: {
    open(profileId: string, context: SessionContext, passcode?: string): Promise<SessionId>;
    close(sessionId: SessionId): Promise<void>;
    setContext(sessionId: SessionId, context: Partial<SessionContext>): Promise<void>;
  };
  query: {
    run(sessionId: SessionId, sql: string, options?: RunOptions): Promise<QueryId>;
    cancel(queryId: QueryId): Promise<void>;
  };
  queryEvents: {
    onRowBatch(handler: (event: QueryRowBatchEvent) => void): () => void;
    onComplete(handler: (event: QueryCompleteEvent) => void): () => void;
    onError(handler: (event: QueryErrorEvent) => void): () => void;
  };
  schema: {
    listDatabases(sessionId: SessionId): Promise<string[]>;
    listSchemas(sessionId: SessionId, db: string): Promise<string[]>;
    listObjects(
      sessionId: SessionId,
      db: string,
      schema: string,
      options?: ListObjectsOptions
    ): Promise<SchemaObject[]>;
    listRoles(sessionId: SessionId): Promise<string[]>;
    listWarehouses(sessionId: SessionId): Promise<string[]>;
    getColumns(sessionId: SessionId, obj: ObjectRef): Promise<Column[]>;
    getDDL(sessionId: SessionId, obj: ObjectRef): Promise<string>;
    invalidate(profileId: string, database?: string, schema?: string): Promise<void>;
  };
  sessionsExt: {
    getEffectiveContext(sessionId: SessionId): Promise<EffectiveContext | null>;
    onEffectiveContextChanged(
      handler: (event: { sessionId: SessionId }) => void
    ): () => void;
  };
  settings: {
    get(): Promise<Settings>;
    set(partial: Partial<Settings>): Promise<Settings>;
    onChanged(handler: (event: Settings) => void): () => void;
  };
  theme: {
    get(): Promise<EffectiveTheme>;
    onChanged(handler: (event: ThemeChangedEvent) => void): () => void;
  };
  history: {
    list(filter?: HistoryFilter): Promise<HistoryEntry[]>;
    get(id: string): Promise<HistoryEntry>;
  };
  workspace: {
    saveLayout(layout: LayoutTree): Promise<void>;
    loadLayout(): Promise<LayoutTree | null>;
    saveWorksheet(w: Worksheet): Promise<void>;
    listWorksheets(): Promise<Worksheet[]>;
    saveWorkspace(payload: { layout: LayoutTreeSerialized; worksheets: Worksheet[] }): Promise<void>;
    getWorksheet(id: string): Promise<Worksheet | null>;
    flushAck(): Promise<void>;
  };
  workspaceEvents: {
    onRequestFlush(handler: () => void): () => void;
  };
}
