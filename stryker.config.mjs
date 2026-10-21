/**
 * Mutation testing: Stryker makes hundreds of small deliberate bugs in the
 * pure calculation code (a > becomes >=, a + becomes -, a line is dropped)
 * and runs the tests against each one. A bug the tests don't notice
 * ("survived") is a gap in the tests. Weekly in CI; locally: npm run test:mutation
 *
 * Uses the "command" runner (a fresh test run per bug): Stryker's Vitest
 * runner can't switch bugs on inside Vitest 5's workers, so it reported
 * nearly every bug as missed.
 */
const config = {
  testRunner: "command",
  commandRunner: { command: "npx vitest run --config vitest.mutation.mts" },
  mutate: ["src/ledger/domain.ts", "src/lib/qty.ts", "src/lib/dates.ts", "src/lib/units.ts"],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  thresholds: { high: 85, low: 70, break: Number(process.env.MUTATION_BREAK ?? 85) },
  concurrency: Number(process.env.MUTATION_CONCURRENCY ?? 4),
  coverageAnalysis: "off",
  timeoutMS: 60000,
  tempDirName: ".stryker-tmp",
  ignorePatterns: ["/.next", "/.next-e2e", "/playwright-report", "/test-results", "/reports", "/coverage", "/e2e", "/smoke"],
};

export default config;
