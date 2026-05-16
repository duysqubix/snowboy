import { test, expect } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { snowflakeDialect } from '../../../src/renderer/lib/editor/snowflakeDialect';

function getTokens(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [snowflakeDialect.extension]
  });
  const tree = syntaxTree(state);
  const tokens: { name: string, text: string }[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name !== 'Document' && node.name !== 'Script' && node.name !== 'Statement') {
        tokens.push({
          name: node.name,
          text: doc.slice(node.from, node.to)
        });
      }
    }
  });
  return tokens;
}

test('snowflakeDialect parses a basic SELECT * FROM t correctly', () => {
  const tokens = getTokens('SELECT * FROM t');
  const names = tokens.map(t => t.name);
  expect(names).toContain('Keyword');
  expect(names).toContain('Operator');
  expect(names).toContain('Keyword');
  expect(names).toContain('Identifier');
});

test('QUALIFY is recognized as a keyword', () => {
  const tokens = getTokens('QUALIFY row_number() = 1');
  const qualifyToken = tokens.find(t => t.text.toUpperCase() === 'QUALIFY');
  expect(qualifyToken).toBeDefined();
  expect(qualifyToken?.name).toBe('Keyword');
});

test('MATCH_RECOGNIZE is recognized as a keyword', () => {
  const tokens = getTokens('MATCH_RECOGNIZE ( ORDER BY time )');
  const matchToken = tokens.find(t => t.text.toUpperCase() === 'MATCH_RECOGNIZE');
  expect(matchToken).toBeDefined();
  expect(matchToken?.name).toBe('Keyword');
});

test('$$ hello $$ is parsed as a string literal', () => {
  const tokens = getTokens('SELECT $$ hello $$');
  const stringToken = tokens.find(t => t.text === '$$ hello $$');
  expect(stringToken).toBeDefined();
  expect(stringToken?.name).toBe('String');
});

test('-- and /* */ comments are recognized', () => {
  const tokens1 = getTokens('-- line comment\nSELECT 1');
  expect(tokens1.some(t => t.name === 'LineComment')).toBe(true);

  const tokens2 = getTokens('/* block comment */ SELECT 1');
  expect(tokens2.some(t => t.name === 'BlockComment')).toBe(true);
});

test('CURRENT_ROLE is recognized as a builtin/function', () => {
  const tokens = getTokens('SELECT CURRENT_ROLE()');
  const roleToken = tokens.find(t => t.text.toUpperCase() === 'CURRENT_ROLE');
  expect(roleToken).toBeDefined();
  expect(roleToken?.name).toBe('Builtin');
});
