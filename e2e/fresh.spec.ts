/**
 * Screens open instantly the second time (kept on the phone), yet never show
 * old numbers: something saved elsewhere reaches an open screen.
 */
import type { Request } from "@playwright/test";
import { test, expect, expectHealthy, stateFile } from "./fixtures";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** A screen's data fetched from the server on a tap (not a background preload). */
const navigationFetch = (r: Request, path: string) => r.headers()["rsc"] === "1" && !r.headers()["next-router-prefetch"] && new URL(r.url()).pathname === path;

test.use({ storageState: stateFile("owner") });

test("a tab opened before shows again without asking the server", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const tabs = page.locator("[data-tabbar]");
  await tabs.getByRole("link", { name: "Orders" }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const fetched: string[] = [];
  page.on("request", (r) => navigationFetch(r, "/") && fetched.push(r.url()));
  await tabs.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: /New Order/ }).first()).toBeVisible();
  expect(fetched, "Home was fetched again").toEqual([]);
  await expectHealthy(page);
});

test("something saved by someone else shows on an open screen", async ({ page, playwright, seed }) => {
  await page.goto("/stock", { waitUntil: "networkidle" });
  const row = page.locator(`[data-stock-item="Probe Cloth"] [data-stock="in"]`);
  const before = Number((await row.innerText()).trim().replace("−", "-"));

  const staff = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: stateFile("staff") });
  const res = await staff.post("/api/stock", { data: { entryCaptureId: `e2e-${Date.now()}`, inputMethod: "form", kind: "receipt", date: today(), lines: [{ itemId: seed.probe, quantity: "5" }] } });
  expect(res.ok(), await res.text()).toBe(true);
  await staff.dispose();

  // The screen checks every 15 s and whenever the app comes back into view.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(async () => Number((await row.innerText()).trim().replace("−", "-")), { timeout: 20_000 }).toBe(before + 5);
  await expectHealthy(page);
});
