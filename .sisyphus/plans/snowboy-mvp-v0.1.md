# Snowboy v0.1 MVP — Work Plan

## 1. Project summary

**Snowboy** is a cross-platform, open-source, standalone desktop IDE for Snowflake, built on Electron. The project exists to fill a gap in the Snowflake tooling ecosystem: no first-class desktop IDE currently exists. Snowsight (web) has well-documented UX friction, DBeaver/Beekeeper treat Snowflake as a generic JDBC source, and the official VSCode extension is intentionally lightweight.

The v0.1 MVP must deliver a single-account Snowflake IDE that fixes the user's primary pain point — **inability to view two queries side-by-side** — by shipping an SSMS-style multi-pane workspace from day one.

**Working directory**: `/home/duys/.repos/snowboy/` (greenfield, no existing code, not yet a git repo)
**Target audience (v0.1)**: Personal tool. Public OSS positioning happens post-alpha once core UX is proven.
**Platforms**: Linux, Windows, macOS (all three via electron-builder).

---

## 2. v0.1 goals (concrete acceptance)

The MVP is "done" when a Snowflake user can:

1. Launch Snowboy on Linux, Windows, or macOS.
2. Create a connection profile using any of: `externalbrowser` SSO, password + MFA push, username/password.
3. Successfully connect to Snowflake and see their accessible databases/schemas/tables in an object browser.
4. Open a worksheet, write SQL, and run it against a chosen account/role/warehouse/database/schema combo.
5. **Split the workspace into 2+ panes (horizontal or vertical) and run different queries simultaneously, each against an independent context.** This is the headline feature.
6. View results in a virtualized table (handles 100k+ rows without locking the UI).
7. Cancel running queries.
8. Export results to CSV.
9. See their query history, click a past query to restore it into the current pane.
10. View the DDL for any selected object.
11. Close and reopen the app and have all worksheets, pane layout, tab state, and connection profiles persisted.

A v0.1 ship is gated on these 11 capabilities working end-to-end on at least Linux + Windows. macOS may ship unsigned (no notarization) for v0.1.

---

## 3. Non-goals (explicit out of scope for v0.1)

These are documented as "Coming soon" in the UI where relevant, with a tracking issue link:

- Key pair (RSA) auth, OAuth refresh token auth
- Auto-update enabled (infrastructure laid down, but disabled in v0.1)
- Drag-out pane → separate `BrowserWindow`
- Drag-and-dock between panes
- Multi-account simultaneous sessions
- Cortex / semantic view explorer UI
- Time travel helper UI (`AS OF` builder)
- Query plan visualization (EXPLAIN-as-DAG)
- Git-aware worksheets
- Per-query credit cost UI (data collection scaffolding is in place from day one so v0.2 has history)
- Code signing / notarization for macOS
- Auto-formatting on save (formatter wired, but not auto-triggered)
- AI / Cortex-assisted authoring
- Stream / task / dynamic table dashboards

---

## 4. Tech stack (locked, per user decision)

| Layer | Choice | Version target |
|---|---|---|
| Runtime | Electron (bundled Node + V8) | 32.x LTS |
| Package manager | Bun | 1.1.x+ |
| Test runner | `bun test` | 1.1.x+ |
| Build / bundler | `electron-vite` (Vite under the hood) | 0.29.x+ |
| UI framework | Svelte 5 (Runes mode) | 5.x |
| State | Svelte stores + runes (no external lib) | — |
| IPC | Typed `contextBridge` + `ipcRenderer.invoke` (custom thin wrapper; tRPC overkill for v0.1) | — |
| SQL editor | CodeMirror 6 + `svelte-codemirror-editor` + custom Snowflake dialect | latest |
| UI kit | `shadcn-svelte` + Tailwind (via `bits-ui` primitives) | latest |
| Result grid | `@tanstack/svelte-table` + virtualization (svelte-virtual or @tanstack/svelte-virtual) | latest |
| Layout | `svelte-splitpanes` | latest |
| Snowflake driver | `snowflake-sdk` 2.4.x + `snowflake-promise` 5.x wrapper | 2.4.1+ |
| Local cache / persistence | `better-sqlite3` (with `electron-rebuild`) | 11.x |
| Credentials | Electron `safeStorage` API (built-in) | — |
| Packaging | `electron-builder` → AppImage + deb + NSIS + portable EXE + dmg | 25.x |
| Auto-update | `electron-updater` + GitHub Releases as update server (infrastructure only, disabled in v0.1) | 6.x |
| E2E test | Playwright for Electron | 1.45+ |
| Linting | ESLint flat config + Prettier (with svelte plugin) | latest |
| TypeScript | strict mode, separate tsconfig per process | 5.5+ |

### Bun usage envelope (constraint)

Electron embeds Node.js — Bun cannot replace it as the runtime. Bun is used for:

