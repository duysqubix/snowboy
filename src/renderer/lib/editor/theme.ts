import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const lightBg = 'hsl(0 0% 100%)';
const lightText = 'hsl(222.2 84% 4.9%)';
const lightMuted = 'hsl(210 40% 96.1%)';
const lightKeyword = '#4f46e5';
const lightType = '#059669';
const lightString = '#c2410c';
const lightComment = 'hsl(215.4 16.3% 46.9%)';
const lightFunction = '#7c3aed';

const darkBg = 'hsl(222.2 84% 4.9%)';
const darkText = 'hsl(210 40% 98%)';
const darkMuted = 'hsl(217.2 32.6% 17.5%)';
const darkKeyword = '#818cf8';
const darkType = '#34d399';
const darkString = '#fb923c';
const darkComment = 'hsl(215 20.2% 65.1%)';
const darkFunction = '#a78bfa';

const lightTheme = EditorView.theme({
  '&': {
    color: lightText,
    backgroundColor: lightBg,
  },
  '.cm-content': {
    caretColor: lightText,
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: lightText },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: lightMuted },
  '.cm-panels': { backgroundColor: lightBg, color: lightText },
  '.cm-panels.cm-panels-top': { borderBottom: '2px solid black' },
  '.cm-panels.cm-panels-bottom': { borderTop: '2px solid black' },
  '.cm-searchMatch': {
    backgroundColor: '#72a1ff59',
    outline: '1px solid #457dff'
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: '#6199ff2f'
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionMatch': { backgroundColor: '#aafe661a' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: '#bad0f847'
  },
  '.cm-gutters': {
    backgroundColor: lightBg,
    color: lightComment,
    border: 'none'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent'
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#ddd'
  },
  '.cm-tooltip': {
    border: 'none',
    backgroundColor: lightBg
  },
  '.cm-tooltip .cm-tooltip-arrow:before': {
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent'
  },
  '.cm-tooltip .cm-tooltip-arrow:after': {
    borderTopColor: lightBg,
    borderBottomColor: lightBg
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: lightMuted,
      color: lightText
    }
  }
}, { dark: false });

const lightHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: lightKeyword },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: lightText },
  { tag: [t.function(t.variableName), t.labelName], color: lightFunction },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: lightFunction },
  { tag: [t.definition(t.name), t.separator], color: lightText },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: lightType },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: lightText },
  { tag: [t.meta, t.comment], color: lightComment, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: lightComment, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: lightText },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: lightFunction },
  { tag: [t.processingInstruction, t.string, t.inserted], color: lightString },
  { tag: t.invalid, color: '#ff0000' },
]);

const darkTheme = EditorView.theme({
  '&': {
    color: darkText,
    backgroundColor: darkBg,
  },
  '.cm-content': {
    caretColor: darkText,
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: darkText },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: darkMuted },
  '.cm-panels': { backgroundColor: darkBg, color: darkText },
  '.cm-panels.cm-panels-top': { borderBottom: '2px solid black' },
  '.cm-panels.cm-panels-bottom': { borderTop: '2px solid black' },
  '.cm-searchMatch': {
    backgroundColor: '#72a1ff59',
    outline: '1px solid #457dff'
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: '#6199ff2f'
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionMatch': { backgroundColor: '#aafe661a' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: '#bad0f847'
  },
  '.cm-gutters': {
    backgroundColor: darkBg,
    color: darkComment,
    border: 'none'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent'
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#ddd'
  },
  '.cm-tooltip': {
    border: 'none',
    backgroundColor: darkBg
  },
  '.cm-tooltip .cm-tooltip-arrow:before': {
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent'
  },
  '.cm-tooltip .cm-tooltip-arrow:after': {
    borderTopColor: darkBg,
    borderBottomColor: darkBg
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: darkMuted,
      color: darkText
    }
  }
}, { dark: true });

const darkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: darkKeyword },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: darkText },
  { tag: [t.function(t.variableName), t.labelName], color: darkFunction },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: darkFunction },
  { tag: [t.definition(t.name), t.separator], color: darkText },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: darkType },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: darkText },
  { tag: [t.meta, t.comment], color: darkComment, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: darkComment, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: darkText },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: darkFunction },
  { tag: [t.processingInstruction, t.string, t.inserted], color: darkString },
  { tag: t.invalid, color: '#ff0000' },
]);

export const snowboyLightTheme = [lightTheme, syntaxHighlighting(lightHighlightStyle)];
export const snowboyDarkTheme = [darkTheme, syntaxHighlighting(darkHighlightStyle)];
