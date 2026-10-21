/**
 * Real work done through the screens, like a person would, checking the
 * numbers every screen shows after each step: login, order, dispatch,
 * sending more than is in stock, a stock count, offline saving, and the
 * owner's reports. Runs in order on one database, so each step builds on the last.
 */
import type { Page } from "@playwright/test";
import { test, expect, expectHealthy, stateFile } from "./fixtures";
import { PHONES } from "./env";

test.describe.configure({ mode: "serial" });

/** "In stock 40 · Owed 0" and "40 Free" for one item on the Stock screen. */
async function stockRow(page: Page, item: string) {
  await page.goto("/stock", { waitUntil: "networkidle" });
  const row = page.getByRole("row", { name: new RegExp(`^${item} `) });
  const text = (await row.innerText()).replace(/\s+/g, " ");
  const free = (await row.getByRole("cell").nth(1).innerText()).trim();
  const num = (s: string, re: RegExp) => Number((s.match(re)?.[1] ?? "NaN").replace("−", "-"));
  return { inStock: num(text, /In stock ([−\d.-]+)/), owed: num(text, /Owed ([−\d.-]+)/), free: num(free, /^([−\d.-]+)/), low: /Low/.test(free), text };
}

/** A picker row: the name, then maybe its unit or town. */
const startsWith = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);

async function fillEntry(page: Page, path: string, party: string | null, lines: [string, string][]) {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Type/ }).click();
  await page.getByRole("button", { name: "Fill the form instead" }).click();
  if (party) {
    await page.getByRole("button", { name: "Pick party" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(party.split(" ")[0]);
    await dialog.getByRole("button", { name: startsWith(party) }).first().click();
  }
  for (const [i, [item, qty]] of lines.entries()) {
    if (i > 0) await page.getByRole("button", { name: "+ Add item" }).click();
    await page.getByRole("button", { name: "Pick item" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(item.split(" ")[0]);
    await dialog.getByRole("button", { name: startsWith(item) }).first().click();
    await page.getByRole("textbox", { name: /Qty|Counted/ }).nth(i).fill(qty);
  }
}

/** Saving goes through the phone's send queue, so screens catch up a moment later. */
const POLL = { timeout: 30_000 };

const saved = (page: Page) => expect(page.getByText("Saved", { exact: false }).first()).toBeVisible();

test("log in through the screens with the code", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "EN" }).click();
  await page.getByRole("textbox", { name: "Phone number" }).fill(PHONES.viewer);
  await page.getByRole("button", { name: "Send code" }).click();
  // No SMS in tests: the code is shown on screen.
  const code = (await page.locator(".font-mono").first().innerText()).trim();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByRole("textbox", { name: "Enter the 6-digit code" }).fill(code);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expectHealthy(page);
});

test.describe("staff at work", () => {
  test.use({ storageState: stateFile("staff") });

  test("the seeded numbers show right on the stock screen", async ({ page }) => {
    await expect.poll(() => stockRow(page, "D-4012"), POLL).toMatchObject({ inStock: 75, owed: 45, free: 30 }); // 100 in − 25 sent; 35 + 10 owed by the two firms
    await expect.poll(() => stockRow(page, "Cotton Poplin"), POLL).toMatchObject({ inStock: 245.5, owed: 20.25, free: 225.25 });
    await expect.poll(() => stockRow(page, "Rayon Plain"), POLL).toMatchObject({ inStock: 40, owed: 0, free: 40, low: false });
  });

  test("an order makes stock owed, not gone", async ({ page }) => {
    await fillEntry(page, "/order/new", "Gupta Traders", [["Rayon Plain", "7"]]);
    await page.getByRole("button", { name: "Save" }).click();
    await saved(page);
    await expect.poll(() => stockRow(page, "Rayon Plain"), POLL).toMatchObject({ inStock: 40, owed: 7, free: 33 });
  });

  test("a dispatch takes from stock and from what is owed", async ({ page }) => {
    await fillEntry(page, "/dispatch/new", "Gupta Traders", [["Rayon Plain", "4"]]);
    await page.getByRole("button", { name: "Save" }).click();
    await saved(page);
    await expect.poll(() => stockRow(page, "Rayon Plain"), POLL).toMatchObject({ inStock: 36, owed: 3, free: 33 });
  });

  test("sending more than is in stock asks first, then goes negative", async ({ page }) => {
    await fillEntry(page, "/dispatch/new", "Gupta Traders", [["Rayon Plain", "50"]]);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Rayon Plain" })).toBeVisible();
    await page.getByRole("button", { name: "Send anyway" }).click();
    await saved(page);
    // 36 − 50; the 3 owed were sent, the other 47 have no order.
    await expect.poll(() => stockRow(page, "Rayon Plain"), POLL).toMatchObject({ inStock: -14, owed: 0, free: -14, low: true });
    await page.goto("/unmatched", { waitUntil: "networkidle" });
    await expect(page.getByText("Gupta Traders").first()).toBeVisible();
    await expectHealthy(page);
  });

  test("a stock count sets what is really there", async ({ page }) => {
    await fillEntry(page, "/stock/in?mode=count", null, [["Rayon Plain", "20"]]);
    await page.getByRole("button", { name: "Save" }).click();
    await saved(page);
    await expect.poll(() => stockRow(page, "Rayon Plain"), POLL).toMatchObject({ inStock: 20, owed: 0, free: 20 });
  });

  test("an order saved with no signal is kept on the phone and sent when back online", async ({ page, context }) => {
    await fillEntry(page, "/order/new", "Sharma Textiles", [["Rayon Plain", "5"]]);
    await context.setOffline(true);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved|phone|offline|internet/i).first()).toBeVisible();
    await context.setOffline(false);
    await expect.poll(async () => (await stockRow(page, "Rayon Plain")).owed, POLL).toBe(5);
  });
});

test.describe("owner checks", () => {
  test.use({ storageState: stateFile("owner") });

  test("reports add up to what was sent", async ({ page }) => {
    await page.goto("/reports", { waitUntil: "networkidle" });
    await expectHealthy(page);
    // Rayon: 4 + 50 sent today; D-4012: 25; Cotton: 5.
    const text = await page.locator("main").innerText();
    expect(text).toContain("Rayon Plain");
    expect(text).toMatch(/54/);
  });

  test("the activity log shows what staff did", async ({ page }) => {
    await page.goto("/activity", { waitUntil: "networkidle" });
    await expectHealthy(page);
    await expect(page.getByText("Staff Kumar").filter({ visible: true }).first()).toBeVisible();
    // The count is logged as the change it made: −14 counted to 20.
    await expect(page.getByText("Rayon Plain 34 pcs").first()).toBeVisible();
  });
});
