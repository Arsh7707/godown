import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/db/types";
import { createDispatch, createOrder } from "@/ledger/service";
import { itemStockHistory, recordStock, reverseStockEntry, stockOverview } from "@/stock/service";
import { createProduct } from "@/masters/service";
import { matchMention } from "@/extraction/matcher";
import { loadCatalog } from "@/extraction/catalog";
import { cid, freshDb, makeCompany, NOW, TODAY } from "./helpers";

let db: Db;
let co: Awaited<ReturnType<typeof makeCompany>>;
const app = { channel: "app", inputMethod: "form" } as const;
beforeEach(async () => {
  db = await freshDb();
  co = await makeCompany(db);
});

const goodsIn = (qty: number | string, itemId = co.d4012.id, ctx = co.staff) => recordStock(db, ctx, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId, quantity: qty }] });
const send = (qty: number, itemId = co.d4012.id) => createDispatch(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, dispatchDate: TODAY, lines: [{ itemId, quantity: qty }] });
const row = async (itemId = co.d4012.id) => (await stockOverview(db, co.viewer)).find((r) => r.itemId === itemId)!;

describe("stock = goods in ± counts/adjustments − dispatched", () => {
  it("follows the worked example", async () => {
    await goodsIn(100);
    await send(30);
    expect(await row()).toMatchObject({ inStock: 7000 });
    const count = await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "count", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 65 }] });
    expect(count.lines[0]).toMatchObject({ before: 7000, change: -500, after: 6500 });
    await recordStock(db, co.owner, { ...app, captureId: cid(), kind: "adjustment", date: TODAY, reason: "2 damaged", lines: [{ itemId: co.d4012.id, quantity: "-2" }] });
    expect((await row()).inStock).toBe(6300);
    await reverseStockEntry(db, co.owner, count.batchId, "counted wrong");
    expect((await row()).inStock).toBe(6800);
  });

  it("free = in stock − owed to pending orders; low when free reaches the item's level", async () => {
    await goodsIn(63);
    await createOrder(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 60 }] });
    expect(await row()).toMatchObject({ inStock: 6300, owed: 6000, free: 300, lowLevel: 1000, low: true });
    await goodsIn(20);
    expect(await row()).toMatchObject({ free: 2300, low: false });
    await send(60); // the order is now fully sent: nothing owed
    expect(await row()).toMatchObject({ inStock: 2300, owed: 0, free: 2300 });
  });

  it("dispatching more than in stock is allowed and shows negative", async () => {
    await goodsIn(5);
    await send(12);
    expect((await row()).inStock).toBe(-700);
  });

  it("a cancelled dispatch puts the goods back", async () => {
    const { cancelDispatch } = await import("@/ledger/service");
    await goodsIn(10);
    const d = await send(4);
    await cancelDispatch(db, co.owner, d.dispatchId, { baseRev: 1 });
    expect((await row()).inStock).toBe(1000);
  });

  it("saves once per capture id; rejects bad input", async () => {
    const captureId = cid();
    const a = await recordStock(db, co.staff, { ...app, captureId, kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 5 }] });
    const b = await recordStock(db, co.staff, { ...app, captureId, kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 5 }] });
    expect(b).toMatchObject({ duplicate: true, batchId: a.batchId });
    expect((await row()).inStock).toBe(500);
    await expect(goodsIn(0)).rejects.toMatchObject({ code: "INVALID_QTY" });
    await expect(goodsIn("-3")).rejects.toMatchObject({ code: "INVALID_QTY" });
    await expect(recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: "2026-10-09", lines: [{ itemId: co.d4012.id, quantity: 1 }] })).rejects.toMatchObject({ code: "FUTURE_DATE" });
    await expect(recordStock(db, co.viewer, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 1 }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // a count of zero is fine
    await expect(recordStock(db, co.staff, { ...app, captureId: cid(), kind: "count", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 0 }] })).resolves.toBeTruthy();
    expect((await row()).inStock).toBe(0);
  });

  it("who may undo: owner anytime, staff own same-day only, once", async () => {
    const e = await goodsIn(10);
    await expect(reverseStockEntry(db, co.staff2, e.batchId)).rejects.toMatchObject({ code: "NOT_OWN_ENTRY" });
    await expect(reverseStockEntry(db, co.viewer, e.batchId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reverseStockEntry(db, { ...co.staff, now: new Date("2026-10-09T09:00:00Z") }, e.batchId)).rejects.toMatchObject({ code: "EDIT_WINDOW_CLOSED" });
    await reverseStockEntry(db, co.staff, e.batchId);
    await expect(reverseStockEntry(db, co.owner, e.batchId)).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });
  });

  it("is append-only in the database", async () => {
    await goodsIn(10);
    const err = await db.update(s.stockMovements).set({ quantity: "99" }).where(eq(s.stockMovements.companyId, co.company.id)).then(() => null, (e) => e);
    expect(String(err?.cause?.message ?? err)).toMatch(/append-only/);
  });

  it("history shows goods in, dispatches and reversals, newest first", async () => {
    const e = await goodsIn(10);
    await send(3);
    const h = await itemStockHistory(db, co.owner, co.d4012.id);
    expect(h.item.inStock).toBe(700);
    expect(h.events.map((x) => [x.kind, x.change]).sort()).toEqual([["dispatch", -300], ["receipt", 1000]].sort());
    await reverseStockEntry(db, co.owner, e.batchId);
    const h2 = await itemStockHistory(db, co.owner, co.d4012.id);
    expect(h2.events.find((x) => x.kind === "receipt")).toMatchObject({ reversed: true, canReverse: false });
  });

  it("keeps companies apart", async () => {
    const other = await makeCompany(db, "Other");
    await goodsIn(10);
    await expect(goodsIn(1, other.d4012.id)).rejects.toMatchObject({ code: "UNKNOWN_ITEM" });
    expect((await stockOverview(db, other.viewer)).find((r) => r.itemId === other.d4012.id)?.inStock).toBe(0);
  });
});

