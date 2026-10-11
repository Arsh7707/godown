import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/db/types";
import {
  cancelDispatch,
  cancelOrder,
  correctDispatch,
  correctOrder,
  createDispatch,
  createOrder,
  findUnmatched,
  getPending,
  linkUnmatched,
  previewDispatch,
} from "@/ledger/service";
import { balance } from "@/ledger/domain";
import { cid, freshDb, makeCompany, TODAY } from "./helpers";

let db: Db;
let co: Awaited<ReturnType<typeof makeCompany>>;

beforeEach(async () => {
  db = await freshDb();
  co = await makeCompany(db);
});

const src = { channel: "app", inputMethod: "form" } as const;

async function order(qty: number | string, opts: { orderDate?: string; promisedDate?: string; partyId?: string; itemId?: string } = {}) {
  return createOrder(db, co.staff, {
    ...src,
    captureId: cid(),
    partyId: opts.partyId ?? co.sharma.id,
    orderDate: opts.orderDate ?? TODAY,
    promisedDate: opts.promisedDate,
    lines: [{ itemId: opts.itemId ?? co.d4012.id, quantity: qty }],
  });
}

async function send(qty: number | string, opts: { partyId?: string; itemId?: string; captureId?: string } = {}) {
  return createDispatch(db, co.staff, {
    ...src,
    captureId: opts.captureId ?? cid(),
    partyId: opts.partyId ?? co.sharma.id,
    dispatchDate: TODAY,
    takenBy: "Ramesh",
    transport: "VRL",
    lrNumber: "LR123",
    lines: [{ itemId: opts.itemId ?? co.d4012.id, quantity: qty }],
  });
}

async function sharmaBalance() {
  const p = await getPending(db, co.viewer, { partyId: co.sharma.id });
  return p.byParty[0];
}

describe("balance math", () => {
  it("order 20, send 5 + 5 + 4 leaves 6", async () => {
    await order(20);
    await send(5);
    await send(5);
    await send(4);
    const b = await sharmaBalance();
    expect(b).toMatchObject({ ordered: 2000, sent: 1400, balance: 600 });
  });

  it("handles decimal meters", async () => {
    await order("100.5", { itemId: co.cotton.id });
    await send("40.25", { itemId: co.cotton.id });
    expect((await sharmaBalance()).balance).toBe(6025);
  });

  it("aggregates by item and keeps parties apart", async () => {
    await order(10);
    await order(7, { partyId: co.gupta.id });
    await send(3, { partyId: co.gupta.id });
    const p = await getPending(db, co.owner);
    expect(p.byItem).toEqual([expect.objectContaining({ key: co.d4012.id, ordered: 1700, sent: 300, balance: 1400 })]);
    const byParty = Object.fromEntries(p.byParty.map((r) => [r.key, r.balance]));
    expect(byParty).toEqual({ [co.sharma.id]: 1000, [co.gupta.id]: 400 });
  });
});

describe("FIFO allocation", () => {
  it("allocates to the oldest order first, including backdated entries", async () => {
    const newer = await order(10, { orderDate: "2026-10-05" });
    const older = await order(10, { orderDate: "2026-09-28" }); // entered later but older date
    const r = await send(15);
    const allocs = r.plan!.lines[0].allocations;
    expect(allocs.map((a) => [a.orderId, a.quantity, a.balanceAfter])).toEqual([
      [older.orderId, 1000, 0],
      [newer.orderId, 500, 500],
    ]);
  });

  it("preview matches what confirm writes, and preview writes nothing", async () => {
    await order(10);
    const input = { partyId: co.sharma.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 4 }] };
    const preview = await previewDispatch(db, co.staff, input);
    expect((await sharmaBalance()).balance).toBe(1000);
    const saved = await createDispatch(db, co.staff, { ...src, ...input, captureId: cid() });
    expect(saved.plan).toEqual(preview);
  });
});

