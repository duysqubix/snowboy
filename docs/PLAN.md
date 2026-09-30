# Snowboy v0.1: plan & task tracker

**Goal:** a workable Snowboy you can install on your own machine (Windows or Linux), connect to your Snowflake account, and use productively every day.

This file is the source of truth for what's planned, in progress, and done. Update a task's status and add a log line as soon as its verification passes. Finding IDs (A1, D5, …) refer to the review in `.omc/reviews/2026-09-29-architecture-sweep.md`.

**Status:** `[ ]` todo · `[~]` in progress · `[x]` done and verified · `[!]` blocked · `[-]` dropped

## Definition of done (v0.1 "daily driver")

- [ ] A Windows installer (NSIS), and optionally a Linux AppImage/deb, builds from a clean checkout with one documented command.
- [ ] The installed app launches on your machine, and the e2e smoke passes against the **packaged** build.
- [ ] It connects to your Snowflake account with your sign-in method. Credentials are stored by the OS (Windows DPAPI / macOS Keychain / Linux libsecret), or kept for the session only where no keyring exists. Never plaintext.
- [ ] You can write SQL, run statements, cancel, browse objects, and export results.
- [ ] Work survives a restart.
- [ ] Queries run in the context the UI shows.
- [ ] It runs on a supported Electron; CI is green; typecheck, lint, unit, and e2e all pass.

## Build targets

| Target | How it's built | Role |
|---|---|---|
| **Windows NSIS installer** | Windows-side clone + Windows `bun.exe` (present on this machine), or a GitHub Actions `windows-latest` job | **Daily driver**: DPAPI secrets, native SSO browser flow |
| Linux AppImage / deb | WSL/Linux (`bun run build:linux`) | Automated packaged-build smoke tests; Linux use |

Unsigned builds are fine for personal use. Windows SmartScreen will warn once ("More info → Run anyway").

## Decisions

| # | Decision | Status | Choice |
|---|---|---|---|
| D-1 | Sign-in method(s) to support | **Decided (you, 2026-09-29)** | All four: SSO (external browser), password + MFA, PAT, and **key-pair (new)**. Plain password stays available. |
| D-2 | Execution context model (B1) | Default adopted | One shared session per profile with a single visible context bar. Per-pane sessions come later. |
| D-3 | Tabs + splits in v0.1 (A1/A3) | Default adopted | Keep both. |
| D-4 | Result row cap (C3) | Default adopted | 100k-row preview with a `truncated` banner. "Export all" streams to disk from main. |
| D-5 | Linux without a keyring (D5) | Default adopted | Session-only in-memory credentials with a clear message. Never plaintext. |
| D-6 | Electron target (D1) | Default adopted | Latest stable (44.x) before any build leaves your machine. |
| D-7 | Zone.Identifier signed URL (G12) | Default adopted | Untrack and ignore. No history rewrite. |

## Milestones & tasks

Order: M0 → M1 → M2 → **preview build** → M3 → M4 → M5 → M6 → **v0.1.0**. M7 runs continuously.

### M0: Safety net & quick wins

- [x] **M0.1** e2e runs with an isolated temp userData, plus a new-tab e2e spec. *(G1, A2)*
  - AC: e2e never touches `~/.config/snowboy`; smoke and tabs specs pass.
- [x] **M0.2** New tab / Ctrl+W on a lone pane shows an editor (`{#key tree.paneId}`). *(A2)*
- [x] **M0.3** One run guard for the button, run-at-cursor, and run-all. *(C7)* *(Reviewed; no automated test, since that needs a component harness (M7.2).)*
- [x] **M0.4** Result rows stored as `$state.raw`; previous results freed on re-run; late events for disposed ids dropped. *(C3 part)* *(13 store unit tests.)*
- [x] **M0.5** Grid Ctrl+C scoped to the grid; selection resets on new results. *(C4)* *(Reviewed; no automated test, since that needs a component harness (M7.2).)*
- [x] **M0.6** Backslash-safe SQL string literals through one shared `sqlText.ts` helper. *(D2)* *(Review approved; `quoteIdent("")` throws.)*
- [x] **M0.7** `splitSql` honours backslash escapes. *(C8)* *(Review approved; O(1) connector-style URI guard for `--`, `//` and `/*`.)*
- [x] **M0.8** Fix the unhandled rejection in `completionPrefetch.ts:51`. *(G11)* *(Review approved; mutation-tested.)*
- [x] **M0.9** bunfig `[test]` preload + root, so bare `bun test` and filters work; README test docs fixed. *(G12)* *(Review approved.)*
- [~] **M0.10** Minimal CI: typecheck, lint, unit on ubuntu. *(G2)*
  - AC: dry run passes in a clean copy; the workflow runs on the first push.
