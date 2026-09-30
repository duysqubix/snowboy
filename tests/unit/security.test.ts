import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';

import {
  guardIpcMain,
  isAppUrl,
  isPermissionAllowed,
  isTrustedIpcSender,
  safeExternalUrl
} from '../../src/main/security';

// What the window loads: out/renderer/index.html in an installed app, or
// electron-vite's dev server (ELECTRON_RENDERER_URL has no trailing slash).
const FILE_APP = 'file:///opt/Snowboy/resources/app.asar/out/renderer/index.html';
const DEV_APP = 'http://localhost:5173';
const WINDOWS_APP =
  'file:///C:/Users/me/AppData/Local/Programs/Snowboy/resources/app.asar/out/renderer/index.html';

describe('isAppUrl for the file:// build', () => {
  test('accepts the app page itself', () => {
    expect(isAppUrl(FILE_APP, FILE_APP)).toBe(true);
  });

  test('accepts the app page with a hash or query, since it is the same file', () => {
    expect(isAppUrl(`${FILE_APP}#pane-2`, FILE_APP)).toBe(true);
    expect(isAppUrl(`${FILE_APP}?reload=1`, FILE_APP)).toBe(true);
  });

  test('accepts spellings the URL parser normalises to the app page', () => {
    expect(isAppUrl(FILE_APP.replace('file:', 'FILE:'), FILE_APP)).toBe(true);
    expect(isAppUrl(FILE_APP.replace('file:///', 'file://localhost/'), FILE_APP)).toBe(true);
    expect(isAppUrl(FILE_APP.replace('/out/', '/out/renderer/../'), FILE_APP)).toBe(true);
    expect(isAppUrl(`  ${FILE_APP}\n`, FILE_APP)).toBe(true);
  });

  test('matches the path Chromium reports for a folder with special characters', () => {
    // Node escapes `[`, `]` and `%`; Chromium (webContents.getURL) leaves them.
    const dir = '/home/me/dir with space [x] ^ {y} %';
    const appUrl = pathToFileURL(`${dir}/index.html`).href;
    const chromiumUrl = 'file:///home/me/dir%20with%20space%20[x]%20%5E%20%7By%7D%20%/index.html';

    expect(appUrl).not.toBe(chromiumUrl);
    expect(isAppUrl(chromiumUrl, appUrl)).toBe(true);
  });

  test('rejects other local files, as a dropped file would load', () => {
    expect(isAppUrl('file:///etc/passwd', FILE_APP)).toBe(false);
    expect(isAppUrl(FILE_APP.replace('index.html', 'other.html'), FILE_APP)).toBe(false);
    expect(isAppUrl(`${FILE_APP}.evil`, FILE_APP)).toBe(false);
    expect(isAppUrl(FILE_APP.replace('/out/renderer/', '/out/'), FILE_APP)).toBe(false);
  });

  test('judges the path a traversal resolves to, not how it starts', () => {
    const escaped = FILE_APP.replace('/renderer/index.html', '/renderer/../../evil/index.html');
    const encoded = FILE_APP.replace(
      '/renderer/index.html',
      '/renderer/%2e%2e/%2E%2E/evil/index.html'
    );

    expect(isAppUrl(escaped, FILE_APP)).toBe(false);
    expect(isAppUrl(encoded, FILE_APP)).toBe(false);
  });

  test('rejects the same path on another host or scheme', () => {
    expect(isAppUrl(FILE_APP.replace('file:///', 'file://evil.example/'), FILE_APP)).toBe(false);
    expect(isAppUrl(FILE_APP.replace('file:///', 'https://evil.example/'), FILE_APP)).toBe(false);
    expect(isAppUrl(FILE_APP.replace('file:///', 'http://localhost:5173/'), FILE_APP)).toBe(false);
  });

  test('treats path case as significant, apart from a Windows drive letter', () => {
    expect(isAppUrl(FILE_APP.replace('/renderer/', '/Renderer/'), FILE_APP)).toBe(false);
    expect(isAppUrl(WINDOWS_APP.replace('file:///C:', 'file:///c:'), WINDOWS_APP)).toBe(true);
    expect(isAppUrl(WINDOWS_APP.replace('file:///C:', 'file:///D:'), WINDOWS_APP)).toBe(false);
  });

  test('accepts a Windows path written with backslashes', () => {
    const backslashed = WINDOWS_APP.slice('file:///'.length).replaceAll('/', '\\');
    expect(isAppUrl(`file:///${backslashed}`, WINDOWS_APP)).toBe(true);
  });

  test('rejects script, data, blob, about and browser-internal URLs', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<h1>hi</h1>',
      `blob:${FILE_APP}`,
      'about:blank',
      'about:srcdoc',
      'devtools://devtools/bundled/devtools_app.html',
      'chrome://gpu'
    ]) {
      expect(isAppUrl(url, FILE_APP)).toBe(false);
    }
  });

  test('rejects input that is not a URL', () => {
    for (const url of [
      '',
      'index.html',
      '/opt/Snowboy/out/renderer/index.html',
      'file:',
      'http://'
    ]) {
      expect(isAppUrl(url, FILE_APP)).toBe(false);
    }
  });
});

