/**
 * Browser tests: a production build of the app on its own port and its own
 * local database (never the live one), driven like a person on an iPhone.
 *
 *   npm run test:e2e          build, start, run everything
 *   npm run test:e2e -- --ui  watch it click through
 *   E2E_REUSE=1               keep a server already running on E2E_PORT
 */
import { defineConfig, devices } from "@playwright/test";
import { BASE, DB_URL, PORT } from "./e2e/env";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // The specs share one database; run them one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE,
    ...devices["iPhone 13"],
    // Run the iPhone profile in Chromium (WebKit is not needed to catch layout and logic breaks).
    browserName: "chromium",
    defaultBrowserType: "chromium",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(process.env.E2E_CHROME ? { launchOptions: { executablePath: process.env.E2E_CHROME } } : {}),
  },
  projects: [
    { name: "login", testMatch: /auth\.setup\.ts/ },
    { name: "app", dependencies: ["login"], testIgnore: /auth\.setup\.ts/ },
    // Safari's engine, as on the iPhone: every screen in both languages (E2E_SAFARI=1; nightly runs it).
    ...(process.env.E2E_SAFARI
      ? [{ name: "iphone-safari", dependencies: ["app"], testMatch: /screens\.spec\.ts/, use: { ...devices["iPhone 13"], browserName: "webkit" as const, defaultBrowserType: "webkit" as const } }]
      : []),
  ],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `${BASE}/login`,
    timeout: 300_000,
    reuseExistingServer: !!process.env.E2E_REUSE,
    stdout: "pipe",
    env: {
      // Only these settings: no .env file is read, so no real keys, database or SMS.
      __NEXT_PROCESSED_ENV: "true",
      NEXT_DIST_DIR: ".next-e2e",
      DATABASE_URL: DB_URL,
      SESSION_SECRET: "e2e-session-secret-e2e-session-secret",
      OTP_DEV_MODE: "true",
      TEST_ACCESS_CODE: "",
      CRON_SECRET: "e2e-cron-secret",
      ANTHROPIC_API_KEY: "",
      SARVAM_API_KEY: "",
      VAPID_PUBLIC_KEY: "",
      VAPID_PRIVATE_KEY: "",
    },
  },
});
