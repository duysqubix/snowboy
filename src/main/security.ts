/**
 * The renderer's trust boundary as plain functions: which URLs are the app's
 * own page, which may be handed to the OS, which web permissions the page
 * gets, and which IPC senders may reach a handler. `src/main/index.ts` and
 * `src/main/ipc/index.ts` wire them into Electron.
 *
 * `appUrl` is the page the window loads: electron-vite's dev server in
 * development, otherwise the file:// URL of `out/renderer/index.html`.
 */

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Percent-decodes `path`, leaving a `%` that doesn't start a valid UTF-8 escape as it is. */
function decodePercentEscapes(path: string): string {
  return path.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * A file: URL's path, decoded, because Chromium and Node spell the same path
 * differently: `webContents.getURL()` leaves `[`, `]` and a stray `%`
 * unescaped where `pathToFileURL` escapes them. Chromium may also report a
 * Windows drive letter in the other case.
 */
function filePath(url: URL): string {
  return decodePercentEscapes(url.pathname).replace(
    /^\/([a-z]):/i,
    (_match, drive: string) => `/${drive.toUpperCase()}:`
  );
}

/**
 * Whether `url` shows the app itself. For the dev server that's any URL on its
 * origin; for the file:// build it's that one file, whatever its query or hash.
 * Both URLs go through the WHATWG URL parser, as in Chromium, so `..`
 * segments, case and stray whitespace resolve as they do in the window.
 * (Chromium won't load a path containing `%2F` or `%5C`, which this decodes;
 * accepting a URL that can't load is harmless.)
 */
export function isAppUrl(url: string, appUrl: string): boolean {
  const target = parseUrl(url);
  const app = parseUrl(appUrl);
  if (target === null || app === null) return false;
  if (app.protocol === 'file:') {
    return (
      target.protocol === 'file:' && target.host === app.host && filePath(target) === filePath(app)
    );
  }
  if (app.protocol === 'http:' || app.protocol === 'https:') {
    return target.origin === app.origin && target.username === '' && target.password === '';
  }
  return false;
}

/** Hosts the UI links to; add one when the UI gains a link there. */
const EXTERNAL_HOSTS: ReadonlySet<string> = new Set([
  // The connection wizard's PAT and key-pair help links.
  'docs.snowflake.com'
]);

/**
 * The URL to pass to `shell.openExternal`, or null to refuse. Other schemes
 * can start local programs (file:, or a protocol handler such as ms-msdt:).
 * Other hosts would let a compromised page send data out through the browser.
 * The result is the parser's normalised form, so the OS opens exactly the URL
 * that was checked.
 */
export function safeExternalUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (parsed === null || parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  if (!EXTERNAL_HOSTS.has(parsed.host)) return null;
  return parsed.href;
}

/** Web permissions the app page may use; Electron would otherwise grant them all. */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  // navigator.clipboard.writeText: results grid, DDL dialog, object browser, settings.
  'clipboard-sanitized-write'
]);

/**
 * Whether to grant `permission` to the page at `requestingUrl`: only the
 * permissions above, and only for the app page. `requestingUrl` is undefined
 * when no document asked (a service worker, say), which is refused.
 */
export function isPermissionAllowed(
  permission: string,
  requestingUrl: string | undefined,
  appUrl: string
): boolean {
  return (
    ALLOWED_PERMISSIONS.has(permission) &&
    requestingUrl !== undefined &&
    isAppUrl(requestingUrl, appUrl)
  );
}

/** The frame fields the sender check reads; `WebFrameMain` has them. */
interface FrameRef {
  url: string;
  processId: number;
  routingId: number;
}

/** The IPC event fields the sender check reads; `IpcMainEvent` and `IpcMainInvokeEvent` have them. */
export interface IpcSenderEvent {
  /** Null once the sending frame has navigated or been destroyed. */
  senderFrame: FrameRef | null;
  sender: { mainFrame: FrameRef };
}

