# Snowboy Wave 4 — Persistence & Polish [v2, hyperplan-corrected]

Parent plan: [`.sisyphus/plans/snowboy-mvp-v0.1.md`](snowboy-mvp-v0.1.md) §T4.1–T4.5.

## Live progress (2026-05-20)

**Phase 0 + Phase A: ✅ COMPLETE.** All 9 task commits + 4 polish commits pushed to `origin/main`. 273 unit tests passing. e2e smoke green. typecheck/lint clean.

| Task | Status | Commit |
|---|---|---|
| Phase 0 contract patch | ✅ | `7e9f68d` |
| T4.5a keymap registry | ✅ | `bddf4f5` |
| exportCsv hardening | ✅ | `b2db5c4` |
| T4.2 worksheet persistence | ✅ | `27cc634` |
| T4.3a settings storage | ✅ | `1889437` |
| T4.4a theme bridge + FOUC | ✅ | `0233de1` |
| T4.1 layout persistence + close flush | ✅ | `da9134e` |
| B1 schema cache + Refresh | ✅ | `692d33a` |
| B3 live session context | ✅ | `bee02ed` |
| smoke WSL fix | ✅ | `a1e7faa` |
| mirror bug fix | ✅ | `151ca1f` |
| dropdowns + keymap remap | ✅ | `d4a1b80` |
| Ctrl+W fix | ✅ | `630b4ab` |

**Next: Phase B** (T4.3b dialog, T4.4b CodeMirror compartment, T4.5b Cmd+Enter run-at-cursor, T4.5c help modal, Recently-Closed recovery). Also still pending: B2 virtualized grid.

Detailed handoff at [`.sisyphus/plans/snowboy-handoff-2026-05-20.md`](snowboy-handoff-2026-05-20.md).

---

## Revision history

**v1 (REJECTED)** — initial plan; 60+ findings from 5-agent hyperplan adversarial review (reactivity / data-correctness / concurrency / UX / scope critics). Failed because:
1. Plan claimed files were **NEW** that **already exist** from Wave 1 (`layout.ts`, `worksheets.ts`, `schemaCache.ts`). 8 agents fanning out would have collided and rewritten working code.
2. paneId ↔ worksheetId persistence path was never specified — on first restart, every worksheet would orphan.
3. "8-way parallel" was fictional — 5 of 8 tasks mutate `channels.ts`, 3 mutate `types.ts`.
4. App-close flush relied on async IPC during renderer destroy, which Electron drops.
5. Theme FOUC fix was not achievable with `$effect` (runs AFTER first paint).

See git history at HEAD~1 for the original v1 plan.

**v2 (current, this doc)** — fully rebaselined against actual codebase, design decisions resolved, app-close orchestration redesigned, foundation pre-flight phase added.

---

## Status overview

| Task | v1 effort | v2 effort | Δ | Reason |
|---|---|---|---|---|
| **Phase 0 — Pre-flight contract patch** | — | **4h** | +4 | NEW. Mandatory before any Phase A work. |
| T4.1 — Pane layout persistence | 6h | 5h | -1 | Existing `layout.ts` already CRUDs; net work is per-tab IPC + integration |
| T4.2 — Worksheet body persistence | 6h | 7h | +1 | Adds upsert (existing `update` throws) + hydration-before-save gate |
| T4.3a — Settings storage layer | 2h | 3h | +1 | Adds Windows rename retry + clamping on read |
| T4.3b — Settings UI dialog | 4h | 8h | +4 | ConnectionWizard embedding alone could blow the v1 budget |
| T4.4a — Theme store + bridge | 2h | 3h | +1 | Adds preload-injected initial class for FOUC fix |
| T4.4b — Theme swap + CodeMirror | 2h | 3h | +1 | Replaces SqlEditor's broad reconfigure with explicit compartments |
| T4.5a — Keymap util extension | 2h | 3h | +1 | Per-shortcut focus rules (not one global rule) + `e.code` for intl keyboards |
| T4.5b — Cmd+Enter run-at-cursor | 3h | 5h | +2 | splitSql rework to emit all segments + CM6 keymap extension + statementAtOffset with comment detection |
| T4.5c — Shortcuts help modal | 1h | 1h | 0 | OS-formatted display strings, no extra effort if done in T4.5a |
| B1 — Schema cache + Refresh | 4h | 3h | -1 | Reuses existing `schemaCache.ts`; net work is invalidate channel + UI button |
| B2 — Virtualized grid + fixes | 5h | 8h | +3 | Sticky headers complexity + multiline VARCHAR indicator + reactive row height |
| B3 — Live session context | 3h | 4h | +1 | Adds USE-statement post-execute hook + `$state` (not async getter) |
| **`exportCsv.ts` hardening (NEW)** | — | **2h** | +2 | Block B2 until Date/BigInt/object serialization fixed |
| **`PaneTree.svelte` resize wiring (NEW)** | — | **1h** | +1 | Resize callback writes back to store; was missing from v1 |
| **Recently-Closed recovery (NEW)** | — | **2h** | +2 | Replaces "orphan worksheets are intentional" with a basic recovery UI |
| **Migration 002 (NEW)** | — | **1h** | +1 | Adds `worksheetId` to LayoutTree leaves + `scroll_top INTEGER` to worksheets |
| Total | 40h | **63h** | **+23** | Realistic given hyperplan findings |

