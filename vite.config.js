import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/acp": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/.well-known": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/agent": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/audit-log": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/webhook": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
