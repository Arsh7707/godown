/** Renders the app icon at the sizes PWAs need. Run once: npx tsx scripts/make-icons.mts */
import { chromium } from "playwright-core";

// Ledger book with a tick, on brand blue. `pad` shrinks the art for maskable icons (safe zone).
const svg = (pad: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1f4e79"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">
    <rect x="118" y="96" width="276" height="330" rx="28" fill="#ffffff"/>
    <rect x="118" y="96" width="46" height="330" rx="20" fill="#d9e4ef"/>
    <rect x="196" y="160" width="160" height="18" rx="9" fill="#9fb6cc"/>
    <rect x="196" y="206" width="160" height="18" rx="9" fill="#9fb6cc"/>
    <rect x="196" y="252" width="110" height="18" rx="9" fill="#9fb6cc"/>
    <circle cx="330" cy="340" r="62" fill="#2e7d4f"/>
    <path d="M300 340 l22 22 l40 -44" fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await browser.newPage();
for (const [name, size, pad] of [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["maskable-512.png", 512, 64],
  ["apple-touch-icon.png", 180, 24],
] as const) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(pad).replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: false });
  console.log(name);
}
await browser.close();
