import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  const apiBase = env.VITE_API_BASE_URL || process.env.VITE_API_BASE_URL;
  // When VITE_API_BASE_URL is set, frontend calls the API directly (no proxy). Avoids ECONNREFUSED.
  const useProxy = !apiBase;

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
      port: 5173,
      proxy: useProxy
        ? {
            '/api': {
              target: 'http://localhost:3001',
              changeOrigin: true,
              configure: (proxy) => {
                let logged = false;
                proxy.on('error', (err, req, res) => {
                  if (!res.headersSent) {
                    (res as import('http').ServerResponse).writeHead(503, {
                      'Content-Type': 'application/json',
                    });
                    (res as import('http').ServerResponse).end(
                      JSON.stringify({
                        error: 'Backend unavailable',
                        message: 'Start the backend: cd grovyn-core-platform/backend && npm run dev',
                      })
                    );
                  }
                  if (!logged) {
                    logged = true;
                    console.warn('[vite] API proxy: backend unreachable. Start: cd grovyn-core-platform/backend && npm run dev');
                  }
                });
              },
            },
          }
        : undefined,
    },
  };
});
