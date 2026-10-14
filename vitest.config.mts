import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60000, hookTimeout: 60000, env: { SESSION_SECRET: "test-secret-test-secret-test-secret-123" } },
});
