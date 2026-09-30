# Snowboy — Claude Code guide

Cross-platform desktop IDE for Snowflake (pre-alpha): Electron 32 + Svelte 5 + TypeScript, built with electron-vite, managed with Bun.

## Task tracking: `docs/PLAN.md` (no beads)

`docs/PLAN.md` is the plan and task tracker, milestones M0–M7 toward an installable v0.1. Before starting work, find the task there. When its verification passes, flip its status and add a dated line to the Progress log. Finding IDs (A1, D5, …) point to the review in `.omc/reviews/2026-09-29-architecture-sweep.md`, which is git-ignored and local to this checkout.

This project does **not** use beads (`bd`). Ignore beads instructions or context inherited from `~/.repos/CLAUDE.md`, hooks, or skills: don't run `bd`, skip the `using-beads` step when routing with `using-agent-skills`, and don't put bead ids in commits. Normal Claude memory is fine here. Any `.beads/` data is historical only.

## Build & Test

Toolchain: Bun ≥ 1.3 and Node ≥ 20.19 (tooling only — Electron 32 bundles its own Node 20.18). `bun install` downloads better-sqlite3's prebuilt Electron binary. `g++`, `make`, and `python3` are needed only when no prebuild matches the platform or the download fails (e.g. offline). Linux also needs GTK 3, NSS, and ALSA runtime libraries.

```bash
bun install        # postinstall fetches better-sqlite3's Electron-ABI prebuild, compiling only as a fallback (scripts/rebuild-natives.ts)
bun run dev        # electron-vite dev: HMR renderer on :5173 + Electron window
bun run build      # main/preload/renderer bundles -> out/
bun run typecheck  # tsc (main, preload) + svelte-check (renderer); does NOT cover tests/, scripts/, or config files
bun run lint       # ESLint flat config
bun run test       # unit tests (bun:test); same as bare `bun test`; takes a file filter
bun run test:e2e   # builds, then Playwright launches Electron (throwaway userData) and runs tests/e2e/specs/
```

- `bun test` and `bun run test` are equivalent. `bunfig.toml` `[test]` sets `root = "./tests/unit"` and preloads `tests/unit/setup.ts` (rune and DOM shims). A positional filter runs only matching files (`bun test splitSql`); a filter that matches nothing exits 1.
- CI (`.github/workflows/ci.yml`) runs typecheck, lint, and unit tests on every push and PR, installing with `--ignore-scripts` (no Electron, no native build). e2e is local-only for now.
- Don't run `bun run format` (`prettier --write .`): much of the tree is not Prettier-clean and there is no `.prettierignore`, so it rewrites ~170 files. Format only what you touched: `bunx prettier --write <files>`.
- Done means `typecheck`, `lint`, `test`, and `test:e2e` all pass. On a clean checkout all are green; the only skip is `tests/unit/snowflake.smoke.test.ts`, a live Snowflake round-trip enabled by `SNOWBOY_TEST_ACCOUNT`, `SNOWBOY_TEST_USER`, `SNOWBOY_TEST_PWD` (optional `SNOWBOY_TEST_ROLE` / `_WAREHOUSE` / `_DATABASE` / `_SCHEMA`). Never commit credentials.
- Unit tests do not exercise the real stack. Storage runs on `bun:sqlite` (Bun blocks better-sqlite3; `src/main/storage/db.ts` switches drivers), migrations load from disk instead of the embedded map, and Svelte runes are identity shims (no reactivity). `$state.raw` is an identity shim too, while `$state.snapshot` and `$derived.by` are undefined. Verify storage and UI changes with `bun run test:e2e`, and UI behaviour in `bun run dev`.
- `bun run dev` uses Electron `userData` — `~/.config/snowboy` on Linux — holding `snowboy.db`, `settings.json`, and `secrets.json` (safeStorage-encrypted saved passwords). Deleting it for a clean slate also wipes saved credentials.
- `test:e2e` never touches that directory. Specs launch through `tests/e2e/helpers/launch.ts`, which passes `--user-data-dir` pointing at a throwaway temp dir and removes it afterwards. New specs must use that helper, never `electron.launch` directly.
- Stop `bun run dev` by closing the window or Ctrl+C. If you kill it from a script, check for an orphaned `node_modules/electron/dist/electron .` process afterwards; one has been seen ignoring SIGTERM.

