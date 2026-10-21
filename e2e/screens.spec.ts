/**
 * Opens every screen as owner, staff and viewer, in English and Hindi, and
 * checks each one: no crash or server error, nothing wider than the phone,
 * no NaN/undefined on screen, and people only reach what their role allows.
 */
import { test, expect, expectHealthy, setLanguage, stateFile, type Seed } from "./fixtures";
import type { RoleName } from "./env";

type Screen = { path: (s: Seed) => string; only?: RoleName[] };

const SCREENS: Screen[] = [
  { path: () => "/" },
  { path: () => "/order/new", only: ["owner", "staff"] },
  { path: () => "/dispatch/new", only: ["owner", "staff"] },
  { path: () => "/pending" },
  { path: (s) => `/pending/party/${s.sharma}` },
  { path: () => "/dispatches" },
  { path: (s) => `/dispatches/${s.dispatchId}` },
  { path: (s) => `/orders/${s.orderId}` },
  { path: () => "/stock" },
  { path: (s) => `/stock/item/${s.d4012}` },
  { path: () => "/stock/in", only: ["owner", "staff"] },
  { path: () => "/stock/new-product", only: ["owner"] },
  { path: () => "/unmatched" },
  { path: () => "/history" },
  { path: () => "/inbox" },
  { path: () => "/firms" },
  { path: () => "/reports", only: ["owner", "viewer"] },
  { path: () => "/activity", only: ["owner"] },
  { path: () => "/manage", only: ["owner"] },
  { path: () => "/manage/clients", only: ["owner"] },
  { path: (s) => `/manage/clients/${s.sharma}`, only: ["owner"] },
  { path: () => "/manage/items", only: ["owner"] },
  { path: (s) => `/manage/items/${s.d4012}`, only: ["owner"] },
  { path: () => "/manage/team", only: ["owner"] },
  { path: () => "/manage/company", only: ["owner"] },
  { path: () => "/manage/import", only: ["owner"] },
];

for (const role of ["owner", "staff", "viewer"] as const) {
  test.describe(`${role}`, () => {
    test.use({ storageState: stateFile(role) });

    for (const lang of ["en", "hi"] as const) {
      test(`every screen works in ${lang === "en" ? "English" : "Hindi"}`, async ({ page, seed }) => {
        await setLanguage(page, lang);
        try {
          for (const screen of SCREENS) {
            const path = screen.path(seed);
            const res = await page.goto(path, { waitUntil: "networkidle" });
            expect(res?.status(), `${path} status`).toBeLessThan(400);
            const landed = new URL(page.url()).pathname;
            if (screen.only && !screen.only.includes(role)) {
              expect(landed, `${role} must not reach ${path}`).not.toBe(path);
            } else {
              expect(landed, `${role} should reach ${path}`).toBe(path);
            }
            await expectHealthy(page, `${path} (${role}, ${lang})`);
          }
        } finally {
          await setLanguage(page, "en");
        }
      });
    }
  });
}

test("logged out: every screen sends you to the login page", async ({ page, seed }) => {
  for (const screen of SCREENS) {
    await page.goto(screen.path(seed));
    await expect(page, screen.path(seed)).toHaveURL(/\/login/);
  }
  await expectHealthy(page);
});

test("a screen for something that does not exist shows not found, not a crash", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: stateFile("owner") });
  const page = await ctx.newPage();
  for (const path of ["/orders/00000000-0000-0000-0000-000000000000", "/dispatches/not-a-uuid", "/stock/item/00000000-0000-0000-0000-000000000000", "/manage/clients/abc"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
  await ctx.close();
});
