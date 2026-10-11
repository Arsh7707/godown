/**
 * Calls the real Claude API. Skipped unless ANTHROPIC_API_KEY and the
 * EXTRACTION_MODEL_* settings are set. Run with: npm run test:live
 */
import { describe, expect, it } from "vitest";
import { defaultDeps } from "@/extraction";
import { runExtraction } from "@/extraction/pipeline";
import type { Catalog, Transcriber } from "@/extraction/types";

const live = !!process.env.ANTHROPIC_API_KEY && !!process.env.EXTRACTION_MODEL_SIMPLE && !!process.env.EXTRACTION_MODEL_COMPLEX;

const catalog: Catalog = {
  parties: [
    { id: "p-sharma", name: "Sharma Textiles", aliases: ["Sharma", "शर्मा"] },
    { id: "p-gupta", name: "Gupta Traders", aliases: [] },
  ],
  items: [
    { id: "i-4012", name: "D-4012", unit: "pcs", aliases: ["4012"] },
    { id: "i-poplin", name: "Cotton Poplin", unit: "meter", aliases: ["poplin"] },
  ],
};
const noVoice: Transcriber = { transcribe: async () => ({ text: "", languageCode: null }) };
const deps = { ...defaultDeps(), transcriber: noVoice, timeoutMs: 60_000, now: () => new Date("2026-10-08T06:30:00Z") };

describe.skipIf(!live)("live Claude extraction", () => {
  it("reads a terse Hinglish dispatch", async () => {
    const r = await runExtraction(deps, { kind: "dispatch", catalog, text: "Sharma ko 5 piece D-4012 gaye, Ramesh le gaya, VRL se, LR 778" });
    if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
    expect(r.entries[0].draft.party).toMatchObject({ status: "matched", id: "p-sharma" });
    expect(r.entries[0].draft.lines).toHaveLength(1);
    expect(r.entries[0].draft.lines[0]).toMatchObject({ item: { status: "matched", id: "i-4012" }, quantity: "5" });
    expect(r.entries[0].draft).toMatchObject({ takenBy: expect.stringMatching(/ramesh/i), transport: expect.stringMatching(/vrl/i), lrNumber: expect.stringContaining("778") });
    expect(r.entries[0].readyToConfirm).toBe(true);
  });

  it("resolves 'kal' as yesterday for an order date and a promised date in days", async () => {
    const r = await runExtraction(deps, { kind: "order", catalog, text: "kal gupta traders ne 50 meter poplin ka order diya, 5 din mein dena hai" });
    if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
    expect(r.entries[0].draft).toMatchObject({ entryDate: "2026-10-07", promisedDate: "2026-10-13" });
    expect(r.entries[0].draft.lines[0]).toMatchObject({ item: { id: "i-poplin" }, quantity: "50" });
  });

  it("does not invent a party it was not given", async () => {
    const r = await runExtraction(deps, { kind: "order", catalog, text: "20 piece 4012 bhejna hai" });
    if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].draft.party.status).toBe("missing");
    expect(r.entries[0].readyToConfirm).toBe(false);
  });

  it("splits two parties into two entries and keeps one party's items together", async () => {
    const r = await runExtraction(deps, {
      kind: "order",
      catalog,
      text: "Sharma ka order 20 piece 4012 aur 10 meter poplin. Gupta Traders ko 50 meter poplin chahiye.",
    });
    if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
    expect(r.entries.map((e) => e.draft.party.status === "matched" && e.draft.party.id)).toEqual(["p-sharma", "p-gupta"]);
    expect(r.entries[0].draft.lines.map((l) => [l.item.status === "matched" && l.item.id, l.quantity])).toEqual([
      ["i-4012", "20"],
      ["i-poplin", "10"],
    ]);
    expect(r.entries[1].draft.lines.map((l) => l.quantity)).toEqual(["50"]);
  });
});
