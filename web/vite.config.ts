import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const appVersion = `${pkg.version}${process.env.GITHUB_RUN_NUMBER ? `.${process.env.GITHUB_RUN_NUMBER}` : ''}`;

export default defineConfig(({ mode }) => {
  // `--mode mobile` builds the self-contained Android/iOS app: the backend (server/*) runs on the
  // device against SQLite-in-WebAssembly, with small shims standing in for Node-only modules.
  const mobile = mode === 'mobile';
  const local = (f: string) => path.resolve(__dirname, 'src/local', f);
  const alias = mobile
    ? [
      { find: 'node:sqlite', replacement: local('shims/sqlite.js') },
      { find: 'node:fs', replacement: local('shims/fs.js') },
      { find: 'node:path', replacement: local('shims/path.js') },
      { find: 'node:url', replacement: local('shims/url.js') },
      { find: /^express$/, replacement: local('shims/express.js') },
      { find: /^compression$/, replacement: local('shims/compression.js') },
      { find: /^\.\/crypto\.js$/, replacement: local('shims/crypto.js') },
    ]
    : [{ find: /^\.\.\/local\/backend\.js$/, replacement: local('stub.js') }];

  return {
    root: path.resolve(__dirname),
    plugins: [react()],
    resolve: { alias },
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
      ...(mobile ? { 'import.meta.env.VITE_LOCAL_API': JSON.stringify('1'), 'process.env': 'globalThis.__kompareEnv', 'process.argv': '[]' } : {}),
    },
    build: {
      outDir: path.resolve(__dirname, '../dist'),
      emptyOutDir: true,
      target: 'es2020',
      rollupOptions: { output: { manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'] } } },
    },
    server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  };
});
