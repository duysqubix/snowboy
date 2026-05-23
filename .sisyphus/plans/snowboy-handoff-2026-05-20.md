# Snowboy — Handoff (2026-05-20)

This document is the canonical "where we are, what's next, how to continue" state for picking up Snowboy v0.1 from another machine.

## TL;DR

- **Wave 4 Phase A is fully landed.** All 9 task commits + 4 polish commits pushed to `origin/main`.
- **273 unit tests pass / 1 skip / 0 fail.** typecheck, lint, e2e smoke all green.
- **Phase B is NOT started.** 3 UI builds remaining (Settings dialog, CodeMirror compartment theme swap, Cmd+Enter run-at-cursor) + 2 polish items (Recently-Closed recovery, shortcuts help modal).

## Tip of the branch

```
630b4ab fix(keymap): Ctrl+W closes pane even when focus is in the editor
d4a1b80 feat(panes): populate role/warehouse/database/schema dropdowns from Snowflake + remap split shortcuts
151ca1f fix(panes): mirroring bug when splitting >=3 panes — PaneTree key + paneState derivation
bee02ed feat(wave4): B3 — live session context tracking + USE-statement invalidation
a1e7faa test(e2e): translate /mnt/c/... cwd to C:\... when running from WSL
692d33a feat(wave4): B1 — schema cache reuse + Object Browser Refresh button
da9134e feat(wave4): T4.1 — pane layout persistence + main-coordinated app-close flush
0233de1 feat(wave4): T4.4a — theme bridge + FOUC fix via preload sync inject
1889437 feat(wave4): T4.3a — settings storage layer with atomic writes + clamping
27cc634 feat(wave4): T4.2 — worksheet body persistence
b2db5c4 fix(results): RFC 4180 + type-safe CSV export
bddf4f5 feat(wave4): T4.5a — keymap registry with per-shortcut scopes + e.code for intl keyboards
7e9f68d feat(wave4): Phase 0 — pre-flight contract patch
```

## Continuation from another machine

```powershell
# PowerShell (Windows-native bun) — REQUIRED, not WSL
cd C:\Users\duan_\.repos\snowboy  # or wherever you clone it
git pull
bun install        # rebuilds native modules (snowflake-sdk + better-sqlite3) for the local Electron ABI
bun run typecheck  # should be 0 errors
bun run test       # should be 273 pass / 1 skip / 0 fail
bun run test:e2e   # should be 1 passed (~12s)
bun run dev        # start the app
```

If you're cloning fresh on a new machine: confirm `node >= 20.19`, `bun >= 1.3.14`. The `postinstall` script handles native-module rebuilding for Electron 32.

**Critical**: do NOT run `bun install` or `bun run dev` from WSL bash — Linux bun installs Linux-native bindings which crash Windows Electron. The smoke spec has a WSL→Windows path bridge but the runtime apps still need to match platform. From PowerShell with Windows `bun.exe`, everything works.

## What landed in this session

### Phase 0 — Pre-flight contract patch (`7e9f68d`)
- Migration 002 adds `worksheets.scroll_top INTEGER`
- `LayoutTree` leaf type extended with required `worksheetId`
- 8 new IPC channels (settings, theme, workspace.saveWorkspace, workspace.getWorksheet, schema.invalidate, sessions.getEffectiveContext) all wired as stubs
- `worksheets.upsertWorksheet` (race-free INSERT...ON CONFLICT...UPDATE)
- `@tanstack/svelte-table` removed from `package.json` (banned in Wave 3, was still listed)