- ✅ `bun install` (workspaces, lockfile)
- ✅ `bun run <script>` and inline `bunx`
- ✅ `bun test` for unit tests
- ✅ Pre-build codegen scripts in TypeScript
- ❌ Bundling main / preload / renderer (Vite does this)
- ❌ Runtime for main / preload / renderer (Electron's bundled Node does this)
- ⚠️ Native modules (`snowflake-sdk`, `better-sqlite3`) require `electron-rebuild` against Electron's Node ABI **after** Bun install — verified early in Wave 0.

---

## 5. Architecture

### 5.1 Process model

```
┌───────────────────────────────────────────────────────────────┐
│ Renderer (Svelte 5 + CodeMirror + TanStack)                   │
│ • UI only. No node access. contextIsolation: true.            │
│ • Calls typed APIs exposed by preload.                        │
└──────────────────────────┬────────────────────────────────────┘
                           │ contextBridge: typed invoke channels
                           │ (query.run, query.cancel, conn.connect,
                           │  schema.list, history.list, etc.)
┌──────────────────────────▼────────────────────────────────────┐
│ Preload                                                       │
│ • Whitelists IPC channels.                                    │
│ • Exposes `window.snowboy.*` typed API.                       │
└──────────────────────────┬────────────────────────────────────┘
                           │ ipc.invoke
┌──────────────────────────▼────────────────────────────────────┐
│ Main                                                          │
│ • Snowflake connection pool (snowflake-sdk).                  │
│ • Credentials via safeStorage.                                │
│ • Local SQLite (better-sqlite3): history, worksheets,         │
│   pane layout, profiles, schema cache.                        │
│ • Window mgmt: one BrowserWindow per workspace in v0.1.       │
└──────────────────────────┬────────────────────────────────────┘
                           │
                  ┌────────▼────────┐
                  │ Worker threads  │ ← heavy result chunk decode,
                  │ (Node)          │   schema cache rebuild
                  └─────────────────┘
```

### 5.2 IPC design

Single typed surface exposed from preload as `window.snowboy`:

```ts
type SnowboyApi = {
  connections: {
    listProfiles(): Promise<ConnectionProfile[]>
    saveProfile(p: ConnectionProfile): Promise<{ id: string }>
    deleteProfile(id: string): Promise<void>
    test(profileId: string): Promise<TestResult>
  }
  sessions: {
    open(profileId: string, context: SessionContext): Promise<SessionId>
    close(sessionId: SessionId): Promise<void>
    setContext(sessionId: SessionId, context: Partial<SessionContext>): Promise<void>
  }
  query: {
    run(sessionId: SessionId, sql: string, options?: RunOptions): Promise<QueryId>
    cancel(queryId: QueryId): Promise<void>
    // Streaming results via event channel (see below)
  }
  schema: {
    listDatabases(sessionId: SessionId): Promise<string[]>
    listSchemas(sessionId: SessionId, db: string): Promise<string[]>
    listObjects(sessionId: SessionId, db: string, schema: string): Promise<SchemaObject[]>
    getColumns(sessionId: SessionId, obj: ObjectRef): Promise<Column[]>
    getDDL(sessionId: SessionId, obj: ObjectRef): Promise<string>
  }
  history: {
    list(filter?: HistoryFilter): Promise<HistoryEntry[]>
    get(id: string): Promise<HistoryEntry>
  }
  workspace: {
    saveLayout(layout: LayoutTree): Promise<void>
    loadLayout(): Promise<LayoutTree>
    saveWorksheet(w: Worksheet): Promise<void>
    listWorksheets(): Promise<Worksheet[]>
  }
}
```

Streaming results use event channels (`onQueryRowBatch`, `onQueryComplete`, `onQueryError`) returned as cleanup handles from `query.run`.

### 5.3 Connection lifecycle

- A **ConnectionProfile** is persistent (DB row), holds account URL + auth method + non-secret config; secrets live in `safeStorage`.
- A **Session** is a runtime concept: one connection to Snowflake with a specific `(role, warehouse, database, schema)` context. Multiple sessions can share one profile.
- A **WorksheetPane** holds a reference to a Session. Switching context = `sessions.setContext` (cheap, `USE ROLE` / `USE WAREHOUSE` SQL). Switching profile = open a new session.
- The main process maintains a session pool keyed by `(profileId, role, warehouse)`. Database/schema are per-query `USE` statements.

### 5.4 Pane model (the headline feature)

A **LayoutTree** is a recursive structure:

```ts
type LayoutTree =
  | { kind: 'leaf', paneId: string }
  | { kind: 'split', direction: 'h' | 'v', sizes: number[], children: LayoutTree[] }
```

A **Pane** is a self-contained worksheet:

```ts
type Pane = {
  id: string
  worksheetId: string         // FK to persisted worksheet content
  sessionId: SessionId | null
  context: SessionContext     // role/warehouse/db/schema
  scratch: { sql: string, cursor: Position }
  results: QueryResult | null
  status: 'idle' | 'running' | 'error'
}
```

Splitting = wrap a leaf in a split node, persist, re-render via `svelte-splitpanes`. Closing a pane = remove from tree, collapse the split. Each pane has its own session, so cmd+Enter in pane A doesn't touch pane B.

### 5.5 Persistence schema (better-sqlite3)

```sql
CREATE TABLE connection_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_url TEXT NOT NULL,
  auth_method TEXT NOT NULL,         -- 'externalbrowser' | 'password_mfa' | 'password'
  username TEXT NOT NULL,
  default_role TEXT,
  default_warehouse TEXT,
  default_database TEXT,
  default_schema TEXT,
  -- secret material lives in safeStorage keyed by `profile:${id}`
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE worksheets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  cursor_line INTEGER,
  cursor_col INTEGER,
  last_session_context_json TEXT,    -- last role/warehouse/db/schema
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE query_history (
  id TEXT PRIMARY KEY,
  worksheet_id TEXT,
  profile_id TEXT NOT NULL,
  role TEXT,
  warehouse TEXT,
  database_name TEXT,
  schema_name TEXT,
  sql TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,              -- 'success' | 'error' | 'cancelled'
  row_count INTEGER,
  bytes_scanned INTEGER,
  query_id TEXT,                     -- Snowflake-side query ID for later credit lookup
  error_message TEXT
);
CREATE INDEX idx_history_started ON query_history(started_at DESC);
CREATE INDEX idx_history_worksheet ON query_history(worksheet_id);

CREATE TABLE pane_layout (
  workspace_id TEXT PRIMARY KEY,     -- 'default' for v0.1 (single workspace)
  tree_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE schema_cache (
  profile_id TEXT NOT NULL,
  database_name TEXT NOT NULL,
  schema_name TEXT,
  object_type TEXT NOT NULL,         -- 'table' | 'view' | 'database' | 'schema' | 'column'
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, database_name, schema_name, object_type)
);
```

---

## 6. Repo structure (target end-of-v0.1)

```
snowboy/
├─ .github/
│  └─ workflows/
│     └─ ci.yml
├─ .sisyphus/
│  └─ plans/
│     └─ snowboy-mvp-v0.1.md         ← this file
├─ build/                              ← electron-builder resources (icons, etc.)
├─ resources/                          ← runtime assets
├─ src/
│  ├─ main/
│  │  ├─ index.ts                     ← entry
│  │  ├─ ipc/
│  │  │  ├─ index.ts                  ← register all handlers
│  │  │  ├─ connections.ts
│  │  │  ├─ sessions.ts
│  │  │  ├─ query.ts
│  │  │  ├─ schema.ts
│  │  │  ├─ history.ts
│  │  │  └─ workspace.ts
│  │  ├─ snowflake/
│  │  │  ├─ pool.ts                   ← session pool
│  │  │  ├─ session.ts                ← single session wrapper around snowflake-sdk
│  │  │  ├─ auth.ts                   ← externalbrowser / password / mfa
│  │  │  └─ streaming.ts              ← chunked row streaming over IPC
│  │  ├─ storage/
│  │  │  ├─ db.ts                     ← better-sqlite3 init + migrations
│  │  │  ├─ migrations/
│  │  │  │  └─ 001_initial.sql
│  │  │  ├─ profiles.ts
│  │  │  ├─ worksheets.ts
│  │  │  ├─ history.ts
│  │  │  ├─ layout.ts
│  │  │  └─ schemaCache.ts
│  │  ├─ secrets/
│  │  │  └─ safeStorage.ts            ← wrapper with linux-no-keyring fallback warning
│  │  ├─ window/
│  │  │  └─ main.ts                   ← BrowserWindow creation, menus
│  │  └─ types.ts                     ← shared types between main and renderer
│  ├─ preload/
│  │  └─ index.ts                     ← contextBridge.exposeInMainWorld('snowboy', api)
│  └─ renderer/
│     ├─ index.html
│     ├─ main.ts
│     ├─ App.svelte
│     ├─ app.css                      ← Tailwind entry
│     ├─ lib/
│     │  ├─ components/
│     │  │  └─ ui/                    ← shadcn-svelte components (buttons, dialogs, …)
│     │  ├─ shell/
│     │  │  ├─ TopBar.svelte          ← profile + role/wh/db/schema selectors
│     │  │  ├─ LeftRail.svelte        ← object browser
│     │  │  ├─ StatusBar.svelte
│     │  │  └─ TabBar.svelte
│     │  ├─ panes/
│     │  │  ├─ PaneTree.svelte        ← recursive split tree renderer
│     │  │  ├─ WorksheetPane.svelte
│     │  │  └─ paneStore.ts
│     │  ├─ editor/
│     │  │  ├─ SqlEditor.svelte
│     │  │  └─ snowflakeDialect.ts    ← CodeMirror language extension
│     │  ├─ results/
│     │  │  ├─ ResultsGrid.svelte
│     │  │  └─ exportCsv.ts
│     │  ├─ browser/
│     │  │  └─ ObjectBrowser.svelte
│     │  ├─ history/
│     │  │  └─ HistoryPanel.svelte
│     │  ├─ connections/
│     │  │  ├─ ConnectionWizard.svelte
│     │  │  └─ ProfileList.svelte
│     │  ├─ stores/
│     │  │  ├─ panes.ts
│     │  │  ├─ profiles.ts
│     │  │  ├─ sessions.ts
│     │  │  ├─ history.ts
│     │  │  └─ ui.ts                  ← theme, modal state, etc.
│     │  ├─ ipc/
│     │  │  └─ client.ts              ← typed wrapper around window.snowboy
│     │  └─ utils/
│     │     └─ keymap.ts              ← cmd+enter, cmd+\ for split, cmd+T, etc.
│     └─ assets/
├─ tests/
│  ├─ unit/
│  └─ e2e/
│     └─ playwright.config.ts
├─ electron.vite.config.ts
├─ svelte.config.js
├─ tailwind.config.ts
├─ postcss.config.js
├─ tsconfig.json                      ← root, references the three below
├─ tsconfig.main.json
├─ tsconfig.preload.json
├─ tsconfig.renderer.json
├─ eslint.config.js
├─ prettier.config.js
├─ electron-builder.yml
├─ bunfig.toml
├─ package.json
├─ LICENSE                            ← MIT (default for personal-tool-going-OSS)
├─ README.md
└─ .gitignore
```

---

## 7. Task graph

All task IDs are stable identifiers; downstream we will create matching items in the task tracker.

### Wave 0 — Repo bootstrap (sequential, ~0.5 day)
- T0.1 → blocks all
- T0.2 → blocks all wave-1 tasks

### Wave 1 — Foundation (parallel after T0.2, ~3 days)
Tasks T1.1 – T1.6 run **in parallel**; none depend on each other.

### Wave 2 — UI components (parallel after Wave 1, ~5 days)
T2.1 – T2.8 run in parallel. T2.1 depends on T1.5 and T1.6.

### Wave 3 — Wiring (parallel after Wave 2, ~4 days)
T3.1 – T3.7. T3.1 depends on T1.2 + T1.4 + T2.8. T3.2 depends on T3.1. T3.3/T3.4 depend on T3.1 + T2.1. Others depend on T3.1.

### Wave 4 — Persistence & polish (parallel after Wave 3, ~3 days)
T4.1 – T4.5. T4.1/T4.2 depend on T1.3. T4.5 depends on Wave 2 complete.

### Wave 5 — Packaging & release (sequential, ~2 days)
T5.1 → T5.2 → T5.3 (can parallelize the three platform builds) → T5.4 → T5.5.

---

## 8. Task details

### Wave 0

#### T0.1 — Repo bootstrap

**Scope**: Initialize git repo. Set up `package.json` with Bun. Install Electron 32 + electron-vite + Svelte 5 + TypeScript 5.5+. Configure three tsconfigs. Set up Tailwind + shadcn-svelte init. Configure ESLint + Prettier. Configure Playwright + bun test. Write `.gitignore`. Write skeleton `README.md` and `LICENSE` (MIT).

**Files**: `package.json`, `bunfig.toml`, `tsconfig*.json`, `electron.vite.config.ts`, `svelte.config.js`, `tailwind.config.ts`, `postcss.config.js`, `eslint.config.js`, `prettier.config.js`, `.gitignore`, `README.md`, `LICENSE`, `src/main/index.ts` (stub), `src/preload/index.ts` (stub), `src/renderer/main.ts` (stub), `src/renderer/App.svelte` (stub), `src/renderer/index.html` (Vite-convention entry — must be `index.html` so the dev server serves it at `/`; loading `app.html` returns 404).

**Acceptance**: `bun install` succeeds. `bun run dev` launches an empty Electron window with "Snowboy" title. `bun test` runs zero tests with exit 0. `bun run lint` runs clean. Playwright config compiles.

**Manual QA**: Launch app on Linux, confirm window opens, confirm DevTools opens with cmd+shift+I. No errors in console.

**Delegation**: `task(category="systems", load_skills=[])` — TypeScript-heavy setup, no UI work yet.

**Estimate**: 4 hours.

---

#### T0.2 — Native-module rebuild smoke test

**Scope**: Add `better-sqlite3` and `snowflake-sdk` as dependencies. Wire `electron-rebuild` (or `@electron/rebuild`) into `postinstall`. Verify both load in the main process without rebuilding errors on Linux, Windows, macOS.

**Files**: `package.json` (deps + scripts), `src/main/index.ts` (smoke load), `scripts/rebuild-natives.ts`.

**Acceptance**: Fresh `bun install && bun run rebuild` on all three platforms loads both modules without error. `require('better-sqlite3')` and `require('snowflake-sdk')` succeed inside the Electron main process.

**Manual QA**: On Linux: delete `node_modules`, `bun install`, `bun run dev`, verify console logs "natives ok" emitted from main on startup.

**Delegation**: `task(category="systems", load_skills=[])`. Native module rebuild is a known footgun — must be solved before any further work.

**Risks**: Bun's `node_modules` layout may differ from npm's enough to confuse `@electron/rebuild`. **If this task fails, escalate to Oracle before continuing** — we may need to switch to `pnpm` for install while keeping `bun test` / `bun run`.

**Estimate**: 4 hours (with 4 hours of slack for fix-up).

---

### Wave 1

#### T1.1 — Typed IPC plumbing

**Scope**: Define the `SnowboyApi` type. Implement `contextBridge.exposeInMainWorld('snowboy', api)` in preload with all method signatures returning stubs. Register matching `ipcMain.handle` handlers in main that return `NotImplemented` errors. Wire a typed renderer-side client (`src/renderer/lib/ipc/client.ts`) that gives full autocomplete on `window.snowboy.*`.

**Files**: `src/main/types.ts`, `src/preload/index.ts`, `src/main/ipc/index.ts`, `src/main/ipc/*.ts` (stubs), `src/renderer/lib/ipc/client.ts`.

**Acceptance**: Calling `window.snowboy.connections.listProfiles()` from the renderer DevTools console returns a `NotImplemented` rejection. TypeScript autocomplete works end-to-end with strict mode.

**Manual QA**: Open DevTools in dev, type `window.snowboy.` and confirm autocomplete shows all top-level groups (connections, sessions, query, schema, history, workspace).

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 6 hours.

---

#### T1.2 — safeStorage credential layer

**Scope**: Wrap Electron's `safeStorage` API in a small module. Add a **fallback warning** for Linux when no keyring is available (`safeStorage.isEncryptionAvailable()` returns false). Expose `setSecret(key, value)` / `getSecret(key)` / `deleteSecret(key)`. Persist the encrypted blob to `app.getPath('userData')/secrets.json`.

**Files**: `src/main/secrets/safeStorage.ts`, `src/main/secrets/secrets.test.ts`.

**Acceptance**: `bun test src/main/secrets` passes. Round-trip a secret. On Linux without keyring, log a clear warning but still function with basic encryption fallback (documented as less secure).

**Manual QA**: On Linux without `libsecret`, app starts, warning appears in console, secrets still round-trip.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 4 hours.

---

#### T1.3 — better-sqlite3 setup + migrations

**Scope**: Initialize `better-sqlite3` at `app.getPath('userData')/snowboy.db`. Implement a tiny migration runner (read `.sql` files from `src/main/storage/migrations/` in order, apply, track `schema_migrations` table). Implement repo modules for each table in section 5.5: `profiles.ts`, `worksheets.ts`, `history.ts`, `layout.ts`, `schemaCache.ts`. Each exposes typed CRUD.

**Files**: `src/main/storage/db.ts`, `src/main/storage/migrations/001_initial.sql`, `src/main/storage/profiles.ts`, `src/main/storage/worksheets.ts`, `src/main/storage/history.ts`, `src/main/storage/layout.ts`, `src/main/storage/schemaCache.ts`, unit tests for each.

**Acceptance**: All migrations apply cleanly on a fresh install. Unit tests pass: CRUD round-trip for each table. Foreign-key constraints enforced.

**Manual QA**: Delete `snowboy.db`, launch app, verify the file is recreated with all tables.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 8 hours.

---

#### T1.4 — Snowflake driver wiring (session + pool)

**Scope**: Implement `Session` class wrapping `snowflake-sdk` + `snowflake-promise`. Implement three auth flows in `auth.ts`:
- `externalbrowser`: opens system default browser, listens on localhost callback as the SDK directs.
- `password_mfa`: passes password + sets `authenticator=username_password_mfa`.
- `password`: plain password.

Implement a `SessionPool` keyed by `(profileId, role, warehouse)`. Sessions are lazily created; idle sessions are closed after 30 min.

Streaming: implement `runStreaming(sql, opts, onBatch, onComplete, onError)` using `statement.streamRows({start, end})` in 1000-row batches, emitting batches over IPC event channels.

**Files**: `src/main/snowflake/session.ts`, `src/main/snowflake/pool.ts`, `src/main/snowflake/auth.ts`, `src/main/snowflake/streaming.ts`, unit tests (mocked driver).

**Acceptance**: Unit tests pass (mocked). Integration smoke test with a real Snowflake trial account passes locally for at least the `password` auth path (others tested manually).

**Manual QA**: Connect to a Snowflake trial via password auth, run `SELECT 1`, see result.

**Delegation**: `task(category="systems", load_skills=[])` — Snowflake driver knowledge concentrated here.

**Estimate**: 12 hours (this is the highest-risk task in Wave 1).

---

#### T1.5 — Tailwind + shadcn-svelte initial component pull

**Scope**: Verify Tailwind compiles. Run `bunx shadcn-svelte init`. Pull the components we'll need: `button`, `dialog`, `dropdown-menu`, `input`, `label`, `select`, `tabs`, `separator`, `tooltip`, `toast`, `command` (for cmd+k palette), `resizable`, `scroll-area`. Configure dark mode (class strategy).

**Files**: `tailwind.config.ts`, `src/renderer/lib/components/ui/*` (generated by shadcn-svelte), `src/renderer/app.css`.

**Acceptance**: A toy page in the renderer renders a `<Button>` with shadcn styling. Dark-mode toggle works via a body class.

**Manual QA**: Visual check the components render correctly.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 6 hours.

---

#### T1.6 — App shell layout

**Scope**: Implement the static layout shell (no data wiring yet): top bar with placeholder dropdowns (profile / role / warehouse / database / schema), left rail (object browser placeholder), main area (placeholder where pane tree will go), status bar at bottom. Use `svelte-splitpanes` for the left-rail/main split.

**Files**: `src/renderer/App.svelte`, `src/renderer/lib/shell/TopBar.svelte`, `src/renderer/lib/shell/LeftRail.svelte`, `src/renderer/lib/shell/StatusBar.svelte`, `src/renderer/lib/shell/TabBar.svelte`.

**Acceptance**: Visual: app launches with the expected layout. Resizing the left rail works. No data wired — placeholders show "Not connected".

**Manual QA**: Launch app, drag the splitter, confirm smooth resize.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 6 hours.

---

### Wave 2

#### T2.1 — WorksheetPane skeleton

**Scope**: Composite component containing editor (placeholder), results grid (placeholder), per-pane context selectors at the top (role / warehouse / db / schema dropdowns), run/cancel buttons, status line at bottom (timing, bytes, warehouse used). No data wiring.

**Files**: `src/renderer/lib/panes/WorksheetPane.svelte`, `src/renderer/lib/panes/paneStore.ts`.

**Acceptance**: Visual: component renders with all sub-regions. Per-pane context selectors are independent (changing in pane A doesn't affect pane B once two are rendered).

**Manual QA**: Render two pane instances side-by-side in a Storybook-like dev page, confirm independence.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 6 hours.

---

#### T2.2 — CodeMirror 6 + Snowflake dialect

**Scope**: Wire `svelte-codemirror-editor` into the WorksheetPane. Build a Snowflake SQL language extension covering: standard SQL keywords + Snowflake-specific (`QUALIFY`, `MATCH_RECOGNIZE`, `LATERAL FLATTEN`, `PIVOT`, `UNPIVOT`, `AT`, `BEFORE`, `CHANGES`, `$$...$$` dollar-quoted strings, semicolon statement separation, Snowflake function names from `INFORMATION_SCHEMA.FUNCTIONS`-style list). Configure: line numbers, bracket matching, multi-cursor, find/replace, syntax highlighting, theme (light + dark).

**Files**: `src/renderer/lib/editor/SqlEditor.svelte`, `src/renderer/lib/editor/snowflakeDialect.ts`, dialect unit tests.

**Acceptance**: Snowflake-specific keywords highlight correctly. Multi-cursor works (cmd+click). Find/replace works (cmd+F).

**Manual QA**: Paste a real-world Snowflake query with QUALIFY + dollar-quoted string, verify highlighting.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 10 hours.

---

#### T2.3 — TanStack results grid

**Scope**: `@tanstack/svelte-table` integration with virtualization (`@tanstack/svelte-virtual`). Columns derived from result schema. Sticky header, column resize, click cell to view full value in a side panel for long strings/JSON. Row selection (click + shift-click range). Copy region (cmd+C copies tab-separated values for selected region).

**Files**: `src/renderer/lib/results/ResultsGrid.svelte`, `src/renderer/lib/results/exportCsv.ts`.

**Acceptance**: 100k rows render at 60fps on scroll. Column resize persists per session. CSV export downloads a valid file.

**Manual QA**: Feed 100k synthetic rows, scroll, resize columns, select a region, paste into a spreadsheet — verify content.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 10 hours.

---

#### T2.4 — Split pane system

**Scope**: Implement `PaneTree.svelte` — recursive renderer of `LayoutTree`. Use `svelte-splitpanes` for the actual splitter. Keyboard shortcuts (registered globally): `cmd+\` split current pane vertically, `cmd+shift+\` split horizontally, `cmd+w` close current pane (collapse split if last). Active pane is highlighted with a 1px border accent.

**Files**: `src/renderer/lib/panes/PaneTree.svelte`, `src/renderer/lib/stores/panes.ts`, `src/renderer/lib/utils/keymap.ts`.

**Acceptance**: Open default single pane. cmd+\ creates a vertical split with two equal panes. cmd+\ on the right pane creates a 3-pane row. cmd+w closes panes correctly. State is purely in memory in this task (persistence comes in T4.1).

**Manual QA**: Split, split, split until 4 panes. Resize. Close one. Verify layout reflows correctly.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 8 hours.

---

#### T2.5 — Tab system

**Scope**: Tabs at the workspace level (above the pane tree). Each tab owns its own pane tree. cmd+T new tab (with default single-pane layout), cmd+1..9 switch tabs, cmd+shift+] / cmd+shift+[ next/previous tab. Tab title = first non-comment line of the active pane's worksheet, truncated to 30 chars, "•" prefix if dirty.

**Files**: `src/renderer/lib/shell/TabBar.svelte`, `src/renderer/lib/stores/tabs.ts`.

**Acceptance**: Open multiple tabs, switch with keyboard, close with middle-click or "x" button.

**Manual QA**: 10 tabs open, switch with cmd+1..9, close some, confirm correct active tab tracking.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 6 hours.

---

#### T2.6 — Object browser tree

**Scope**: Tree component in left rail: profile → databases → schemas → (tables | views | functions) → columns. Lazy-load children on expand. Right-click context menu: "Select 100 rows" (inserts SQL into active pane), "Show DDL" (opens a modal with the DDL), "Copy fully qualified name".

**Files**: `src/renderer/lib/browser/ObjectBrowser.svelte`, `src/renderer/lib/browser/DdlDialog.svelte`.

**Acceptance**: Visual: tree renders. Expand works with loading state. Context menu fires correctly. (Data is mocked at this point; wired in T3.5.)

**Manual QA**: Mock data, expand levels, right-click → "Select 100" inserts SQL into the active pane.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 8 hours.

---

#### T2.7 — Query history panel

**Scope**: Panel (toggleable, e.g. in a bottom drawer or right-rail tab) listing query history. Each row: timestamp, status icon, truncated SQL, duration, role/warehouse. Search box (substring match on SQL). Click → restore SQL into active pane.

**Files**: `src/renderer/lib/history/HistoryPanel.svelte`.

**Acceptance**: Renders mocked history. Search filters correctly. Click restores SQL.

**Manual QA**: Mock 1000 history entries, scroll smoothly, search, click an entry, verify SQL appears in active pane editor.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 6 hours.

---

#### T2.8 — Connection wizard + profile list

**Scope**: Two-screen flow:
1. **Profile list**: shows saved profiles, "Add new" button, edit/delete actions per row.
2. **Wizard**: prompts for name, account URL, auth method (radio: SSO / password+MFA / password), username, optional defaults (role/wh/db/schema). On "Save", returns to list. On "Save & Connect", calls `connections.test` first; on success, transitions to the workspace with that profile active.

For SSO: a "Connect" button on the profile invokes the externalbrowser flow.

**Files**: `src/renderer/lib/connections/ConnectionWizard.svelte`, `src/renderer/lib/connections/ProfileList.svelte`, `src/renderer/lib/stores/profiles.ts`.

**Acceptance**: Visual + form validation. Mocked IPC at this stage.

**Manual QA**: Step through wizard, try invalid inputs, confirm validation messages.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 10 hours.

---

### Wave 3 — Wiring

#### T3.1 — Profile CRUD wiring

**Scope**: Wire `connections.listProfiles / saveProfile / deleteProfile / test` from the renderer through IPC into `profiles.ts` storage + `safeStorage` for secrets. `test()` opens a short-lived session, runs `SELECT CURRENT_ROLE()`, closes.

**Acceptance**: Create a profile, save it, restart app, profile persists. Test connection returns success/failure.

**Manual QA**: Real Snowflake trial account, save profile, restart, confirm it's still there, test it.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 6 hours.

---

#### T3.2 — Session open + context switch

**Scope**: Wire `sessions.open / setContext / close`. `setContext` issues `USE ROLE` / `USE WAREHOUSE` / `USE DATABASE` / `USE SCHEMA` on the active connection.

**Acceptance**: From a pane's context dropdowns, change role; subsequent `SELECT CURRENT_ROLE()` reflects the change. Each pane's session is independent.

**Manual QA**: Two panes, set different roles, run `SELECT CURRENT_ROLE()` in each, verify different results.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 6 hours.

---

#### T3.3 — Query run + cancel

**Scope**: Wire `query.run` and `query.cancel`. Renderer dispatches run with current pane's sessionId + sql. Main streams batches back via IPC events. Cancel invokes Snowflake-side query cancellation.

**Acceptance**: Run a 30-second query, cancel it mid-flight, verify Snowflake-side `QUERY_HISTORY` shows it as `CANCELLED`.

**Manual QA**: `SELECT SYSTEM$WAIT(30);` → cancel after 5s → check QUERY_HISTORY.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 8 hours.

---

#### T3.4 — Result streaming into TanStack

**Scope**: Renderer-side: subscribe to `onQueryRowBatch` for the active pane's running query. Append rows to a row buffer fed into TanStack table. Throttle UI updates to ~30 fps (no more frequent than every 33ms) to avoid renderer lock-up on fast queries.

**Acceptance**: Run `SELECT * FROM SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.LINEITEM LIMIT 100000;` → rows stream in, UI stays responsive, final count is correct.

**Manual QA**: As above, scroll while streaming, confirm no jank.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 8 hours.

---

#### T3.5 — Object browser data wiring

**Scope**: Wire `schema.listDatabases / listSchemas / listObjects / getColumns / getDDL`. Backing queries hit `INFORMATION_SCHEMA` and `GET_DDL()`. Cache results in `schema_cache` for 5 minutes. Refresh on right-click "Refresh".

**Acceptance**: Tree expands and shows real databases/schemas/tables. DDL viewer shows correct DDL.

**Manual QA**: Expand all levels on a test account, verify against Snowsight. Right-click a table → DDL.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 8 hours.

---

#### T3.6 — Query history capture

**Scope**: Every query run/cancel/error inserts into `query_history` with all metadata. Renderer-side: `history.list` returns latest 1000 entries ordered by `started_at DESC`. Re-running a history entry (click) inserts SQL into the active pane.

**Acceptance**: Run 5 queries, restart app, history panel still shows them.

**Manual QA**: Same.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 4 hours.

---

#### T3.7 — DDL viewer

**Scope**: Modal that shows `GET_DDL('TABLE', '<fully-qualified-name>')` result with CodeMirror in read-only mode (for syntax highlighting). Copy-to-clipboard button.

**Acceptance**: Click "Show DDL" on a table in the object browser → DDL appears.

**Manual QA**: As above.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 4 hours.

---

### Wave 4 — Persistence & polish

#### T4.1 — Pane layout persistence

**Scope**: On layout change (split / close / resize), debounce-save the layout tree as JSON to `pane_layout`. On startup, load and restore. Each leaf pane references a `worksheetId`.

**Acceptance**: Set up a 3-pane layout, close app, reopen, layout restored.

**Manual QA**: Same.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 6 hours.

---

#### T4.2 — Worksheet persistence

**Scope**: Each pane's editor content is persisted as a `worksheet` row. Debounced save on edit (500ms). New panes get a fresh worksheet. Closing a pane does NOT delete the worksheet (orphan worksheets are reachable via cmd+P palette in v0.2).

**Acceptance**: Type SQL in a pane, close app, reopen — content restored.

**Manual QA**: Same.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 6 hours.

---

#### T4.3 — Settings UI

**Scope**: Settings dialog with sections: General (theme, font size), Connections (profile list, same as wizard but in-app), Editor (tab width, wrap), Advanced (data directory, "Open log folder"). Persisted in a `settings` table or a flat JSON file at `userData/settings.json`.

**Acceptance**: Change a setting, restart app, setting persists.

**Manual QA**: Same.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 6 hours.

---

#### T4.4 — Theme (dark / light / system)

**Scope**: Three theme modes. System mode reads `nativeTheme.shouldUseDarkColors` and reacts to changes. CSS variables for color tokens applied via body class. Both shadcn-svelte components and CodeMirror theme switch together.

**Acceptance**: Toggle theme in settings, all of UI + editor follow. System mode follows OS change live.

**Manual QA**: Same.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 4 hours.

---

#### T4.5 — Keyboard shortcuts pass

**Scope**: Audit and finalize all keyboard shortcuts. Document them in `Help → Keyboard Shortcuts` modal. Minimum set:

- `cmd+enter` run current statement (or selected text)
- `cmd+shift+enter` run all in current pane
- `cmd+.` cancel running query in current pane
- `cmd+\` split pane vertically
- `cmd+shift+\` split pane horizontally
- `cmd+w` close current pane (collapses split)
- `cmd+t` new tab
- `cmd+shift+t` reopen last closed tab
- `cmd+1..9` switch to tab N
- `cmd+,` settings
- `cmd+k` command palette (v0.2 placeholder)
- `cmd+s` save (auto-save happens too; cmd+s forces flush)
- `cmd+f` find in editor

**Acceptance**: All shortcuts work as documented on Linux/Windows/macOS (use platform-appropriate modifier).

**Manual QA**: Walk through every shortcut on each platform.

**Delegation**: `task(category="visual-engineering", load_skills=["frontend-ui-ux"])`.

**Estimate**: 6 hours.

---

### Wave 5 — Packaging & release

#### T5.1 — Linux build (AppImage + deb)

**Scope**: Configure `electron-builder.yml` for Linux. Produce `.AppImage` (universal) and `.deb`. Set up icon, desktop entry, categories.

**Acceptance**: `bun run build:linux` produces both artifacts. Each installs/runs cleanly on Ubuntu 22.04 + Fedora 39.

**Manual QA**: Install `.deb` on Ubuntu, run from Activities. Run `.AppImage` from Files.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 4 hours.

---

#### T5.2 — Windows build (NSIS installer + portable)

**Scope**: Configure for Windows. Produce NSIS installer + portable exe. No code signing for v0.1.

**Acceptance**: `bun run build:win` produces both. Installer runs on Windows 11. Portable exe runs without install.

**Manual QA**: Run installer, launch app, uninstall cleanly.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 4 hours.

---

#### T5.3 — macOS build (dmg, unsigned)

**Scope**: Configure for macOS. Produce `.dmg`. Document the unsigned-app right-click-open workaround in README. Universal binary (arm64 + x64).

**Acceptance**: `bun run build:mac` produces `.dmg`. App runs on macOS 13+ after right-click → Open.

**Manual QA**: Same.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 4 hours.

---

#### T5.4 — GitHub Actions CI

**Scope**: One workflow that runs on every push to `main` and on PR: `bun install`, `bun run lint`, `bun run typecheck`, `bun test`, Playwright smoke (launch + connect with mocked driver), build on all three OS matrix targets. Release workflow on git tag `v*`: produces all platform artifacts and creates a GitHub Release with them attached.

**Files**: `.github/workflows/ci.yml`, `.github/workflows/release.yml`.

**Acceptance**: Push a commit, CI passes on all three platforms. Tag `v0.1.0`, release artifacts appear on the GitHub Releases page.

**Manual QA**: Tag a test version `v0.0.1-test`, confirm release appears with all artifacts.

**Delegation**: `task(category="systems", load_skills=[])`.

**Estimate**: 6 hours.

---

#### T5.5 — README, screenshots, license

**Scope**: README with: project description, screenshots (3-4 of the workspace, split panes, results grid, object browser), install instructions per platform, quick-start (creating first profile), keyboard shortcuts, "not yet supported" list with links to issues. MIT LICENSE. CONTRIBUTING.md stub. Issue templates for bugs + features.

**Files**: `README.md`, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/*`, screenshots in `docs/screenshots/`.

**Acceptance**: Reader of README can install + create a profile + run a query without reaching out for help.

**Manual QA**: Have a Snowflake-experienced friend follow README cold; observe friction points.

**Delegation**: `task(category="writing", load_skills=[])`.

**Estimate**: 6 hours.

---

## 9. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bun + Electron native module rebuild fails | Medium | High | **T0.2 is the gate**. If it fails, fall back to `pnpm install` while keeping Bun for `run`/`test`. Decision point before Wave 1 starts. |
| `snowflake-sdk` externalbrowser auth flow doesn't interact well with Electron's BrowserWindow (callback URL issues, etc.) | Medium | Medium | Test early in T1.4. The driver uses an OS-default browser, so Electron is not in the loop for the redirect — but the callback listener port may conflict. Document fallback. |
| CodeMirror 6 Snowflake dialect insufficient out of the box | Medium | Low | Built progressively; start with subset of dialect, expand as we hit gaps. |
| safeStorage on headless Linux without keyring | High on CI/server installs | Low for personal-tool MVP | Document. Fallback to basic encryption. Add UI warning. |
| TanStack table virtualization with 1M+ rows | Low | Medium | Test with 100k early in T2.3. If 1M is needed, switch to canvas-rendered grid (Glide Data Grid) — defer to v0.2. |
| Snowflake driver memory blow-up on `streamRows` with poorly-paged chunks | Medium | Medium | v2.4.1 has improvements; use bounded backpressure in `streaming.ts`. |
| svelte-splitpanes recursive layout edge cases (collapse-last, resize after deep nesting) | Medium | Low | Cover with Playwright E2E for split/close cycles. |
| `shadcn-svelte` component coverage gaps for IDE chrome (e.g., command palette) | Low | Low | The components in T1.5 cover MVP; command palette is v0.2. |
| Cross-platform keyboard shortcut differences (cmd vs ctrl) | Certain | Low | Use a `mod` abstraction in `keymap.ts`. |
| `electron-builder` failing on cross-OS builds in GitHub Actions | Medium | Medium | Use platform-matching runners (`ubuntu-latest`, `windows-latest`, `macos-latest`), don't cross-build. |

---

## 10. Open architectural questions (decided during implementation, not blockers now)

1. **Result chunk size**: 1000 rows per batch? 5000? Tunable. Default 1000, measure.
2. **Schema cache TTL**: 5 minutes default, expose in settings.
3. **Active pane indicator**: 1px accent border vs background tint vs both. Decided in T2.4.
4. **Tab close behavior**: confirm-on-close if dirty? Or trust auto-save and silently close? v0.1: silent close, auto-save guarantees persistence.
5. **Command palette in v0.1?**: cmd+k is bound but only shows "Coming soon" toast. Real palette is v0.2.
6. **Single workspace vs multiple workspaces in v0.1?**: Single. Multiple is v0.2.
7. **Snowsight worksheet import**: Out of scope for v0.1.
8. **Telemetry / crash reporting**: None in v0.1. Personal-tool scope.

---

## 11. Estimate

- **Total estimated effort**: ~200 hours of focused implementation.
- **One dev, full-time focused**: ~5 weeks.
- **One dev, evenings-and-weekends**: ~10-12 weeks.
- **Critical path**: T0.1 → T0.2 → T1.4 (Snowflake driver) → T3.3 (query run) → T3.4 (streaming). Everything else can be parallelized around this spine.

---

## 12. Definition of Done for v0.1

All 11 acceptance criteria in section 2 verified manually on Linux and Windows. Build artifacts published as a GitHub Release. README sufficient for cold install. No P0 bugs in the issue tracker. Personal-use dogfooding has happened for at least one week without crashes.

After v0.1 ships, the project transitions to public OSS: announce on r/snowflake + Hacker News, accept community issues, set up a roadmap for v0.2.
