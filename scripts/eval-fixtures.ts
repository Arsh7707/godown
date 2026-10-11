/**
 * Runs every case in fixtures/ through the real extraction pipeline and
 * grades it against <case>.expected.json. Usage: npm run eval:fixtures [filter]
 * Spends real API credits (one Claude call per case, plus Sarvam for voice).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { defaultDeps, runExtraction, type Route } from "@/extraction";
import type { Catalog, Draft, ExtractionResult } from "@/extraction/types";
import type { MatchResult } from "@/extraction/matcher";
import { normalizeName } from "@/lib/normalize";
import { toCenti } from "@/lib/qty";

const DIR = "fixtures";
const IMAGE: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const AUDIO: Record<string, string> = {
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".aac": "audio/aac",
  ".amr": "audio/amr",
};

interface ExpectedEntry {
  party?: string;
  lines?: { item: string; quantity: string }[];
  entryDate?: string | null;
  promisedDate?: string | null;
  takenBy?: string | null;
  transport?: string | null;
  lrNumber?: string | null;
}

/** Either one entry's fields at the top level, or `entries` for inputs with several parties. */
interface Expected extends ExpectedEntry {
  kind?: "order" | "dispatch";
  today?: string;
  entries?: ExpectedEntry[];
}

type Grade = "auto" | "pick" | "wrong" | "ok" | "miss";

function loadCatalog(): Catalog {
  const file = existsSync(path.join(DIR, "catalog.json")) ? "catalog.json" : "catalog.example.json";
  const raw = JSON.parse(readFileSync(path.join(DIR, file), "utf8")) as {
    parties: { name: string; aliases?: string[] }[];
    items: { name: string; unit: string; aliases?: string[] }[];
  };
  console.log(`Catalog: ${file} (${raw.parties.length} parties, ${raw.items.length} items)`);
  return {
    parties: raw.parties.map((p) => ({ id: p.name, name: p.name, aliases: p.aliases ?? [] })),
    items: raw.items.map((i) => ({ id: i.name, name: i.name, unit: i.unit, aliases: i.aliases ?? [] })),
  };
}

/** auto = matched automatically and correct; pick = correct answer is among the choices; wrong / miss otherwise. */
function gradeMatch(m: MatchResult, expected: string): Grade {
  if (m.status === "matched") return m.name === expected ? "auto" : "wrong";
  return m.candidates.some((c) => c.name === expected) ? "pick" : "miss";
}

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  normalizeName(a ?? "") === normalizeName(b ?? "") || (!!a && !!b && normalizeName(a).includes(normalizeName(b)));

function gradeEntry(d: Draft, exp: ExpectedEntry, p: string, g: Record<string, Grade>) {
  if (exp.party !== undefined) g[`${p}party`] = gradeMatch(d.party, exp.party);
  if (exp.lines) {
    exp.lines.forEach((el, i) => {
      const line = d.lines.find((l) => l.item.status === "matched" && l.item.name === el.item) ?? d.lines[i];
      g[`${p}item${i + 1}`] = line ? gradeMatch(line.item, el.item) : "miss";
      g[`${p}qty${i + 1}`] = line?.quantity && toCenti(line.quantity) === toCenti(el.quantity) ? "ok" : "wrong";
    });
    if (d.lines.length !== exp.lines.length) g[`${p}lineCount`] = "wrong";
  }
  if (exp.entryDate !== undefined) g[`${p}entryDate`] = (d.entryDateStated ? d.entryDate : null) === exp.entryDate ? "ok" : "wrong";
  if (exp.promisedDate !== undefined) g[`${p}promisedDate`] = d.promisedDate === exp.promisedDate ? "ok" : "wrong";
  for (const k of ["takenBy", "transport", "lrNumber"] as const) {
    if (exp[k] !== undefined) g[`${p}${k}`] = (exp[k] === null ? d[k] === null : sameText(d[k], exp[k])) ? "ok" : "wrong";
  }
}

function grade(r: ExtractionResult, exp: Expected) {
  const g: Record<string, Grade> = {};
  if (!r.ok) return { failed: `${r.reason}: ${r.message}`, g };
  const expEntries = exp.entries ?? (exp.party !== undefined || exp.lines ? [exp] : []);
  if (expEntries.length && r.entries.length !== expEntries.length) g.entryCount = "wrong";
  expEntries.forEach((ee, i) => {
    // Pair by party name when the app matched it, else by position.
    const actual = r.entries.find((e) => e.draft.party.status === "matched" && e.draft.party.name === ee.party) ?? r.entries[i];
    const p = expEntries.length > 1 ? `e${i + 1}.` : "";
    if (!actual) g[`${p}party`] = "miss";
    else gradeEntry(actual.draft, ee, p, g);
  });
  return { failed: null, g };
}

