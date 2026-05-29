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

| Script              | What it does                                                            |
| ------------------- | ----------------------------------------------------------------------- |
| `bun run dev`       | Launches Electron with hot-reload via electron-vite.                    |
| `bun run build`     | Compiles main, preload, and renderer bundles into `out/`.               |
| `bun run typecheck` | Runs `tsc --noEmit` for the main, preload, and renderer tsconfigs.      |
| `bun run lint`      | Runs ESLint flat config across the repo.                                |
| `bun run format`    | Runs Prettier with the Svelte plugin.                                   |
| `bun test`          | Runs the Bun unit-test suite under `tests/unit/`.                       |
| `bun run test:e2e`  | Runs Playwright end-to-end tests against the packaged Electron build.   |
| `bun run rebuild`   | Native-module rebuild step (stubbed in T0.1; wired in T0.2).            |

See [`.sisyphus/plans/snowboy-mvp-v0.1.md`](./.sisyphus/plans/snowboy-mvp-v0.1.md) for the full work plan.

## Key bindings

| Action | Windows/Linux | Mac |
| --- | --- | --- |
| Run statement at cursor | `Ctrl+Enter` | `Cmd+Enter` |
| Run all statements | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` |
| Open Settings | `Ctrl+,` | `Cmd+,` |
| Show keyboard shortcuts | `Ctrl+/` | `Cmd+/` |
| Query history | `Ctrl+H` | `Cmd+H` |

## License

[MIT](./LICENSE).
