import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: { output: { manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'] } } },
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
});
