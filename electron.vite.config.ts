import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { Plugin } from 'vite';

// electron-vite 5 externalizes package.json `dependencies` from the main and
// preload bundles by default (`build.externalizeDeps`), which replaces the
// deprecated externalizeDepsPlugin().

/**
 * src/renderer/index.html carries the production Content-Security-Policy, so
 * builds ship it as written. Only the dev server widens connect-src, for
 * Vite's HMR websocket and its fetches back to the server.
 */
function devServerCsp(): Plugin {
  const connectSrc = "connect-src 'none'";
  return {
    name: 'snowboy:dev-server-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      if (!html.includes(connectSrc)) {
        throw new Error(`index.html's CSP has no "${connectSrc}" for the dev server to widen`);
      }
      return html.replace(
        connectSrc,
        "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*"
      );
    }
  };
}

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    },
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main')
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        // The window's preload is sandboxed, and a sandboxed preload runs as a
        // plain CommonJS script. `.cjs`, because package.json's "type": "module"
        // would make a `.js` file an ES module.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        $lib: resolve(__dirname, 'src/renderer/lib')
      }
    },
    plugins: [
      devServerCsp(),
      svelte({
        configFile: resolve(__dirname, 'svelte.config.js')
      })
    ]
  }
});
