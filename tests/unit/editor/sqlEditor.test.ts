import { describe, expect, test } from 'bun:test';
import { Compartment, EditorState } from '@codemirror/state';
import { snowboyDarkTheme, snowboyLightTheme } from '../../../src/renderer/lib/editor/theme';

describe('SqlEditor — theme compartment swap', () => {
  test('reconfigure preserves document text', () => {
    const themeCompartment = new Compartment();
    const state = EditorState.create({
      doc: 'SELECT 1; SELECT 2;',
      extensions: [themeCompartment.of(snowboyDarkTheme)]
    });

    const next = state.update({
      effects: themeCompartment.reconfigure(snowboyLightTheme)
    }).state;

    expect(next.doc.toString()).toBe('SELECT 1; SELECT 2;');
  });

  test('reconfigure preserves caret position', () => {
    const themeCompartment = new Compartment();
    const initial = EditorState.create({
      doc: 'SELECT 1; SELECT 2;',
      extensions: [themeCompartment.of(snowboyDarkTheme)]
    });

    const stateWithCursor = initial.update({
      selection: { anchor: 10, head: 10 }
    }).state;

    const reconfigured = stateWithCursor.update({
      effects: themeCompartment.reconfigure(snowboyLightTheme)
    }).state;

    expect(reconfigured.selection.main.head).toBe(10);
    expect(reconfigured.selection.main.anchor).toBe(10);
  });

  test('reconfigure preserves a multi-character selection range', () => {
    const themeCompartment = new Compartment();
    const initial = EditorState.create({
      doc: 'SELECT 1; SELECT 2;',
      extensions: [themeCompartment.of(snowboyDarkTheme)]
    });

    const selected = initial.update({
      selection: { anchor: 0, head: 6 }
    }).state;

    const reconfigured = selected.update({
      effects: themeCompartment.reconfigure(snowboyLightTheme)
    }).state;

    expect(reconfigured.selection.main.anchor).toBe(0);
    expect(reconfigured.selection.main.head).toBe(6);
    expect(
      reconfigured.doc.sliceString(
        reconfigured.selection.main.from,
        reconfigured.selection.main.to
      )
    ).toBe('SELECT');
  });

  test('swapping to light then back to dark still preserves doc + cursor', () => {
    const themeCompartment = new Compartment();
    const initial = EditorState.create({
      doc: 'hello world',
      extensions: [themeCompartment.of(snowboyDarkTheme)]
    });
    const withCursor = initial.update({ selection: { anchor: 5, head: 5 } }).state;

    const toLight = withCursor.update({
      effects: themeCompartment.reconfigure(snowboyLightTheme)
    }).state;
    const backToDark = toLight.update({
      effects: themeCompartment.reconfigure(snowboyDarkTheme)
    }).state;

    expect(backToDark.doc.toString()).toBe('hello world');
    expect(backToDark.selection.main.head).toBe(5);
  });

  test('compartment.get returns the currently-configured extension after reconfigure', () => {
    const themeCompartment = new Compartment();
    const state = EditorState.create({
      doc: '',
      extensions: [themeCompartment.of(snowboyDarkTheme)]
    });
    expect(themeCompartment.get(state)).toBe(snowboyDarkTheme);

    const next = state.update({
      effects: themeCompartment.reconfigure(snowboyLightTheme)
    }).state;
    expect(themeCompartment.get(next)).toBe(snowboyLightTheme);
  });

  test('reconfigure preserves doc when intervening edits have happened', () => {
    const themeCompartment = new Compartment();
    const initial = EditorState.create({
      doc: 'one',
      extensions: [themeCompartment.of(snowboyDarkTheme)]
    });
    const edited = initial.update({
      changes: { from: 0, to: 3, insert: 'two three four' }
    }).state;
    expect(edited.doc.toString()).toBe('two three four');

    const reconfigured = edited.update({
      effects: themeCompartment.reconfigure(snowboyLightTheme)
    }).state;
    expect(reconfigured.doc.toString()).toBe('two three four');
  });
});
