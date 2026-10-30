/**
 * Opens every screen as owner, staff and viewer, in English and Hindi, and
 * checks each one: no crash or server error, nothing wider than the phone,
 * no NaN/undefined on screen, and people only reach what their role allows.
 */
import { test, expect, expectHealthy, setLanguage, stateFile } from "./fixtures";
import { SCREENS } from "./screens";

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
            const want = path.split("?")[0];
            if (screen.only && !screen.only.includes(role)) {
              expect(landed, `${role} must not reach ${path}`).not.toBe(want);
            } else {
              expect(landed, `${role} should reach ${path}`).toBe(want);
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
    const res = await page.goto(path, { waitUntil: "networkidle" });
    // Screens stream in (instant loading skeleton), so a missing record can arrive with status 200:
    // what matters is that it says "not found" and offers the way home, never a server error.
    expect(res?.status(), path).toBeLessThan(500);
    await expect(page.getByText("Not found").first(), path).toBeVisible();
    await expect(page.getByRole("link", { name: "Home" }).first(), path).toBeVisible();
  }
  await ctx.close();
});
