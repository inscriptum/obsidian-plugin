import { defineConfig } from 'vite';
import { deployPlugin } from './vite/vite-plugin-deploy.mjs';
import { jsxToTtPlugin } from './vite/vite-plugin-jsx-to-tt.mjs';

export default defineConfig({
  plugins: [deployPlugin(), jsxToTtPlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: 'src/main.ts',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    cssMinify: 'lightningcss',
    rolldownOptions: {
      external: ['obsidian', 'electron'],
      output: {
        codeSplitting: false,
        assetFileNames: 'styles.css',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
  },
  css: {
    transformer: 'lightningcss',
  },
});
