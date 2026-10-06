import { defineConfig } from "vite";
// Client builds contain only the product. Auditions remain a separate development tool.
export default defineConfig({ build: { outDir: "dist/client", rollupOptions: { input: { app: 'index.html' } } }, server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8787" } } });
