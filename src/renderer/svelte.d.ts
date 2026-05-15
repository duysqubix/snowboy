declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}

declare module '*.css';

declare global {
  interface Window {
    snowboy: Record<string, never>;
  }
}

export {};