**v2 wall-clock with corrected parallelism**: 4–5 days, vs v1's optimistic 2–3.

---

## Critical findings from hyperplan (synthesized)

### P0 — Cross-confirmed by 3+ critics (kickoff blockers)

| # | Finding | Critics | Resolution |
|---|---|---|---|
| 1 | `layout.ts` / `worksheets.ts` / `schemaCache.ts` **already exist** — plan called them NEW | concurrency #B1, data #C-7, reactivity #1 | v2 marks them as **EXISTING**; subtasks become "wire/extend", not "create" |
| 2 | paneId ↔ worksheetId persistence path missing — all worksheets orphan on first restart | concurrency #B4, data #B-1, reactivity #6 | v2 Phase 0 adds `worksheetId` field to `LayoutTree` leaf type; Migration 002 |
| 3 | "8-way parallel" fictional — `channels.ts` mutated by 5+ tasks | concurrency #B2, reactivity #16, data observation | v2 Phase 0 is a single-owner contract patch that lands first |
| 4 | App-close flush broken — async IPC during renderer destroy drops; main closes DB before flush | ux #1, concurrency #B5, data #C-1, reactivity #3 | v2 redesigns `before-quit` with `event.preventDefault()` + main-coordinated flush protocol |
| 5 | FOUC not avoidable with `$effect` — runs after first paint | ux #2, concurrency #B7, reactivity #8 | v2 reads `settings.json` synchronously in preload; injects initial class before renderer hydrates |

### P0 — Critical bugs (1–2 critics, would still ship broken)

| # | Finding | Critic | Resolution |
|---|---|---|---|
| 6 | `splitSql.ts` drops comment-only segments → cursor in comment runs WRONG statement against prod | data #B-2, reactivity #12 | v2 reworks splitter to emit ALL segments with `kind: 'stmt' \| 'comment' \| 'ws'`; comment cursor → no-op |
| 7 | "byte-ranges" wrong — CodeMirror uses UTF-16 code units, not bytes | scope #2, reactivity #11 | v2 spec says "JS string indices (UTF-16 code units)" everywhere |
| 8 | `USE DATABASE FOO;` in editor mutates session, bypasses B3 cache → dropdowns lie → user fires DELETE on wrong DB | scope #1, data #C-3 | v2 adds post-execute regex hook for `USE (DATABASE\|SCHEMA\|WAREHOUSE\|ROLE)` → cache invalidate |
| 9 | SqlEditor's existing root `StateEffect.reconfigure` will lose editor state when adding theme Compartment | reactivity #9 | v2 replaces root reconfigure with explicit compartments (`themeCompartment`, `readOnlyCompartment`, `placeholderCompartment`) |
| 10 | `@tanstack/svelte-table` still in `package.json` despite being banned | reactivity #17 | v2 Phase 0 removes it; `@tanstack/svelte-virtual` (different package) stays |
| 11 | `PaneTree.svelte` reads `tree.sizes[i]` but never writes resize back → resizes lost on restart | reactivity #5 | v2 adds `PaneTree.svelte` to T4.1 touch list with resize callback |
| 12 | Settings atomic write throws EPERM on Windows under AV / OneDrive | ux #6, data #C-2 | v2 spec: 3-retry-with-50ms-backoff on `fs.renameSync`; unlink-then-rename fallback |
| 13 | No transaction wraps cross-table save — power loss = dangling `worksheetId` refs | data #B-6 | v2 Phase 0 adds single `saveWorkspace({layout, worksheets})` IPC wrapped in `db.transaction()` |
| 14 | `exportCsv.ts` already silently corrupts Date (locale TZ), BigInt (precision), objects (escape collision); B2 amplifies | data #B-7 | v2 adds standalone `exportCsv.ts` hardening as gate-task BEFORE B2 |
| 15 | B2 fixed 28px row clips multi-line VARCHAR with no indicator | data #C-5, ux #4 | v2 row height = `Math.ceil(fontSize * 1.4)` reactive to settings.fontSize; clipped cells show "+N more lines" affordance |
| 16 | "Orphaned worksheets are intentional" = unacceptable data loss in v0.1 | ux #3 | v2 adds Recently-Closed recovery (5-item LRU shown in `Cmd+Shift+T` reopen-pane handler) |
| 17 | `Ctrl+/` broken on intl keyboards (German etc.) | ux #5 | v2 spec: `e.code === 'Slash'` not `e.key === '/'`; OS-formatted display string in shortcut modal |
| 18 | No clamping on settings read → `fontSize: -10` bricks app | data #C-8 | v2 boot-path clamps every numeric field; type-mismatch falls to default |
| 19 | First-save race — `updateWorksheet` throws if no row exists; debounce 2 racing with insert 1 | data #B-3 | v2 replaces `updateWorksheet` with atomic `upsertWorksheet` (INSERT ... ON CONFLICT DO UPDATE) |
| 20 | T4.5a's "block all global shortcuts inside `.cm-editor`" regresses existing `Cmd+\` split | reactivity #10 | v2 spec: per-shortcut `scope: 'global-allow-editor' \| 'global-block-editor' \| 'editor-only'`; cmd+\ is `global-allow-editor` |
| 21 | T4.3b `ConnectionWizard` embedding inside settings dialog not free — currently top-level component | scope #3 | v2 effort = 8h, not 4h; adds explicit refactor subtask |
| 22 | B2 sticky headers + virtualized table is "notoriously hacky" | scope #4 | v2 effort = 8h; spec uses `position: sticky` with explicit z-index ordering; scroll-container fixed |
| 23 | B3 `effectiveContext` must be `$state` / `SvelteMap` — async getter won't reactively update dropdowns | reactivity #15 | v2 spec: `#effectiveContext = new SvelteMap<SessionId, Context>()` |

