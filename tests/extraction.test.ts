import { describe, expect, it } from "vitest";
import { jaroWinkler, matchMention } from "@/extraction/matcher";
import { buildEntries, emptyDraft, type EntryContext } from "@/extraction/draft";
import { runExtraction } from "@/extraction/pipeline";
import type { Entry, EntryKind, ModelOutput } from "@/extraction/schema";
import { ExtractionError, type Catalog, type Extractor, type Transcriber } from "@/extraction/types";
import { systemPrompt } from "@/extraction/prompt";
import { RoutingExtractor } from "@/extraction/routing";

const catalog: Catalog = {
  parties: [
    { id: "p-sharma", name: "Sharma Textiles", aliases: ["Sharma", "शर्मा"] },
    { id: "p-sharda", name: "Sharda Fabrics", aliases: [] },
    { id: "p-gupta", name: "Gupta Traders", aliases: [] },
    { id: "p-singh", name: "Singh Cloth House", aliases: ["सिंह", "ਸਿੰਘ"] },
  ],
  items: [
    { id: "i-4012", name: "D-4012", unit: "pcs", aliases: ["4012"] },
    { id: "i-4013", name: "D-4013", unit: "pcs", aliases: [] },
    { id: "i-poplin", name: "Cotton Poplin", unit: "meter", aliases: ["poplin"] },
  ],
};

const NOW = new Date("2026-10-08T09:30:00Z"); // 15:00 IST
const TODAY = "2026-10-08";

const ENTRY_KEYS = ["party", "lines", "entry_date", "promised_date", "taken_by", "transport", "lr_number", "notes"] as const;

function entry(p: Partial<Entry> = {}): Entry {
  return {
    party: { as_written: "Sharma", latin: "Sharma", catalog_guess: "Sharma Textiles" },
    lines: [{ item: { as_written: "D-4012", latin: "D-4012", catalog_guess: "D-4012" }, quantity: 5, quantity_as_written: "5", unit: "piece" }],
    entry_date: { iso: null, as_written: null },
    promised_date: { iso: null, as_written: null },
    taken_by: null,
    transport: null,
    lr_number: null,
    notes: null,
    summary: "Sharma Textiles ko D-4012 ke 5 piece gaye",
    ...p,
  };
}

/** Model output with one party entry; entry fields can be given directly. */
function out(p: Partial<ModelOutput> & Partial<Entry> = {}): ModelOutput {
  const e: Partial<Entry> = {};
  const rest: Partial<ModelOutput> = {};
  for (const [k, v] of Object.entries(p)) {
    if ((ENTRY_KEYS as readonly string[]).includes(k)) (e as Record<string, unknown>)[k] = v;
    else (rest as Record<string, unknown>)[k] = v;
  }
  return {
    is_relevant: true,
    language: "hinglish",
    entries: [entry(e)],
    unreadable: [],
    summary: "Sharma Textiles ko D-4012 ke 5 piece gaye",
    summary_en: "Sent 5 pcs of D-4012 to Sharma Textiles.",
    ...rest,
  };
}

/** First entry's draft, with input-level and entry issues together (single-party cases). */
function buildDraft(kind: EntryKind, o: ModelOutput, cat: Catalog, ctx: EntryContext) {
  const r = buildEntries(kind, o, cat, ctx);
  return { draft: r.entries[0]?.draft ?? emptyDraft(kind, ctx.today, ctx.sourceText), issues: [...r.issues, ...(r.entries[0]?.issues ?? [])] };
}

