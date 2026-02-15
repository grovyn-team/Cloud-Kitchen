import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    // Proxy target from env (e.g. Vercel backend) or fallback to local backend
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:3001',
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
                  message:
                    process.env.VITE_API_BASE_URL
                      ? `Remote backend unreachable: ${process.env.VITE_API_BASE_URL}`
                      : 'Start the backend: cd grovyn-core-platform/backend && npm run dev',
                })
              );
            }
            if (!logged) {
              logged = true;
              console.warn(
                '[vite] API proxy: backend unreachable. Target:',
                process.env.VITE_API_BASE_URL || 'http://localhost:3001'
              );
            }
          });
        },
      },
    },
  },
});