### Phase A Burst 1 (all parallel)
- **T4.5a `bddf4f5`** — `keymap.ts` refactored to a registry with `e.code` keys for intl keyboards
- **exportCsv `b2db5c4`** — RFC 4180 line terminators, ISO 8601 dates (no locale TZ), BigInt-safe, object escape correct
- **T4.2 `27cc634`** — worksheet body + cursor + scroll position persisted via `upsertWorksheet` with hydration gate
- **T4.3a `1889437`** — settings.json at `userData/`, atomic write w/ 3-retry Windows EPERM backoff, clamping on read
- **T4.4a `0233de1`** — `nativeTheme` IPC bridge + preload-injected initial `documentElement.classList.toggle('dark')` for FOUC fix (deferred to DOMContentLoaded if document still loading)
- **T4.1 `da9134e`** — layout serialize/restore with version envelope, debounce util, `setSizes` mutator, **app-close flush protocol** (main process owns single before-quit with `event.preventDefault()` → `request-flush` IPC to renderer → ack with 2s timeout → `closeAllSessions` → `closeDatabase` → `app.quit()`). Also bundled a fix for T4.4a's preload crash when `documentElement` was null at apply-time.

### Phase A Burst 2 (sequenced)
- **B1 `692d33a`** — `schemaCache.ts` (existing Wave 1 SQLite cache) wired up through `schema.ts`; 5-min TTL via `{fetchedAt, data}` envelopes; `schema.invalidate(profileId, ?db, ?schema)` IPC; Refresh button on Object Browser (disabled when no session); session-close hook auto-invalidates closed profile's cache
- **B3 `bee02ed`** — `Session.getEffectiveContext()` runs a single `SELECT CURRENT_ROLE/WAREHOUSE/DATABASE/SCHEMA` query, cached per-Session, invalidated on `setContext` + on any executed SQL matching `/^\s*USE\s+(DATABASE|SCHEMA|WAREHOUSE|ROLE)\b/i`. Renderer stores it in `SvelteMap<SessionId, EffectiveContext>`. WorksheetPane autofills empty dropdown slots from effective context (never overwrites user's explicit choice).

### Polish layer
- **smoke WSL fix `a1e7faa`** — `tests/e2e/specs/smoke.spec.ts` translates `/mnt/c/...` → `C:\...` for cwd when launching from WSL with Windows bun
- **mirror bug fix `151ca1f`** — `PaneTree.svelte` keys `{#each}` by stable `nodeKey(child)` instead of array index (Svelte 5 was reusing components with new props but `paneState = untrack(...)` was captured at mount); `WorksheetPane.svelte` switched to `$derived(getOrCreatePaneState(...))`; `paneStore.svelte.ts` wrapped `getOrCreatePaneState` mutation in `untrack()` so it's safe inside derivations
- **dropdowns + keymap remap `d4a1b80`** — `schema.listRoles` (SHOW ROLES) + `schema.listWarehouses` (SHOW WAREHOUSES) IPC handlers; WorksheetPane fetches roles/warehouses/databases on session activation and schemas on database change; `onValueChange` calls `snowboy.sessions.setContext` which fires the matching USE statement; split-pane shortcuts moved from `Ctrl+\` / `Ctrl+Shift+\` to `Ctrl+Alt+\` / `Ctrl+Alt+Shift+\` to dodge Windows OS-level intercept
- **Ctrl+W fix `630b4ab`** — `pane.close` shortcut scope changed from `global-block-editor` to `global-allow-editor`; was being suppressed when focus was in the editor, letting Electron's default Ctrl+W close the whole window

## Numbers

- 273 unit tests passing (started Wave 4 at 187 → +86 new tests)
- 0 typecheck errors / 0 svelte-check warnings
- ESLint clean
- e2e smoke 12s ✓
- Renderer bundle ~1.77 MB
- Working tree: clean
- Branch: `main`, in sync with `origin/main`

## Phase B — next up (NOT STARTED)

Three parallelizable UI tasks. v2 plan at `.sisyphus/plans/snowboy-wave4.md` has the full spec for each. Estimated total ~17h with disjoint files.

### T4.3b — Settings UI dialog (8h)
- **What**: bits-ui Dialog with 4 sections: General (theme picker + font size slider), Connections (embed existing ProfileList + ConnectionWizard), Editor (tab width 2/4/8, word-wrap toggle), Advanced (data dir display, Open log folder button).
- **Auto-save semantics**: no Apply/Cancel button; every `settings.set(partial)` call commits immediately. `settings.svelte.ts` store already wired from T4.3a.
- **Open via**: Settings button in `TopBar.svelte` + `Ctrl+,` keymap shortcut.
- **Hidden cost (hyperplan finding #21)**: `ConnectionWizard.svelte` is currently a top-level component. To embed it inside the Settings dialog without breaking the standalone usage, extract the Dialog wrapper into the caller. Plan for ~2h on this alone.
- **MUST NOT** stack with the Shortcuts modal — Shortcuts modal cannot open while Settings is open (concurrency-critic #B11).

### T4.4b — CodeMirror Compartment theme swap (3h)
- **What**: replace the existing `StateEffect.reconfigure.of([...])` root reconfigure in `src/renderer/lib/editor/SqlEditor.svelte` with explicit compartments (`themeCompartment`, `readOnlyCompartment`, `placeholderCompartment`). Subscribe to `theme.svelte.ts` store; on change, `view.dispatch({ effects: themeCompartment.reconfigure(newTheme) })`.
- **Why critical**: T4.4a flipped the document body class on OS theme change, but the CodeMirror editor's syntax highlight theme is currently captured at mount. So the chrome goes dark, the editor stays light (or vice versa). Compartment swap preserves cursor + scroll state.
- **MUST DO**: REPLACE the root reconfigure, don't ADD a theme compartment on top of it (reactivity-critic #9 — adding without removing still loses state).

### T4.5b — Cmd+Enter run-at-cursor (5h)
- **What**: rework `src/renderer/lib/editor/splitSql.ts` to emit ALL segments with `kind: 'stmt' | 'comment' | 'ws'`, add `statementAtOffset(text, offset): Segment | null`. Register `Cmd+Enter` (= Mod-Enter) via CodeMirror's `keymap.of([...])` extension (NOT window-level). Cursor in whitespace → run NEXT statement. Cursor in comment → no-op + toast.
- **Use JS string indices (UTF-16 code units), NOT byte offsets** — scope-critic #2 + reactivity-critic #11. The plan's earlier "byte ranges" wording was wrong.
- **500ms highlight** of the executed statement: single shared timer with clearTimeout on rapid-fire (concurrency-critic #B14).

### T4.5c — Shortcuts help modal (1h)
- Modal table iterating `listShortcuts()` from `keymap.ts`. Each row renders via `formatCombo(shortcut.combo)` (already OS-aware: `⌘` on mac, `Ctrl` on Linux/Windows).
- Open via `Ctrl+/` (use `e.code === 'Slash'`, NOT `e.key === '/'` — ux-critic #5 intl keyboard safety).
- Cannot open while Settings dialog is open.

### Recently-Closed recovery (2h) — replaces "orphans are intentional"
- 5-item LRU of `{worksheetId, title, closedAt}` kept in `tabs.svelte.ts`. When a pane closes AND its worksheet has non-empty body, push the entry into the LRU.
- `Ctrl+Shift+T` opens a small popover listing the 5. Selecting one creates a new pane bound to that worksheetId.
- Solves ux-critic #3 — currently if user accidentally closes a pane with content, the worksheet row stays in SQLite but there's no UI to recover it.

## Phase C — verification gate

After Phase B, before declaring Wave 4 complete, run the full manual QA flow per `.sisyphus/plans/snowboy-wave4.md` §"Cross-cutting verification gates":
1. Wipe `userData/`
2. Connect with PAT
3. 3-pane layout (vertical + horizontal split) with custom resizes, distinct SQL in each
4. Toggle theme: light → dark → system (back to light if OS is light). All editors flip + cursor preserved.
5. Font-size 14 → 20 — grid row height grows, no clipping
6. Cmd+Enter in middle of statement 2 of 5 → only stmt 2 runs; highlight flashes
7. Cmd+Enter with cursor in a comment → toast appears, no query fires
8. Run `USE DATABASE SNOWFLAKE;` then check Object Browser — dropdowns reflect the switch
9. Run query, click Export CSV mid-stream — disabled or warning
10. Click Refresh in Object Browser — schemas re-fetch (verify by adding a new DB in Snowsight, then refreshing)
11. Close app via X button mid-typing → reopen → SQL up to last 500ms preserved
12. Kill -9 the app mid-typing → reopen → no SQLite corruption, layout intact
13. Close a pane with SQL → Cmd+Shift+T → see Recently Closed → reopen → SQL intact

## Open known issues

### Issue 1: `Ctrl+Alt+\` shortcut conflict (USER VERIFY)
The previous `Ctrl+Shift+\` was being intercepted by something on Windows (per user report). Remapped to `Ctrl+Alt+\` for vertical split + `Ctrl+Alt+Shift+\` for horizontal. If those ALSO conflict on the user's machine, identify and disable the OS handler OR try yet another combo (e.g., `Ctrl+B` followed by `\` à la tmux).

### Issue 4 followup: dropdown UX cross-effects
When user changes role via dropdown, B3 fires `USE ROLE X`. The post-execute hook invalidates effective context, which refetches and may update other dropdowns (database, schema). The autofill in WorksheetPane will only fill EMPTY slots — but if `paneState.role` was already non-empty, changing it doesn't cascade. Test if this matters in practice; v0.1 may be acceptable.

### Issue 6: no Settings UI (T4.3b not built)
Documented above as Phase B work.

### Editor theme not live-swapping (T4.4b not built)
Body class flips with OS theme, but the CodeMirror editor's static theme prop doesn't. User may see chrome/editor color mismatch.

## Conventions to preserve

### Hard rules (do NOT violate)
1. **Always run `bun install` and `bun run dev` from PowerShell with Windows `bun.exe`**, NEVER from WSL bash. The native modules (`snowflake-sdk`, `better-sqlite3`) are Windows PE32+ in this checkout.
2. **No `as any`, `@ts-ignore`, or `@ts-expect-error`** anywhere.
3. **Never delete failing tests to make builds pass.**
4. **Type-safety constraints in `<constraints>` of the Sisyphus agent never yield.**

### Svelte 5 landmines (cross-confirmed by hyperplan critics)
1. Native `Map.set()` / `Set.add()` is NOT reactive in $state — use `SvelteMap`/`SvelteSet` from `svelte/reactivity` (or reassign with new reference).
2. Passing a `$state`-proxied object across Electron IPC throws "An object could not be cloned" — always `$state.snapshot(x)` before any IPC call that takes an object.
3. Mutating a parent-owned prop's properties triggers `ownership_invalid_mutation` — children must use local `$state` + callback up.
4. `@tanstack/svelte-table` v9-alpha is permanently BANNED — caused 3 separate reactivity bugs in Wave 3. `@tanstack/svelte-virtual` (different package, headless layer) is fine.
5. `streamWindows` short-circuits at `getNumRows() <= 0` — wave 3 fix emits an empty batch carrying columns so consumers don't get empty-columns errors.
6. Mutating $state inside a `$derived` throws `state_unsafe_mutation` — wrap the mutation in `untrack(...)` (see `paneStore.svelte.ts:32`).
7. `{#each}` with index-based keys causes Svelte to reuse component instances with new props, breaking captured-at-mount state like our `paneState` was. Use stable identifiers (paneId, etc.) as keys.

### Electron landmines
1. `app.on('before-quit')` handlers can race + ordering matters. `src/main/index.ts` now owns the single orchestrated handler with `event.preventDefault()`. Do not register additional before-quit handlers — modify the orchestrator instead.
2. Preload scripts run BEFORE document is fully parsed. `documentElement` may be `null` at the top of preload — defer DOM mutations to `DOMContentLoaded` (see preload's `applyBootTheme`).
3. Async IPC during renderer-process unload is unreliable. The flush protocol uses an ack-and-timeout pattern to drain pending state.
4. Electron windows on close-via-X-button OR via `app.quit()` BOTH fire `before-quit`. The orchestrator uses a `shutdownComplete` flag to detect re-entry and skip preventDefault on the second pass.

## Agent skill recommendations for picking up Phase B

If a future me (or another agent) picks up Phase B, the v2 plan + hyperplan critics' findings cover the landmines comprehensively. Recommend these task() invocations:

```typescript
// Burst 1 (parallel):
task(category="visual-engineering", load_skills=["frontend-ui-ux"], 
     description="T4.3b settings dialog",
     prompt="...spec from .sisyphus/plans/snowboy-wave4.md §T4.3b plus extract ConnectionWizard's Dialog wrapper first...");

task(category="systems", load_skills=[], 
     description="T4.4b CodeMirror compartment theme swap",
     prompt="...replace root StateEffect.reconfigure with explicit compartments (theme/readOnly/placeholder) per reactivity-critic #9...");

// Burst 2 (sequenced after Burst 1's SqlEditor changes):
task(category="systems", load_skills=["tdd"],
     description="T4.5b Cmd+Enter run-at-cursor",
     prompt="...UTF-16 string indices not bytes; CM keymap extension not window-level; splitSql emits ALL segments with kind tag...");
```

**Before delegating**: always spot-check the agent's commit appears in `git log --oneline -3` right after they report done. The T4.1 agent silently failed to commit despite reporting success; I redid that work manually. Verify, don't trust.

## Files of interest for picking up

| File | Purpose |
|---|---|
| `.sisyphus/plans/snowboy-wave4.md` | The full v2 plan (hyperplan-corrected). Phase B specs live there. |
| `.sisyphus/plans/snowboy-mvp-v0.1.md` | Top-level Snowboy MVP plan. Wave 4/5 task IDs here. |
| `src/main/types.ts` | `SnowboyApi` shape — single source of truth for IPC contract |
| `src/main/ipc/channels.ts` | Channel string registry |
| `src/preload/index.ts` | IPC bridge (preload script — also has the FOUC fix) |
| `src/renderer/lib/stores/sessions.svelte.ts` | Sessions store + effective context SvelteMap (B3) |
| `src/renderer/lib/stores/panes.svelte.ts` | Pane tree store + serialize/restore + version counter |
| `src/renderer/lib/panes/paneStore.svelte.ts` | Per-pane state facade (PaneStateFacade) registry, SvelteMap-backed |
| `src/renderer/lib/panes/WorksheetPane.svelte` | The main worksheet pane — editor + dropdowns + results + autofill |
| `src/renderer/lib/utils/keymap.ts` | Shortcut registry with per-shortcut scopes + `e.code` for intl |
| `src/renderer/lib/editor/SqlEditor.svelte` | CodeMirror integration — T4.4b touches this for compartments |
| `src/renderer/lib/editor/splitSql.ts` | SQL statement splitter — T4.5b reworks to emit all segments |
| `src/renderer/lib/results/exportCsv.ts` | CSV export — RFC 4180 + ISO dates + BigInt-safe (post-B2 hardening) |
| `src/main/storage/*` | SQLite repos — `worksheets.ts`, `layout.ts`, `schemaCache.ts`, `settings.ts`, etc. |
| `src/main/snowflake/session.ts` | `Session` class — getEffectiveContext, runStreaming, setContext |

## How to wake up here

```bash
# On the new machine, after git pull:
cat .sisyphus/plans/snowboy-handoff-2026-05-20.md  # this doc
cat .sisyphus/plans/snowboy-wave4.md               # full Phase B spec
git log --oneline -15                              # confirm tip is 630b4ab
bun run typecheck && bun run lint && bun run test  # verify health
bun run dev                                        # start app
```

Then either:
- **Manual testing**: open app, follow `## Phase C verification gate` checklist above.
- **Resume implementation**: launch Phase B Burst 1 (T4.3b + T4.4b in parallel).
- **Bug-fix iteration**: if user reports new issues, fix → commit → push → next.

Have a good break. Tree is clean and pushable from anywhere.
