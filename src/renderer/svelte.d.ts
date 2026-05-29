import type { Settings, SnowboyApi } from '../main/types';

declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}

declare module '*.css';

declare module '*?asset' {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    snowboy: SnowboyApi;
    snowboySettingsBoot: Settings;
  }
}

export {};
