/**
 * Screenshots for design review (not a test): `SHOTS=orders npx playwright test shots --project=app`
 * saves every matching screen at 360px, in English and Hindi, to test-results/shots/.
 */
import { test, setLanguage, stateFile } from "./fixtures";
import { SCREENS } from "./screens";

const MATCH = process.env.SHOTS;
test.skip(!MATCH, "set SHOTS=<path regex> to take screenshots");
test.use({ viewport: { width: 360, height: 740 }, storageState: stateFile((process.env.SHOTS_ROLE as "owner" | "staff" | "viewer") ?? "owner") });

test("screenshots", async ({ page, seed }) => {
  const re = new RegExp(MATCH ?? "");
  try {
    for (const lang of ["en", "hi"] as const) {
      await setLanguage(page, lang);
      for (const s of SCREENS) {
        const path = s.path(seed);
        if (!re.test(path)) continue;
        await page.goto(path, { waitUntil: "networkidle" });
        const name = path.replace(/[^a-z0-9]+/gi, "_").replace(/_[0-9a-f]{8}_[0-9a-f_]{27,}/g, "_id");
        await page.screenshot({ path: `test-results/shots/${name}-${lang}.png`, fullPage: true });
      }
    }
  } finally {
    await setLanguage(page, "en");
  }
});