describe('isAppUrl for the dev server', () => {
  test('accepts any path on the dev server origin', () => {
    expect(isAppUrl('http://localhost:5173/', DEV_APP)).toBe(true);
    expect(isAppUrl('http://localhost:5173/src/main.ts?t=123', DEV_APP)).toBe(true);
    expect(isAppUrl('HTTP://LOCALHOST:5173/', DEV_APP)).toBe(true);
  });

  test('rejects another port, host or scheme', () => {
    expect(isAppUrl('http://localhost:5174/', DEV_APP)).toBe(false);
    expect(isAppUrl('http://127.0.0.1:5173/', DEV_APP)).toBe(false);
    expect(isAppUrl('https://localhost:5173/', DEV_APP)).toBe(false);
    expect(isAppUrl('ws://localhost:5173/', DEV_APP)).toBe(false);
    expect(isAppUrl('file:///etc/passwd', DEV_APP)).toBe(false);
  });

  test('rejects userinfo tricks', () => {
    // The host here is evil.example.
    expect(isAppUrl('http://localhost:5173@evil.example/', DEV_APP)).toBe(false);
    // The host is the dev server, but the app never sends credentials.
    expect(isAppUrl('http://evil.example@localhost:5173/', DEV_APP)).toBe(false);
    expect(isAppUrl('http://user:pass@localhost:5173/', DEV_APP)).toBe(false);
  });

  test('rejects hosts that only look like the dev server', () => {
    expect(isAppUrl('http://localhost:5173.evil.example/', DEV_APP)).toBe(false);
    expect(isAppUrl('http://localhost.evil.example:5173/', DEV_APP)).toBe(false);
  });
});

describe('safeExternalUrl', () => {
  test('passes the docs links the connection wizard opens', () => {
    const pat = 'https://docs.snowflake.com/en/user-guide/programmatic-access-tokens';
    const keyPair = 'https://docs.snowflake.com/en/user-guide/key-pair-auth';

    expect(safeExternalUrl(pat)).toBe(pat);
    expect(safeExternalUrl(keyPair)).toBe(keyPair);
  });

  test('returns the parser-normalised form, so the OS opens exactly what was checked', () => {
    expect(safeExternalUrl('  HTTPS://Docs.Snowflake.com/a b\t')).toBe(
      'https://docs.snowflake.com/a%20b'
    );
    expect(safeExternalUrl('https://docs.snowflake.com/"&calc.exe')).toBe(
      'https://docs.snowflake.com/%22&calc.exe'
    );
  });

  test('refuses hosts the UI does not link to, which could carry data out', () => {
    for (const url of [
      'https://example.com/',
      'https://attacker.example/?key=-----BEGIN',
      'https://docs.snowflake.com.attacker.example/',
      'https://snowflake.com/',
      'https://www.docs.snowflake.com/',
      'https://docs.snowflake.com:8443/'
    ]) {
      expect(safeExternalUrl(url)).toBeNull();
    }
  });

  test('refuses every scheme except https', () => {
    for (const url of [
      'http://docs.snowflake.com/',
      'file:///C:/Windows/System32/calc.exe',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<h1>hi</h1>',
      'mailto:someone@example.com',
      'smb://attacker.example/share',
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=calc',
      'vbscript:msgbox(1)',
      'snowflake://open'
    ]) {
      expect(safeExternalUrl(url)).toBeNull();
    }
  });

  test('refuses URLs carrying credentials', () => {
    expect(safeExternalUrl('https://user:pass@docs.snowflake.com/')).toBeNull();
    expect(safeExternalUrl('https://evil.example@docs.snowflake.com/')).toBeNull();
  });

  test('refuses input that is not an absolute URL', () => {
    for (const url of ['', 'docs.snowflake.com', '//evil.example/', 'https:', 'https://']) {
      expect(safeExternalUrl(url)).toBeNull();
    }
  });
});