- [x] **M0.11** Untrack the Zone.Identifier and `.sisyphus` session JSON; ignore rule added. *(G12)* *(Review approved.)*
- [x] **M0.12** better-sqlite3 uses the Electron prebuild instead of compiling. *(G7)*
  - AC: `bun run rebuild` is fast and e2e passes.
- [x] **M0.13** Batch verification (orchestrator). *(Gates, rebuild, e2e 5/5, full-tree CI dry run, and three independent reviews all green.)*
  - AC: full gates, native rebuild, e2e, CI dry run, and an independent code review are all green.

### M1: Supported runtime & installable build

- [ ] **M1.1** Upgrade Electron 32 → 44, with better-sqlite3 → a release with prebuilds for the new ABI, and `@types/node` → the bundled Node major. *(D1)*
  - AC: gates and e2e pass; `bun audit` shows no Electron advisories.
- [ ] **M1.2** Renderer hardening. *(D3, D6)*
  - Preload built as CJS with `sandbox: true`.
  - Deny navigation and `window.open` except app URLs.
  - Permission handler allows clipboard only.
  - Central IPC sender check.
  - `openExternal` is https-only.
  - Production CSP without dev allowances.
  - AC: e2e passes; dropping a link or file does not navigate.
- [ ] **M1.3** Packaging. *(G8, G9, D4)*
  - Add `electron-builder@^26`.
  - Only better-sqlite3 and snowflake-sdk stay in `dependencies`.
  - Narrow `files` to `out/{main,preload,renderer}` + `resources`.
  - Set `author`; targets `nsis` (win) and `AppImage` + `deb` (linux).
  - Remove the deprecated `externalizeDepsPlugin`.
  - Fuses: RunAsNode, NODE_OPTIONS, and `--inspect` off; OnlyLoadAppFromAsar and asar integrity on.
  - Gate `ELECTRON_RENDERER_URL` and DevTools on `!app.isPackaged`.
  - AC: `bun run build:linux` produces an AppImage that launches, and the e2e smoke passes against the packaged app.
- [ ] **M1.4** Startup robustness. *(E1)*
  - try/catch around startup → error dialog → exit.
  - Single-instance lock that focuses the existing window.
  - Drop `smokeLoadNatives`.
  - AC: a forced DB-open failure shows a dialog and exits; a second launch focuses the first.
- [ ] **M1.5** Windows installer build. First pass: a Windows-side clone + Windows `bun.exe` (`bun install`, `bun run build:win`). Later: a CI `windows-latest` job (needs push approval, U-3).
  - AC: the installer installs, the app launches on Windows, and the smoke passes.
- [ ] **M1.6** README "Install" section: how to build the installer and where the app keeps its data.
- [x] **M1.7** Pulled forward into M0 (renderer lane). Make e2e temp-profile cleanup Windows-safe: `rmSync` with `force`/`maxRetries`, and don't fail a passing test on EBUSY (`tests/e2e/helpers/launch.ts`). Needed before running e2e on Windows in M1.5. *(Implemented in M0; the Windows run is confirmed in M1.5.)*

### M2: Connect to your Snowflake account

