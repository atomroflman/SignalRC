import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // React 19 automatic runtime, as Next compiles it (tsconfig keeps "preserve" for Next).
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
