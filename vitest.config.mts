import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    env: { SESSION_SECRET: "test-secret-test-secret-test-secret-123" },
    // npm run test:coverage → coverage/index.html shows which lines no test runs.
    coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/**/*.d.ts"], reporter: ["text-summary", "html"] },
  },
});
