import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';
var __dirname = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
        port: 5173,
        proxy: process.env.VITE_API_BASE_URL
            ? undefined
            : { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
    },
});
