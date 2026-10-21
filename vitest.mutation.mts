/**
 * The tests Stryker runs for each planted bug (see stryker.config.mjs): the
 * fast tests of the pure calculation code (no database), so each of the
 * hundreds of runs takes seconds. Standalone on purpose: mergeConfig would
 * add these to the full test list instead of replacing it.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/domain.test.ts", "tests/edges.test.ts", "tests/qty-dates.test.ts", "tests/properties.test.ts", "tests/fuzzy.test.ts"],
    // The random-history test needs a database; the pure property tests in that file still run.
    testNamePattern: "^(?!.*random histories)",
    bail: 1,
    env: { SESSION_SECRET: "test-secret-test-secret-test-secret-123" },
  },
});