### Platform: install and run on the same OS

`node_modules` holds platform-specific binaries (Electron itself and `better-sqlite3`).

- **WSL clone on the Linux filesystem** (e.g. `~/.repos/snowboy`): run everything from WSL bash. Works under WSLg — `dev` launches and `test:e2e` passes. `viz_main_impl ... Exiting GPU process` errors are benign (software-rendering fallback).
- **Windows clone** (`C:\...`): run from PowerShell with Windows `bun.exe` only. `bun install` from WSL against a `/mnt/c/...` checkout installs Linux binaries that crash Windows Electron — that is what the "never WSL" rule in `.sisyphus/plans/snowboy-handoff-2026-05-20.md` refers to.
- Never share one `node_modules` between the two.

## Architecture Overview

Three bundles:

| Layer | Path | Role |
|---|---|---|
| Main (Node) | `src/main/` | `ipc/` — one module per domain (connections, sessions, query, schema, history, workspace, settings, theme), each exporting `register(ipcMain)`, wired in `ipc/index.ts`. `snowflake/` — `Session` (live sessions are a `Map` in `ipc/sessions.ts`), auth options, row streaming over `snowflake-sdk`, and `sqlText.ts` (`quoteIdent` / `sqlStringLiteral`); `pool.ts` (`SessionPool`) is unit-tested but not wired into the app. `storage/` — better-sqlite3 repos (worksheets, layout, history, profiles, schemaCache) + migrations; `settings.ts` is a synchronous flat-JSON store at `<userData>/settings.json` (no SQLite), with `settingsEvents.ts` as its change emitter. `secrets/` — saved passwords, PATs, and key-pair passphrases, encrypted with Electron `safeStorage` in `<userData>/secrets.json`. Key-pair profiles store only the key file's path (`private_key_path`); never copy, cache, or log key contents. |
| Preload | `src/preload/index.ts` | `contextBridge` exposes `window.snowboy` (the `SnowboyApi`) and `window.snowboySettingsBoot`. |
| Renderer | `src/renderer/` | Svelte 5 (runes) + Tailwind 3; shadcn-svelte/bits-ui primitives in `lib/components/ui/`; CodeMirror 6 SQL editor and IntelliSense completion cache in `lib/editor/`; global stores in `lib/stores/*.svelte.ts`; split-pane worksheets in `lib/panes/`; virtualized results grid in `lib/results/`; Object Browser in `lib/browser/`. |

- **IPC contract.** `src/main/types.ts` (`SnowboyApi`) is the single source of truth; channel strings live in `src/main/ipc/channels.ts` (`CHANNELS`), imported by both preload and main — except the synchronous `theme.boot` channel, a raw string on both sides. A new call touches `channels.ts` → `types.ts` → the handler in `src/main/ipc/<domain>.ts` → `src/preload/index.ts` → the renderer caller via `lib/ipc/client.ts`, plus a test under `tests/unit/ipc/`.
- **Migrations.** Add `src/main/storage/migrations/NNN_name.sql` *and* register it in `src/main/storage/embedded-migrations.ts` (imported with `?raw`). The app runs only registered migrations; unit tests scan the directory, so they will not catch a missing registration.
- **Startup / shutdown.** `src/main/index.ts`: `smokeLoadNatives()` → `openDatabase()` → `registerIpc()` → window. Quit goes through a single `before-quit` orchestrator (renderer flush handshake with a 2 s timeout → `closeAllSessions()` → `closeDatabase()` → `app.quit()`), guarded by a `shutdownComplete` flag because that final `app.quit()` fires `before-quit` again. Extend it; never register another `before-quit` handler.
- **Path aliases.** `$lib` → `src/renderer/lib` (the only one in use), `@renderer` → `src/renderer`, `@main` → `src/main` (main bundle only).
- **Plans.** `.sisyphus/plans/` holds the MVP v0.1 plan, the Wave 4 spec, and the 2026-05-20 handoff. Treat them as history: much of their "next up" work has since shipped (check `git log`).

