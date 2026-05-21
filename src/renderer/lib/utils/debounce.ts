/**
 * Trailing-edge debounce with explicit `flush()` and `cancel()`. Used by
 * T4.1/T4.2 to throttle layout and worksheet saves to ~500ms while
 * guaranteeing the app-close flush protocol can drain a pending edit.
 *
 * `flush()` runs the most recent pending invocation immediately and
 * clears the timer; safe to call any time (no-op if nothing pending).
 * `cancel()` discards the pending invocation without running it.
 */

export interface DebouncedFn<TArgs extends readonly unknown[]> {
  (...args: TArgs): void;
  flush(): void;
  cancel(): void;
  readonly isPending: boolean;
}

export function debounce<TArgs extends readonly unknown[]>(
  fn: (...args: TArgs) => void,
  waitMs: number
): DebouncedFn<TArgs> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: TArgs | null = null;

  const invoke = (): void => {
    const args = pendingArgs;
    pendingArgs = null;
    timer = null;
    if (args !== null) {
      fn(...args);
    }
  };

  const debounced = ((...args: TArgs): void => {
    pendingArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(invoke, waitMs);
  }) as DebouncedFn<TArgs>;

  debounced.flush = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    invoke();
  };

  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  Object.defineProperty(debounced, 'isPending', {
    get(): boolean {
      return timer !== null;
    }
  });

  return debounced;
}