describe("matcher", () => {
  it("jaro-winkler sanity", () => {
    expect(jaroWinkler("sharma", "sharma")).toBe(1);
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 2);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });

  it("auto-matches exact names and aliases, any script, ignoring case and punctuation", () => {
    for (const asWritten of ["Sharma", "SHARMA", "sharma textiles", "Sharma-Textiles.", "शर्मा"]) {
      expect(matchMention({ asWritten }, catalog.parties)).toMatchObject({ status: "matched", id: "p-sharma" });
    }
    expect(matchMention({ asWritten: "सिंह" }, catalog.parties)).toMatchObject({ status: "matched", id: "p-singh" });
    expect(matchMention({ asWritten: "ਸਿੰਘ ਜੀ" }, catalog.parties)).toMatchObject({ status: "matched", id: "p-singh" });
    expect(matchMention({ asWritten: "d 4012" }, catalog.items)).toMatchObject({ status: "matched", id: "i-4012" });
    expect(matchMention({ asWritten: "4012" }, catalog.items)).toMatchObject({ status: "matched", id: "i-4012" });
  });

  it("ignores courtesy words like M/s, ji, Shri", () => {
    for (const asWritten of ["M/s Sharma Textiles", "M/S. शर्मा", "शर्मा जी", "Sharma ji", "Shri Sharma", "श्री शर्मा जी", "Sharma wale", "शर्मा वाले"]) {
      expect(matchMention({ asWritten }, catalog.parties)).toMatchObject({ status: "matched", id: "p-sharma" });
    }
    // Mixed scripts are matched through the transliteration.
    expect(matchMention({ asWritten: "M/s शर्मा Textiles", latin: "M/s Sharma Textiles" }, catalog.parties)).toMatchObject({ status: "matched" });
    expect(matchMention({ asWritten: "ji" }, catalog.parties).status).toBe("missing");
  });

  it("uses the transliteration when the original script has no alias", () => {
    expect(matchMention({ asWritten: "गुप्ता ट्रेडर्स", latin: "Gupta Traders" }, catalog.parties)).toMatchObject({ status: "matched", id: "p-gupta" });
  });

  it("asks the user on near matches instead of guessing, with top candidates", () => {
    const r = matchMention({ asWritten: "Sharme Textile", latin: "Sharme Textile" }, catalog.parties);
    expect(r.status).toBe("choose");
    expect(r.candidates[0].id).toBe("p-sharma");
    expect(r.candidates.length).toBeLessThanOrEqual(3);
  });

  it("never auto-selects on the model's guess alone", () => {
    const r = matchMention({ asWritten: "S. T.", latin: "S T", catalogGuess: "Sharma Textiles" }, catalog.parties);
    expect(r.status).toBe("choose");
  });

  it("the model's guess raises rank between close candidates", () => {
    const r = matchMention({ asWritten: "Shar", latin: "Shar", catalogGuess: "Sharda Fabrics" }, catalog.parties);
    expect(r.status).toBe("choose");
    expect(r.candidates[0].id).toBe("p-sharda");
  });

  it("does not offer unrelated names", () => {
    expect(matchMention({ asWritten: "Ramesh Kumar" }, catalog.parties).candidates).toEqual([]);
  });

  it("offers nothing for an unknown name, so the user can create it", () => {
    const r = matchMention({ asWritten: "Patel Saree Centre", latin: "Patel Saree Centre" }, catalog.parties);
    expect(r).toMatchObject({ status: "choose", candidates: [] });
  });

  it("design numbers with different digits are not matched", () => {
    const r = matchMention({ asWritten: "D-4021" }, catalog.items);
    expect(r.status).toBe("choose");
  });

  it("reports missing", () => {
    expect(matchMention(null, catalog.parties).status).toBe("missing");
    expect(matchMention({ asWritten: " - " }, catalog.parties).status).toBe("missing");
  });
});