describe("over-dispatch and unmatched", () => {
  it("sends more than ordered: excess is unmatched and balance never goes negative", async () => {
    await order(6);
    const r = await send(10);
    expect(r.plan!.lines[0]).toMatchObject({ unmatched: 400 });
    expect(r.plan!.totalUnmatched).toBe(400);
    expect((await sharmaBalance()).balance).toBe(0);
    const um = await findUnmatched(db, co.viewer, co.sharma.id);
    expect(um.map((u) => u.unmatched)).toEqual([400]);
  });

  it("dispatch with no order at all is fully unmatched", async () => {
    const r = await send(5);
    expect(r.plan!.lines[0].allocations).toEqual([]);
    expect(r.plan!.totalUnmatched).toBe(500);
  });

  it("applies unmatched to a new order when the user accepts", async () => {
    await send(5);
    const o = await createOrder(db, co.staff, {
      ...src,
      captureId: cid(),
      partyId: co.sharma.id,
      orderDate: TODAY,
      lines: [{ itemId: co.d4012.id, quantity: 20 }],
      applyUnmatched: true,
    });
    expect(o.appliedUnmatched.map((l) => l.quantity)).toEqual([500]);
    expect((await sharmaBalance()).balance).toBe(1500);
    expect(await findUnmatched(db, co.viewer, co.sharma.id)).toEqual([]);
  });

  it("leaves unmatched alone when the user does not accept", async () => {
    await send(5);
    await order(20);
    expect((await sharmaBalance()).balance).toBe(2000);
    expect((await findUnmatched(db, co.viewer, co.sharma.id))[0].unmatched).toBe(500);
  });

  it("owner can link unmatched by hand, within limits", async () => {
    const d = await send(5);
    const o = await order(3);
    const [um] = await findUnmatched(db, co.owner, co.sharma.id);
    const { lines } = await getPending(db, co.owner, { partyId: co.sharma.id });
    const ol = lines.find((l) => l.orderId === o.orderId)!;
    await expect(linkUnmatched(db, co.owner, { dispatchLineId: um.dispatchLineId, orderLineId: ol.orderLineId, quantity: 4 })).rejects.toMatchObject({
      code: "LINK_EXCEEDS",
    });
    await expect(linkUnmatched(db, co.staff, { dispatchLineId: um.dispatchLineId, orderLineId: ol.orderLineId, quantity: 3 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await linkUnmatched(db, co.owner, { dispatchLineId: um.dispatchLineId, orderLineId: ol.orderLineId, quantity: 3 });
    expect((await sharmaBalance()).balance).toBe(0);
    expect((await findUnmatched(db, co.owner, co.sharma.id))[0].unmatched).toBe(200);
    expect(d.dispatchId).toBe(um.dispatchId);
  });
});

describe("cancellations", () => {
  it("cancelling a partly sent order short-closes it: sent stays, rest cancelled", async () => {
    const o = await order(20);
    await send(10);
    await cancelOrder(db, co.owner, o.orderId, { baseRev: 1, reason: "party said no more" });
    expect(await sharmaBalance()).toMatchObject({ ordered: 2000, sent: 1000, cancelled: 1000, balance: 0 });
    // Next dispatch does not go to the cancelled order.
    const r = await send(2);
    expect(r.plan!.totalUnmatched).toBe(200);
  });

  it("cannot cancel twice or with a stale revision", async () => {
    const o = await order(5);
    await cancelOrder(db, co.owner, o.orderId, { baseRev: 1 });
    await expect(cancelOrder(db, co.owner, o.orderId, { baseRev: 1 })).rejects.toMatchObject({ code: "STALE_REVISION" });
    await expect(cancelOrder(db, co.owner, o.orderId, { baseRev: 2 })).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });
  });

  it("cancelling a dispatch reopens the balance", async () => {
    await order(20);
    const d = await send(5);
    await send(5);
    await cancelDispatch(db, co.owner, d.dispatchId, { baseRev: 1, reason: "entered twice" });
    expect((await sharmaBalance())).toMatchObject({ sent: 500, balance: 1500 });
  });

  it("cancelling an unmatched dispatch removes it from unmatched", async () => {
    const d = await send(5);
    await cancelDispatch(db, co.owner, d.dispatchId, { baseRev: 1 });
    expect(await findUnmatched(db, co.owner)).toEqual([]);
  });
});

describe("corrections", () => {
  it("are new revisions; the original rows are untouched", async () => {
    const o = await order(20);
    const [lineBefore] = (await getPending(db, co.owner)).lines;
    await correctOrder(db, co.owner, o.orderId, {
      baseRev: 1,
      partyId: co.sharma.id,
      orderDate: TODAY,
      lines: [{ orderLineId: lineBefore.orderLineId, itemId: co.d4012.id, quantity: 25 }],
      reason: "slip said 25",
    });
    const revs = await db.select().from(s.orderRevisions).where(eq(s.orderRevisions.orderId, o.orderId));
    expect(revs.map((r) => r.rev).sort()).toEqual([1, 2]);
    const versions = await db.select().from(s.orderLineVersions).where(eq(s.orderLineVersions.orderLineId, lineBefore.orderLineId));
    expect(versions.map((v) => v.quantity).sort()).toEqual(["20.00", "25.00"]);
    expect((await sharmaBalance()).balance).toBe(2500);
  });

  it("blocks correcting a quantity below what was already sent", async () => {
    const o = await order(20);
    await send(10);
    const [l] = (await getPending(db, co.owner)).lines;
    await expect(
      correctOrder(db, co.owner, o.orderId, {
        baseRev: 1,
        partyId: co.sharma.id,
        orderDate: TODAY,
        lines: [{ orderLineId: l.orderLineId, itemId: co.d4012.id, quantity: 8 }],
      }),
    ).rejects.toMatchObject({ code: "BELOW_DISPATCHED", details: { dispatched: "10.00" } });
    // Exactly the sent amount is allowed and closes the line.
    await correctOrder(db, co.owner, o.orderId, {
      baseRev: 1,
      partyId: co.sharma.id,
      orderDate: TODAY,
      lines: [{ orderLineId: l.orderLineId, itemId: co.d4012.id, quantity: 10 }],
    });
    expect((await sharmaBalance()).balance).toBe(0);
  });

  it("blocks removing a line, changing its item, or changing party after goods were sent", async () => {
    const o = await order(20);
    await send(1);
    const [l] = (await getPending(db, co.owner)).lines;
    const base = { baseRev: 1, partyId: co.sharma.id, orderDate: TODAY };
    await expect(correctOrder(db, co.owner, o.orderId, { ...base, lines: [{ itemId: co.d4012.id, quantity: 5 }] })).rejects.toMatchObject({
      code: "LINE_HAS_DISPATCHES",
    });
    await expect(
      correctOrder(db, co.owner, o.orderId, { ...base, lines: [{ orderLineId: l.orderLineId, itemId: co.cotton.id, quantity: 20 }] }),
    ).rejects.toMatchObject({ code: "LINE_HAS_DISPATCHES" });
    await expect(
      correctOrder(db, co.owner, o.orderId, {
        ...base,
        partyId: co.gupta.id,
        lines: [{ orderLineId: l.orderLineId, itemId: co.d4012.id, quantity: 20 }],
      }),
    ).rejects.toMatchObject({ code: "PARTY_HAS_DISPATCHES" });
  });

  it("correcting a dispatch re-runs FIFO on the new quantities", async () => {
    await order(10);
    const d = await send(4);
    const r = await correctDispatch(db, co.owner, d.dispatchId, {
      baseRev: 1,
      partyId: co.sharma.id,
      dispatchDate: TODAY,
      lines: [{ itemId: co.d4012.id, quantity: 12 }],
    });
    expect(r.plan.lines[0]).toMatchObject({ unmatched: 200 });
    expect(await sharmaBalance()).toMatchObject({ sent: 1000, balance: 0 });
  });

  it("correcting a dispatch to another party moves its quantity", async () => {
    await order(10);
    await order(10, { partyId: co.gupta.id });
    const d = await send(4);
    await correctDispatch(db, co.owner, d.dispatchId, {
      baseRev: 1,
      partyId: co.gupta.id,
      dispatchDate: TODAY,
      lines: [{ itemId: co.d4012.id, quantity: 4 }],
    });
    const p = await getPending(db, co.owner);
    const byParty = Object.fromEntries(p.byParty.map((r) => [r.key, r.balance]));
    expect(byParty).toEqual({ [co.sharma.id]: 1000, [co.gupta.id]: 600 });
  });
});

describe("packing units (saved as said, never converted)", () => {
  it("dabba orders are filled only by dabba dispatches; pieces stay separate", async () => {
    await createOrder(db, co.staff, { ...src, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 2, unit: "dabba" }, { itemId: co.d4012.id, quantity: 10 }] });
    const d = await createDispatch(db, co.staff, { ...src, captureId: cid(), partyId: co.sharma.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 1, unit: "डिब्बा" }] });
    expect(d.plan!.lines[0]).toMatchObject({ unit: "dabba", unmatched: 0 });
    const p = await getPending(db, co.viewer, { partyId: co.sharma.id });
    expect(p.lines.map((l) => [l.unit, l.ordered, l.dispatched]).sort()).toEqual([[null, 1000, 0], ["dabba", 200, 100]].sort());
    // pieces against a party that only has a dabba order left in that unit: go to the pcs order
    const pcs = await createDispatch(db, co.staff, { ...src, captureId: cid(), partyId: co.sharma.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 12 }] });
    expect(pcs.plan!.lines[0]).toMatchObject({ unit: null, unmatched: 200 });
  });

  it("refuses a unit that doesn't fit the item, and a unit change after goods were sent", async () => {
    await expect(createOrder(db, co.staff, { ...src, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 2, unit: "meter" }] })).rejects.toMatchObject({ code: "INVALID_UNIT" });
    const o = await createOrder(db, co.staff, { ...src, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 5, unit: "bora" }] });
    await createDispatch(db, co.staff, { ...src, captureId: cid(), partyId: co.sharma.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 1, unit: "bora" }] });
    const [l] = (await getPending(db, co.owner)).lines;
    await expect(
      correctOrder(db, co.owner, o.orderId, { baseRev: 1, partyId: co.sharma.id, orderDate: TODAY, lines: [{ orderLineId: l.orderLineId, itemId: co.d4012.id, quantity: 5, unit: null }] }),
    ).rejects.toMatchObject({ code: "LINE_HAS_DISPATCHES" });
  });
});

