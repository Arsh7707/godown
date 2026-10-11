import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import { cancelDispatch, cancelOrder, createDispatch, createOrder } from "@/ledger/service";
import { dispatchDetail, dispatchForEdit, dispatchList, orderDetail, partyOrders, pendingOverview } from "@/ledger/queries";
import { previewDispatch } from "@/ledger/service";
import { cid, freshDb, makeCompany, TODAY } from "./helpers";

let db: Db;
let co: Awaited<ReturnType<typeof makeCompany>>;
const src = { channel: "app", inputMethod: "form" } as const;

beforeEach(async () => {
  db = await freshDb();
  co = await makeCompany(db);
});

const order = (lines: { itemId: string; quantity: number }[], orderDate = TODAY, partyId = co.sharma.id) =>
  createOrder(db, co.staff, { ...src, captureId: cid(), partyId, orderDate, lines });
const send = (itemId: string, quantity: number, partyId = co.sharma.id) =>
  createDispatch(db, co.staff, { ...src, captureId: cid(), partyId, dispatchDate: TODAY, takenBy: "Ramesh", transport: "VRL", lrNumber: "77", lines: [{ itemId, quantity }] });

describe("pending overview", () => {
  it("keeps units apart: party rows are per item", async () => {
    await order([{ itemId: co.d4012.id, quantity: 20 }, { itemId: co.cotton.id, quantity: 45 }], "2026-10-01");
    await send(co.d4012.id, 14);
    const p = await pendingOverview(db, co.viewer);
    expect(p.parties).toHaveLength(1);
    expect(p.parties[0]).toMatchObject({ partyName: "Sharma Textiles", oldestDays: 7, overdueLines: 2 });
    expect(p.parties[0].items.map((i) => [i.itemName, i.unit, i.ordered, i.sent, i.balance])).toEqual([
      ["Cotton Poplin", "meter", 4500, 0, 4500],
      ["D-4012", "pcs", 2000, 1400, 600],
    ]);
    expect(p.items.find((i) => i.itemName === "D-4012")).toMatchObject({ balance: 600, parties: 1 });
  });

  it("hides fully sent and cancelled orders", async () => {
    await order([{ itemId: co.d4012.id, quantity: 5 }]);
    await send(co.d4012.id, 5);
    const o = await order([{ itemId: co.d4012.id, quantity: 3 }], TODAY, co.gupta.id);
    await cancelOrder(db, co.owner, o.orderId, { baseRev: 1 });
    expect((await pendingOverview(db, co.viewer)).parties).toEqual([]);
  });

  it("lists overdue parties first", async () => {
    await order([{ itemId: co.d4012.id, quantity: 1 }], TODAY, co.gupta.id);
    await order([{ itemId: co.d4012.id, quantity: 1 }], "2026-09-20");
    expect((await pendingOverview(db, co.viewer)).parties.map((p) => p.partyName)).toEqual(["Sharma Textiles", "Gupta Traders"]);
  });
});