describe("draft building", () => {
  const ctx = { today: TODAY, now: NOW, sourceText: "Sharma ko 5 piece D-4012 gaye" };

  it("clean dispatch is ready to confirm", () => {
    const { draft, issues } = buildDraft(
      "dispatch",
      out({ taken_by: "Ramesh", transport: "VRL", lr_number: "LR-778" }),
      catalog,
      ctx,
    );
    expect(issues).toEqual([]);
    expect(draft).toMatchObject({
      party: { status: "matched", id: "p-sharma" },
      lines: [{ item: { status: "matched", id: "i-4012" }, quantity: "5", unitExpected: "pcs" }],
      entryDate: TODAY,
      entryDateStated: false,
      takenBy: "Ramesh",
      transport: "VRL",
      lrNumber: "LR-778",
      language: "hinglish",
    });
  });

  it("keeps extra details as notes without flagging them", () => {
    const { draft, issues } = buildDraft("order", out({ notes: "rate ₹1070, Secunderabad via DRTC" }), catalog, ctx);
    expect(draft.notes).toBe("rate ₹1070, Secunderabad via DRTC");
    expect(issues).toEqual([]);
  });

  it("uses the slip's date unless it's in the future; then today, with a note", () => {
    const future = buildDraft("order", out({ entry_date: { iso: "2026-10-09", as_written: "9/10" } }), catalog, ctx);
    expect(future.issues).toContainEqual(expect.objectContaining({ code: "ENTRY_DATE_FUTURE", blocking: false }));
    expect(future.draft).toMatchObject({ entryDate: ctx.today, entryDateStated: false });
    expect(future.issues.some((i) => i.blocking)).toBe(false);
    const past = buildDraft("order", out({ entry_date: { iso: "2026-10-07", as_written: "kal" } }), catalog, ctx);
    expect(past.issues).toEqual([]);
    expect(past.draft).toMatchObject({ entryDate: "2026-10-07", entryDateStated: true });
  });

  it("no date on the slip: today, or the day picked in History", () => {
    const none = buildDraft("order", out({ entry_date: { iso: null, as_written: null } }), catalog, ctx);
    expect(none.draft).toMatchObject({ entryDate: ctx.today, entryDateStated: false });
    const picked = buildDraft("order", out({ entry_date: { iso: null, as_written: null } }), catalog, { ...ctx, defaultDate: "2026-10-01" });
    expect(picked.draft.entryDate).toBe("2026-10-01");
    // A date written on the slip still wins over the picked day.
    const written = buildDraft("order", out({ entry_date: { iso: "2026-10-03", as_written: "3/10" } }), catalog, { ...ctx, defaultDate: "2026-10-01" });
    expect(written.draft.entryDate).toBe("2026-10-03");
    // A future date on the slip falls back to the picked day.
    const future = buildDraft("order", out({ entry_date: { iso: "2026-10-20", as_written: "20/10" } }), catalog, { ...ctx, defaultDate: "2026-10-01" });
    expect(future.draft.entryDate).toBe("2026-10-01");
  });

  it("keeps a future promised date on orders, ignores it on dispatches", () => {
    const o = buildDraft("order", out({ promised_date: { iso: "2026-10-15", as_written: "15 tarikh" } }), catalog, ctx);
    expect(o.draft.promisedDate).toBe("2026-10-15");
    const d = buildDraft("dispatch", out({ promised_date: { iso: "2026-10-15", as_written: "x" } }), catalog, ctx);
    expect(d.draft.promisedDate).toBeNull();
  });

  it("flags quantity problems", () => {
    const { issues } = buildDraft(
      "order",
      out({
        lines: [
          { item: { as_written: "4012", latin: "4012", catalog_guess: null }, quantity: null, quantity_as_written: "?", unit: null },
          { item: { as_written: "4013", latin: "4013", catalog_guess: null }, quantity: 1.234, quantity_as_written: "1.234", unit: null },
          { item: { as_written: "4013", latin: "4013", catalog_guess: null }, quantity: 0, quantity_as_written: "0", unit: null },
        ],
      }),
      catalog,
      ctx,
    );
    expect(issues.find((i) => i.code === "QTY_MISSING")?.line).toBe(0);
    expect(issues.filter((i) => i.code === "QTY_INVALID").map((i) => i.line)).toEqual([1, 2]);
    // "4013" is not an alias of D-4013, so the user confirms the item.
    expect(issues.filter((i) => i.code === "ITEM_UNCERTAIN").map((i) => i.line)).toEqual([1, 2]);
    expect(issues.every((i) => i.blocking)).toBe(true);
  });

  it("understands units written in Indian scripts", () => {
    const { issues } = buildDraft(
      "order",
      out({
        lines: [
          { item: { as_written: "4012", latin: "4012", catalog_guess: null }, quantity: 20, quantity_as_written: "बीस पीस", unit: "पीस" },
          { item: { as_written: "4012", latin: "4012", catalog_guess: null }, quantity: 12, quantity_as_written: "ਬਾਰਾਂ ਪੀਸ", unit: "ਪੀਸ" },
        ],
      }),
      catalog,
      ctx,
    );
    expect(issues).toEqual([]);
  });

  it("accepts decimals and unit synonyms; packing units are kept as said; other units need a person", () => {
    const ok = buildDraft(
      "order",
      out({ lines: [{ item: { as_written: "poplin", latin: "poplin", catalog_guess: null }, quantity: 12.5, quantity_as_written: "sadhe barah", unit: "mtr" }] }),
      catalog,
      ctx,
    );
    expect(ok.issues).toEqual([]);
    expect(ok.draft.lines[0]).toMatchObject({ quantity: "12.5", unit: null });
    const thaan = buildDraft(
      "order",
      out({ lines: [{ item: { as_written: "poplin", latin: "poplin", catalog_guess: null }, quantity: 3, quantity_as_written: "3 than", unit: "than" }] }),
      catalog,
      ctx,
    );
    expect(thaan.issues).toEqual([]);
    expect(thaan.draft.lines[0]).toMatchObject({ quantity: "3", unit: "thaan" });
    const kg = buildDraft(
      "order",
      out({ lines: [{ item: { as_written: "poplin", latin: "poplin", catalog_guess: null }, quantity: 3, quantity_as_written: "3 kilo", unit: "kg" }] }),
      catalog,
      ctx,
    );
    expect(kg.issues).toContainEqual(expect.objectContaining({ code: "UNIT_MISMATCH", blocking: true, line: 0 }));
  });

  it("irrelevant input gives no entries", () => {
    const r = buildEntries("order", out({ is_relevant: false, unreadable: ["second line smudged"] }), catalog, ctx);
    expect(r.entries).toEqual([]);
    expect(r.issues.map((i) => i.code)).toEqual(["NOT_RELEVANT", "UNREADABLE"]);
  });

  it("flags missing party and no lines on an entry", () => {
    const { issues } = buildDraft("order", out({ party: null, lines: [] }), catalog, ctx);
    expect(issues.map((i) => i.code).sort()).toEqual(["NO_LINES", "PARTY_MISSING"]);
    expect(issues.every((i) => i.blocking)).toBe(true);
  });
});

