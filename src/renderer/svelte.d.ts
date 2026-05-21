import type { Settings, SnowboyApi } from '../main/types';

declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}

declare module '*.css';

declare global {
  interface Window {
    snowboy: SnowboyApi;
    snowboySettingsBoot: Settings;
  }
}

export {};
