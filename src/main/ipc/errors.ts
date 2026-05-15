/**
 * Errors crossing the IPC boundary. Electron serializes rejected promises from
 * `ipcMain.handle` via a structured clone that preserves `name`, `message`,
 * `stack`, and enumerable own properties — so the renderer can detect this
 * class with `error?.name === 'NotImplementedError'` and read `error.method` /
 * `error.task` for context.
 */
export class NotImplementedError extends Error {
  public readonly method: string;
  public readonly task: string;

  constructor(method: string, task: string) {
    super(`not implemented (deferred to ${task})`);
    this.name = 'NotImplementedError';
    this.method = method;
    this.task = task;
  }
}

const loggedMethods = new Set<string>();

/**
 * Returns a rejected promise carrying a `NotImplementedError`. Logs the first
 * touch of each method exactly once per process lifetime so `bun run dev`
 * surfaces every stub the renderer is still calling against.
 */
export function notImplemented(method: string, task: string): Promise<never> {
  if (!loggedMethods.has(method)) {
    loggedMethods.add(method);
    console.warn(`[ipc] not implemented: ${method} (-> ${task})`);
  }
  return Promise.reject(new NotImplementedError(method, task));
}
