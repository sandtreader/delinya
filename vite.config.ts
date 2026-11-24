import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    // One copy of React, MUI and Emotion even when @sandtreader/collab is a
    // local link (its own dev installs would otherwise split the theme context)
    dedupe: ["react", "react-dom", "@mui/material", "@mui/icons-material", "@emotion/react", "@emotion/styled"],
  },
  server: {
    port: 5174,
    // The collab relay (pnpm relay), at /collab as Apache serves it on the
    // live site, so the app reaches it the same way, from the LAN too.
    proxy: { "/collab": { target: "ws://localhost:2901", ws: true } },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