async function main() {
  const filter = process.argv[2];
  const catalog = loadCatalog();
  const files = readdirSync(DIR).filter(
    (f) => !f.endsWith(".json") && !f.endsWith(".md") && !f.startsWith(".") && (IMAGE[path.extname(f).toLowerCase()] || AUDIO[path.extname(f).toLowerCase()] || f.endsWith(".txt")),
  );
  const cases = files.filter((f) => !filter || f.includes(filter)).sort();
  if (!cases.length) return console.log("No cases found in fixtures/. See fixtures/README.md.");

  // $ per million tokens: [input, output]. Cache reads are billed at 0.1x input, cache writes at 1.25x.
  const PRICES: Record<string, [number, number]> = {
    "claude-opus-5-5": [4, 20],
    "claude-sonnet-5-5": [2, 10],
    "claude-haiku-4-5": [1, 5],
  };
  let cost = 0;
  let lastCost = 0;
  let route: Route | null = null;
  const models: string[] = [];
  const deps = defaultDeps({
    onUsage: (u, model) => {
      const [i, o] = PRICES[model] ?? [NaN, NaN];
      const c =
        (u.input_tokens * i + (u.cache_creation_input_tokens ?? 0) * i * 1.25 + (u.cache_read_input_tokens ?? 0) * i * 0.1 + u.output_tokens * o) / 1e6;
      lastCost += c;
      cost += c;
      models.push(model.replace("claude-", ""));
    },
    onRoute: (r) => (route = r),
  });
  console.log(
    `Simple: ${process.env.EXTRACTION_MODEL_SIMPLE} (${process.env.EXTRACTION_EFFORT_SIMPLE || "default effort"})  Complex: ${process.env.EXTRACTION_MODEL_COMPLEX} (${process.env.EXTRACTION_EFFORT_COMPLEX || "default effort"})`,
  );
  const results: unknown[] = [];
  const names: Record<Grade, number> = { auto: 0, pick: 0, wrong: 0, ok: 0, miss: 0 };
  const fields = { ok: 0, wrong: 0 };
  const isName = (k: string) => /(^|\.)(party|item\d+)$/.test(k);
  let failures = 0;

  for (const f of cases) {
    const base = f.slice(0, -path.extname(f).length);
    const expFile = path.join(DIR, `${base}.expected.json`);
    const exp: Expected = existsSync(expFile) ? JSON.parse(readFileSync(expFile, "utf8")) : {};
    const kind = exp.kind ?? (base.includes("dispatch") ? "dispatch" : base.includes("order") ? "order" : null);
    if (!kind) {
      console.log(`SKIP ${f}: name it order-… / dispatch-… or set "kind"`);
      continue;
    }
    const ext = path.extname(f).toLowerCase();
    const data = readFileSync(path.join(DIR, f));
    const input = IMAGE[ext]
      ? { image: { data, mimeType: IMAGE[ext] } }
      : AUDIO[ext]
        ? { audio: { data, mimeType: AUDIO[ext] } }
        : { text: data.toString("utf8") };
    // Noon IST on the pinned day, so relative dates resolve the same every run.
    const now = exp.today ? new Date(`${exp.today}T06:30:00Z`) : undefined;

    lastCost = 0;
    route = null;
    models.length = 0;
    const r = await runExtraction({ ...deps, now: now ? () => now : undefined }, { kind, catalog, ...input });
    const { failed, g } = grade(r, exp);
    if (failed) failures++;
    if (!r.ok && AUDIO[ext] && r.draft.sourceText) console.log(`       heard:   ${r.draft.sourceText}`);
    for (const [k, v] of Object.entries(g)) {
      if (isName(k)) names[v]++;
      else if (v === "ok") fields.ok++;
      else fields.wrong++;
    }
    const marks = Object.entries(g)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    console.log(`${failed ? "FAIL" : "    "} ${f.padEnd(40)} ${(r.durationMs / 1000).toFixed(1)}s  $${lastCost.toFixed(4)}  ${(route ?? "-").padEnd(9)} ${models.join("+").padEnd(18)} ${failed ?? marks}`);
    if (r.ok) {
      if (AUDIO[ext]) console.log(`       heard:   ${r.sourceText}`);
      console.log(`       summary: ${r.summary ?? "-"}`);
      console.log(`       english: ${r.summaryEn ?? "-"}`);
      const fmt = (is: { code: string; detail?: string; line?: number }[]) =>
        is.map((i) => i.code + (i.line !== undefined ? `#${i.line + 1}` : "") + (i.detail ? `(${i.detail})` : "")).join(", ");
      if (r.issues.length) console.log(`       input issues: ${fmt(r.issues)}`);
      r.entries.forEach((e, i) => {
        const party = e.draft.party.status === "matched" ? e.draft.party.name : `${e.draft.party.mention ?? "?"} (?)`;
        const lines = e.draft.lines
          .map((l) => `${l.item.status === "matched" ? l.item.name : `${l.item.mention} (?)`} ${l.quantity ?? "?"}${l.unitSaid ? " " + l.unitSaid : ""}`)
          .join(", ");
        console.log(`       [${i + 1}] ${party}: ${lines}${e.draft.notes ? `  | notes: ${e.draft.notes}` : ""}${e.issues.length ? `  | ${fmt(e.issues)}` : ""}`);
      });
    }
    results.push({ case: f, expected: exp, result: r, grade: g });
  }

  console.log(
    `\n${cases.length} cases, ${failures} failed to extract. Names: ${names.auto} auto-matched, ${names.pick} in choices, ${names.miss} not offered, ${names.wrong} WRONG. Fields: ${fields.ok} ok, ${fields.wrong} wrong.`,
  );
  console.log(`API cost this run: $${cost.toFixed(4)}`);
  console.log("(A WRONG name means an automatic match picked the wrong entry: that should never happen.)");
  mkdirSync(path.join(DIR, "results"), { recursive: true });
  const out = path.join(DIR, "results", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`Full results: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