describe("stock reading", () => {
  it("has no party and needs none", () => {
    const r = buildEntries("stock", out({ party: null }), catalog, { today: TODAY, now: NOW, sourceText: null });
    expect(r.entries[0]).toMatchObject({ readyToConfirm: true, draft: { party: { status: "missing" } } });
    expect(systemPrompt("stock", catalog)).toContain("There is no party");
  });
});

describe("several parties in one input", () => {
  const ctx = { today: TODAY, now: NOW, sourceText: "..." };
  const line = (code: string, quantity: number) => ({ item: { as_written: code, latin: code, catalog_guess: null }, quantity, quantity_as_written: String(quantity), unit: null });

  it("gives one draft per party, each confirmable on its own", () => {
    const r = buildEntries(
      "order",
      out({
        entries: [
          entry({ party: { as_written: "Sharma", latin: "Sharma", catalog_guess: null }, lines: [line("4012", 5), line("4013", 2)] }),
          entry({ party: { as_written: "Patel Saree", latin: "Patel Saree", catalog_guess: null }, lines: [line("4012", 3)], notes: "rate 1070" }),
        ],
      }),
      catalog,
      ctx,
    );
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({ readyToConfirm: false, draft: { party: { id: "p-sharma" } } }); // 4013 not an alias → pick
    expect(r.entries[0].draft.lines.map((l) => l.quantity)).toEqual(["5", "2"]);
    expect(r.entries[1]).toMatchObject({ readyToConfirm: false, draft: { party: { status: "choose" }, notes: "rate 1070" } });
    expect(r.entries[1].issues.map((i) => i.code)).toEqual(["PARTY_UNCERTAIN"]);
  });

  it("merges two entries for the same party into one, keeping line issues pointed at the right line", () => {
    const r = buildEntries(
      "order",
      out({
        entries: [
          entry({ lines: [line("4012", 5)], notes: "urgent" }),
          entry({ party: { as_written: "शर्मा जी", latin: "Sharma ji", catalog_guess: null }, lines: [line("4013", 2), line("poplin", 1.234)], notes: "rate 900" }),
        ],
      }),
      catalog,
      ctx,
    );
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0];
    expect(e.draft.lines.map((l) => l.item.mention)).toEqual(["4012", "4013", "poplin"]);
    expect(e.draft.notes).toBe("urgent; rate 900");
    expect(e.issues.map((i) => [i.code, i.line])).toEqual([
      ["ITEM_UNCERTAIN", 1],
      ["QTY_INVALID", 2],
    ]);
  });

  it("does not merge the same party across different dates", () => {
    const r = buildEntries(
      "order",
      out({ entries: [entry({}), entry({ entry_date: { iso: "2026-10-07", as_written: "kal" } })] }),
      catalog,
      ctx,
    );
    expect(r.entries).toHaveLength(2);
  });

  it("does not merge unmatched names that look alike; a person decides", () => {
    const p = { as_written: "Patel", latin: "Patel", catalog_guess: null };
    const r = buildEntries("order", out({ entries: [entry({ party: p }), entry({ party: p })] }), catalog, ctx);
    expect(r.entries).toHaveLength(2);
  });
});