### P1 — Design polish (multi-critic but lower blast radius)

- workspace_id per-tab uses ephemeral nanoids → v2 ships **single `'default'` workspace** for v0.1; per-tab persistence deferred to v0.2 (requires stable tab IDs persisted to disk)
- `splitActive` shared `worksheetId` ambiguity → v2 picks **new worksheet per pane** (avoids concurrent-write data loss)
- Cursor restoration timing must defer to post-CM-mount → v2 uses `EditorState.fromJSON` to bundle initial selection
- Highlight 500ms timer race on rapid Cmd+Enter → v2 uses single shared timer + clearTimeout on each new highlight
- Schema cache hierarchical invalidation → v2 uses existing `invalidateByProfile / ByProfileDb / ByProfileDbSchema` primitives in `schemaCache.ts`
- Two stacked modals (Settings + Shortcuts) fight for Escape → v2 spec: Shortcuts modal cannot open while Settings is open
- Cursor persistence uses dedicated `cursor_line` / `cursor_col` columns (already exist in schema), NOT `last_session_context_json`

---

## Design decisions (FINALIZED — no open questions before kickoff)

1. **workspace_id**: single `'default'` for v0.1. Per-tab deferred to v0.2.
2. **paneId↔worksheetId binding**: `LayoutTree` leaf gains `worksheetId: string` field. Migration 002 + `pane_layout.tree_json` becomes schema-versioned (`{ version: 2, tree: {...} }`).
3. **Settings storage**: flat JSON at `userData/settings.json`. Atomic write = temp + rename with 3-retry backoff on Windows. Boot reads synchronously in preload (FOUC fix).
4. **Theme initialization**: preload script reads `settings.json` sync, sets `documentElement.classList.toggle('dark', ...)` before renderer hydration. Async IPC just listens for live OS changes after boot.
5. **Cmd+Enter cursor-in-whitespace**: runs NEXT statement (Snowsight parity). Cursor-in-comment: no-op + toast "No statement at cursor".
6. **Cmd+Enter implementation surface**: CodeMirror `keymap.of([{ key: 'Mod-Enter', run: ... }])` extension, NOT window-level. The shortcut REGISTRY knows about it for the help modal but doesn't install it.
7. **B1 cache model**: keep existing `schemaCache.ts` SQLite cache; add `schema.invalidate(profileId, ?database, ?schema)` IPC channel. Refresh button invalidates at current node + below.
8. **`splitActive` worksheet binding**: split creates a NEW worksheet for the new pane (clean state, no concurrent-write hazard).
9. **App-close flush protocol**: main process `before-quit` with `event.preventDefault()` → broadcasts `request-flush` to renderer → awaits ack with 2s timeout → `closeAllSessions()` → `closeDatabase()` → `app.quit()`.
10. **Recently-Closed recovery**: 5-item LRU of {worksheetId, title, closedAt} kept in-memory + persisted on app close. `Cmd+Shift+T` opens a menu listing them; selecting one creates a new pane bound to that worksheetId.

