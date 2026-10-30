/**
 * Design rules, checked on every screen at the smallest common phone width
 * (360px), in English and Hindi:
 *  - nothing wider than the screen;
 *  - every button, link and field is at least 48×48px to tap (inline links in a sentence excepted);
 *  - no text smaller than 14px, and body text (paragraphs) at least 16px;
 *  - no text cut off with "…" or clipped by its box (Hindi matras included);
 *  - no word glued to a number ("after6", "sending6pcs").
 */
import type { Page } from "@playwright/test";
import { test, expect, setLanguage, stateFile, type Seed } from "./fixtures";
import { SCREENS } from "./screens";

test.use({ viewport: { width: 360, height: 740 } });

/** While working on one screen: `AUDIT_ONLY=orders npx playwright test ui-audit`. */
const ONLY = process.env.AUDIT_ONLY ? new RegExp(process.env.AUDIT_ONLY) : null;
/** Screens already moved to the new design; the rest join as they are redesigned. */
const DONE = [/^\/orders/, /^\/dispatch\/new/];

type Problem = { rule: string; what: string };

async function audit(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const out: { rule: string; what: string }[] = [];
    const describe = (el: Element) => {
      const name = el.getAttribute("aria-label") || (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50) || (el as HTMLInputElement).placeholder || el.tagName.toLowerCase();
      return `<${el.tagName.toLowerCase()}> "${name}"`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[inert],[aria-hidden=true]");
    };

    // Overflow
    const doc = document.scrollingElement ?? document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) out.push({ rule: "overflow", what: `page is ${doc.scrollWidth}px wide` });

    // Touch targets
    for (const el of document.querySelectorAll("a[href], button, input, select, textarea, [role=button]")) {
      if (!visible(el)) continue;
      const input = el as HTMLInputElement;
      if (el.tagName === "INPUT" && (input.type === "hidden" || input.type === "file")) continue;
      const s = getComputedStyle(el);
      if (s.display === "inline" && el.tagName === "A") continue; // a link inside a sentence
      let r = el.getBoundingClientRect();
      // A checkbox or radio counts with its label around it.
      if (el.tagName === "INPUT" && (input.type === "checkbox" || input.type === "radio")) r = (el.closest("label") ?? el).getBoundingClientRect();
      // A number box inside a stepper/label counts with its label.
      if (el.tagName === "INPUT" && el.closest("label") && r.height < 47.5) r = el.closest("label")!.getBoundingClientRect();
      if (r.height < 47.5 || r.width < 47.5) out.push({ rule: "touch target < 48px", what: `${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}` });
    }

    // Text size, clipping, glued numbers
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").trim();
      const el = n.parentElement;
      if (!text || !el || seen.has(el) || !visible(el)) continue;
      if (el.closest("script,style,noscript,svg,option")) continue;
      seen.add(el);
      const s = getComputedStyle(el);
      const px = parseFloat(s.fontSize);
      if (px < 13.9) out.push({ rule: "text < 14px", what: `"${text.slice(0, 40)}" ${px}px` });
      else if (px < 15.9 && el.closest("p") && !el.closest("small,time,[data-caption]") && text.length > 40) out.push({ rule: "body text < 16px", what: `"${text.slice(0, 40)}" ${px}px` });
      if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) out.push({ rule: "text cut off", what: `"${text.slice(0, 40)}"` });
      // Cut off by a box around it (a card with rounded, hidden overflow).
      const r = el.getBoundingClientRect();
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.overflowX !== "hidden" && as.overflowX !== "clip") continue;
        const ar = a.getBoundingClientRect();
        if (r.right > ar.right + 1 || r.left < ar.left - 1) out.push({ rule: "text cut off by its box", what: `"${text.slice(0, 40)}"` });
        break;
      }
      if ((s.overflow === "hidden" || s.overflowY === "hidden") && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) out.push({ rule: "text clipped", what: `"${text.slice(0, 40)}"` });
    }
    const all = document.body.innerText;
    const glued = all.match(/[a-zऀ-ॿ]{3,}\d+|\d+(?:pcs|mtr|kg|nag|dabba|than|thaan)\b/gi);
    if (glued) for (const g of new Set(glued)) out.push({ rule: "word glued to number", what: g });
    return out;
  });
}

for (const role of ["owner", "staff"] as const) {
  test.describe(role, () => {
    test.use({ storageState: stateFile(role) });
    for (const lang of ["en", "hi"] as const) {
      test(`every screen follows the design rules at 360px (${lang})`, async ({ page, seed }) => {
        await setLanguage(page, lang);
        const report: string[] = [];
        try {
          for (const screen of SCREENS) {
            if (screen.only && !screen.only.includes(role)) continue;
            const path = screen.path(seed as Seed);
            if (ONLY && !ONLY.test(path)) continue;
            if (!ONLY && !DONE.some((r) => r.test(path))) continue;
            await page.goto(path, { waitUntil: "networkidle" });
            for (const p of await audit(page)) report.push(`${path}: ${p.rule}: ${p.what}`);
          }
        } finally {
          await setLanguage(page, "en");
        }
        expect([...new Set(report)], "design rule problems").toEqual([]);
      });
    }
  });
}

test.describe("sticky Save bar", () => {
  test.use({ storageState: stateFile("owner") });

  test("never covers the Notes field or the last field on order edit", async ({ page, seed }) => {
    await page.goto(`/orders/${seed.orderId}/edit`, { waitUntil: "networkidle" });
    const bar = page.getByRole("button", { name: "Save" }).locator("xpath=ancestor::div[contains(@class,'sticky')][1]");
    for (const field of [page.getByRole("textbox", { name: "Notes" }), page.getByRole("textbox", { name: /Reason/ })]) {
      await field.click();
      await field.fill("call before sending");
      const f = (await field.boundingBox())!;
      const b = (await bar.boundingBox())!;
      expect(f.y + f.height, "field bottom is above the Save bar").toBeLessThanOrEqual(b.y + 1);
    }
    // Scrolled to the very end, the bar sits below the page, not over it.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const last = (await page.getByRole("textbox", { name: /Reason/ }).boundingBox())!;
    const b = (await bar.boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(b.y + 1);
  });
});
