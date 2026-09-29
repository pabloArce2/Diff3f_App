import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // three.js alone is about 550 kB minified; it is loaded only when a 3D viewer opens.
  build: { chunkSizeWarningLimit: 700 },
});
