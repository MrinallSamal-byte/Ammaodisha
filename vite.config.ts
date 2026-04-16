import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // MapLibre is intentionally isolated behind the lazy map route. Keep the
    // build warning focused on unexpected app chunks rather than this vendor file.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("maplibre-gl")) return "maplibre-gl";
        }
      }
    }
  },
  server: {
    port: 5173
  }
});
