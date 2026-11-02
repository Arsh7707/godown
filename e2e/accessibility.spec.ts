/**
 * Accessibility on every main screen (axe-core): buttons and fields have
 * names, text is readable against its background, the page has a language,
 * nothing blocks zooming. Serious and critical problems fail the test,
 * text contrast below 4.5:1 included. Minor findings are listed in the
 * report (and the job summary).
 */
import AxeBuilder from "@axe-core/playwright";
import { test, expect, stateFile } from "./fixtures";

const SCREENS = ["/", "/orders", "/order/new", "/dispatch/new", "/pending", "/dispatches", "/stock", "/stock/in", "/unmatched", "/history", "/reports", "/activity", "/manage", "/manage/items", "/manage/clients", "/firms", "/inbox"];

test.use({ storageState: stateFile("owner") });

test("main screens have no serious accessibility problems", async ({ page }, info) => {
  const found: string[] = [];
  const report: string[] = [];
  for (const path of [...SCREENS, "/login"]) {
    if (path === "/login") await page.context().clearCookies();
    await page.goto(path, { waitUntil: "networkidle" });
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    for (const v of violations) {
      const line = `${path}: [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}×) e.g. ${v.nodes[0]?.target.join(" ")}`;
      const blocking = v.impact === "serious" || v.impact === "critical";
      if (blocking) found.push(line);
      else report.push(line);
    }
  }
  if (report.length) await info.attach("accessibility-to-improve.txt", { body: report.join("\n"), contentType: "text/plain" });
  if (process.env.GITHUB_STEP_SUMMARY && report.length) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Accessibility: minor findings\n\n${report.map((r) => `- ${r}`).join("\n")}\n`);
  }
  expect(found, found.join("\n")).toEqual([]);
});
