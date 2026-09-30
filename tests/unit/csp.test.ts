/**
 * The renderer's production Content-Security-Policy, as written in
 * src/renderer/index.html. Builds ship it unchanged; only `bun run dev`
 * widens it (devServerCsp in electron.vite.config.ts). The e2e hardening spec
 * checks that the built page carries this same policy.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const INDEX_HTML = new URL('../../src/renderer/index.html', import.meta.url);

function directives(): Map<string, string[]> {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1];
  if (policy === undefined) throw new Error('index.html has no CSP <meta>');
  const parsed = new Map<string, string[]>();
  for (const directive of policy.split(';')) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (name) parsed.set(name, sources);
  }
  return parsed;
}

describe('production CSP in src/renderer/index.html', () => {
  test('is exactly the reviewed policy', () => {
    expect(Object.fromEntries(directives())).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'none'"],
      'frame-src': ["'none'"],
      'worker-src': ["'none'"],
      'base-uri': ["'none'"],
      'object-src': ["'none'"],
      'form-action': ["'none'"]
    });
  });

  test("gives no way to read other local files, which 'self' would match under file://", () => {
    const policy = directives();
    for (const name of ['connect-src', 'frame-src', 'worker-src']) {
      expect(policy.get(name)).toEqual(["'none'"]);
    }
  });

  test('carries none of the dev server allowances', () => {
    const sources = [...directives().values()].flat();
    for (const devOnly of ['ws:', 'wss:', 'http:', 'https:', "'unsafe-eval'", '*']) {
      expect(sources).not.toContain(devOnly);
    }
    expect(sources.filter((source) => /localhost|127\.0\.0\.1/.test(source))).toEqual([]);
  });
});