describe("pipeline", () => {
  const fakeExtractor = (fn: Extractor["extract"]): Extractor => ({ extract: fn });
  const okTranscriber: Transcriber = { transcribe: async () => ({ text: "Sharma ko paanch piece 4012 gaye", languageCode: "hi-IN" }) };
  const neverTranscriber: Transcriber = { transcribe: () => new Promise(() => {}) };
  const base = { kind: "dispatch" as const, catalog };

  it("text → draft, ready to confirm", async () => {
    let seen: string | null | undefined;
    const r = await runExtraction(
      {
        extractor: fakeExtractor(async (req) => {
          seen = req.text;
          expect(req.today).toBe(TODAY);
          expect(req.weekday).toBe("Thursday");
          return out();
        }),
        transcriber: neverTranscriber,
        now: () => NOW,
      },
      { ...base, text: "  Sharma ko 5 piece D-4012 gaye " },
    );
    expect(seen).toBe("Sharma ko 5 piece D-4012 gaye");
    expect(r).toMatchObject({ ok: true, summaryEn: "Sent 5 pcs of D-4012 to Sharma Textiles.", sourceText: "Sharma ko 5 piece D-4012 gaye", entries: [{ readyToConfirm: true, draft: { sourceText: "Sharma ko 5 piece D-4012 gaye" } }] });
  });

  it("voice → transcript → extraction, with catalog names as key terms", async () => {
    let keyterms: string[] = [];
    let fromVoice = false;
    const r = await runExtraction(
      {
        extractor: fakeExtractor(async (req) => {
          fromVoice = req.fromVoice;
          return out();
        }),
        transcriber: {
          transcribe: async (_a, o) => {
            keyterms = o.keyterms ?? [];
            return okTranscriber.transcribe(_a, o);
          },
        },
        now: () => NOW,
      },
      { ...base, audio: { data: Buffer.from("x"), mimeType: "audio/webm" } },
    );
    expect(fromVoice).toBe(true);
    expect(keyterms).toEqual(expect.arrayContaining(["Sharma Textiles", "शर्मा", "D-4012", "poplin"]));
    expect(r.ok && r.sourceText).toBe("Sharma ko paanch piece 4012 gaye");
  });

  it("times out into the manual form, keeping what was captured", async () => {
    const r = await runExtraction(
      { extractor: fakeExtractor(() => new Promise(() => {})), transcriber: okTranscriber, timeoutMs: 50, now: () => NOW },
      { ...base, text: "Sharma 5 piece" },
    );
    expect(r).toMatchObject({ ok: false, reason: "timeout", draft: { kind: "dispatch", sourceText: "Sharma 5 piece", entryDate: TODAY, lines: [] } });
  });

  it("voice transcription hanging also times out (and keeps typed text)", async () => {
    const r = await runExtraction(
      { extractor: fakeExtractor(async () => out()), transcriber: neverTranscriber, timeoutMs: 50, now: () => NOW },
      { ...base, text: "note", audio: { data: Buffer.from("x"), mimeType: "audio/webm" } },
    );
    expect(r).toMatchObject({ ok: false, reason: "timeout", draft: { sourceText: "note" } });
  });

  it("empty transcript falls back with transcription_failed", async () => {
    const r = await runExtraction(
      { extractor: fakeExtractor(async () => out()), transcriber: { transcribe: async () => ({ text: "  ", languageCode: null }) }, now: () => NOW },
      { ...base, audio: { data: Buffer.from("x"), mimeType: "audio/webm" } },
    );
    expect(r).toMatchObject({ ok: false, reason: "transcription_failed" });
  });

  it("model errors, refusals and missing config fall back to the manual form", async () => {
    for (const reason of ["error", "refused", "not_configured"] as const) {
      const r = await runExtraction(
        { extractor: fakeExtractor(async () => { throw new ExtractionError(reason, reason); }), transcriber: okTranscriber, now: () => NOW },
        { ...base, text: "x" },
      );
      expect(r).toMatchObject({ ok: false, reason, draft: { sourceText: "x" } });
    }
    const crash = await runExtraction(
      { extractor: fakeExtractor(async () => { throw new TypeError("boom"); }), transcriber: okTranscriber, now: () => NOW },
      { ...base, text: "x" },
    );
    expect(crash).toMatchObject({ ok: false, reason: "error" });
  });

  it("rejects bad inputs without calling the model", async () => {
    let called = false;
    const deps = { extractor: fakeExtractor(async () => { called = true; return out(); }), transcriber: okTranscriber, now: () => NOW };
    expect(await runExtraction(deps, { ...base })).toMatchObject({ ok: false, reason: "empty_input" });
    expect(await runExtraction(deps, { ...base, image: { data: Buffer.from("x"), mimeType: "image/heic" } })).toMatchObject({ ok: false, reason: "error" });
    expect(await runExtraction(deps, { ...base, image: { data: Buffer.alloc(7_000_001), mimeType: "image/jpeg" } })).toMatchObject({ ok: false, reason: "error" });
    expect(called).toBe(false);
  });

  it("passes the photo through to the extractor", async () => {
    let gotImage = false;
    await runExtraction(
      { extractor: fakeExtractor(async (req) => { gotImage = req.image?.mimeType === "image/jpeg"; return out(); }), transcriber: okTranscriber, now: () => NOW },
      { ...base, image: { data: Buffer.from([0xff, 0xd8]), mimeType: "image/jpeg" } },
    );
    expect(gotImage).toBe(true);
  });
});

