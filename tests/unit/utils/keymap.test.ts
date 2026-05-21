import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// Mock Svelte runes

import { registerShortcut, listShortcuts, formatCombo } from '../../../src/renderer/lib/utils/keymap';

describe('keymap registry', () => {
  let originalPlatform: string;

  beforeEach(() => {
    // Clear registry by unregistering all
    
    originalPlatform = navigator.platform;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      configurable: true
    });
  });

  it('registers and deregisters shortcuts', () => {
    const initialCount = listShortcuts().length;
    
    
    const handler = () => {};
    const deregister = registerShortcut({
      id: 'test.shortcut',
      combo: { cmdOrCtrl: true, code: 'KeyA' },
      scope: 'global-allow-editor',
      description: 'Test shortcut',
      handler
    });

    expect(listShortcuts().length).toBe(initialCount + 1);
    expect(listShortcuts().find(s => s.id === 'test.shortcut')).toBeDefined();

    deregister();

    expect(listShortcuts().length).toBe(initialCount);
    expect(listShortcuts().find(s => s.id === 'test.shortcut')).toBeUndefined();
  });

  it('formats combos correctly for macOS', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true
    });

    expect(formatCombo({ cmdOrCtrl: true, code: 'Backslash' })).toBe('⌘+\\');
    expect(formatCombo({ cmdOrCtrl: true, shift: true, code: 'Backslash' })).toBe('⌘+⇧+\\');
    expect(formatCombo({ cmdOrCtrl: true, code: 'KeyW' })).toBe('⌘+W');
    expect(formatCombo({ cmdOrCtrl: true, code: 'Enter' })).toBe('⌘+Enter');
  });

  it('formats combos correctly for Windows/Linux', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true
    });

    expect(formatCombo({ cmdOrCtrl: true, code: 'Backslash' })).toBe('Ctrl+\\');
    expect(formatCombo({ cmdOrCtrl: true, shift: true, code: 'Backslash' })).toBe('Ctrl+Shift+\\');
    expect(formatCombo({ cmdOrCtrl: true, code: 'KeyW' })).toBe('Ctrl+W');
    expect(formatCombo({ cmdOrCtrl: true, code: 'Enter' })).toBe('Ctrl+Enter');
  });

  it('respects global-block-editor scope', () => {
    let called = 0;
    const handler = () => { called++; };
    const deregister = registerShortcut({
      id: 'test.block',
      combo: { cmdOrCtrl: true, code: 'KeyB' },
      scope: 'global-block-editor',
      description: 'Test block',
      handler
    });

    // Mock Mac
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true
    });

    // Fire event on body
    const event1 = new KeyboardEvent('keydown', {
      code: 'KeyB',
      metaKey: true,
      bubbles: true
    });
    document.body.dispatchEvent(event1);
    expect(called).toBe(1);

    // Fire event on input
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event2 = new KeyboardEvent('keydown', {
      code: 'KeyB',
      metaKey: true,
      bubbles: true
    });
    input.dispatchEvent(event2);
    expect(called).toBe(1); // Not called again

    // Fire event on cm-editor
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    document.body.appendChild(editor);
    const event3 = new KeyboardEvent('keydown', {
      code: 'KeyB',
      metaKey: true,
      bubbles: true
    });
    editor.dispatchEvent(event3);
    expect(called).toBe(1); // Not called again

    deregister();
    input.remove();
    editor.remove();
  });

  it('respects global-allow-editor scope', () => {
    let called = 0;
    const handler = () => { called++; };
    const deregister = registerShortcut({
      id: 'test.allow',
      combo: { cmdOrCtrl: true, code: 'KeyA' },
      scope: 'global-allow-editor',
      description: 'Test allow',
      handler
    });

    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true
    });

    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = new KeyboardEvent('keydown', {
      code: 'KeyA',
      metaKey: true,
      bubbles: true
    });
    input.dispatchEvent(event);
    expect(called).toBe(1); // Called even in input

    deregister();
    input.remove();
  });

  it('matches international keyboards using e.code', () => {
    let called = 0;
    const handler = () => { called++; };
    const deregister = registerShortcut({
      id: 'test.intl',
      combo: { cmdOrCtrl: true, code: 'Slash' },
      scope: 'global-allow-editor',
      description: 'Test intl',
      handler
    });

    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true
    });

    const event = new KeyboardEvent('keydown', {
      code: 'Slash',
      key: '-',
      metaKey: true,
      bubbles: true
    });
    document.body.dispatchEvent(event);
    expect(called).toBe(1);

    deregister();
  });
});
