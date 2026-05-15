import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{ts,svelte}'
  ],
  darkMode: 'class',
  theme: {
    extend: {}
  },
  plugins: []
};

export default config;
