/** Writes the test coverage table (coverage/coverage-summary.json) to the job summary. */
const fs = require("node:fs");
const s = JSON.parse(fs.readFileSync("coverage/coverage-summary.json", "utf8"));
const pct = (k) => `${s.total[k].pct}%`;
const rows = Object.entries(s)
  .filter(([f]) => f !== "total")
  .map(([f, v]) => ({ f: f.replace(`${process.cwd()}/`, ""), lines: v.lines.pct }))
  .sort((a, b) => a.lines - b.lines)
  .slice(0, 15);
const md = [
  "### Test coverage",
  "",
  `Lines ${pct("lines")} · Branches ${pct("branches")} · Functions ${pct("functions")}`,
  "",
  "<details><summary>Least covered files</summary>",
  "",
  "| File | Lines |",
  "|---|---|",
  ...rows.map((r) => `| ${r.f} | ${r.lines}% |`),
  "",
  "</details>",
  "",
].join("\n");
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? "/dev/stdout", md);
