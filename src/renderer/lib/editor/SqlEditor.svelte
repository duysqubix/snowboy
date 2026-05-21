<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorState, StateEffect } from '@codemirror/state';
  import {
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

  export type SqlEditorProps = {
    value: string;
    onChange?: (v: string) => void;
    theme?: 'light' | 'dark';
    readOnly?: boolean;
    placeholder?: string;
    initialCursorLine?: number | null;
    initialCursorCol?: number | null;
    initialScrollTop?: number | null;
    onCursorChange?: (line: number, col: number) => void;
    onScrollChange?: (scrollTop: number) => void;
  };

  let {
    value = $bindable(''),
    onChange,
    theme = 'light',
    readOnly = false,
    placeholder = '-- Write SQL here, then Run or press Ctrl+Enter',
    initialCursorLine = null,
    initialCursorCol = null,
    initialScrollTop = null,
    onCursorChange,
    onScrollChange
  }: SqlEditorProps = $props();

  let editorContainer: HTMLDivElement;
  let view: EditorView;
  let scrollListenerCleanup: (() => void) | null = null;

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
      placeholderExt(placeholder),
      keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap]),
      snowflakeDialect.extension,
      theme === 'dark' ? snowboyDarkTheme : snowboyLightTheme,
      EditorState.readOnly.of(readOnly),
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
    if (scrollListenerCleanup) {
      scrollListenerCleanup();
      scrollListenerCleanup = null;
    }
    if (view) {
      view.destroy();
    }
  });

  $effect(() => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value }
      });
    }
  });

  $effect(() => {
    void theme;
    void readOnly;
    void placeholder;
    if (view) {
      view.dispatch({
        effects: StateEffect.reconfigure.of(buildExtensions())
      });
    }
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
</style>