/**
 * Whether an IPC message may reach a handler: it must come from the main frame
 * (not an iframe) of one of the app's windows (`fromAppWindow`), and that
 * frame must be showing the app page. A page can rewrite its URL in place with
 * `history.pushState`, so the URL test only holds because the navigation guard
 * keeps other documents out of the window.
 */
export function isTrustedIpcSender(
  event: IpcSenderEvent,
  appUrl: string,
  fromAppWindow: boolean
): boolean {
  const frame = event.senderFrame;
  if (frame === null || !fromAppWindow) return false;
  const main = event.sender.mainFrame;
  const isMainFrame = frame.processId === main.processId && frame.routingId === main.routingId;
  return isMainFrame && isAppUrl(frame.url, appUrl);
}

type IpcListener<E> = (event: E, ...args: unknown[]) => unknown;

/** The ipcMain methods `guardIpcMain` wraps, for events of type `E`; `IpcMain` has them. */
interface IpcRegistrar<E> {
  handle(channel: string, listener: IpcListener<E>): void;
  on(channel: string, listener: IpcListener<E>): unknown;
  addListener(channel: string, listener: IpcListener<E>): unknown;
  prependListener(channel: string, listener: IpcListener<E>): unknown;
}

const INVOKE_METHODS: ReadonlySet<string> = new Set(['handle']);
const MESSAGE_METHODS: ReadonlySet<string> = new Set(['on', 'addListener', 'prependListener']);
/**
 * Electron and EventEmitter remove a one-shot listener before calling it, so
 * an untrusted message would use it up. Nothing registers one today.
 */
const ONE_SHOT_METHODS: ReadonlySet<string> = new Set([
  'handleOnce',
  'once',
  'prependOnceListener'
]);

/**
 * A view of `ipc` whose listeners each run `isTrusted(event)` first, so a
 * domain module registering through it can't forget the sender check.
 *
 * - A rejected invoke throws, so the renderer's `invoke()` rejects.
 * - A rejected `send` or `sendSync` is dropped. `returnValue` is set to null,
 *   so a `sendSync` caller gets its fallback instead of blocking.
 * - A check that throws counts as a rejection.
 * - One-shot registrations (`handleOnce`, `once`) throw; see ONE_SHOT_METHODS.
 *
 * Other members pass through to `ipc`. A listener registered here is wrapped,
 * so remove it by channel (`removeHandler`, `removeAllListeners`).
 */
export function guardIpcMain<E, T extends IpcRegistrar<E>>(
  ipc: T,
  isTrusted: (event: E) => boolean
): T {
  const allowed = (channel: string, event: E): boolean => {
    let trusted = false;
    try {
      trusted = isTrusted(event);
    } catch {
      trusted = false;
    }
    if (!trusted) console.warn(`[ipc] blocked "${channel}" from an untrusted sender`);
    return trusted;
  };

  return new Proxy(ipc, {
    get(target, prop, receiver) {
      const member: unknown = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof member !== 'function') return member;
      if (ONE_SHOT_METHODS.has(prop)) {
        return () => {
          throw new Error(`The guarded ipcMain does not support ${prop}()`);
        };
      }
      if (INVOKE_METHODS.has(prop)) {
        return (channel: string, listener: IpcListener<E>) =>
          Reflect.apply(member, target, [
            channel,
            (event: E, ...args: unknown[]) => {
              if (!allowed(channel, event)) {
                throw new Error(`Blocked IPC "${channel}" from an untrusted sender`);
              }
              return listener(event, ...args);
            }
          ]);
      }
      if (MESSAGE_METHODS.has(prop)) {
        return (channel: string, listener: IpcListener<E>) => {
          Reflect.apply(member, target, [
            channel,
            (event: E & { returnValue?: unknown }, ...args: unknown[]) => {
              if (!allowed(channel, event)) {
                event.returnValue = null;
                return;
              }
              listener(event, ...args);
            }
          ]);
          return receiver;
        };
      }
      return member;
    }
  });
}
