# Snowboy — Claude Code guide

Cross-platform desktop IDE for Snowflake (pre-alpha): Electron 44 + Svelte 5 + TypeScript, built with electron-vite, managed with Bun.

## Task tracking: `docs/PLAN.md` (no beads)

`docs/PLAN.md` is the plan and task tracker, milestones M0–M7 toward an installable v0.1. Before starting work, find the task there. When its verification passes, flip its status and add a dated line to the Progress log. Finding IDs (A1, D5, …) point to the review in `.omc/reviews/2026-09-29-architecture-sweep.md`, which is git-ignored and local to this checkout.

This project does **not** use beads (`bd`). Ignore beads instructions or context inherited from `~/.repos/CLAUDE.md`, hooks, or skills: don't run `bd`, skip the `using-beads` step when routing with `using-agent-skills`, and don't put bead ids in commits. Normal Claude memory is fine here. Any `.beads/` data is historical only.

## Build & Test

Toolchain: Bun ≥ 1.3 and Node ≥ 22.12 (tooling only — Electron 44 bundles its own Node 24.21). No compiler toolchain is needed: better-sqlite3's prebuilt binaries ship inside its npm package, and the `postinstall` hook (`bun run setup:natives`, `scripts/setup-natives.ts`) downloads the Electron binary, which the `electron` package stopped doing itself in Electron 42, then checks that better-sqlite3 loads in it. See the native-module landmines below. Linux also needs GTK 3, NSS, and ALSA runtime libraries.

```bash
bun install        # postinstall runs `bun run setup:natives`: downloads the Electron binary, checks better-sqlite3 loads in it
bun run dev        # electron-vite dev: HMR renderer on :5173 + Electron window
bun run build      # main/preload/renderer bundles -> out/
bun run typecheck  # tsc (main, preload) + svelte-check (renderer); does NOT cover tests/, scripts/, or config files
bun run lint       # ESLint flat config
bun run test       # unit tests (bun:test); same as bare `bun test`; takes a file filter
bun run test:e2e   # builds, then Playwright launches Electron (throwaway userData) and runs tests/e2e/specs/
bun run build:linux  # electron-vite build + electron-builder: dist/*.AppImage, dist/*.deb, dist/linux-unpacked/
bun run build:win    # NSIS installer; build it on Windows (cross-building from Linux needs Wine)
```