---

## Phase 0 — Pre-flight contract patch (MANDATORY, single owner)

**Owner**: lead (Sisyphus directly, not delegated). **Effort**: 4h. **Blocks**: all Phase A.

**Deliverables**:
1. **Migration 002** (`src/main/storage/migrations/002_wave4.sql`):
   - `ALTER TABLE worksheets ADD COLUMN scroll_top INTEGER`.
   - No structural change to `pane_layout`; serialization version bump handled in code.
2. **Type definitions** (`src/main/types.ts`):
   - `LayoutTree` leaf gains `worksheetId: string`.
   - `LayoutTreeSerialized = { version: 2; tree: LayoutTree }` (versioned wrapper).
   - `SnowboyApi` adds: `workspace.saveWorkspace({ layout, worksheets })`, `workspace.getWorksheet(id)`, `settings.get / set`, `theme.get / onChanged`, `schema.invalidate(profileId, ?database, ?schema)`, `sessions.getEffectiveContext(sessionId)`, `sessions.onClose(handler)` (main-internal hook, not IPC).
3. **Channels** (`src/main/ipc/channels.ts`):
   - Add `settings.get`, `settings.set`, `theme.get`, `theme.event.changed`, `schema.invalidate`, `sessions.getEffectiveContext`, `workspace.saveWorkspace`, `workspace.getWorksheet`.
4. **Preload bridge** (`src/preload/index.ts`):
   - Wire all new channels.
   - `$state.snapshot` pattern docstring at top of file (defensive reminder for future contributors).
5. **IPC registration** (`src/main/ipc/index.ts`):
   - Register `settings.ts`, `theme.ts` modules (stubs are fine, real impls in Phase A).
6. **Storage upserts**:
   - `worksheets.ts` gains `upsertWorksheet(row)` (INSERT ... ON CONFLICT(id) DO UPDATE). Existing `updateWorksheet` left in place (used by tests) but new code uses upsert.
   - `layout.ts` `setLayout(tree)` becomes `setLayout(serialized: LayoutTreeSerialized)`; reads return the inner tree after version-check.
7. **Cross-table transaction wrapper**:
   - `workspace.ts` IPC handler for `saveWorkspace` wraps both writes in `db.transaction(() => { ... })`.
8. **Remove banned dep**:
   - `package.json`: drop `@tanstack/svelte-table`. Keep `@tanstack/svelte-virtual`. Lint rule recommended (defer if not cheap).

**Verification**:
- `bun run typecheck` clean
- `bun run lint` clean
- All existing 187 tests still pass
- `bun run e2e` smoke green
- No new IPC channels are wired to handlers yet (handlers in Phase A); compile-time contract is the gate.

---

## Phase A — Foundation (parallel after Phase 0)

**Now genuinely parallelizable** because Phase 0 has serialized the contract surface. The remaining work touches distinct files per subtask.

### T4.1 — Pane layout persistence (5h)