describe('isPermissionAllowed', () => {
  test('grants clipboard writes to the app page', () => {
    expect(isPermissionAllowed('clipboard-sanitized-write', FILE_APP, FILE_APP)).toBe(true);
    expect(
      isPermissionAllowed('clipboard-sanitized-write', 'http://localhost:5173/', DEV_APP)
    ).toBe(true);
  });

  test('refuses clipboard writes to any other page', () => {
    expect(isPermissionAllowed('clipboard-sanitized-write', 'file:///etc/passwd', FILE_APP)).toBe(
      false
    );
    expect(
      isPermissionAllowed('clipboard-sanitized-write', 'https://evil.example/', FILE_APP)
    ).toBe(false);
  });

  test('refuses a request no document made (for example a service worker)', () => {
    expect(isPermissionAllowed('clipboard-sanitized-write', undefined, FILE_APP)).toBe(false);
  });

  test('refuses every other permission, even for the app page', () => {
    for (const permission of [
      'clipboard-read',
      'deprecated-sync-clipboard-read',
      'notifications',
      'media',
      'display-capture',
      'geolocation',
      'openExternal',
      'fullscreen',
      'pointerLock',
      'keyboardLock',
      'fileSystem',
      'hid',
      'serial',
      'usb',
      'local-fonts',
      'window-management',
      'storage-access',
      'unknown'
    ]) {
      expect(isPermissionAllowed(permission, FILE_APP, FILE_APP)).toBe(false);
    }
  });
});

describe('isTrustedIpcSender', () => {
  const frame = (url: string, processId = 4, routingId = 1) => ({ url, processId, routingId });
  const event = (
    senderFrame: ReturnType<typeof frame> | null,
    mainFrame: ReturnType<typeof frame> = frame(FILE_APP)
  ) => ({ senderFrame, sender: { mainFrame } });

  test('trusts the main frame of an app window showing the app page', () => {
    expect(isTrustedIpcSender(event(frame(FILE_APP)), FILE_APP, true)).toBe(true);
    const dev = frame('http://localhost:5173/');
    expect(isTrustedIpcSender(event(dev, dev), DEV_APP, true)).toBe(true);
  });

  test('rejects a message whose frame has navigated away or been destroyed', () => {
    expect(isTrustedIpcSender(event(null), FILE_APP, true)).toBe(false);
  });

  test('rejects a sender that is not one of the app windows', () => {
    expect(isTrustedIpcSender(event(frame(FILE_APP)), FILE_APP, false)).toBe(false);
  });

  test('rejects an iframe, even one showing the app page', () => {
    expect(isTrustedIpcSender(event(frame(FILE_APP, 4, 2)), FILE_APP, true)).toBe(false);
    expect(isTrustedIpcSender(event(frame(FILE_APP, 5, 1)), FILE_APP, true)).toBe(false);
  });

  test('rejects the main frame once it shows another page', () => {
    const escaped = frame('https://evil.example/');
    expect(isTrustedIpcSender(event(escaped, escaped), FILE_APP, true)).toBe(false);
    const localFile = frame('file:///home/me/Downloads/dropped.html');
    expect(isTrustedIpcSender(event(localFile, localFile), FILE_APP, true)).toBe(false);
  });
});

type Listener = (event: FakeEvent, ...args: unknown[]) => unknown;

interface FakeEvent {
  trusted: boolean;
  returnValue?: unknown;
}

/** Stands in for Electron's ipcMain: an EventEmitter plus invoke handlers. */
class FakeIpcMain extends EventEmitter {
  readonly handlers = new Map<string, Listener>();

  handle(channel: string, listener: Listener): void {
    this.handlers.set(channel, listener);
  }

