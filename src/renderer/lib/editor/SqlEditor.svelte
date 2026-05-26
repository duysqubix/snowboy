<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
  import {
    Decoration,
    type DecorationSet,
    EditorView,
    keymap,
    lineNumbers,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    placeholder as placeholderExt
  } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import { autocompletion, completionKeymap, CompletionContext } from '@codemirror/autocomplete';
  import { lintGutter } from '@codemirror/lint';
  import { bracketMatching } from '@codemirror/language';

  import { snowflakeDialect } from './snowflakeDialect';
  import { snowboyLightTheme, snowboyDarkTheme } from './theme';
  import { snowflakeKeywords, snowflakeBuiltins, snowflakeTypes } from './snowflakeKeywords';
  import { runAtCursorCommand, runAllCommand, type RunAtCursorPayload } from './runCommands';
  import { theme as themeStore } from '../stores/theme.svelte';

  export type SqlEditorApi = {
    flashStatement(start: number, end: number): void;
    clearHighlight(): void;
  };

  export type SqlEditorProps = {
    value: string;
    onChange?: (v: string) => void;
    readOnly?: boolean;
    placeholder?: string;
    initialCursorLine?: number | null;
    initialCursorCol?: number | null;
    initialScrollTop?: number | null;
    onCursorChange?: (line: number, col: number) => void;
    onScrollChange?: (scrollTop: number) => void;
    onRunAtCursor?: (payload: RunAtCursorPayload) => void;
    onNoStatementAtCursor?: () => void;
    onRunAll?: () => void;
    api?: SqlEditorApi | null;
  };

  let {
    value = $bindable(''),
    onChange,
    readOnly = false,
    placeholder = '-- Write SQL here, then Run or press Ctrl+Enter',
    initialCursorLine = null,
    initialCursorCol = null,
    initialScrollTop = null,
    onCursorChange,
    onScrollChange,
    onRunAtCursor,
    onNoStatementAtCursor,
    onRunAll,
    api = $bindable<SqlEditorApi | null>(null)
  }: SqlEditorProps = $props();

  let editorContainer: HTMLDivElement;
  let view: EditorView;
  let scrollListenerCleanup: (() => void) | null = null;
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;

  // Compartments let us live-swap individual extensions (theme, readOnly,
  // placeholder, keymap) via `dispatch({ effects: compartment.reconfigure(...) })`
  // WITHOUT replacing the whole extension set. A broad `StateEffect.reconfigure`
  // would rebuild every extension's state and silently lose history /
  // autocomplete / cursor / scroll. See hyperplan reactivity-critic #9.
  const themeCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const placeholderCompartment = new Compartment();
  const keymapCompartment = new Compartment();

  // The CM keymap is built once at mount and lives inside a compartment so
  // the *handler* callbacks must dispatch through a stable reference. We
  // re-read `onRunAtCursor` / `onNoStatementAtCursor` / `onRunAll` off the
  // latest props via closure, so prop reassignment from the parent reaches
  // the running keymap without needing a compartment reconfigure.
  const callbacks: {
    onRunAtCursor?: (payload: RunAtCursorPayload) => void;
    onNoStatementAtCursor?: () => void;
    onRunAll?: () => void;
  } = {};

  $effect(() => {
    callbacks.onRunAtCursor = onRunAtCursor;
    callbacks.onNoStatementAtCursor = onNoStatementAtCursor;
    callbacks.onRunAll = onRunAll;
  });

  const setHighlightEffect = StateEffect.define<{ from: number; to: number }>();
  const clearHighlightEffect = StateEffect.define<null>();

  const highlightMark = Decoration.mark({ class: 'sql-run-highlight' });

  const highlightField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(set, tr) {
      let next = set.map(tr.changes);
      for (const e of tr.effects) {
        if (e.is(setHighlightEffect)) {
          const { from, to } = e.value;
          if (from < to) {
            next = Decoration.set([highlightMark.range(from, to)]);
          } else {
            next = Decoration.none;
          }
        } else if (e.is(clearHighlightEffect)) {
          next = Decoration.none;
        }
      }
      return next;
    },
    provide: (f) => EditorView.decorations.from(f)
  });

  const HIGHLIGHT_MS = 500;

  function flashStatement(from: number, to: number): void {
    if (!view) return;
    const docLen = view.state.doc.length;
    const clampedFrom = Math.max(0, Math.min(from, docLen));
    const clampedTo = Math.max(clampedFrom, Math.min(to, docLen));
    if (clampedFrom === clampedTo) return;

    view.dispatch({ effects: setHighlightEffect.of({ from: clampedFrom, to: clampedTo }) });

    if (highlightTimer !== null) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightTimer = null;
      if (!view) return;
      view.dispatch({ effects: clearHighlightEffect.of(null) });
    }, HIGHLIGHT_MS);
  }

  function clearHighlight(): void {
    if (highlightTimer !== null) {
      clearTimeout(highlightTimer);
      highlightTimer = null;
    }
    if (!view) return;
    view.dispatch({ effects: clearHighlightEffect.of(null) });
  }

  function buildRunKeymap() {
    return keymap.of([
      { key: 'Mod-Enter', preventDefault: true, run: runAtCursorCommand(callbacks) },
      { key: 'Mod-Shift-Enter', preventDefault: true, run: runAllCommand(callbacks) }
    ]);
  }

  function themeExtensionFor(effective: 'light' | 'dark') {
    return effective === 'dark' ? snowboyDarkTheme : snowboyLightTheme;
  }

  function snowflakeCompletionSource(context: CompletionContext) {
    let word = context.matchBefore(/\w*/);
    if (!word || (word.from == word.to && !context.explicit)) return null;

    const options = [
      ...snowflakeKeywords.map((k) => ({ label: k, type: 'keyword' })),
      ...snowflakeBuiltins.map((b) => ({ label: b, type: 'function' })),
      ...snowflakeTypes.map((t) => ({ label: t, type: 'type' }))
    ];

    return {
      from: word.from,
      options,
      validFor: /^\w*$/
    };
  }

  function buildExtensions() {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      bracketMatching(),
      autocompletion({ override: [snowflakeCompletionSource] }),
      highlightActiveLine(),
      highlightSelectionMatches(),
      lintGutter(),
      placeholderCompartment.of(placeholderExt(placeholder)),
      // Run-at-cursor keymap MUST sit ahead of defaultKeymap so it wins over
      // any future binding on Mod-Enter (currently none, but compartmented
      // for future override). Editor owns Cmd+Enter — window listener does
      // not (see registry's `editor-only` scope).
      keymapCompartment.of(buildRunKeymap()),
      keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap]),
      highlightField,
      snowflakeDialect.extension,
      themeCompartment.of(themeExtensionFor(themeStore.effective)),
      readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newValue = update.state.doc.toString();
          if (newValue !== value) {
            value = newValue;
            onChange?.(newValue);
          }
        }
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          onCursorChange?.(line.number, head - line.from);
        }
      })
    ];
  }

  onMount(() => {
    const state = EditorState.create({
      doc: value,
      extensions: buildExtensions()
    });

    view = new EditorView({
      state,
      parent: editorContainer
    });

    api = { flashStatement, clearHighlight };

    const handleScroll = () => {
      onScrollChange?.(view.scrollDOM.scrollTop);
    };
    view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });
    scrollListenerCleanup = () => {
      view.scrollDOM.removeEventListener('scroll', handleScroll);
    };

    // CM6 measures DOM on the frame after construction. Restore cursor +
    // scroll after that first measure (rAF) — dispatching against an
    // unmeasured viewport silently no-ops (hyperplan concurrency #B13).
    requestAnimationFrame(() => {
      if (!view) return;
      if (initialCursorLine !== null && initialCursorCol !== null) {
        const totalLines = view.state.doc.lines;
        const lineNum = Math.min(Math.max(initialCursorLine, 1), Math.max(totalLines, 1));
        const lineRef = view.state.doc.line(lineNum);
        const col = Math.min(Math.max(initialCursorCol, 0), lineRef.length);
        const pos = lineRef.from + col;
        view.dispatch({ selection: { anchor: pos, head: pos } });
      }
      if (initialScrollTop !== null && initialScrollTop > 0) {
        view.scrollDOM.scrollTop = initialScrollTop;
      }
    });
  });

  onDestroy(() => {
    if (highlightTimer !== null) {
      clearTimeout(highlightTimer);
      highlightTimer = null;
    }
    if (scrollListenerCleanup) {
      scrollListenerCleanup();
      scrollListenerCleanup = null;
    }
    if (view) {
      view.destroy();
    }
    api = null;
  });

  $effect(() => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value }
      });
    }
  });

  // Live-swap theme via the theme store. Reading `themeStore.effective`
  // registers the effect as a subscriber; on OS / settings flip the store
  // re-emits and we surgically reconfigure ONLY the theme compartment —
  // cursor, scroll, history, and autocomplete state are preserved.
  $effect(() => {
    const effective = themeStore.effective;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure(themeExtensionFor(effective))
    });
  });

  $effect(() => {
    const ro = readOnly;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(ro))
    });
  });

  $effect(() => {
    const ph = placeholder;
    if (!view) return;
    view.dispatch({
      effects: placeholderCompartment.reconfigure(placeholderExt(ph))
    });
  });
</script>

<div bind:this={editorContainer} class="h-full w-full overflow-hidden"></div>

<style>
  :global(.cm-editor) {
    height: 100%;
  }
  :global(.cm-scroller) {
    overflow: auto;
  }
  :global(.sql-run-highlight) {
    background-color: rgba(250, 204, 21, 0.35);
    border-radius: 2px;
    transition: background-color 500ms ease-out;
  }
</style>
