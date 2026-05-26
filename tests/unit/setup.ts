/* eslint-disable */
import { plugin } from 'bun';
import { compile } from 'svelte/compiler';
import { readFileSync } from 'fs';

plugin({
  name: 'svelte-loader',
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, (args) => {
      let source = readFileSync(args.path, 'utf8');
      source = source.replace(/import .* from '\$lib\/components\/ui\/.*';/g, '');
      source = source.replace(/import .* from '\.\.\/.*\.svelte';/g, '');
      const { js } = compile(source, {
        filename: args.path,
        generate: 'client',
        runes: true
      });
      return {
        contents: js.code,
        loader: 'js'
      };
    });
  }
});

(globalThis as any).$state = (v: any) => v;
(globalThis as any).$derived = (v: any) => v;
(globalThis as any).$effect = (v: any) => v;

class MockEventTarget {
  listeners: Record<string, Function[]> = {};
  tagName: string = '';
  className: string = '';
  style: any = {};
  
  addEventListener(type: string, listener: Function) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }
  removeEventListener(type: string, listener: Function) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(l => l !== listener);
  }
  dispatchEvent(event: any) {
    if (!event.target) event.target = this;
    if (this.listeners[event.type]) {
      for (const l of this.listeners[event.type]) {
        l(event);
      }
    }
    // Bubble to window
    if (event.bubbles && (globalThis as any).window && this !== (globalThis as any).window) {
      (globalThis as any).window.dispatchEvent(event);
    }
  }
  closest(sel: string) {
    if (sel === '.cm-editor' && this.className === 'cm-editor') return this;
    return null;
  }
}

(globalThis as any).window = new MockEventTarget();
(globalThis as any).window.snowboy = {
  settings: {
    onChanged: () => () => {},
    set: async (p: any) => p
  },
  theme: {
    onChanged: () => () => {},
    get: async () => 'light'
  },
  workspace: {
    saveLayout: async () => {},
    loadLayout: async () => null,
    flushAck: async () => {}
  },
  workspaceEvents: {
    onRequestFlush: () => () => {}
  }
};
(globalThis as any).document = {
  body: new MockEventTarget(),
  documentElement: {
    style: {}
  },
  createElement: (tag: string) => {
    const el = new MockEventTarget() as any;
    el.tagName = tag.toUpperCase();
    el.remove = () => {};
    return el;
  }
};
(globalThis as any).document.body.tagName = 'BODY';
(globalThis as any).document.body.appendChild = () => {};

(globalThis as any).navigator = {
  platform: 'MacIntel',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
};

(globalThis as any).KeyboardEvent = class KeyboardEvent {
  type: string;
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  bubbles: boolean;
  target: any;
  constructor(type: string, init: any) {
    this.type = type;
    this.code = init.code || '';
    this.key = init.key || '';
    this.metaKey = init.metaKey || false;
    this.ctrlKey = init.ctrlKey || false;
    this.shiftKey = init.shiftKey || false;
    this.altKey = init.altKey || false;
    this.bubbles = init.bubbles || false;
  }
  preventDefault() {}
};