**Files**:
- EXTEND `src/main/ipc/workspace.ts` — real `saveWorkspace` handler (wraps `setLayout` + N `upsertWorksheet` in transaction); `loadWorkspace` returns both layout + map of `{worksheetId → row}`.
- EXTEND `src/renderer/lib/stores/panes.svelte.ts` — `serialize(): LayoutTreeSerialized`, `restore(serialized)`. Emits a monotonic `version` counter `$state<number>` that bumps on every nested mutation (gives `$effect` consumers a reliable change signal — solves reactivity #4).
- EXTEND `src/renderer/lib/stores/tabs.svelte.ts` — single workspace v0.1 (per-tab deferred).
- EXTEND `src/renderer/lib/panes/PaneTree.svelte` — resize callback writes back via `paneStore.setSizes(parentId, sizes)` mutator (not direct mutation; avoids ownership_invalid_mutation).
- EXTEND `src/renderer/App.svelte` — onMount restores layout; before-quit IPC `request-flush` handler flushes pending debounce.
- NEW `src/renderer/lib/utils/debounce.ts` — leading-trailing debounce with `.flush()` and `.cancel()`.

**MUST DO**:
- `$state.snapshot(tree)` before IPC (landmine #2).
- `LayoutTreeSerialized` version check on restore: version mismatch → log + use default layout (don't crash).
- Resize callback throttled to 16ms (one frame).
- Flush IPC has a 2s ack timeout; if exceeded, main process force-quits anyway (don't hang the app on a deadlocked renderer).

**MUST NOT DO**:
- No direct mutation of `tree.sizes` from `PaneTree.svelte`.
- No `JSON.stringify` of `$state`-proxied tree (snapshot first).
- No `event.preventDefault()` reentry — main process owns the `before-quit` orchestration in T4.1.

**Acceptance**: 3-pane layout with custom resizes survives restart. Crash mid-save (kill -9 the app) does NOT corrupt layout — at worst the last 500ms of resize is lost.

### T4.2 — Worksheet body persistence (7h)

**Files**:
- EXTEND `src/main/ipc/workspace.ts` — `saveWorksheet(row)` calls `upsertWorksheet`; `getWorksheet(id)` reads.
- EXTEND `src/renderer/lib/panes/paneStore.svelte.ts` — `PaneStateFacade` gains `worksheetId: string`, `hydrated: boolean` ($state).
- EXTEND `src/renderer/lib/panes/WorksheetPane.svelte` — onMount: if `worksheetId` known, load. Suppress saves until `hydrated = true`. Debounced save uses `upsertWorksheet`. Cleanup on pane destroy: flush + clear timer.

**MUST DO**:
- Hydration gate: save handler short-circuits while `hydrated === false`. Solves reactivity #7 hydration overwrite trap.
- Stale-load cancellation: if `worksheetId` changes mid-load, abort the in-flight fetch via AbortController.
- `cursor_line` / `cursor_col` use the dedicated columns (NOT `last_session_context_json`). Solves data #B-4.
- `scroll_top` uses the new column added in Migration 002.
- Cursor restoration uses `EditorState.fromJSON` to bundle initial selection (defers to post-mount). Solves concurrency #B13.

**MUST NOT DO**:
- No initial `body = ''` write to the editor — would race with the load.
- No mutation of parent's `paneState` from inside `SqlEditor.svelte` (callback up).

**Acceptance**: SQL typed in one pane survives restart. Cursor lands at the saved offset. Fast typing → quick close does NOT lose more than the last 500ms.

### T4.3a — Settings storage layer (3h)

**Files**:
- NEW `src/main/storage/settings.ts` — `readSettings()` / `writeSettings(partial)`.
- NEW `src/main/ipc/settings.ts` — `get`/`set` handlers.
- EXTEND `src/preload/index.ts` — settings synchronous boot read (see "Theme initialization" decision).
- NEW `src/renderer/lib/stores/settings.svelte.ts` — reactive store.
- NEW `tests/unit/storage/settings.test.ts`.

**MUST DO**:
- Atomic write: write to `${path}.tmp` → 3-retry `fs.renameSync` with 50ms backoff (solves ux #6). On final failure: log error, leave .tmp in place, surface a renderer toast.
- Clamping on read (solves data #C-8): every numeric field bounded; type mismatch (`theme: 42`) falls to default + log.
- Defaults merge: read partial JSON → spread over hardcoded defaults so future-added fields don't break existing installs.

**MUST NOT DO**:
- No JSON-schema validation library.
- No async settings access during renderer hydration (preload provides sync seed).

### T4.4a — Theme store + nativeTheme bridge (3h)

**Files**:
- NEW `src/main/ipc/theme.ts` — subscribes `nativeTheme.on('updated')`, broadcasts via event channel.
- EXTEND `src/preload/index.ts` — `theme.get` + `theme.onChanged`. **Critically**: preload also reads `settings.json` and sets `documentElement.classList.toggle('dark', ...)` BEFORE the renderer hydrates. This is the FOUC fix.
- NEW `src/renderer/lib/stores/theme.svelte.ts` — reactive `$state<EffectiveTheme>`, subscribes to OS-changed event.

**MUST DO**:
- Initial class set in preload (synchronous, pre-paint). Solves ux #2, concurrency #B7, reactivity #8.
- nativeTheme listener attached during IPC registration (post-`whenReady`), not on `app.on('ready')`. Solves reactivity #8 second half.

**MUST NOT DO**:
- No `window.matchMedia` in renderer.
- No `$effect` in `App.svelte` for the boot class (won't beat first paint — proven structurally false in v1).

### T4.5a — Keymap util extension (3h)

**Files**:
- EXTEND `src/renderer/lib/utils/keymap.ts` — registry-based:

```typescript
type ShortcutScope =
  | 'global-allow-editor'   // fires everywhere (e.g. cmd+\)
  | 'global-block-editor'   // suppressed inside .cm-editor (e.g. cmd+w)
  | 'editor-only';           // fires only inside .cm-editor (cmd+enter)

type Shortcut = {
  combo: { cmdOrCtrl?: boolean; shift?: boolean; alt?: boolean; code: string };
  scope: ShortcutScope;
  handler: (e: KeyboardEvent) => void;
  description: string;
  formatDisplay(): string;  // OS-appropriate ⌘/Ctrl rendering
};
```

- EXTEND `src/renderer/lib/stores/tabs.svelte.ts` — `installTabsKeymap` becomes registrations.
- NEW `tests/unit/utils/keymap.test.ts`.

**MUST DO**:
- Use `e.code` not `e.key` (solves ux #5 — intl keyboards).
- Preserve existing cmd+\\, cmd+shift+\\, cmd+w semantics — verify with manual QA on Linux/Windows.
- `editor-only` shortcuts are documented as such; T4.5b implements Cmd+Enter via CM keymap extension (parallel mechanism), but registers it here for help-modal visibility.

**MUST NOT DO**:
- Don't break the existing 3 shortcuts (cmd+\, cmd+shift+\, cmd+w).
- Don't install editor-scope shortcuts via window listeners (CM owns its own keybindings).

### B1 — Schema cache reuse + Refresh button (3h)

**Files**:
- EXTEND `src/main/ipc/schema.ts` — wire `getCached`/`setCached` from existing `schemaCache.ts`. Implement `schema.invalidate(profileId, ?database, ?schema)` using existing `invalidateByProfile/Db/Schema` primitives.
- EXTEND `src/main/ipc/sessions.ts` — add `onClose(handler)` internal hook; `closeSession` fires the hook BEFORE removing from registry. Schema module subscribes to invalidate session's profile cache.
- EXTEND `src/renderer/lib/browser/ObjectBrowser.svelte` — Refresh button (disabled when sessionId is null — solves ux #7). On click, invalidates at current node level + below, then reloads.
- EXTEND `src/renderer/lib/browser/TreeNode.svelte` — accept a `refreshCounter` prop / context; bumping it clears local `children` $state.

**MUST DO**:
- Reuse existing `schemaCache.ts` (SQLite-backed). Solves data #B-5, reactivity #13.
- Hierarchical invalidation: refresh on a `database` node invalidates db-level entry + all child schemas + child tables/views.
- Refresh button visually disabled when `sessionId === null`.

**MUST NOT DO**:
- No in-memory cache layer on top of SQLite cache (one truth, the existing one).
- No invalidation on session.open (cache is profile-keyed; multi-session-per-profile reuses the same entries).

### B3 — Live session context (4h)

**Files**:
- EXTEND `src/main/snowflake/session.ts` — `getEffectiveContext()` runs `SELECT CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_DATABASE(), CURRENT_SCHEMA()` as 4 sequential queries (snowflake-sdk multi-statement is too complex for the gain). Caches result in `Session` instance.
- EXTEND `src/main/ipc/sessions.ts` — `getEffectiveContext` IPC handler.
- EXTEND `src/main/ipc/query.ts` — post-execute hook: regex match `/^\s*USE\s+(DATABASE|SCHEMA|WAREHOUSE|ROLE)/i` on the executed SQL → `session.invalidateEffectiveContext()` → renderer event.
- EXTEND `src/renderer/lib/stores/sessions.svelte.ts` — `#effectiveContext = new SvelteMap<SessionId, Context>()`. Solves reactivity #15.
- EXTEND `src/renderer/lib/panes/WorksheetPane.svelte` — autofill ONLY when dropdown is empty; do not overwrite user's manual selection.

**MUST DO**:
- USE-statement detection regex includes `USE` standalone (not just keyword variants) and the schema sets.
- Effective context invalidation broadcasts an event the renderer subscribes to (so dropdowns refresh).
- Honor explicit user selection: only autofill when slot is undefined/empty.

**MUST NOT DO**:
- No race-condition workaround that locks all `setContext` calls serially (acceptable v0.1 limitation: simultaneous `setContext` from 2 panes may produce a temporarily inconsistent effective context until next refresh).

### `exportCsv.ts` hardening (gate for B2) (2h)

**Files**:
- REWRITE `src/renderer/lib/results/exportCsv.ts`:
  - Line terminator: `\r\n` (RFC 4180).
  - Date → ISO 8601 UTC (`toISOString()`).
  - BigInt → string (no marker; documented as "lossless string representation").
  - Object → `JSON.stringify(v)` then CSV-escape (quote + doubled-quotes inside).
  - null → empty.
  - NaN / undefined → empty.
- EXTEND `tests/unit/results/exportCsv.test.ts` — add tests for Date, BigInt, object, null, NaN, multi-line VARCHAR.

**MUST DO**: ship this BEFORE B2 begins. B2 should consume the hardened exporter unchanged.

### B2 — Virtualized result grid (8h, gated on `exportCsv.ts`)

**Files**:
- REWRITE `src/renderer/lib/results/ResultsGrid.svelte` using `@tanstack/svelte-virtual` for ROW virtualization (no column virtualization in v0.1; document as a known limitation).
- EXTEND `src/renderer/lib/results/CellDetailPanel.svelte` — clickable affordance "+N more lines" on rows where the rendered cell is truncated.
- NEW `tests/unit/results/grid.test.ts`.

**MUST DO**:
- Row height = `Math.ceil(fontSize * 1.4)` reactive to `settings.fontSize`. Solves data #C-5, ux #4.
- Sticky headers via `position: sticky; top: 0; z-index: 2`. Scroll container is the grid wrapper; explicit `height: 100%`.
- Export button disabled while query is still streaming (or warning toast on click during stream). Solves concurrency #B15.
- `+N more lines` affordance on truncated cells.

**MUST NOT DO**:
- Don't import `@tanstack/svelte-table` (removed in Phase 0).
- No dynamic row height v0.1.
- No column virtualization v0.1.

### Recently-Closed recovery (2h)

**Files**:
- EXTEND `src/renderer/lib/stores/tabs.svelte.ts` — `#recentlyClosed = $state<RecentlyClosed[]>([])` (5-item LRU).
- EXTEND `src/renderer/lib/utils/keymap.ts` — `Cmd+Shift+T` registered as `global-block-editor`.
- NEW `src/renderer/lib/shell/RecentlyClosedMenu.svelte` — popover listing the 5.

**MUST DO**:
- When pane is closed AND the worksheet has non-empty body, push `{worksheetId, title, closedAt}` into LRU.
- Selecting a recently-closed entry opens a new pane bound to that `worksheetId`.

**Solves**: ux #3 orphaned-worksheet data loss.

### `PaneTree.svelte` resize wiring (1h)

Captured under T4.1 above; broken out here for visibility only.

---

## Phase B — UI on foundation (after Phase A)

### T4.3b — Settings UI dialog (8h)

**Files** (unchanged from v1, but effort revised + dependency on Phase A items locked):
- NEW `src/renderer/lib/settings/SettingsDialog.svelte`
- NEW `src/renderer/lib/settings/sections/{General,Connections,Editor,Advanced}Section.svelte`
- EXTEND `src/renderer/App.svelte` — settingsOpen + dialog mount; **must** lock-out Shortcuts modal while open (solves concurrency #B11).
- EXTEND `src/renderer/lib/shell/TopBar.svelte` — Settings button.

**MUST DO**:
- Refactor `ConnectionWizard.svelte` to be embeddable (extract the modal Dialog wrapper into a separate caller). v1 underestimated this.
- Font size slider: range [10, 24], step 2, debounced apply (don't fire 14 saves while sliding).
- Auto-save (no Apply/Cancel button) — modern UX.

### T4.4b — Theme swap + CodeMirror Compartment (3h)

**Files**:
- EXTEND `src/renderer/lib/stores/theme.svelte.ts` — `$effect` toggles `documentElement.classList`.
- EXTEND `src/renderer/lib/editor/SqlEditor.svelte` — **replace** the existing root `StateEffect.reconfigure.of([...])` with explicit compartments:
  - `themeCompartment` (live-swappable)
  - `readOnlyCompartment` (used by DdlDialog)
  - `placeholderCompartment` (if used)
- Subscribe to theme store; on change, `view.dispatch({ effects: themeCompartment.reconfigure(newTheme) })`.

**MUST DO**: replace the root reconfigure — adding theme compartment on top of it preserves the existing state-blowing problem (solves reactivity #9).

### T4.5b — Cmd+Enter run-at-cursor (5h)

**Files**:
- REWRITE `src/renderer/lib/editor/splitSql.ts` to emit ALL segments:

```typescript
type Segment = { start: number; end: number; sql: string; kind: 'stmt' | 'comment' | 'ws' };
export function splitSql(text: string): Segment[];
export function statementAtOffset(text: string, offset: number): Segment | null;  // returns the stmt segment under cursor, or the next stmt if cursor is in ws/comment, or null
```

- EXTEND `tests/unit/editor/splitSql.test.ts` — cursor-in-comment, cursor-in-ws, cursor-in-stmt, cursor-at-eof, UTF-16 surrogate pair edge.
- EXTEND `src/renderer/lib/editor/SqlEditor.svelte` — register CM `keymap.of([{ key: 'Mod-Enter', run: ... }])`. Solves reactivity #11 + concurrency #B9.
- EXTEND `src/renderer/lib/panes/WorksheetPane.svelte` — expose `runStatementAtCursor` callback. Single shared 500ms highlight timer per pane (clearTimeout on rapid-fire).

**MUST DO**:
- UTF-16 code unit offsets, NOT bytes (solves scope #2, reactivity #11).
- Cursor in comment → no-op + toast (solves data #B-2).
- Cursor in whitespace between statements → run NEXT statement (Snowsight parity, finalized decision).
- Decorations for highlight use CM's `EditorView.decorations` field with explicit teardown.

### T4.5c — Shortcuts help modal (1h)

**Files**:
- NEW `src/renderer/lib/help/ShortcutsModal.svelte`
- EXTEND `src/renderer/lib/shell/TopBar.svelte` — Help menu.

**MUST DO**:
- Render each shortcut via `shortcut.formatDisplay()` (OS-appropriate ⌘/Ctrl).
- Cannot open while Settings dialog is open.

---

## Phase C — Verification gates

Before marking Wave 4 complete:

1. `bun run typecheck` — 0 errors.
2. `bun run lint` — clean.
3. `bun run test` — all green (~215 tests).
4. `bun run build` — produces `out/` cleanly.
5. `bun run e2e` — smoke green.
6. **Manual QA flow (PowerShell, Windows-native)**:
   - Wipe `userData/`.
   - Connect with PAT.
   - 3-pane layout (V+H split), custom resizes, distinct SQL in each.
   - Toggle theme: light → dark → system (back to light if OS is light). All editors flip without losing cursor.
   - Font-size 14 → 20 — grid row height grows, no clipping.
   - Cmd+Enter in middle of statement 2 of 5 → only stmt 2 runs; highlight flashes.
   - Cmd+Enter with cursor in a comment → toast appears, no query fires.
   - Run `USE DATABASE SNOWFLAKE;` then expand Object Browser — dropdowns reflect the switch.
   - Run query, click Export CSV mid-stream — disabled or warning.
   - Click Refresh in Object Browser — schemas re-fetch (verify by adding a new DB in Snowsight, then refreshing).
   - Close app via X button mid-typing → reopen → SQL up to last 500ms preserved.
   - Kill -9 the app mid-typing → reopen → no SQLite corruption, layout intact.
   - Close a pane with SQL → Cmd+Shift+T → see Recently Closed → reopen → SQL intact.

---

## Risk register (open items, scoped + mitigated)

| Risk | Mitigation | Owner |
|---|---|---|
| Hidden Wave 3 polish-chain bugs surface during Wave 4 integration | Run full unit suite after each subtask; e2e after each phase | All |
| Phase 0 contract patch reveals a deeper LayoutTree/Worksheet incompatibility | Phase 0 owner pauses + escalates rather than improvising | Lead |
| `@tanstack/svelte-virtual` integrates worse than expected with Svelte 5 | B2 has a fallback path: manual windowed render via `IntersectionObserver` (no library) | B2 owner |
| Settings JSON migration when schema evolves in v0.2 | Defaults-merge accepts unknown fields; type mismatches log + fall to default | Phase 0 |
| Recently-Closed LRU growth over years (sqlite leak) | LRU is in-memory; not persisted in v0.1 (closed-pane recovery only across pane-life, not app-restart) | T4.5b owner |

---

## Execution order

**Day 1**: Phase 0 lands. Verify gates green. Tag commit `wave4-phase0`.

**Day 2–3**: Phase A — fan out 6 agents (T4.1, T4.2, T4.3a, T4.4a, T4.5a, B1, B3). exportCsv hardening + B2 + Recently-Closed run as a 4th sequential pair (exportCsv → B2; Recently-Closed in parallel with T4.5b).

**Day 4**: Phase B — T4.3b, T4.4b, T4.5b (each depends on its Phase A counterpart).

**Day 5**: Phase C — verification + plan update marking Wave 4 complete.

Total wall-clock: **4–5 days** with disciplined parallelism, up from the original 2–3 (which was the v1 fantasy).
