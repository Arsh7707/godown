/**
 * Read-only check of the live site: it is up, fast, locked, and the phone
 * app's files are there. It never logs in and never changes anything.
 *
 *   npm run test:live-smoke                       checks https://godown-blond.vercel.app
 *   SMOKE_URL=https://preview-url npm run test:live-smoke
 */
import { test, expect } from "@playwright/test";

test("the login page opens quickly and works on a phone", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const start = Date.now();
  const res = await page.goto("/login", { waitUntil: "load" });
  expect(res?.status()).toBe(200);
  expect(Date.now() - start, "login page took too long").toBeLessThan(8_000);
  await expect(page.getByRole("textbox").first()).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width, "login page wider than the phone").toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("security headers are on", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["strict-transport-security"], "https only").toBeTruthy();
});

test("nothing is readable without logging in", async ({ request }) => {
  for (const url of ["/api/catalog", "/api/reports?from=2026-01-01&to=2026-01-02", "/api/activity", "/api/import", "/api/unmatched", "/api/firm"]) {
    expect((await request.get(url, { maxRedirects: 0 })).status(), url).toBe(401);
  }
  for (const url of ["/api/orders", "/api/dispatches", "/api/stock"]) {
    expect((await request.post(url, { data: {}, maxRedirects: 0 })).status(), url).toBe(401);
  }
  for (const url of ["/api/cron/digest", "/api/cron/stock-keeper"]) {
    expect((await request.get(url, { maxRedirects: 0 })).status(), `${url} without the secret`).toBe(401);
  }
});

test("screens send you to log in", async ({ page }) => {
  for (const path of ["/", "/stock", "/pending", "/reports"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login/);
  }
});

test("the phone app's files are served", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).name).toBeTruthy();
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
});
