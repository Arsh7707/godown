import { describe, expect, it } from "vitest";
import { buildProposal, interpretChange, type ChangeOutput, type CurrentOrder } from "@/extraction/change";
import { ExtractionError, type Catalog } from "@/extraction/types";

const catalog: Catalog = {
  parties: [],
  items: [
    { id: "i-crown", name: "Crown", unit: "pcs", aliases: ["ਕਰਾਊਨ"] },
    { id: "i-vistara", name: "Vistara", unit: "pcs", aliases: [] },
    { id: "i-morico", name: "Morico", unit: "pcs", aliases: [] },
  ],
};
const order: CurrentOrder = {
  partyName: "Veer Sudarshan Brothers",
  orderDate: "2026-10-08",
  promisedDate: null,
  lines: [
    { orderLineId: "ol-crown", itemId: "i-crown", itemName: "Crown", unit: "pcs", ordered: 2000, sent: 500 },
    { orderLineId: "ol-morico", itemId: "i-morico", itemName: "Morico", unit: "pcs", ordered: 1000, sent: 0 },
  ],
};
const name = (n: string) => ({ as_written: n, latin: n, catalog_guess: null });
const out = (p: Partial<ChangeOutput>): ChangeOutput => ({
  understood: true,
  cancel_remaining: false,
  lines: [
    { item: name("Crown"), quantity: 20, unit: null },
    { item: name("Morico"), quantity: 10, unit: null },
  ],
  promised_date: { action: "keep", iso: null },
  note: null,
  unreadable: [],
  summary: "x",
  ...p,
});

describe("order change proposal", () => {
  it("keeps line identity, applies new quantities, adds new items, lists the changes", () => {
    const p = buildProposal(out({ lines: [{ item: name("Crown"), quantity: 25, unit: null }, { item: name("Morico"), quantity: 10, unit: null }, { item: name("Vistara"), quantity: 5, unit: null }] }), order, catalog, "20 ki jagah 25, aur 5 Vistara");
    expect(p.lines).toEqual([
      expect.objectContaining({ orderLineId: "ol-crown", itemId: "i-crown", quantity: "25" }),
      expect.objectContaining({ orderLineId: "ol-morico", itemId: "i-morico", quantity: "10" }),
      expect.objectContaining({ orderLineId: undefined, itemId: "i-vistara", quantity: "5" }),
    ]);
    expect(p.changes).toEqual([
      { itemName: "Crown", before: "20 pcs", after: "25 pcs" },
      { itemName: "Vistara", before: null, after: "5 pcs" },
    ]);
  });

  it("removing an item drops its line and shows it as removed", () => {
    const p = buildProposal(out({ lines: [{ item: name("Crown"), quantity: 20, unit: null }] }), order, catalog, "Morico hata do");
    expect(p.lines.map((l) => l.orderLineId)).toEqual(["ol-crown"]);
    expect(p.changes).toEqual([{ itemName: "Morico", before: "10 pcs", after: null }]);
  });

  it("an unknown new item is left for the user to pick, never guessed", () => {
    const p = buildProposal(out({ lines: [...out({}).lines, { item: name("Famous Gold"), quantity: 2, unit: null }] }), order, catalog, "...");
    expect(p.lines[2]).toMatchObject({ itemId: null, mention: "Famous Gold" });
  });

  it("promised date: keep, set and clear", () => {
    expect(buildProposal(out({}), { ...order, promisedDate: "2026-10-20" }, catalog, "").promisedDate).toBe("2026-10-20");
    expect(buildProposal(out({ promised_date: { action: "set", iso: "2026-10-15" } }), order, catalog, "").promisedDate).toBe("2026-10-15");
    expect(buildProposal(out({ promised_date: { action: "set", iso: "15/10" } }), order, catalog, "").promisedDate).toBeNull(); // invalid → unchanged (null)
    expect(buildProposal(out({ promised_date: { action: "clear", iso: null } }), { ...order, promisedDate: "2026-10-20" }, catalog, "").promisedDate).toBeNull();
  });

  it("a quantity said in a packing unit is kept as said, in that unit", () => {
    const p = buildProposal(out({ lines: [{ item: name("Crown"), quantity: 2, unit: "dabba" }, { item: name("Morico"), quantity: 10, unit: null }] }), order, catalog, "Crown 2 dabba kar do");
    expect(p.lines[0]).toMatchObject({ orderLineId: "ol-crown", quantity: "2", unit: "dabba" });
    expect(p.lines[1]).toMatchObject({ quantity: "10", unit: null });
  });

  it("passes through cancel-the-rest", () => {
    expect(buildProposal(out({ cancel_remaining: true }), order, catalog, "baaki cancel").cancelRemaining).toBe(true);
  });
});

describe("model routing for changes", () => {
  const signal = new AbortController().signal;
  const input = { order, catalog, instruction: "25 kar do", today: "2026-10-09", fromVoice: false };
  it("uses the cheap model when it is sure", async () => {
    const calls: string[] = [];
    await interpretChange({ simple: async () => (calls.push("simple"), out({})), complex: async () => (calls.push("complex"), out({})) }, input, signal);
    expect(calls).toEqual(["simple"]);
  });
  it("asks the stronger model when the cheap one is unsure or fails", async () => {
    for (const simple of [async () => out({ understood: false }), async () => out({ unreadable: ["?"] }), async () => { throw new ExtractionError("error", "x"); }]) {
      const calls: string[] = [];
      await interpretChange({ simple: async () => (calls.push("simple"), simple()), complex: async () => (calls.push("complex"), out({})) }, input, signal);
      expect(calls).toEqual(["simple", "complex"]);
    }
  });
  it("refuses an empty instruction", async () => {
    await expect(interpretChange({ simple: async () => out({}), complex: async () => out({}) }, { ...input, instruction: "  " }, signal)).rejects.toMatchObject({ reason: "empty_input" });
  });
});