  handleOnce(channel: string, listener: Listener): void {
    this.handle(channel, (event, ...args) => {
      this.removeHandler(channel);
      return listener(event, ...args);
    });
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  /** What Electron does when a renderer calls `ipcRenderer.invoke`. */
  invoke(channel: string, event: FakeEvent, ...args: unknown[]): unknown {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error(`no handler for ${channel}`);
    return handler(event, ...args);
  }
}

describe('guardIpcMain', () => {
  const trusted = (): FakeEvent => ({ trusted: true });
  const untrusted = (): FakeEvent => ({ trusted: false });

  function setup() {
    const ipc = new FakeIpcMain();
    const guarded = guardIpcMain(ipc, (event: FakeEvent) => event.trusted);
    const calls: unknown[][] = [];
    return { ipc, guarded, calls };
  }

  test('passes a trusted invoke to its handler and returns the result', () => {
    const { ipc, guarded, calls } = setup();
    guarded.handle('sessions.open', (_event: FakeEvent, ...args: unknown[]) => {
      calls.push(args);
      return 'session-1';
    });

    expect(ipc.invoke('sessions.open', trusted(), 'profile-1', { role: 'R' })).toBe('session-1');
    expect(calls).toEqual([['profile-1', { role: 'R' }]]);
  });

  test('rejects an untrusted invoke before its handler runs', () => {
    const { ipc, guarded, calls } = setup();
    guarded.handle('connections.list', () => calls.push([]));

    expect(() => ipc.invoke('connections.list', untrusted())).toThrow(
      'Blocked IPC "connections.list" from an untrusted sender'
    );
    expect(calls).toEqual([]);
  });

  test('answers an untrusted sendSync with null so the renderer uses its fallback', () => {
    const { ipc, guarded, calls } = setup();
    guarded.on('theme.boot', (event: FakeEvent) => {
      calls.push([]);
      event.returnValue = 'dark';
    });

    const blocked = untrusted();
    ipc.emit('theme.boot', blocked);
    const allowed = trusted();
    ipc.emit('theme.boot', allowed);

    expect(blocked.returnValue).toBeNull();
    expect(allowed.returnValue).toBe('dark');
    expect(calls).toHaveLength(1);
  });

  test('guards the other ways of adding a listener', () => {
    const { ipc, guarded, calls } = setup();
    guarded.addListener('add', () => calls.push(['addListener']));
    guarded.prependListener('prepend', () => calls.push(['prependListener']));

    ipc.emit('add', untrusted());
    ipc.emit('prepend', untrusted());
    expect(calls).toEqual([]);

    ipc.emit('add', trusted());
    ipc.emit('prepend', trusted());
    expect(calls).toEqual([['addListener'], ['prependListener']]);
  });

  test('refuses one-shot listeners, which an untrusted message would use up', () => {
    const { ipc, guarded } = setup();
    const listener = () => undefined;

    expect(() => guarded.handleOnce('a', listener)).toThrow('does not support handleOnce()');
    expect(() => guarded.once('b', listener)).toThrow('does not support once()');
    expect(() => guarded.prependOnceListener('c', listener)).toThrow(
      'does not support prependOnceListener()'
    );
    expect(ipc.handlers.size).toBe(0);
    expect(ipc.eventNames()).toEqual([]);
  });

  test('treats a sender check that throws as a rejection', () => {
    const ipc = new FakeIpcMain();
    const guarded = guardIpcMain(ipc, () => {
      throw new Error('Object has been destroyed');
    });
    let ran = false;
    guarded.handle('history.list', () => {
      ran = true;
    });

    expect(() => ipc.invoke('history.list', trusted())).toThrow('Blocked IPC');
    expect(ran).toBe(false);
  });

  test('passes other members through to the real ipcMain', () => {
    const { ipc, guarded } = setup();
    guarded.handle('workspace.flush-ack', () => undefined);

    guarded.removeHandler('workspace.flush-ack');

    expect(ipc.handlers.has('workspace.flush-ack')).toBe(false);
    expect(guarded.listenerCount('anything')).toBe(0);
  });

  test('returns the guarded view from on() for chaining', () => {
    const { guarded } = setup();
    expect(guarded.on('a', () => undefined)).toBe(guarded);
  });
});
