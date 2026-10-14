import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/db/types";
import { cancelDispatch, cancelOrder, correctDispatch, correctOrder, createDispatch, createOrder, getPending, linkMany } from "@/ledger/service";
import { markUnmatchedOk, orderFromUnmatched, reopenUnmatched, unmatchedCount, unmatchedOverview } from "@/ledger/unmatched";
import { activityLog } from "@/ledger/activity";
import { buildReport } from "@/reports/service";
import { buildDigest } from "@/notify/reminders";
import { recordStock } from "@/stock/service";
import { createItem, createParty } from "@/masters/service";
import { deleteParty, updateParty } from "@/masters/manage";
import { revealTaxId } from "@/masters/profiles";
import { cid, freshDb, makeCompany, NOW, TODAY } from "./helpers";

let db: Db;
let co: Awaited<ReturnType<typeof makeCompany>>;
const app = { channel: "app", inputMethod: "form" } as const;

beforeEach(async () => {
  db = await freshDb();
  co = await makeCompany(db);
});

const order = (qty: number, opts: { date?: string; partyId?: string; itemId?: string; unit?: string | null; applyUnmatched?: boolean } = {}) =>
  createOrder(db, co.staff, {
    ...app,
    captureId: cid(),
    partyId: opts.partyId ?? co.sharma.id,
    orderDate: opts.date ?? TODAY,
    applyUnmatched: opts.applyUnmatched ?? false,
    lines: [{ itemId: opts.itemId ?? co.d4012.id, quantity: qty, unit: opts.unit ?? null }],
  });
const send = (qty: number, opts: { date?: string; partyId?: string; itemId?: string; unit?: string | null } = {}) =>
  createDispatch(db, co.staff, {
    ...app,
    captureId: cid(),
    partyId: opts.partyId ?? co.sharma.id,
    dispatchDate: opts.date ?? TODAY,
    lines: [{ itemId: opts.itemId ?? co.d4012.id, quantity: qty, unit: opts.unit ?? null }],
  });
const firstLine = async () => (await unmatchedOverview(db, co.owner)).open[0]?.lines[0];

