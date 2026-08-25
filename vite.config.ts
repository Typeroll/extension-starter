import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/assets',
    emptyOutDir: true,
    lib: {
      entry: 'src/frontend/index.ts',
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'index',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        assetFileNames: '[name][extname]',
        inlineDynamicImports: true,
      },
    },
  },
});
