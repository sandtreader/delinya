import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    // One copy of React even when @sandtreader/collab is a local link
    dedupe: ["react", "react-dom"],
  },
  server: { port: 5174 },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
