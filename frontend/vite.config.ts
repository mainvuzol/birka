import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.BIRKA_DEV_API_URL ?? "http://127.0.0.1:8000",
      },
    },
  },
  // No source maps: served from the public domain they would hand anyone the
  // app's whole source with its comments, and no error tracker reads them.
  build: { outDir: "dist", sourcemap: false },
});
