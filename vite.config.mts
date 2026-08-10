import { defineConfig } from 'vite';
import { version } from './package.json' with { type: 'json' };
import { deployPlugin } from './vite/vite-plugin-deploy.mjs';
import { jsxToTtPlugin } from './vite/vite-plugin-jsx-to-tt.mjs';

export default defineConfig(({ mode }) => ({
  plugins: [deployPlugin(), jsxToTtPlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    // Suffix for custom element tags (see src/tags.ts): unique per build so
    // plugin reloads/updates register fresh classes. Dev gets a per-build
    // hash so `vite build --watch` reloads also pick up changes fully.
    'process.env.EDITOR_VERSION': JSON.stringify(
      mode === 'development'
        ? `${version}-dev-${Date.now().toString(36)}`
        : version,
    ),
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
}));
