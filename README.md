# Snowboy

Cross-platform open-source desktop IDE for Snowflake.

**Status:** pre-alpha. The v0.1 MVP is under active development; do not rely on this build for production work.

## Requirements

- [Bun](https://bun.com) `1.3+`
- Node.js `22.12+` (Electron toolchain only — main/preload/renderer all run inside Electron's bundled Node)
- Linux: GTK 3, NSS, ALSA runtime libraries; Windows / macOS: no extra system deps for development

## Quick start

```bash
bun install
bun run dev
```

A native Snowboy window should appear. Close it (or `Ctrl+C` in the terminal) to stop the dev server.

## Install

Pre-alpha builds are unsigned and built from source.

### Windows (x64)

From PowerShell in a Windows clone (not from WSL, and not in a WSL checkout), using Windows `bun.exe`, with Node.js 22.12+ on PATH for the build tools:

```powershell
bun install
bun run build:win
```

Run `dist\Snowboy Setup <version>.exe`. It is a one-click, per-user install, with no admin rights needed. SmartScreen warns once about the unsigned installer; choose **More info → Run anyway**.

### Linux (x64)

```bash
bun install
bun run build:linux
```

- **AppImage:** `chmod +x dist/Snowboy-<version>.AppImage` and run it. It needs FUSE 2 (`libfuse2`); without FUSE, add `--appimage-extract-and-run`.
- **deb:** `sudo apt install ./dist/snowboy_<version>_amd64.deb` installs it to `/opt/Snowboy` and adds a menu entry.

The Linux runtime needs GTK 3, NSS and ALSA.

### Where Snowboy keeps its data

The data lives in `%APPDATA%\snowboy` on Windows and `~/.config/snowboy` on Linux. It holds:

- `snowboy.db`: worksheets, query history and connection profiles.
- `settings.json`.
- `secrets.json`: saved passwords, tokens and key passphrases, encrypted by the OS through Electron `safeStorage` (DPAPI on Windows, the keyring on Linux).

Uninstalling keeps this folder. On Linux without a keyring (for example WSL), passwords can't be saved yet.

## Scripts

| Script                  | What it does                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bun run dev`           | Launches Electron with hot-reload via electron-vite.                                                           |
| `bun run build`         | Compiles main, preload, and renderer bundles into `out/`.                                                      |
| `bun run typecheck`     | Runs `tsc --noEmit` for the main and preload tsconfigs, and `svelte-check` for the renderer.                   |
| `bun run lint`          | Runs ESLint flat config across the repo.                                                                       |
| `bun run format`        | Runs Prettier with the Svelte plugin.                                                                          |
| `bun test`              | Runs the Bun unit-test suite under `tests/unit/`; `bun test <filter>` runs only matching files.                |
| `bun run test:e2e`      | Builds with electron-vite, then Playwright runs `tests/e2e/specs/` against the built app (throwaway userData). |
| `bun run setup:natives` | Downloads the Electron binary if missing and checks that better-sqlite3 loads in it; runs after `bun install`. |

See [`docs/PLAN.md`](./docs/PLAN.md) for the current plan and task tracker toward an installable v0.1. The earlier MVP plan is kept for history in [`.sisyphus/plans/snowboy-mvp-v0.1.md`](./.sisyphus/plans/snowboy-mvp-v0.1.md).

## Key bindings

| Action                  | Windows/Linux      | Mac               |
| ----------------------- | ------------------ | ----------------- |
| Run statement at cursor | `Ctrl+Enter`       | `Cmd+Enter`       |
| Run all statements      | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` |
| Open Settings           | `Ctrl+,`           | `Cmd+,`           |
| Show keyboard shortcuts | `Ctrl+/`           | `Cmd+/`           |
| Query history           | `Ctrl+H`           | `Cmd+H`           |

## License

[MIT](./LICENSE).