describe("date rules", () => {
  it("rejects future order and dispatch dates, accepts past ones", async () => {
    await expect(order(5, { orderDate: "2026-10-09" })).rejects.toMatchObject({ code: "FUTURE_DATE" });
    await expect(
      createDispatch(db, co.staff, { ...src, captureId: cid(), partyId: co.sharma.id, dispatchDate: "2026-10-09", lines: [{ itemId: co.d4012.id, quantity: 1 }] }),
    ).rejects.toMatchObject({ code: "FUTURE_DATE" });
    await expect(order(5, { orderDate: "2026-09-01" })).resolves.toBeTruthy();
  });

  it("accepts a future promised date", async () => {
    await expect(order(5, { promisedDate: "2026-12-31" })).resolves.toBeTruthy();
  });

  it("reports days old and overdue", async () => {
    await order(5, { orderDate: "2026-10-01" }); // 7 days, no promise -> overdue
    await order(5, { orderDate: "2026-10-01", promisedDate: "2026-10-20" }); // promised later -> not overdue
    expect(await sharmaBalance()).toMatchObject({ oldestDays: 7, overdueLines: 1 });
  });
});

describe("idempotency", () => {
  it("the same capture id saves once", async () => {
    const captureId = cid();
    const a = await send(5, { captureId });
    const b = await send(5, { captureId });
    expect(b).toMatchObject({ dispatchId: a.dispatchId, duplicate: true });
    expect((await findUnmatched(db, co.owner))[0].quantity).toBe(500);
  });

  it("concurrent submissions of the same capture save once", async () => {
    const captureId = cid();
    const input = { ...src, captureId, partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 5 }] };
    const results = await Promise.all([createOrder(db, co.staff, input), createOrder(db, co.staff, input)]);
    expect(new Set(results.map((r) => r.orderId)).size).toBe(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
  });
});