- [ ] **M2.1** Verify the existing sign-in methods in the **packaged** Windows app (D-1). SSO opens the system browser and returns; password + MFA handles both Duo push and passcode; PAT connects.
- [~] **M2.1b** New: key-pair authentication (SDK `SNOWFLAKE_JWT`). Implemented; unit gates green; waiting on the live connect (U-4).
  - Wizard: private-key file picker (PKCS#8 `.p8`, encrypted or not) plus an optional passphrase.
  - Store the key-file **path** in the profile. Store the passphrase in safeStorage; never keep it in SQLite.
  - Validate that the key parses before saving.
  - Clear errors for a wrong passphrase, a missing file, or an unregistered public key.
  - AC:
    - Unit tests for option building and validation.
    - Live connect with your key (U-4).
    - The key file is never copied or logged.
- [ ] **M2.2** Credential storage policy. *(D5)*
  - Password and PAT profiles share the `:password` secret, so switching a profile between the two reuses the old secret. Split the keys or clear the secret on switch.
  - Check the backend before saving.
  - OS keychain on Windows/macOS/Linux-with-keyring.
  - Session-only in memory with a clear UI message elsewhere.
  - Fix the misleading comment.
  - Owner-only file modes (`0600`) for JSON and DB files.
- [ ] **M2.3** Session errors & expiry. *(E2, R-12)*
  - `sessions.open` errors also go through the hint mapper; today only `connections.test` does.
  - Relabel 390114 as master-token expired; its JWT alternative is now unreachable.
  - Typed IPC errors `{code, message}`.
  - Map SDK codes: MFA required, master-token expired (390114), auth failed.
  - Drop dead sessions and prompt to reconnect.
  - Strip Electron's "Error invoking remote method" prefix.
- [ ] **M2.4** **Bug:** `auth.ts:98` sends `clientRequestMfaToken`, but the SDK reads `clientRequestMFAToken` (`connection_config.js:59`), so the MFA token cache is never requested and every password + MFA connect prompts Duo. Found by the M2.1b lane. snowflake-sdk configuration: log level WARN to the app logs dir, no `./snowflake.log`; optional SSO/MFA token cache backed by safeStorage. *(D6: S-7, S-10)*
- [ ] **M2.5** Live verification with your account (**you**, U-4).
  - Opt-in live smoke via `SNOWBOY_TEST_*`.
  - Manual checklist: connect → run → browse → cancel → export → restart.

**Preview build:** after M0–M2, cut `v0.1.0-preview.1`, an installable build to try on your machine.

Known limitations until M3–M5:
- Restart may not restore tabs.
- All panes share one context.
- Duplicate column names break the grid.

### M3: Don't lose work

- [ ] **M3.1** One persisted `workspace` store (tabs → trees of `{paneId, worksheetId}`) and a `worksheets` store that owns hydrate/debounce/flush. Delete `panesSingleton`. Extract `runStatements()`. *(A1, A3)*
- [ ] **M3.2** Quit flush. *(A4)*
  - Triggered from window `close`.
  - Await worksheet saves before the ack.
  - 5 s hard deadline → `app.exit`.
  - Session logout bounded.
- [ ] **M3.3** e2e: split → type → relaunch restores everything; close → reopen.
- [ ] **M3.4** Recover orphaned worksheets (`listWorksheets` UI, or reattach on startup).
- [x] **M3.5** A failed worksheet load must never clobber the stored SQL. Pulled forward into M0 (renderer lane). *(Done in M0: `worksheetLoad.ts` gate, 6 unit tests, e2e retry test.)*
  - Today `finally` marks the pane hydrated even when the load throws (`WorksheetPane.svelte` ~:101-108), so the first keystroke saves an empty body over the stored text. Pre-existing; found in the M0 review.
  - Fix: on load error, show an error state with a retry, and don't save.

### M4: Queries run where you think they run

- [ ] **M4.1** A single visible context bar per session (D-2). Pickers update it, and every pane reflects the session's real context. *(B1)*
- [ ] **M4.2** Read effective context from the SDK getters after each statement. Remove the USE regex and the extra round trip. *(B2)*
- [ ] **M4.3** Real cancel via `stmt.cancel()`. *(C1)*
  - Change the fake so it withholds `complete`.
  - Add a live `SYSTEM$WAIT` cancel smoke.
- [ ] **M4.4** Send events to the owning window; close its sessions on reload or crash. *(E3)*
- [ ] **M4.5** Run lifecycle edge cases, found in the M0 review; all pre-existing.
  - Closing a pane or tab cancels its remaining statements.
  - A late error from a failed cancel doesn't flip "Cancelled" to "Error".
- [x] **M4.6** Pulled forward into M0 (renderer lane: module-level cache shared by the pickers). Cache the role and warehouse lists per session. Since M0.2's `{#key}` remount, every tab switch, split and Ctrl+W re-runs uncached `SHOW ROLES` and `SHOW WAREHOUSES`. Fold this into the M4.1 context-bar redesign. *(Done in M0: module-level lists shared by panes.)*

### M5: Results you can trust

- [ ] **M5.1** Rows as positional `unknown[][]` end to end. *(C2)*
  - Columns keyed by index.
  - `<svelte:boundary>` around results.
  - CSV by index.
- [ ] **M5.2** Lossless numbers: NUMBER/DECIMAL fetched as strings (or BigInt for integers). Map SDK type names (`fixed` → numeric) and hoist the number formatter. *(C6, C5)*
- [ ] **M5.3** Bounded streaming (D-4). *(C3)*
  - One `streamRows()` stream with backpressure.
  - 100k-row cap with a `truncated` banner.
  - "Export all" streams to disk from main.

### M6: Daily-driver polish

- [ ] **M6.1** Keymap. *(F1)*
  - Help moves to F1.
  - Respect `defaultPrevented`.
  - Tab shortcuts work inside the editor.
  - Register Ctrl+H.
- [ ] **M6.2** Apply settings (font size, tab width, word wrap) via compartments. Replace the stubs with one `insertSql(sql, mode)` for Select-100 and History restore. *(F3)*
- [ ] **M6.3** One schema catalog: no negative caching, coalesced rebuilds, capped warmup, role in the cache key. *(F2, E5)*
- [ ] **M6.4** Query history: retention, a "Clear history" action, and recovery of rows left `running`. *(E5, S-11)*

### M7: Guardrails & cleanup (continuous)

- [ ] **M7.1** Typecheck tests/scripts (`@types/bun` + `tsconfig.test.json`) and fix the 38 errors. *(G4)*
- [ ] **M7.2** Real rune preload (`compileModule`) plus store reactivity tests. *(G5)*
- [ ] **M7.3** Migration-parity unit test, and a bind guard in the Bun driver shim. *(G6)*
- [ ] **M7.4** Prettier: `.prettierignore`, one format commit + `.git-blame-ignore-revs`, CI check. *(G10)*
- [ ] **M7.5** Typed ESLint async rules; fix the no-op per-layer globals. *(G11)*
- [ ] **M7.6** Delete dead code and dependencies. *(E6, F4, G9)*
  - `SessionPool`, unused UI deps and components.
  - `lucide-svelte` → `@lucide/svelte`.
  - `tailwind-merge@^2.6`.
  - Small logo.
- [ ] **M7.7** Dedupe the session-open and collect-rows helpers, and the renderer copy of `quoteIdent` in `ObjectBrowser.svelte:261-263`. *(E4)*
- [ ] **M7.8** Remove beads text from AGENTS.md (after U-1).
- [ ] **M7.9** Bind variables for the INFORMATION_SCHEMA COLUMNS predicates. Needs `RunOptions.binds` plumbed through `runStreaming` and `runQueryRows` and the test fake. Defense in depth on top of M0.6; check that INFORMATION_SCHEMA pushdown behaves the same with binds.
- [x] **M7.10** Pulled into M0; the SQL lane now guards `--`, `//` and `/*` with an O(1) connector-accurate word check. splitSql: guard `--` inside unquoted URIs, e.g. `PUT file:///tmp/a--b.csv`, with the same `isUriSlashes`-style check the connector uses. *(Done in M0.)*

## Your action items

- [!] **U-1** Remove the leftover beads wiring. Auto mode blocks Claude from deleting it. Run:
  `! cd ~/.repos/snowboy && { git config --unset core.hooksPath; rm -rf .beads .agents .codex .claude/settings.json; }`
- [x] **U-2** Answer D-1: how do you sign in to Snowflake? Answered: SSO, password + MFA, PAT, key-pair.
- [ ] **U-3** Approve pushing to `duysqubix/snowboy` when CI or a Windows CI build is ready. Pushes need the `github-duysqubix` SSH alias.
- [ ] **U-4** Run the live connection check with your account. Include `SELECT 1 AS "a\"` to confirm backslashes are literal inside quoted identifiers; this settles the review's open question on `quoteIdent`. Type credentials into the app yourself; never paste them into chat.

## Progress log

- 2026-09-29: Plan created from the architecture sweep (41 findings). M0 started in three parallel lanes: renderer + e2e, SQL text, tooling.
- 2026-09-29: D-1 decided: support SSO, password + MFA, PAT, and key-pair. Key-pair added as M2.1b.
- 2026-09-29: M0.6, M0.7 and M0.8 implemented by the SQL lane; lane gates green (428 pass, 1 skip). They stay `[~]` until M0.13 verification.
  - M0.6: `src/main/snowflake/sqlText.ts` (`quoteIdent`, `sqlStringLiteral`) is used by schema.ts and session.ts.
  - M0.7: splitSql honours `\` escapes.
  - M0.8: fixed with `then(clear, clear)` plus a warmup catch.
  - Follow-ups sent to the same lane: dialect `backslashEscapes`, `$tag$` over-matching, `//` comments.
  - Queued: bind variables for the COLUMNS predicates (M7), and the duplicated renderer `quoteIdent` in ObjectBrowser (M7.7).
- 2026-09-29: SQL lane follow-ups; tests at 443 pass, 1 skip.
  - Editor dialect: `backslashEscapes: true`, with tests.
  - splitSql: only `$$` delimits dollar-quoted strings, per the docs, so `A$B$C` splits correctly. One existing tagged-`$foo$` test was rewritten on purpose.
  - Known editor-only gap: lang-sql still highlights `$tag$` as a string; fixing it needs a custom tokenizer (low priority).
  - `//` comments: approved on the evidence of Snowflake's own connector splitter, with its `://` guard. In progress.
- 2026-09-29: Tooling lane finished M0.9–M0.12; lane gates green (443 pass, 1 skip).
  - M0.9: bunfig `[test] root=./tests/unit` plus preload; `scripts.test` is `bun test`; `--pass-with-no-tests` dropped so an unmatched filter fails loudly.
  - M0.10: `.github/workflows/ci.yml`, SHA-pinned; checkout and setup-node are v7 because GitHub removed Node 20 from runners; validated with actionlint.
  - M0.11: Zone.Identifier and the session JSON are untracked, plus an ignore rule. This also unblocks Windows checkouts, since paths can't contain `:` there.
  - M0.12: `buildFromSource:false`, `force` kept; the prebuild probe loads under Electron 32.
  - README drift fixed.
  - Follow-ups:
    - Dependabot for the action SHA pins (M7).
    - Point README's plan link at `docs/PLAN.md`.
    - Verify `root` on Windows `bun.exe` during M1.5.
  - Pending in M0.13: the clean-copy CI dry run, `bun run rebuild`, and e2e.
- 2026-09-29: SQL lane finished all follow-ups; 451 tests pass, 1 skip, and its files lint clean.
  - `//` line comments are implemented with the connector's real `://` check (the whole token), not a previous-character rule, so `PUT file:///tmp/a//b.csv` is safe.
  - `$$`-only dollar quoting is done.
  - The dialect has `backslashEscapes`.
  - Known highlighting-only divergences, both limits of lang-sql's built-in tokenizer: `$tag$` is highlighted as a string, and `//` inside `file:///` is highlighted as a comment.
  - Follow-up queued (M7.10): `--` inside an unquoted URI starts a comment in splitSql (a one-line guard with the same helper).
- 2026-09-29: Renderer lane final report.
  - A2 (`{#key}` plus a hydrate-once guard), C7 (one guarded `runStatements()`), C3 part (`$state.raw` rows, clear on re-run, disposed ids drop late events), C4 (Ctrl+C on a focusable `role=grid`), G1 (`tests/e2e/helpers/launch.ts`) and M4.6 (module-level role/warehouse/database lists).
  - 13 store unit tests; e2e specs `tabs.spec.ts` and `userdata.spec.ts`.
  - An independent review approved it; its medium finding and three lows were applied.
  - M3.5 (data-loss guard) sent back to the lane.
- 2026-09-29: **M0.13 verification, part 1.**
  - `bun run rebuild` took **0.28 s** using the prebuilt better-sqlite3, down from ~75 s compiling.
  - `bun run test:e2e`: **4/4 pass** (smoke, 2 tabs, userdata), 5.3 s.
  - The real `~/.config/snowboy/snowboy.db` mtime was unchanged (10:08:18 before and after), so e2e isolation is proven.
  - No leftover Electron processes.
  - M0.1, M0.2 and M0.12 acceptance met.
- 2026-09-29: Renderer lane implemented M3.5 (the data-loss guard: a failed load blocks saves; retry offered) and M1.7 (Windows-safe e2e cleanup with retries), strengthened the tabs spec, and applied both optional simplifications. typecheck and lint are green. The unit gate waits on the key-pair lane's in-flight tests, and e2e will be re-run in M0.13.
- 2026-09-29: **M0 complete; M0.10 waits only on the first CI run after a push (U-3).**
  - SQL lane review follow-ups: O(1) `sawScheme` URI guard covering `--`, `//` and `/*`. 81k chars now take 5 ms (was about 2 s).
  - `isCommentOnly` removed; `quoteIdent('')` throws and empty context values are rejected before any USE.
  - Final gates: typecheck and lint clean, 549 pass / 1 skip / 0 fail, e2e 5/5, real userData untouched.
- 2026-09-29: Independent review of the SQL and tooling diffs: **APPROVE**, 0 critical or important findings.
  - It ran 23 adversarial splitter scripts, mutation-tested the prefetch fix, checked the CI pins against their tags, and simulated `--ignore-scripts`.
  - Suggestions sent back to the SQL lane:
    - The `//` URI guard is O(n²) (6.3 s on an 80k-char run) and walks back across tokens. It is being replaced with an O(1) connector-style word check covering `--`, `//` and `/*`, which also closes M7.10.
    - Delete the dead `isCommentOnly`.
    - `quoteIdent('')` should throw.
  - Nits fixed by the orchestrator: CI triggers are now `push: main` + `pull_request` (no double runs; actionlint ok), and the README typecheck and e2e rows were corrected.
- 2026-09-29: M2.1b implemented; stays `[~]` until U-4.
  - `keypair` profiles pass the key path to the SDK (`privateKeyPath` / `privateKeyPass`).
  - Path column via migration 003; passphrase in safeStorage.
  - The key is parsed in main (RSA ≥2048, fingerprint) before save, test and open; the wizard has a key picker.
  - Review: 0 critical/high; all 3 medium and 8 low findings addressed.
  - 77 new unit tests; suite 538 pass, 1 skip.
  - Offline JWT check under Electron 32 matches the SDK fingerprint.
  - Pre-existing issues it found were added to M2.2, M2.3 and M2.4.
- 2026-09-29: **M0.13 verification, part 2.**
  - After M3.5: `bun run test:e2e` **5/5 pass** (smoke, 3 tabs including the failed-load Retry, userdata), 6.1 s.
  - Real userData untouched; no leftover processes.
  - Unit tests: 537 pass, 1 skip.
  - M0.3–M0.5, M3.5 and M4.6 marked done. M1.7 is implemented; its Windows run happens in M1.5.
- 2026-09-29: **M0.13 verification, part 3 (final, all four lanes landed).**
  - Repo gates: typecheck 0 errors (4309 files), lint clean, **538 pass / 1 skip / 0 fail** (36 files).
  - e2e **5/5**; real userData untouched; no leftover processes.
  - **Full-tree CI dry run:** clean copy of all 254 files to be committed, `CI=true`. `bun install --frozen-lockfile --ignore-scripts` passes with no Electron binary; typecheck, lint and test pass (538/1/0).
  - Remaining for M0: the independent review of the SQL and tooling diffs, then the commit (owner's call), then the first CI run on push (U-3).
- 2026-09-29: M2.1b key-pair: an independent review found 0 critical/high, 3 medium, 8 low.
  - The lane was told to fix the 3 mediums: Add-mode retry duplicate, secret cleanup on method switch in main, and a tested passphrase decision helper.
  - Plus lows L1, L2, L3, L5 and L6.
- 2026-09-29: Partial CI dry run: HEAD `76cb030` plus the tooling config, in a clean copy with `CI=true`.
  - `bun install --frozen-lockfile --ignore-scripts` passes, and the Electron download and native build were skipped.
  - typecheck, lint and test are green (400 pass, 1 skip, 30 files).
  - Still to do: the full-tree dry run in M0.13, and the first real CI run on push (U-3).