## Conventions & Patterns

**Hard rules**

- No `as any`, `@ts-ignore`, or `@ts-expect-error` in `src/` (there are none today). Three test files carry legacy exceptions (`tests/unit/setup.ts`, `tests/unit/connections/validation.test.ts`, `tests/unit/storage/worksheets.test.ts`); don't add more. TypeScript runs `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals/Parameters`; typecheck and lint stay at zero findings.
- Never delete or skip a failing test to get green, and never weaken the e2e smoke (`tests/e2e/specs/smoke.spec.ts`).
- Build SQL that embeds Snowflake identifiers or string constants only with `quoteIdent` / `sqlStringLiteral` (`src/main/snowflake/sqlText.ts`). Snowflake string constants honour backslash escapes, so doubling `'` alone is injectable.
- Prettier style: single quotes, semicolons, no trailing commas, 100 columns.

**Svelte 5 landmines** (background in the handoff doc)

- Native `Map`/`Set` mutations are not reactive inside `$state` — use `SvelteMap`/`SvelteSet` from `svelte/reactivity`.
- Call `$state.snapshot(x)` before sending any object over IPC ("An object could not be cloned").
- Don't mutate a parent-owned prop's fields; keep local `$state` and call back up.
- Mutating `$state` inside `$derived` throws — wrap it in `untrack(...)` (see `src/renderer/lib/panes/paneStore.svelte.ts`).
- Key `{#each}` blocks by stable ids, never by index.
- `@tanstack/svelte-table` is banned; `@tanstack/svelte-virtual` is fine.
- Props compile to live getters (`$$props.x`). An async function that can outlive its component — e.g. a run loop that continues across a tab switch or split, since `{#key tree.paneId}` remounts panes — must copy props and derived values into locals before its first `await`.

**Electron and streaming landmines**

- Preload runs before the DOM is parsed — defer DOM work to `DOMContentLoaded`.
- IPC during renderer unload is unreliable; use the existing ack-and-timeout flush pattern.
- A zero-row result still emits one empty batch carrying the columns (`src/main/snowflake/streaming.ts`); consumers rely on it.
- Electron and Bun use BoringSSL, while Node uses OpenSSL, so `node:crypto` error codes and messages differ between them. A wrong passphrase can even surface as a decode error. Classify keys by input structure, not error text (see `checkPrivateKeyFile` in `src/main/snowflake/auth.ts`).

**Tests.**
- Unit: `bun:test` under `tests/unit/`, grouped by area (`editor/`, `ipc/`, `storage/`, `stores/`, `results/`, `panes/`, …).
  - IPC handler tests build file-local fakes (e.g. `makeFakeSession`) against a fresh in-memory database.
  - Keep UI decision logic in plain TS, so it's unit-testable despite the rune shims (e.g. `lib/panes/worksheetLoad.ts`).
- e2e: Playwright specs in `tests/e2e/specs/`, launched via `tests/e2e/helpers/launch.ts`.
  - To fake main-process behaviour without Snowflake, swap an IPC handler in the running app, e.g. `app.evaluate(({ ipcMain }, ch) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, …) }, channel)`. See `tabs.spec.ts`.

**Commits.** Conventional commits scoped by area: `feat(editor): …`, `fix(results): …`, `docs: …`. Commit or push only when asked. After a delegated agent reports done, confirm its commit is actually in `git log --oneline -3`.

**Agent skills.** Route work with `using-agent-skills`, skipping its beads step. Common picks here:

| Situation | Skill |
|---|---|
| Svelte UI, pane, or editor work | `frontend-ui-engineering`, then verify with `bun run test:e2e` |
| New behaviour or a bug fix | `test-driven-development` (bun:test), `debugging-and-error-recovery` |
| snowflake-sdk, CodeMirror 6, Svelte 5, or Electron API questions | `source-driven-development` (check current docs via Context7) |
| Before merging | `code-review-and-quality` |