describe("stock per unit", () => {
  it("counts pieces and dabba separately; dispatches take from their own unit", async () => {
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 40 }, { itemId: co.d4012.id, quantity: 3, unit: "dabba" }] });
    await createDispatch(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 1, unit: "dabba" }] });
    const rows = (await stockOverview(db, co.viewer)).filter((r) => r.itemId === co.d4012.id);
    expect(rows.map((r) => [r.unitCode, r.unit, r.inStock])).toEqual([
      [null, "pcs", 4000],
      ["dabba", "dabba", 200],
    ]);
    const count = await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "count", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 1, unit: "dabba" }] });
    expect(count.lines[0]).toMatchObject({ unit: "dabba", before: 200, change: -100, after: 100 });
  });
});

describe("colours and sizes", () => {
  it("one item per variant, matched by name and colour; plain product name asks which", async () => {
    const vs = await createProduct(db, co.owner, { name: "Vistara", unit: "pcs", variants: ["Red", "Blue"], lowStockLevel: 5 });
    expect(vs.map((v) => v.name)).toEqual(["Vistara · Red", "Vistara · Blue"]);
    expect(vs[0]).toMatchObject({ product: "Vistara", variant: "Red", lowStockLevel: "5.00" });
    const cat = await loadCatalog(db, co.company.id);
    expect(matchMention({ asWritten: "vistara red" }, cat.items)).toMatchObject({ status: "matched", id: vs[0].id });
    // colours said in Hindi / Hinglish
    for (const said of ["Vistara laal", "लाल Vistara", "vistara neela"]) {
      expect(matchMention({ asWritten: said }, cat.items)).toMatchObject({ status: "matched", id: said.includes("neela") ? vs[1].id : vs[0].id });
    }
    const plain = matchMention({ asWritten: "Vistara" }, cat.items);
    expect(plain.status).toBe("choose");
    expect(plain.candidates.map((c) => c.name).sort()).toEqual(["Vistara · Blue", "Vistara · Red"]);
    await expect(createProduct(db, co.staff, { name: "X", unit: "pcs" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(NOW).toBeTruthy();
  });
});
