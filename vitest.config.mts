import { defineConfig } from 'vitest/config';
import { jsxToTtPlugin } from './vite/vite-plugin-jsx-to-tt.mjs';

export default defineConfig({
  plugins: [jsxToTtPlugin()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
});