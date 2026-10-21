/** Mutation score and the planted bugs the tests missed, in the job summary. */
const fs = require("node:fs");
const r = JSON.parse(fs.readFileSync("reports/mutation/mutation.json", "utf8"));
const rows = [];
const missed = [];
for (const [file, f] of Object.entries(r.files)) {
  const count = (s) => f.mutants.filter((m) => s.includes(m.status)).length;
  const killed = count(["Killed", "Timeout"]);
  const survived = count(["Survived", "NoCoverage"]);
  rows.push(`| ${file} | ${killed + survived ? Math.round((100 * killed) / (killed + survived)) : 100}% | ${survived} |`);
  for (const m of f.mutants.filter((x) => x.status === "Survived" || x.status === "NoCoverage").slice(0, 8)) {
    missed.push(`- \`${file}:${m.location.start.line}\` ${m.mutatorName}${m.replacement ? `: \`${String(m.replacement).slice(0, 60)}\`` : ""}`);
  }
}
const md = ["### Test strength (mutation score)", "", "| File | Caught | Missed |", "|---|---|---|", ...rows, "", "<details><summary>Planted bugs the tests did not catch (first few per file)</summary>", "", ...missed, "", "</details>", ""].join("\n");
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? "/dev/stdout", md);
