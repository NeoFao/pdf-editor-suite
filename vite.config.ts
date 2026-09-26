import { defineConfig } from 'vite';

// App nueva (cimientos), en paralelo a la app actual. Salida a dist-next/.
export default defineConfig({
  build: { outDir: 'dist-next', rollupOptions: { input: 'index.next.html' }, emptyOutDir: true },
  server: { port: 5173 },
  assetsInclude: ['**/*.wasm']
});
