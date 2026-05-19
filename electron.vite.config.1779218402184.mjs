// electron.vite.config.ts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
var __electron_vite_injected_dirname = "/mnt/c/Users/duan_/.repos/snowboy";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/main/index.ts")
      }
    },
    resolve: {
      alias: {
        "@main": resolve(__electron_vite_injected_dirname, "src/main")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/preload/index.ts")
      }
    }
  },
  renderer: {
    root: resolve(__electron_vite_injected_dirname, "src/renderer"),
    build: {
      outDir: resolve(__electron_vite_injected_dirname, "out/renderer"),
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/renderer/index.html")
      }
    },
    resolve: {
      alias: {
        "@renderer": resolve(__electron_vite_injected_dirname, "src/renderer"),
        "$lib": resolve(__electron_vite_injected_dirname, "src/renderer/lib")
      }
    },
    plugins: [
      svelte({
        configFile: resolve(__electron_vite_injected_dirname, "svelte.config.js")
      })
    ]
  }
});
export {
  electron_vite_config_default as default
};
