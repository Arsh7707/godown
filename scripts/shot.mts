/**
 * Dev helper: screenshots pages at phone size, optionally logged in.
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/shot.mts <outDir> <phone|-> <path> [path...]
 */
import { chromium } from "playwright-core";

const [outDir, phone, ...paths] = process.argv.slice(2);
const base = process.env.SHOT_BASE ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "hi-IN" });
const page = await ctx.newPage();

if (phone && phone !== "-") {
  const r = await page.request.post(`${base}/api/auth/request`, { data: { phone, accessCode: process.env.TEST_ACCESS_CODE } });
  const { devCode } = (await r.json()) as { devCode: string };
  const v = await page.request.post(`${base}/api/auth/verify`, { data: { phone, code: devCode } });
  if (!(await v.json()).ok) throw new Error("login failed");
}
for (const [i, p] of paths.entries()) {
  await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  const file = `${outDir}/${String(i + 1).padStart(2, "0")}-${p.replace(/[^a-z0-9]+/gi, "_") || "home"}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
}
await browser.close();