describe("prompt", () => {
  it("lists the catalog with units and aliases and has no per-request data (cacheable)", () => {
    const p = systemPrompt("dispatch", catalog);
    expect(p).toContain("- Sharma Textiles (also: Sharma, शर्मा)");
    expect(p).toContain("- Cotton Poplin [meter] (also: poplin)");
    expect(p).not.toMatch(/2026/);
    expect(systemPrompt("dispatch", catalog)).toBe(p);
  });
});

describe("model routing", () => {
  const req = (p: Partial<import("@/extraction/types").ExtractorRequest> = {}) => ({
    kind: "order" as const,
    catalog,
    text: "x",
    fromVoice: false,
    today: TODAY,
    weekday: "Thursday",
    ...p,
  });
  const signal = new AbortController().signal;

  function setup(simpleOut: () => Promise<ModelOutput>) {
    const calls: string[] = [];
    const routes: string[] = [];
    const simple: Extractor = { extract: async () => (calls.push("simple"), simpleOut()) };
    const complex: Extractor = { extract: async () => (calls.push("complex"), out({ summary: "from complex" })) };
    return { calls, routes, r: new RoutingExtractor(simple, complex, (x) => routes.push(x)) };
  }

  it("typed text and voice go to the simple model", async () => {
    const { calls, routes, r } = setup(async () => out());
    await r.extract(req(), signal);
    await r.extract(req({ fromVoice: true }), signal);
    expect(calls).toEqual(["simple", "simple"]);
    expect(routes).toEqual(["simple", "simple"]);
  });

  it("photos go straight to the complex model", async () => {
    const { calls, routes, r } = setup(async () => out());
    await r.extract(req({ image: { data: Buffer.from("x"), mimeType: "image/jpeg" } }), signal);
    expect(calls).toEqual(["complex"]);
    expect(routes).toEqual(["complex"]);
  });

  it("escalates when the simple model can't read part of it, misses a quantity, or finds no lines", async () => {
    for (const bad of [
      out({ unreadable: ["second line"] }),
      out({ lines: [{ item: { as_written: "4012", latin: "4012", catalog_guess: null }, quantity: null, quantity_as_written: null, unit: null }] }),
      out({ lines: [] }),
    ]) {
      const { calls, routes, r } = setup(async () => bad);
      const result = await r.extract(req(), signal);
      expect(calls).toEqual(["simple", "complex"]);
      expect(routes).toEqual(["escalated"]);
      expect(result.summary).toBe("from complex");
    }
  });

  it("does not escalate an irrelevant message or a merely unknown party", async () => {
    for (const fine of [out({ is_relevant: false, lines: [] }), out({ party: null })]) {
      const { calls, routes, r } = setup(async () => fine);
      await r.extract(req(), signal);
      expect(calls).toEqual(["simple"]);
      expect(routes).toEqual(["simple"]);
    }
  });

  it("escalates when the simple model errors or refuses, but not on timeout or missing config", async () => {
    for (const reason of ["error", "refused"] as const) {
      const { calls, routes, r } = setup(async () => {
        throw new ExtractionError(reason, reason);
      });
      await r.extract(req(), signal);
      expect(calls).toEqual(["simple", "complex"]);
      expect(routes).toEqual(["escalated"]);
    }
    for (const reason of ["timeout", "not_configured"] as const) {
      const { calls, r } = setup(async () => {
        throw new ExtractionError(reason, reason);
      });
      await expect(r.extract(req(), signal)).rejects.toMatchObject({ reason });
      expect(calls).toEqual(["simple"]);
    }
  });
});

