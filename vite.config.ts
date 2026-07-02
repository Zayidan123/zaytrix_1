import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Allow all hosts so the sandbox preview proxy (and any preview host)
      // can reach the dev server without "Blocked request" errors.
      allowedHosts: true,
      // Bind to all interfaces so the gateway/Caddy reverse proxy can connect.
      host: '0.0.0.0',
    },
    // Exclude non-app directories from Vite module resolution.
    // `entries` restricts the dependency scanner to the real app entry so
    // Vite does not try to parse hundreds of unrelated HTML files in skills/.
    optimizeDeps: {
      entries: ['index.html'],
      exclude: ['skills'],
    },
  };
});
