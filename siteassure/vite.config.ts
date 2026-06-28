import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Tauri expects a fixed dev port and the dist/ build output.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist" },
});
