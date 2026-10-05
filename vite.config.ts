import { defineConfig } from "vite";
export default defineConfig({ build: { outDir: "dist/client", rollupOptions: { input: { app: 'index.html', preview: 'preview.html' } } }, server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8787" } } });