- `bun test` and `bun run test` are equivalent. `bunfig.toml` `[test]` sets `root = "./tests/unit"` and preloads `tests/unit/setup.ts` (rune and DOM shims). A positional filter runs only matching files (`bun test splitSql`); a filter that matches nothing exits 1.
- CI (`.github/workflows/ci.yml`) runs typecheck, lint, and unit tests on every push and PR, installing with `--ignore-scripts`, which skips the postinstall (no Electron download, no better-sqlite3 check). e2e is local-only for now.
- Don't run `bun run format` (`prettier --write .`): much of the tree is not Prettier-clean and there is no `.prettierignore`, so it rewrites ~170 files. Format only what you touched: `bunx prettier --write <files>`.
- Done means `typecheck`, `lint`, `test`, and `test:e2e` all pass. On a clean checkout all are green; the only skip is `tests/unit/snowflake.smoke.test.ts`, a live Snowflake round-trip enabled by `SNOWBOY_TEST_ACCOUNT`, `SNOWBOY_TEST_USER`, `SNOWBOY_TEST_PWD` (optional `SNOWBOY_TEST_ROLE` / `_WAREHOUSE` / `_DATABASE` / `_SCHEMA`). Never commit credentials.
- Unit tests do not exercise the real stack. Storage runs on `bun:sqlite` (`src/main/storage/db.ts` picks it whenever `globalThis.Bun` is set, because Bun 1.3.9 can't load better-sqlite3), migrations load from disk instead of the embedded map, and Svelte runes are identity shims (no reactivity). `$state.raw` is an identity shim too, while `$state.snapshot` and `$derived.by` are undefined. Verify storage and UI changes with `bun run test:e2e`, and UI behaviour in `bun run dev`.
- `bun run dev` uses Electron `userData` — `~/.config/snowboy` on Linux — holding `snowboy.db`, `settings.json`, and `secrets.json` (safeStorage-encrypted saved passwords). Deleting it for a clean slate also wipes saved credentials.
- `test:e2e` never touches that directory. Specs launch through `tests/e2e/helpers/launch.ts`, which passes `--user-data-dir` pointing at a throwaway temp dir and removes it afterwards. New specs must use that helper, never `electron.launch` directly.
- Stop `bun run dev` by closing the window or Ctrl+C. If you kill it from a script, check for an orphaned `node_modules/electron/dist/electron .` process afterwards; one has been seen ignoring SIGTERM.

### Platform: install and run on the same OS

`node_modules` holds platform-specific binaries: Electron itself (`electron/dist` and `electron/path.txt`) and the esbuild and Rollup platform packages. better-sqlite3 is not one of them; it ships every platform's prebuild.

- **WSL clone on the Linux filesystem** (e.g. `~/.repos/snowboy`): run everything from WSL bash. Works under WSLg — `dev` launches and `test:e2e` passes. `viz_main_impl ... Exiting GPU process` errors are benign (software-rendering fallback).
- **Windows clone** (`C:\...`): run from PowerShell with Windows `bun.exe` only. `bun install` from WSL against a `/mnt/c/...` checkout installs Linux binaries that crash Windows Electron — that is what the "never WSL" rule in `.sisyphus/plans/snowboy-handoff-2026-05-20.md` refers to.
- Never share one `node_modules` between the two.

## Architecture Overview

Three bundles:

| Layer | Path | Role |
|---|---|---|
| Main (Node) | `src/main/` | `ipc/` — one module per domain (connections, sessions, query, schema, history, workspace, settings, theme), each exporting `register(ipcMain)`, wired in `ipc/index.ts`. `snowflake/` — `Session` (live sessions are a `Map` in `ipc/sessions.ts`), auth options, row streaming over `snowflake-sdk`, and `sqlText.ts` (`quoteIdent` / `sqlStringLiteral`); `pool.ts` (`SessionPool`) is unit-tested but not wired into the app. `storage/` — better-sqlite3 repos (worksheets, layout, history, profiles, schemaCache) + migrations; `settings.ts` is a synchronous flat-JSON store at `<userData>/settings.json` (no SQLite), with `settingsEvents.ts` as its change emitter. `secrets/` — saved passwords, PATs, and key-pair passphrases, encrypted with Electron `safeStorage` in `<userData>/secrets.json`. Key-pair profiles store only the key file's path (`private_key_path`); never copy, cache, or log key contents. |
| Preload | `src/preload/index.ts` → `out/preload/index.cjs` | Runs **sandboxed** (`sandbox: true`), so it must be CommonJS and may import only `electron`: no Node modules and no Node globals. `contextBridge` exposes `window.snowboy` (the `SnowboyApi`) and `window.snowboySettingsBoot`. |
| Renderer | `src/renderer/` | Svelte 5 (runes) + Tailwind 3; shadcn-svelte/bits-ui primitives in `lib/components/ui/`; CodeMirror 6 SQL editor and IntelliSense completion cache in `lib/editor/`; global stores in `lib/stores/*.svelte.ts`; split-pane worksheets in `lib/panes/`; virtualized results grid in `lib/results/`; Object Browser in `lib/browser/`. |

- **IPC contract.** `src/main/types.ts` (`SnowboyApi`) is the single source of truth; channel strings live in `src/main/ipc/channels.ts` (`CHANNELS`), imported by both preload and main — except the synchronous `theme.boot` channel, a raw string on both sides. A new call touches `channels.ts` → `types.ts` → the handler in `src/main/ipc/<domain>.ts` → `src/preload/index.ts` → the renderer caller via `lib/ipc/client.ts`, plus a test under `tests/unit/ipc/`.
- **Migrations.** Add `src/main/storage/migrations/NNN_name.sql` *and* register it in `src/main/storage/embedded-migrations.ts` (imported with `?raw`). The app runs only registered migrations; unit tests scan the directory, so they will not catch a missing registration.
- **Startup / shutdown.** `src/main/index.ts`:
  - Startup: single-instance lock (a second launch focuses the first window, or opens one if none exists) → `openDatabase()` → `registerIpc()` → window.
  - Any startup failure logs, shows a "Snowboy failed to start" dialog with the data folder, and exits 1.
  - Quit goes through a single `before-quit` orchestrator: renderer flush handshake (2 s timeout, skipped when no window remains) → `closeAllSessions()` (capped at 3 s) → `closeDatabase()` → `app.quit()`. A `shutdownComplete` flag guards it, because that final `app.quit()` fires `before-quit` again. Extend it; never register another `before-quit` handler.
- **Security boundary** (`src/main/security.ts`, wired in `index.ts` and `ipc/index.ts`):
  - Navigation away from the app page is blocked; `window.open` always fails; webviews are refused.
  - `shell.openExternal` opens only allowlisted https hosts (`safeExternalUrl`; today `docs.snowflake.com`).
  - Web permissions are denied except clipboard write.
  - Every IPC registration goes through a Proxy over `ipcMain` that rejects senders other than the main frame of an app window showing the app page. Domain modules must register only on the `ipcMain` they're handed, never on the raw one.
  - Production CSP: `connect-src`, `frame-src` and `worker-src` are `'none'`, because on `file://`, `'self'` matches every local file. The dev server's CSP is widened for HMR only.
  - Packaged builds ignore `ELECTRON_RENDERER_URL` and disable DevTools (`SNOWBOY_DEVTOOLS=1` re-enables it).
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

**Native-module landmines**

- better-sqlite3 13 is a Node-API addon: one binary per platform works with every Electron version. Its npm package ships `prebuilds/<platform>-<arch>.node` for Linux (glibc ≥ 2.34, plus musl), macOS, and Windows, each x64 and arm64. `lib/binding.js` loads that file whenever it exists and falls back to `build/Release` only when it doesn't, so a prebuild that exists but won't load is never replaced. Nothing compiles on install. On a platform without a prebuild, build by hand (`cd node_modules/better-sqlite3 && bunx node-gyp rebuild`, which needs g++, make, and python3), then run `bun run setup:natives`.
- Keep `trustedDependencies` in `package.json` a non-empty list. It holds only `electron`, whose package has had no install scripts since Electron 42, as a placeholder. A non-empty list replaces Bun's default allowlist, and that default trusts better-sqlite3. An empty list doesn't work: Bun leaves it out of `bun.lock`, and every later install falls back to the default. Bun ignores better-sqlite3's `gypfile: false`, so a trusted better-sqlite3 gets an implicit `node-gyp rebuild` that builds nothing yet needs Python, plus Visual Studio on Windows. Never `bun pm trust` better-sqlite3 or esbuild (or `--all`); esbuild's blocked postinstall isn't needed either.
- After an `--ignore-scripts` install, run `bun run setup:natives` before `bun run dev`: electron-vite reads `node_modules/electron/path.txt` and never downloads Electron itself.
- Packaging keeps `npmRebuild: false`, because a rebuild routes better-sqlite3 13 to node-gyp. `asarUnpack` lists only the `.node` binaries.
- Each platform's `files` keeps only its own prebuilds. The patterns spell out `darwin` / `win32` / `linux` and use only `${arch}`, because `${os}` expands to mac/win/linux and `${platform}` to the build host.

**Packaging (electron-builder, `electron-builder.yml`)**

- `files` goes in the platform sections only, never at the top level. electron-builder keeps the two as separate matchers, and a platform list of only `!` patterns then packs the whole repo (src/, tests/, docs, `.omc` state). After any packaging change, list `dist/linux-unpacked/resources/app.asar` and confirm it holds only `out/`, `resources/`, `package.json` and production `node_modules`.
- `dependencies` holds only what main or preload load at runtime: better-sqlite3 and snowflake-sdk. electron-builder packs exactly that tree, and electron-vite externalizes exactly that list. Renderer packages are devDependencies.
- Packaged builds flip Electron fuses. They ignore `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, so Playwright's `_electron.launch` can't attach to `dist/` binaries; check those with a CDP probe (`--remote-debugging-port`). Dev and e2e run the stock `node_modules/electron`, which is unaffected.
- Keep `grantFileProtocolExtraPrivileges` on while the renderer uses `loadFile()`; turning it off gives a blank window (ERR_FILE_NOT_FOUND).
- A packaged build's default userData is the same `~/.config/snowboy` as dev, so in scripts and tests always launch it with `--user-data-dir=<temp dir>`. Stop it with SIGTERM to the main process; killing the whole process group makes Chromium abort.

**Tests.**
- Unit: `bun:test` under `tests/unit/`, grouped by area (`editor/`, `ipc/`, `storage/`, `stores/`, `results/`, `panes/`, …).
  - IPC handler tests build file-local fakes (e.g. `makeFakeSession`) against a fresh in-memory database.
  - Keep UI decision logic in plain TS, so it's unit-testable despite the rune shims (e.g. `lib/panes/worksheetLoad.ts`).
- e2e: Playwright specs in `tests/e2e/specs/`, launched via `tests/e2e/helpers/launch.ts`.
  - To fake main-process behaviour without Snowflake, swap an IPC handler in the running app, e.g. `app.evaluate(({ ipcMain }, ch) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, …) }, channel)`. See `tabs.spec.ts`. Swapped handlers sit on the raw `ipcMain`, so they bypass the IPC sender guard; the guard itself is covered in `hardening.spec.ts`.
  - `hardening.spec.ts` covers the sandbox, navigation, `window.open`, permissions, CSP and foreign-sender rejection; `startup.spec.ts` covers the single instance, relaunch-after-close, startup failure and early close/reload.

**Commits.** Conventional commits scoped by area: `feat(editor): …`, `fix(results): …`, `docs: …`. Commit or push only when asked. After a delegated agent reports done, confirm its commit is actually in `git log --oneline -3`.

**Agent skills.** Route work with `using-agent-skills`, skipping its beads step. Common picks here:

| Situation | Skill |
|---|---|
| Svelte UI, pane, or editor work | `frontend-ui-engineering`, then verify with `bun run test:e2e` |
| New behaviour or a bug fix | `test-driven-development` (bun:test), `debugging-and-error-recovery` |
| snowflake-sdk, CodeMirror 6, Svelte 5, or Electron API questions | `source-driven-development` (check current docs via Context7) |
| Before merging | `code-review-and-quality` |