describe("goods sent with no order", () => {
  it("lists them by client with the open orders they could go to, oldest first", async () => {
    await send(10, { date: "2026-10-05" });
    await order(4, { date: "2026-10-06" });
    await order(3, { date: "2026-10-07" });
    const o = await unmatchedOverview(db, co.owner);
    expect(o.count).toBe(1);
    expect(o.open[0]).toMatchObject({ partyName: "Sharma Textiles" });
    const l = o.open[0].lines[0];
    expect(l).toMatchObject({ itemName: "D-4012", unit: "pcs", unmatched: 1000, days: 3 });
    expect(l.orders.map((x) => [x.orderDate, x.balance])).toEqual([
      ["2026-10-06", 400],
      ["2026-10-07", 300],
    ]);
    expect(l.suggestion.map((x) => x.quantity)).toEqual([400, 300]);
  });

  it("links by hand, all or nothing, never more than sent or owed", async () => {
    await send(10);
    const { orderId } = await order(6);
    const l = (await firstLine())!;
    const ol = l.orders[0].orderLineId;
    await expect(linkMany(db, co.owner, [{ dispatchLineId: l.dispatchLineId, orderLineId: ol, quantity: 7 }])).rejects.toMatchObject({ code: "LINK_EXCEEDS" });
    // Two links that are each fine but together too much: nothing is saved.
    await expect(
      linkMany(db, co.owner, [
        { dispatchLineId: l.dispatchLineId, orderLineId: ol, quantity: 4 },
        { dispatchLineId: l.dispatchLineId, orderLineId: ol, quantity: 4 },
      ]),
    ).rejects.toMatchObject({ code: "LINK_EXCEEDS" });
    expect((await firstLine())!.unmatched).toBe(1000);
    await expect(linkMany(db, co.staff, [{ dispatchLineId: l.dispatchLineId, orderLineId: ol, quantity: 1 }])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await linkMany(db, co.owner, [{ dispatchLineId: l.dispatchLineId, orderLineId: ol, quantity: 6 }]);
    expect((await firstLine())!).toMatchObject({ unmatched: 400, orders: [] });
    expect((await getPending(db, co.owner)).lines.find((x) => x.orderId === orderId)).toMatchObject({ dispatched: 600 });
    await expect(linkMany(db, co.owner, [])).rejects.toMatchObject({ code: "NO_LINES" });
  });

  it("doesn't offer the same order quantity to two unmatched lines", async () => {
    await send(5, { date: "2026-10-04" });
    await send(5, { date: "2026-10-05" });
    await order(6);
    const [a, b] = (await unmatchedOverview(db, co.owner)).open[0].lines;
    expect(a.suggestion.map((x) => x.quantity)).toEqual([500]);
    expect(b.suggestion.map((x) => x.quantity)).toEqual([100]);
  });

  it("keeps units and cancelled orders out of the choices", async () => {
    await send(2, { unit: "dabba" });
    await order(5); // pcs
    const { orderId } = await order(2, { unit: "dabba" });
    await cancelOrder(db, co.owner, orderId, { baseRev: 1 });
    const l = (await firstLine())!;
    expect(l).toMatchObject({ unit: "dabba", orders: [] });
    const pcsLine = (await getPending(db, co.owner)).lines.find((x) => x.unit === null)!;
    await expect(linkMany(db, co.owner, [{ dispatchLineId: l.dispatchLineId, orderLineId: pcsLine.orderLineId, quantity: 1 }])).rejects.toMatchObject({ code: "LINK_MISMATCH" });
  });

  it("makes the missing order from the goods, once per press; staff may, viewers may not", async () => {
    await send(4, { date: "2026-10-03" });
    await send(3, { date: "2026-10-05", itemId: co.cotton.id });
    const ids = (await unmatchedOverview(db, co.owner)).open[0].lines.map((l) => l.dispatchLineId);
    await expect(orderFromUnmatched(db, co.viewer, co.sharma.id, ids)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const press = "11111111-1111-4111-8111-111111111111";
    const r = await orderFromUnmatched(db, co.staff, co.sharma.id, ids, press);
    expect(r).toMatchObject({ linked: 2, duplicate: false });
    expect((await orderFromUnmatched(db, co.staff, co.sharma.id, ids, press).catch((e) => e)).code).toBe("NOT_FOUND"); // already settled
    const [rev] = await db.select().from(s.orderRevisions).where(eq(s.orderRevisions.orderId, r.orderId));
    expect(rev.orderDate).toBe("2026-10-03");
    expect(await unmatchedCount(db, co.company.id)).toEqual({ lines: 0, dispatches: 0 });
    // Fully sent: nothing left pending from it.
    expect((await getPending(db, co.owner)).lines.every((l) => l.ordered === l.dispatched)).toBe(true);
    await expect(orderFromUnmatched(db, co.staff, co.sharma.id, [])).rejects.toMatchObject({ code: "NO_LINES" });
  });

  it("marking OK hides it from the list and the morning reminder until reopened or corrected", async () => {
    const { dispatchId } = await send(2, { date: "2026-10-01" });
    const l = (await firstLine())!;
    await expect(markUnmatchedOk(db, co.staff, l.dispatchLineId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await markUnmatchedOk(db, co.owner, l.dispatchLineId, "sample")).toEqual({ changed: true });
    expect(await markUnmatchedOk(db, co.owner, l.dispatchLineId)).toEqual({ changed: false });
    const o = await unmatchedOverview(db, co.owner);
    expect(o.count).toBe(0);
    expect(o.dismissed[0].lines[0].dismissed).toMatchObject({ reason: "sample" });
    expect(await buildDigest(db, co.company.id, TODAY)).toBeNull();
    await reopenUnmatched(db, co.owner, l.dispatchLineId);
    expect((await unmatchedOverview(db, co.owner)).count).toBe(1);
    expect((await buildDigest(db, co.company.id, TODAY))?.unmatchedDispatches).toBe(1);
    // Correcting the dispatch makes new lines: settled again only by a new decision.
    await markUnmatchedOk(db, co.owner, l.dispatchLineId);
    await correctDispatch(db, co.owner, dispatchId, { ...app, partyId: co.sharma.id, dispatchDate: "2026-10-01", baseRev: 1, lines: [{ itemId: co.d4012.id, quantity: 3 }] });
    expect((await unmatchedOverview(db, co.owner)).open[0].lines[0].unmatched).toBe(300);
    await cancelDispatch(db, co.owner, dispatchId, { baseRev: 2 });
    expect((await unmatchedOverview(db, co.owner)).count).toBe(0);
    await expect(markUnmatchedOk(db, co.owner, l.dispatchLineId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("activity log", () => {
  it("says who did what, newest first, with names and before → after", async () => {
    const { orderId } = await order(5);
    await correctOrder(db, co.owner, orderId, { partyId: co.sharma.id, orderDate: TODAY, baseRev: 1, reason: "phone call", lines: [{ itemId: co.d4012.id, quantity: 8 }, { itemId: co.cotton.id, quantity: 2 }] });
    await updateParty(db, co.owner, co.gupta.id, { phone: "+919812345678", city: "Delhi" });
    const { entries } = await activityLog(db, co.owner);
    expect(entries[0]).toMatchObject({ action: "party.update", subject: "Gupta Traders", by: "owner +919800000001", changes: expect.arrayContaining([{ field: "city", from: null, to: "Delhi" }]) });
    expect(entries[1]).toMatchObject({ action: "order.correct", subject: "Sharma Textiles", reason: "phone call", href: `/orders/${orderId}` });
    expect(entries[1].changes).toEqual(
      expect.arrayContaining([
        { field: "D-4012", from: "5 pcs", to: "8 pcs" },
        { field: "Cotton Poplin", from: null, to: "2 meter" },
      ]),
    );
    expect(entries[2]).toMatchObject({ action: "order.create", by: "staff +919800000002", lines: ["D-4012 5 pcs"] });
  });

  it("filters by kind, person and IST day; pages without gaps or repeats", async () => {
    for (let i = 0; i < 7; i++) await order(i + 1);
    await send(1);
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 5 }] });
    expect((await activityLog(db, co.owner, { group: "dispatches" })).entries.map((e) => e.action)).toEqual(["dispatch.create"]);
    expect((await activityLog(db, co.owner, { group: "stock" })).entries[0]).toMatchObject({ lines: ["D-4012 5 pcs"], href: `/stock/item/${co.d4012.id}` });
    expect((await activityLog(db, co.owner, { userId: co.owner.userId })).entries.every((e) => e.byId === co.owner.userId)).toBe(true);
    const all = (await activityLog(db, co.owner, { limit: 200 })).entries.map((e) => e.id);
    const seen: string[] = [];
    let page = await activityLog(db, co.owner, { limit: 3 });
    seen.push(...page.entries.map((e) => e.id));
    while (page.more) {
      const last = page.entries[page.entries.length - 1];
      page = await activityLog(db, co.owner, { limit: 3, before: { at: last.at.toISOString(), id: last.id } });
      seen.push(...page.entries.map((e) => e.id));
    }
    expect(seen).toEqual(all);
    // Nothing today in the future, nothing before the company existed.
    expect((await activityLog(db, co.owner, { from: "2020-01-01", to: "2020-01-02" })).entries).toEqual([]);
    await expect(activityLog(db, co.owner, { from: "2026-13-01" })).rejects.toMatchObject({ code: "INVALID_DATE" });
  });

  it("owners only; keeps the name of something deleted; never shows a full Aadhaar", async () => {
    await expect(activityLog(db, co.staff)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const p = await createParty(db, co.owner, { name: "Gone Soon" });
    await deleteParty(db, co.owner, p.id);
    const del = (await activityLog(db, co.owner, { group: "clients" })).entries.find((e) => e.action === "party.delete")!;
    expect(del).toMatchObject({ subject: "Gone Soon", href: null });
    const aadhaar = "234567890124";
    await db.update(s.parties).set({ taxIdType: "aadhaar", taxId: aadhaar }).where(eq(s.parties.id, co.gupta.id));
    await revealTaxId(db, co.owner, co.gupta.id);
    const log = await activityLog(db, co.owner);
    expect(log.entries[0]).toMatchObject({ action: "party.taxid.reveal", subject: "Gupta Traders" });
    expect(JSON.stringify(log)).not.toContain(aadhaar);
  });
});

describe("reports", () => {
  it("checks the dates and who may look", async () => {
    await expect(buildReport(db, co.staff, { from: TODAY, to: TODAY })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(buildReport(db, co.owner, { from: "2026-10-09", to: "2026-10-01" })).rejects.toMatchObject({ code: "INVALID_DATE" });
    await expect(buildReport(db, co.owner, { from: "2020-01-01", to: TODAY })).rejects.toMatchObject({ code: "RANGE_TOO_LONG" });
    await expect(buildReport(db, co.owner, { from: "x", to: TODAY })).rejects.toMatchObject({ code: "INVALID_DATE" });
    // A range into the future stops at today; viewers may look.
    expect(await buildReport(db, co.viewer, { from: "2026-10-01", to: "2026-12-31" })).toMatchObject({ to: TODAY });
  });

  it("dispatched: by day, client and item; units never added together; cancelled left out, corrected as corrected", async () => {
    await send(10, { date: "2026-10-02" });
    await send(3, { date: "2026-10-02", unit: "dabba" });
    await send(5, { date: "2026-10-05", partyId: co.gupta.id, itemId: co.cotton.id });
    const { dispatchId } = await send(4, { date: "2026-10-06" });
    await correctDispatch(db, co.owner, dispatchId, { ...app, partyId: co.sharma.id, dispatchDate: "2026-10-06", baseRev: 1, lines: [{ itemId: co.d4012.id, quantity: 6 }] });
    const gone = await send(99, { date: "2026-10-06" });
    await cancelDispatch(db, co.owner, gone.dispatchId, { baseRev: 1 });
    await send(1, { date: "2026-09-30" }); // before the range
    const r = await buildReport(db, co.owner, { from: "2026-10-01", to: TODAY });
    expect(r.dispatched).toMatchObject({ dispatches: 4, total: { pcs: 1600, dabba: 300, meter: 500 } });
    expect(r.dispatched.byDay.map((d) => [d.date, d.dispatches, d.qty])).toEqual([
      ["2026-10-06", 1, { pcs: 600 }],
      ["2026-10-05", 1, { meter: 500 }],
      ["2026-10-02", 2, { pcs: 1000, dabba: 300 }],
    ]);
    expect(r.dispatched.byParty.find((p) => p.name === "Sharma Textiles")).toMatchObject({ dispatches: 3, qty: { pcs: 1600, dabba: 300 } });
    expect(r.dispatched.byItem.map((i) => [i.name, i.unit, i.qty])).toEqual([
      ["D-4012", "pcs", 1600],
      ["Cotton Poplin", "meter", 500],
      ["D-4012", "dabba", 300],
    ]);
  });

  it("orders received in the range with what has gone since; pending now regardless of dates", async () => {
    await order(10, { date: "2026-10-01" });
    const { orderId } = await order(6, { date: "2026-10-02", itemId: co.cotton.id });
    await order(7, { date: "2026-09-20", partyId: co.gupta.id });
    await send(4);
    await cancelOrder(db, co.owner, orderId, { baseRev: 1 });
    const r = await buildReport(db, co.owner, { from: "2026-10-01", to: TODAY });
    expect(r.orders).toMatchObject({ orders: 2, cancelledOrders: 1 });
    expect(r.orders.byItem.find((i) => i.name === "D-4012")).toMatchObject({ ordered: 1000, sent: 400, pending: 600, cancelled: 0 });
    expect(r.orders.byItem.find((i) => i.name === "Cotton Poplin")).toMatchObject({ ordered: 600, sent: 0, pending: 0, cancelled: 600 });
    // Gupta's September order is outside the dates but still pending (and late).
    expect(r.pending.byParty[0]).toMatchObject({ name: "Gupta Traders", pending: { pcs: 700 }, overdue: 1, oldestDays: 18 });
    expect(r.pending.byItem.find((i) => i.name === "D-4012")).toMatchObject({ pending: 1300, parties: 2 });
  });

  it("slow stock: never sent first, then longest idle; recent movers left out", async () => {
    const idle = await createItem(db, co.owner, { name: "Idle Design", unit: "pcs" });
    await recordStock(db, co.staff, {
      ...app,
      captureId: cid(),
      kind: "receipt",
      date: "2026-08-01",
      lines: [
        { itemId: co.d4012.id, quantity: 50 },
        { itemId: co.cotton.id, quantity: 50 },
        { itemId: idle.id, quantity: 9 },
      ],
    });
    await send(1, { date: "2026-08-15", itemId: co.cotton.id });
    await send(1, { date: "2026-10-07" });
    const r = await buildReport(db, co.owner, { from: TODAY, to: TODAY, slowDays: 30 });
    expect(r.slow.map((x) => [x.name, x.days])).toEqual([
      ["Idle Design", null],
      ["Cotton Poplin", 54],
    ]);
    expect((await buildReport(db, co.owner, { from: TODAY, to: TODAY, slowDays: 60 })).slow.map((x) => x.name)).toEqual(["Idle Design"]);
    expect(NOW).toBeTruthy();
  });
});
