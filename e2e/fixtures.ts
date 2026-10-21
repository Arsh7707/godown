/**
 * Every browser test gets a watchdog: any page crash, console error or
 * failed server response fails the test, even if the screen looked fine.
 */
import { readFileSync } from "node:fs";
import { test as base, expect, type Page } from "@playwright/test";
import { SEED_FILE, type RoleName } from "./env";

export type Seed = {
  companyId: string;
  fabricsId: string;
  sharma: string;
  gupta: string;
  d4012: string;
  cotton: string;
  rayon: string;
  probe: string;
  orderId: string;
  dispatchId: string;
  looseDispatchId: string;
};

export const stateFile = (role: RoleName) => `e2e/.state/${role}.json`;

/**
 * Noise that is not a bug: a deliberate 4xx, the offline test cutting the
 * network, and Safari reporting the background preloads of the next screens
 * (`?_rsc=`) as failed when the test moves on before they finish.
 */
const IGNORED = [/Failed to load resource: the server responded with a status of 4\d\d/, /net::ERR_INTERNET_DISCONNECTED/, /Download the React DevTools/, /_rsc=.* due to access control checks/];

export const test = base.extend<{ seed: Seed; problems: string[] }>({
  seed: async ({}, provide) => provide(JSON.parse(readFileSync(SEED_FILE, "utf8"))),
  problems: [
    async ({ page }, provide) => {
      const problems: string[] = [];
      page.on("pageerror", (e) => {
        if (!IGNORED.some((r) => r.test(e.message))) problems.push(`page crashed on ${new URL(page.url()).pathname}: ${e.message.slice(0, 300)}`);
      });
      page.on("console", (m) => {
        if (m.type() === "error" && !IGNORED.some((r) => r.test(m.text()))) problems.push(`console error: ${m.text()}`);
      });
      page.on("response", (r) => {
        if (r.status() >= 500) problems.push(`server error ${r.status()} on ${r.request().method()} ${new URL(r.url()).pathname}`);
      });
      await provide(problems);
      expect(problems, "the page reported problems").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Text that means a number or label went wrong somewhere. */
const BROKEN_TEXT = /\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b|Invalid Date|\bnull\b/;

/** The screen fits the phone, shows no broken values, and has a heading or main content. */
export async function expectHealthy(page: Page, where = page.url()) {
  const text = await page.locator("body").innerText();
  const bad = text.match(BROKEN_TEXT);
  expect(bad?.[0] ?? null, `broken value on ${where}: …${bad ? text.slice(Math.max(0, bad.index! - 60), bad.index! + 40) : ""}…`).toBeNull();
  const overflow = await page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    if (doc.scrollWidth <= window.innerWidth + 1) return null;
    // Name the widest element so the report says what to fix.
    let worst: Element | null = null;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 1 && (!worst || r.width > worst.getBoundingClientRect().width)) worst = el;
    }
    return { width: doc.scrollWidth, screen: window.innerWidth, element: worst ? `${worst.tagName.toLowerCase()}.${String(worst.className).slice(0, 80)}: ${(worst.textContent ?? "").slice(0, 60)}` : "?" };
  });
  expect(overflow, `page wider than the phone on ${where}`).toBeNull();
  expect(text.trim().length, `empty screen on ${where}`).toBeGreaterThan(0);
}

/** Switch the logged-in user's language (saved on the user, so it sticks across tests until changed back). */
export async function setLanguage(page: Page, language: "en" | "hi") {
  const r = await page.request.post("/api/me/language", { data: { language } });
  expect(r.ok()).toBeTruthy();
}