describe("party orders and order detail", () => {
  it("splits open and settled orders", async () => {
    const a = await order([{ itemId: co.d4012.id, quantity: 5 }], "2026-10-01");
    const b = await order([{ itemId: co.d4012.id, quantity: 5 }], "2026-10-05");
    await send(co.d4012.id, 7);
    const r = await partyOrders(db, co.viewer, co.sharma.id);
    expect(r.open.map((o) => o.orderId)).toEqual([b.orderId]);
    expect(r.closed.map((o) => o.orderId)).toEqual([a.orderId]);
    expect(r.open[0].lines[0]).toMatchObject({ ordered: 500, sent: 200, balance: 300 });
  });

  it("shows a timeline of who logged what, without cancelled dispatches", async () => {
    const o = await order([{ itemId: co.d4012.id, quantity: 20 }]);
    await send(co.d4012.id, 5);
    const d2 = await send(co.d4012.id, 4);
    await cancelDispatch(db, co.owner, d2.dispatchId, { baseRev: 1, reason: "entered twice" });
    const det = await orderDetail(db, co.viewer, o.orderId);
    expect(det).toMatchObject({ party: { name: "Sharma Textiles" }, status: "open", createdBy: expect.stringContaining("staff") });
    expect(det.lines).toEqual([expect.objectContaining({ itemName: "D-4012", itemId: co.d4012.id, unit: "pcs", ordered: 2000, sent: 500, balance: 1500, cancelled: 0 })]);
    expect(det.events.map((e) => [e.kind, e.quantity ?? null, e.transport ?? null])).toEqual([
      ["created", null, null],
      ["dispatch", 500, "VRL"],
    ]);
  });

  it("says who may edit: owner yes, staff own same-day yes, other staff and viewer no", async () => {
    const o = await order([{ itemId: co.d4012.id, quantity: 20 }]); // made by co.staff
    await send(co.d4012.id, 5);
    expect((await orderDetail(db, co.owner, o.orderId)).canChange).toBe(true);
    expect((await orderDetail(db, co.staff, o.orderId)).canChange).toBe(true);
    expect((await orderDetail(db, co.staff2, o.orderId)).canChange).toBe(false);
    expect((await orderDetail(db, co.viewer, o.orderId)).canChange).toBe(false);
    expect((await orderDetail(db, { ...co.staff, now: new Date("2026-10-09T09:00:00Z") }, o.orderId)).canChange).toBe(false);
    const ev = (await orderDetail(db, co.staff, o.orderId)).events.find((e) => e.kind === "dispatch")!;
    expect(ev).toMatchObject({ canChange: true, dispatchId: expect.any(String) });
    await cancelOrder(db, co.owner, o.orderId, { baseRev: 1 });
    expect((await orderDetail(db, co.owner, o.orderId)).canChange).toBe(false); // nothing left to edit
  });

  it("loads a dispatch for editing, and previews an edit without double-counting it", async () => {
    await order([{ itemId: co.d4012.id, quantity: 10 }]);
    const d = await send(co.d4012.id, 10);
    const e = await dispatchForEdit(db, co.staff, d.dispatchId);
    expect(e).toMatchObject({ rev: 1, partyId: co.sharma.id, takenBy: "Ramesh", lines: [{ itemId: co.d4012.id, quantity: "10.00" }], canChange: true });
    const input = { partyId: co.sharma.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 8 }] };
    expect((await previewDispatch(db, co.owner, input)).totalUnmatched).toBe(800); // counting the old version too
    expect((await previewDispatch(db, co.owner, input, { excludeDispatchId: d.dispatchId })).totalUnmatched).toBe(0);
  });

  it("lists dispatches newest first, with unmatched part and who logged them", async () => {
    await order([{ itemId: co.d4012.id, quantity: 5 }]);
    const a = await send(co.d4012.id, 7); // 2 unmatched
    const b = await send(co.cotton.id, 3, co.gupta.id);
    const list = await dispatchList(db, co.viewer);
    expect(list.map((d) => d.dispatchId)).toEqual([b.dispatchId, a.dispatchId]);
    expect(list[1]).toMatchObject({ partyName: "Sharma Textiles", unmatched: 200, takenBy: "Ramesh", lines: [{ itemName: "D-4012", quantity: 700 }], canChange: false });
    expect((await dispatchList(db, co.viewer, { partyId: co.gupta.id })).map((d) => d.dispatchId)).toEqual([b.dispatchId]);
    await cancelDispatch(db, co.owner, b.dispatchId, { baseRev: 1 });
    expect((await dispatchList(db, co.viewer)).map((d) => d.dispatchId)).toEqual([a.dispatchId]);
    expect((await dispatchList(db, co.viewer, { includeCancelled: true })).find((d) => d.dispatchId === b.dispatchId)?.status).toBe("cancelled");
    const det = await dispatchDetail(db, co.owner, a.dispatchId);
    expect(det.goesTo).toEqual([expect.objectContaining({ quantity: 500, orderDate: TODAY })]);
    expect(det.history.map((h) => h.status)).toEqual(["active"]);
    expect(det.canChange).toBe(true);
  });

  it("cannot read another company's order", async () => {
    const o = await order([{ itemId: co.d4012.id, quantity: 1 }]);
    const other = await makeCompany(db, "Other");
    await expect(orderDetail(db, other.viewer, o.orderId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(partyOrders(db, other.viewer, co.sharma.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
