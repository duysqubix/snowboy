<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorState, StateEffect } from '@codemirror/state';
  import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
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
  };

  let {
    value = $bindable(''),
    onChange,
    theme = 'light',
    readOnly = false,
    placeholder = 'SELECT current_role();'
  }: SqlEditorProps = $props();

  let editorContainer: HTMLDivElement;
  let view: EditorView;

  // Basic autocomplete source from our keywords
  function snowflakeCompletionSource(context: CompletionContext) {
    let word = context.matchBefore(/\w*/);
    if (!word || (word.from == word.to && !context.explicit)) return null;
    
    const options = [
      ...snowflakeKeywords.map(k => ({ label: k, type: 'keyword' })),
      ...snowflakeBuiltins.map(b => ({ label: b, type: 'function' })),
      ...snowflakeTypes.map(t => ({ label: t, type: 'type' }))
    ];

    return {
      from: word.from,
      options,
      validFor: /^\w*$/
    };
  }

  onMount(() => {
    const state = EditorState.create({
      doc: value || placeholder,
      extensions: [
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
        keymap.of([
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap
        ]),
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
        })
      ]
    });

    view = new EditorView({
      state,
      parent: editorContainer
    });
  });

  onDestroy(() => {
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
    if (view) {
      view.dispatch({
        effects: StateEffect.reconfigure.of([
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
          keymap.of([
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...completionKeymap
          ]),
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
          })
        ])
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