describe("packing units", () => {
  it("nag is its own unit, saved as said (no conversion, no issue)", () => {
    const { draft, issues } = buildDraft(
      "order",
      out({ lines: [{ item: { as_written: "4012", latin: "4012", catalog_guess: null }, quantity: 2, quantity_as_written: "2 नग", unit: "नग" }] }),
      catalog,
      { today: TODAY, now: NOW, sourceText: null },
    );
    expect(issues).toEqual([]);
    expect(draft.lines[0]).toMatchObject({ quantity: "2", unit: "nag" });
  });
});

describe("unit dropdown preset", async () => {
  const { formFromDraft, unitForPick } = await import("@/components/entry/form-state");
  const { unitChoices, storedUnit } = await import("@/lib/units");
  it("'1 dabba' of a pcs item opens with 1 and dabba selected", () => {
    const { draft } = buildDraft(
      "order",
      out({ lines: [{ item: { as_written: "4012", latin: "4012", catalog_guess: null }, quantity: 1, quantity_as_written: "1 dabba", unit: "dabba" }] }),
      catalog,
      { today: TODAY, now: NOW, sourceText: null },
    );
    expect(formFromDraft(draft).lines[0]).toMatchObject({ itemId: "i-4012", quantity: "1", unit: "dabba" });
  });
  it("offers the item's unit first, then packing units; stores null for the item's own unit", () => {
    expect(unitChoices("pcs").map((c) => c.label)).toEqual(["pcs", "nag", "dabba", "bora", "thaan"]);
    expect(unitChoices("dabba").map((c) => c.value)).toEqual([null, "nag", "bora", "thaan"]);
    expect(storedUnit("pcs", "pcs")).toBeNull();
    expect(storedUnit("डिब्बा", "pcs")).toBe("dabba");
    expect(storedUnit("kg", "pcs")).toBeUndefined();
    expect(unitForPick("bore", "pcs")).toBe("bora");
    expect(unitForPick("kg", "pcs")).toBeNull();
  });
});