describe("roles", () => {
  it("viewer cannot create, correct or cancel", async () => {
    await expect(createOrder(db, co.viewer, { ...src, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 1 }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const o = await order(5);
    await expect(cancelOrder(db, co.viewer, o.orderId, { baseRev: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("staff can correct and cancel their own entries on the same day", async () => {
    const o = await order(5);
    const [l] = (await getPending(db, co.staff)).lines;
    await correctOrder(db, co.staff, o.orderId, {
      baseRev: 1,
      partyId: co.sharma.id,
      orderDate: TODAY,
      lines: [{ orderLineId: l.orderLineId, itemId: co.d4012.id, quantity: 7 }],
    });
    await cancelOrder(db, co.staff, o.orderId, { baseRev: 2 });
    const d = await send(1);
    await correctDispatch(db, co.staff, d.dispatchId, { baseRev: 1, partyId: co.sharma.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 2 }] });
    await cancelDispatch(db, co.staff, d.dispatchId, { baseRev: 2 });
  });

  it("staff cannot change someone else's entry", async () => {
    const o = await order(5); // made by co.staff
    await expect(cancelOrder(db, co.staff2, o.orderId, { baseRev: 1 })).rejects.toMatchObject({ code: "NOT_OWN_ENTRY" });
    const d = await send(1);
    await expect(cancelDispatch(db, co.staff2, d.dispatchId, { baseRev: 1 })).rejects.toMatchObject({ code: "NOT_OWN_ENTRY" });
  });

  it("staff cannot change their own entry after the day it was made (IST); owner still can", async () => {
    const o = await order(5);
    const d = await send(1);
    // 18:29 UTC = 23:59 IST same day: still allowed for staff
    const lateSameDay = { ...co.staff, now: new Date("2026-10-08T18:29:00Z") };
    const nextDay = { ...co.staff, now: new Date("2026-10-08T18:31:00Z") }; // 00:01 IST Oct 9
    await expect(cancelDispatch(db, nextDay, d.dispatchId, { baseRev: 1 })).rejects.toMatchObject({
      code: "EDIT_WINDOW_CLOSED",
      details: { createdOn: TODAY },
    });
    await cancelDispatch(db, lateSameDay, d.dispatchId, { baseRev: 1 });
    await expect(cancelOrder(db, nextDay, o.orderId, { baseRev: 1 })).rejects.toMatchObject({ code: "EDIT_WINDOW_CLOSED" });
    await cancelOrder(db, { ...co.owner, now: new Date("2026-10-20T06:00:00Z") }, o.orderId, { baseRev: 1 });
  });

  it("linking unmatched by hand stays owner-only", async () => {
    const d = await send(5);
    const o = await order(3);
    const [um] = await findUnmatched(db, co.staff, co.sharma.id);
    const ol = (await getPending(db, co.staff)).lines.find((l) => l.orderId === o.orderId)!;
    await expect(linkUnmatched(db, co.staff, { dispatchLineId: um.dispatchLineId, orderLineId: ol.orderLineId, quantity: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(d.duplicate).toBe(false);
  });
});

describe("multi-tenancy", () => {
  it("cannot use or see another company's data", async () => {
    const other = await makeCompany(db, "Other Co");
    // Other company's party/item rejected
    await expect(order(5, { partyId: other.sharma.id })).rejects.toMatchObject({ code: "UNKNOWN_PARTY" });
    await expect(order(5, { itemId: other.d4012.id })).rejects.toMatchObject({ code: "UNKNOWN_ITEM" });
    // Other company cannot see or cancel our order
    const o = await order(5);
    expect((await getPending(db, other.owner)).lines).toEqual([]);
    await expect(cancelOrder(db, other.owner, o.orderId, { baseRev: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("capture ids are scoped per company", async () => {
    const other = await makeCompany(db, "Other Co");
    const captureId = cid();
    const a = await send(1, { captureId });
    const b = await createDispatch(db, other.staff, { ...src, captureId, partyId: other.sharma.id, dispatchDate: TODAY, lines: [{ itemId: other.d4012.id, quantity: 1 }] });
    expect(b.duplicate).toBe(false);
    expect(b.dispatchId).not.toBe(a.dispatchId);
  });
});

describe("audit log and input tracking", () => {
  it("records every create, correct and cancel with user and source", async () => {
    const o = await order(5);
    const d = await send(2);
    await cancelDispatch(db, co.owner, d.dispatchId, { baseRev: 1 });
    await cancelOrder(db, co.owner, o.orderId, { baseRev: 1 });
    const log = await db.select().from(s.auditLog).where(eq(s.auditLog.companyId, co.company.id));
    const ledgerActions = log.filter((l) => !l.action.startsWith("party.") && !l.action.startsWith("item."));
    expect(ledgerActions.map((l) => [l.action, l.userId])).toEqual([
      ["order.create", co.staff.userId],
      ["dispatch.create", co.staff.userId],
      ["dispatch.cancel", co.owner.userId],
      ["order.cancel", co.owner.userId],
    ]);
    expect(ledgerActions[0].details).toMatchObject({ channel: "app", inputMethod: "form" });
    const [rev] = await db.select().from(s.orderRevisions).where(eq(s.orderRevisions.orderId, o.orderId)).limit(1);
    expect(rev).toMatchObject({ channel: "app", inputMethod: "form" });
  });
});

describe("append-only enforcement in the database", () => {
  it("rejects UPDATE and DELETE on ledger tables", async () => {
    const o = await order(5);
    const pgMessage = (p: Promise<unknown>) =>
      p.then(
        () => "succeeded",
        (e: { cause?: { message?: string }; message: string }) => e.cause?.message ?? e.message,
      );
    expect(await pgMessage(db.update(s.orderRevisions).set({ notes: "x" }).where(eq(s.orderRevisions.orderId, o.orderId)))).toMatch(
      /order_revisions is append-only \(UPDATE rejected\)/,
    );
    expect(await pgMessage(db.delete(s.orders).where(eq(s.orders.id, o.orderId)))).toMatch(/orders is append-only \(DELETE rejected\)/);
    expect(await pgMessage(db.execute(sql`truncate audit_log`))).toMatch(/append-only/);
  });
});

describe("invariant: balance never negative, sent never exceeds ordered", () => {
  it("holds across a random sequence of operations", async () => {
    let seed = 42;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const parties = [co.sharma.id, co.gupta.id];
    const dispatchIds: string[] = [];
    for (let i = 0; i < 40; i++) {
      const partyId = parties[rand(2)];
      const op = rand(10);
      if (op < 4) await order(1 + rand(20), { partyId, orderDate: `2026-09-${String(1 + rand(28)).padStart(2, "0")}` });
      else if (op < 9) dispatchIds.push((await send(1 + rand(15), { partyId })).dispatchId);
      else if (dispatchIds.length) {
        const id = dispatchIds.splice(rand(dispatchIds.length), 1)[0];
        await cancelDispatch(db, co.owner, id, { baseRev: 1 });
      }
    }
    const { lines } = await getPending(db, co.owner);
    for (const l of lines) {
      expect(l.dispatched).toBeLessThanOrEqual(l.ordered);
      expect(balance(l)).toBeGreaterThanOrEqual(0);
    }
    // Every dispatched unit is either allocated or unmatched.
    const um = await findUnmatched(db, co.owner);
    for (const u of um) expect(u.allocated + u.unmatched).toBe(u.quantity);
  });
});
