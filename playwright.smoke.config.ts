/** Read-only checks of the live site (see smoke/live.spec.ts). */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "smoke",
  retries: 2,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: { baseURL: process.env.SMOKE_URL ?? "https://godown-blond.vercel.app", ...devices["iPhone 13"], browserName: "chromium", defaultBrowserType: "chromium", locale: "en-IN" },
});
