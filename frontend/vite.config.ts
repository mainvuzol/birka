import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  // The build's version, passed to the image build as `BIRKA_RELEASE` (the
  // git commit). Declared in src/release.d.ts.
  define: {
    __BIRKA_RELEASE__: JSON.stringify(process.env.BIRKA_RELEASE ?? "dev"),
  },
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
