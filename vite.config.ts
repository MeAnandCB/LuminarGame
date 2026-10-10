import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/socket.io': { target: backend, ws: true, changeOrigin: false },
    },
  },
});
