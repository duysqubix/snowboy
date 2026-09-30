# Snowboy

Cross-platform open-source desktop IDE for Snowflake.

**Status:** pre-alpha. The v0.1 MVP is under active development; do not rely on this build for production work.

## Requirements

- [Bun](https://bun.com) `1.3+`
- Node.js `20.19+` (Electron toolchain only — main/preload/renderer all run inside Electron's bundled Node)
- Linux: GTK 3, NSS, ALSA runtime libraries; Windows / macOS: no extra system deps for development

## Quick start

```bash
bun install
bun run dev
```

A native Snowboy window should appear. Close it (or `Ctrl+C` in the terminal) to stop the dev server.

## Scripts

| Script              | What it does                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bun run dev`       | Launches Electron with hot-reload via electron-vite.                                                           |
| `bun run build`     | Compiles main, preload, and renderer bundles into `out/`.                                                      |
| `bun run typecheck` | Runs `tsc --noEmit` for the main and preload tsconfigs, and `svelte-check` for the renderer.                   |
| `bun run lint`      | Runs ESLint flat config across the repo.                                                                       |
| `bun run format`    | Runs Prettier with the Svelte plugin.                                                                          |
| `bun test`          | Runs the Bun unit-test suite under `tests/unit/`; `bun test <filter>` runs only matching files.                |
| `bun run test:e2e`  | Builds with electron-vite, then Playwright runs `tests/e2e/specs/` against the built app (throwaway userData). |
| `bun run rebuild`   | Fetches better-sqlite3's prebuilt Electron binary (compiles only if none matches); runs after `bun install`.   |

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
