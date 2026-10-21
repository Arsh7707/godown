/**
 * Random-history tests: fast-check makes up long sequences of real actions
 * (goods in, counts, adjustments, undoing stock entries, orders, corrections,
 * cancellations, dispatches, links, retries of the same capture) across two
 * firms sharing one godown, runs them against a real database, and after
 * every single step checks that the numbers still add up:
 *
 * - In stock = everything that came in (tracked here, independently) − what is sent.
 * - Free = in stock − owed; low exactly when free ≤ the item's low level.
 * - Owed on the stock screen = pending on the pending screen = pending in reports.
 * - Nothing is sent twice: an order line never gets more than ordered, a
 *   dispatch line never gives away more than it sent, and both sides agree.
 * - FIFO: right after a dispatch, goods are unmatched only if that client owes
 *   nothing more of that item.
 * - Reports: totals = sum by day = sum by client = sum by item.
 * - A refused action changes nothing at all; a retried capture saves nothing new.
 *
 * On a failure it prints the history that broke, the step and a seed; replay
 * it with FC_SEED=<seed> FC_PATH=<path>. FC_SHRINK=1 also cuts the history
 * down to the shortest one that still breaks (slow).
 * PROPERTY_RUNS=200 for a deep run (nightly CI does this).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { desc, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { centiToDecimal, toCenti } from "@/lib/qty";
import { addDays, formatDateTimeIST, formatDay, formatTimeIST, todayIST } from "@/lib/dates";
import { unitKey } from "@/lib/units";
import { balance, unmatched } from "@/ledger/domain";
import { loadState } from "@/ledger/state";
import { cancelDispatch, cancelOrder, correctDispatch, correctOrder, createDispatch, createOrder, getPending, linkUnmatched, type Ctx } from "@/ledger/service";
import { recordStock, reverseStockEntry, stockOverview } from "@/stock/service";
import { createParty } from "@/masters/service";
import { buildReport } from "@/reports/service";
import { unmatchedCount } from "@/ledger/unmatched";
import { freshDb, makeCompany, NOW, TODAY } from "./helpers";

const RUNS = Number(process.env.PROPERTY_RUNS ?? 12);
const app = { channel: "app", inputMethod: "form" } as const;

// ---------------------------------------------------------------- actions

const firm = fc.constantFrom(0, 1);
const key = fc.constantFrom(0, 1, 2); // D-4012 pcs, D-4012 dabba, Cotton meter
const qty = fc.oneof(fc.integer({ min: 1, max: 30 }).map((n) => n * 100), fc.integer({ min: 1, max: 4000 })); // whole and fractional
const pick = fc.nat({ max: 50 });
const day = fc.integer({ min: 0, max: 3 });
const lines = fc.array(fc.record({ key, qty }), { minLength: 1, maxLength: 3 });

const action = fc.oneof(
  { weight: 3, arbitrary: fc.record({ t: fc.constant("in" as const), firm, key, qty }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("count" as const), firm, key, qty: fc.oneof(fc.constant(0), qty) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("adjust" as const), firm, key, qty, minus: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("undoStock" as const), pick }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant("order" as const), firm, party: fc.nat({ max: 1 }), day, lines, applyUnmatched: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("fixOrder" as const), pick, line: fc.nat({ max: 3 }), qty }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("cancelOrder" as const), pick }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant("send" as const), firm, party: fc.nat({ max: 1 }), day, lines }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("fixSend" as const), pick, lines }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("cancelSend" as const), pick }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("link" as const), firm, pick }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("retry" as const), pick }) },
);
type Action = typeof action extends fc.Arbitrary<infer T> ? T : never;

// ---------------------------------------------------------------- world

async function world() {
  const db = await freshDb();
  const a = await makeCompany(db, "Smart Homes");
  // Firm B uses firm A's godown.
  const [bCo] = await db.insert(s.companies).values({ name: "Smart Fabrics", stockCompanyId: a.company.id }).returning();
  const [bUser] = await db.insert(s.users).values({ companyId: bCo.id, phone: "+919800000001", name: "owner B", role: "owner" }).returning();
  const bOwner: Ctx = { companyId: bCo.id, userId: bUser.id, role: "owner", stockId: a.company.id, now: NOW };
  const aOwner: Ctx = { ...a.owner, stockId: a.company.id };
  const firms = [
    { ctx: aOwner, viewer: { ...a.viewer, stockId: a.company.id }, parties: [a.sharma.id, a.gupta.id] },
    { ctx: bOwner, viewer: { ...bOwner, role: "viewer" as const }, parties: [(await createParty(db, bOwner, { name: "Mehta Cloth" })).id, (await createParty(db, bOwner, { name: "Gupta Traders" })).id] },
  ];
  const keys = [
    { itemId: a.d4012.id, unit: null as string | null },
    { itemId: a.d4012.id, unit: "dabba" },
    { itemId: a.cotton.id, unit: null },
  ];
  return { db, firms, keys, lowLevel: new Map([[a.d4012.id, 1000], [a.cotton.id, 1000]]) };
}

type World = Awaited<ReturnType<typeof world>>;

/** What this test knows independently of the app. */
interface Model {
  /** Goods in ± counts/adjustments/undos, by unit key (centi). */
  moved: Map<string, number>;
  stockBatches: { batchId: string; change: Map<string, number>; undone: boolean }[];
  orders: { firm: number; orderId: string; rev: number; cancelled: boolean }[];
  sends: { firm: number; dispatchId: string; rev: number; cancelled: boolean; qty: Map<string, number> }[];
  captures: { firm: number; kind: "order" | "send"; input: Parameters<typeof createOrder>[2] | Parameters<typeof createDispatch>[2] }[];
}

const add = (m: Map<string, number>, k: string, q: number) => m.set(k, (m.get(k) ?? 0) + q);
const toLines = (w: World, ls: { key: number; qty: number }[]) => ls.map((l) => ({ itemId: w.keys[l.key].itemId, unit: w.keys[l.key].unit, quantity: centiToDecimal(l.qty) }));
const qtyOf = (w: World, ls: { key: number; qty: number }[]) => {
  const m = new Map<string, number>();
  for (const l of ls) add(m, unitKey(w.keys[l.key].itemId, w.keys[l.key].unit), l.qty);
  return m;
};
const sentNow = (m: Model) => {
  const out = new Map<string, number>();
  for (const d of m.sends) if (!d.cancelled) for (const [k, q] of d.qty) add(out, k, q);
  return out;
};

/** Everything the screens show, to compare before and after a refused action. */
async function snapshot(w: World) {
  const [stock, p0, p1] = await Promise.all([stockOverview(w.db, w.firms[0].viewer), getPending(w.db, w.firms[0].viewer), getPending(w.db, w.firms[1].viewer)]);
  return JSON.stringify([stock, p0.lines, p1.lines]);
}

const expected = (e: unknown, ...codes: string[]) => e instanceof LedgerError && codes.includes(e.code);
let n = 0;
const capture = () => `p-${++n}-${Math.random().toString(36).slice(2)}`;

async function run(w: World, m: Model, a: Action): Promise<{ refused?: boolean; checkFifo?: { firm: number; dispatchId: string }; applied?: { firm: number; orderId: string } }> {
  const { db } = w;
  switch (a.t) {
    case "in":
    case "count":
    case "adjust": {
      const k = w.keys[a.key];
      const quantity = a.t === "adjust" && a.minus ? `-${centiToDecimal(a.qty)}` : centiToDecimal(a.qty);
      const kind = a.t === "in" ? "receipt" : a.t === "count" ? "count" : "adjustment";
      const r = await recordStock(db, w.firms[a.firm].ctx, { ...app, captureId: capture(), kind, date: TODAY, reason: "test", lines: [{ itemId: k.itemId, unit: k.unit, quantity }] });
      const uk = unitKey(k.itemId, k.unit);
      const before = (m.moved.get(uk) ?? 0) - (sentNow(m).get(uk) ?? 0);
      const change = a.t === "count" ? a.qty - before : a.t === "adjust" && a.minus ? -a.qty : a.qty;
      // A count records the difference from what the app thought was there.
      expect(r.lines[0]).toMatchObject({ before, change, after: before + change });
      add(m.moved, uk, change);
      m.stockBatches.push({ batchId: r.batchId, change: new Map([[uk, change]]), undone: false });
      return {};
    }
    case "undoStock": {
      const b = m.stockBatches[a.pick % Math.max(1, m.stockBatches.length)];
      if (!b) return {};
      try {
        await reverseStockEntry(db, w.firms[0].ctx, b.batchId, "test");
      } catch (e) {
        if (b.undone && expected(e, "ALREADY_CANCELLED")) return { refused: true };
        throw e;
      }
      expect(b.undone, "undoing twice must be refused").toBe(false);
      b.undone = true;
      for (const [k, q] of b.change) add(m.moved, k, -q);
      return {};
    }
    case "order": {
      const f = w.firms[a.firm];
      const input = { ...app, captureId: capture(), partyId: f.parties[a.party], orderDate: addDays(TODAY, -a.day), lines: toLines(w, a.lines), applyUnmatched: a.applyUnmatched };
      const r = await createOrder(db, f.ctx, input);
      m.orders.push({ firm: a.firm, orderId: r.orderId, rev: 1, cancelled: false });
      m.captures.push({ firm: a.firm, kind: "order", input });
      return a.applyUnmatched ? { applied: { firm: a.firm, orderId: r.orderId } } : {};
    }
    case "fixOrder": {
      const o = m.orders[a.pick % Math.max(1, m.orders.length)];
      if (!o) return {};
      const f = w.firms[o.firm];
      const { lines: ls } = await loadState(db, f.ctx.companyId, { orderId: o.orderId });
      const target = ls[a.line % ls.length];
      const [rev] = await db.select().from(s.orderRevisions).where(eq(s.orderRevisions.orderId, o.orderId)).orderBy(desc(s.orderRevisions.rev)).limit(1);
      try {
        await correctOrder(db, f.ctx, o.orderId, {
          baseRev: o.rev,
          partyId: rev.partyId,
          orderDate: rev.orderDate,
          lines: ls.map((l) => ({ orderLineId: l.orderLineId, itemId: l.itemId, unit: l.unit, quantity: centiToDecimal(l === target ? a.qty : l.ordered) })),
        });
      } catch (e) {
        if (o.cancelled && expected(e, "ALREADY_CANCELLED")) return { refused: true };
        if (a.qty < target.dispatched && expected(e, "BELOW_DISPATCHED")) return { refused: true };
        throw e;
      }
      expect(o.cancelled, "a cancelled order cannot be corrected").toBe(false);
      expect(a.qty, "cannot go below what was sent").toBeGreaterThanOrEqual(target.dispatched);
      o.rev++;
      return {};
    }
    case "cancelOrder": {
      const o = m.orders[a.pick % Math.max(1, m.orders.length)];
      if (!o) return {};
      try {
        await cancelOrder(db, w.firms[o.firm].ctx, o.orderId, { baseRev: o.rev, reason: "test" });
      } catch (e) {
        if (o.cancelled && expected(e, "ALREADY_CANCELLED")) return { refused: true };
        throw e;
      }
      o.cancelled = true;
      o.rev++;
      return {};
    }
    case "send": {
      const f = w.firms[a.firm];
      const input = { ...app, captureId: capture(), partyId: f.parties[a.party], dispatchDate: addDays(TODAY, -a.day), lines: toLines(w, a.lines) };
      const r = await createDispatch(db, f.ctx, input);
      m.sends.push({ firm: a.firm, dispatchId: r.dispatchId, rev: 1, cancelled: false, qty: qtyOf(w, a.lines) });
      m.captures.push({ firm: a.firm, kind: "send", input });
      return { checkFifo: { firm: a.firm, dispatchId: r.dispatchId } };
    }
    case "fixSend": {
      const d = m.sends[a.pick % Math.max(1, m.sends.length)];
      if (!d) return {};
      const [rev] = await db.select().from(s.dispatchRevisions).where(eq(s.dispatchRevisions.dispatchId, d.dispatchId)).orderBy(desc(s.dispatchRevisions.rev)).limit(1);
      try {
        await correctDispatch(db, w.firms[d.firm].ctx, d.dispatchId, { baseRev: d.rev, partyId: rev.partyId, dispatchDate: rev.dispatchDate, lines: toLines(w, a.lines) });
      } catch (e) {
        if (d.cancelled && expected(e, "ALREADY_CANCELLED")) return { refused: true };
        throw e;
      }
      expect(d.cancelled, "a cancelled dispatch cannot be corrected").toBe(false);
      d.rev++;
      d.qty = qtyOf(w, a.lines);
      return { checkFifo: { firm: d.firm, dispatchId: d.dispatchId } };
    }
    case "cancelSend": {
      const d = m.sends[a.pick % Math.max(1, m.sends.length)];
      if (!d) return {};
      try {
        await cancelDispatch(db, w.firms[d.firm].ctx, d.dispatchId, { baseRev: d.rev, reason: "test" });
      } catch (e) {
        if (d.cancelled && expected(e, "ALREADY_CANCELLED")) return { refused: true };
        throw e;
      }
      d.cancelled = true;
      d.rev++;
      return {};
    }
    case "link": {
      // Link the first unmatched line that has a matching open order line, partly.
      const f = w.firms[a.firm];
      const st = await loadState(db, f.ctx.companyId);
      const pairs = st.dispatchLines
        .filter((d) => unmatched(d) > 0)
        .flatMap((d) => st.lines.filter((o) => balance(o) > 0 && o.partyId === d.partyId && o.itemId === d.itemId && o.unit === d.unit).map((o) => ({ d, o })));
      const p = pairs[a.pick % Math.max(1, pairs.length)];
      if (!p) {
        // Linking more than is unmatched must be refused (and change nothing).
        const d = st.dispatchLines[0];
        const o = st.lines.find((x) => d && x.partyId === d.partyId && x.itemId === d.itemId && x.unit === d.unit && balance(x) > 0);
        if (!d || !o) return {};
        await expect(linkUnmatched(db, f.ctx, { dispatchLineId: d.dispatchLineId, orderLineId: o.orderLineId, quantity: centiToDecimal(unmatched(d) + 1) })).rejects.toMatchObject({ code: "LINK_EXCEEDS" });
        return { refused: true };
      }
      const q = Math.max(1, Math.floor(Math.min(unmatched(p.d), balance(p.o)) / 2));
      await linkUnmatched(db, f.ctx, { dispatchLineId: p.d.dispatchLineId, orderLineId: p.o.orderLineId, quantity: centiToDecimal(q) });
      return {};
    }
    case "retry": {
      // The same capture sent again (bad network, double tap): nothing new is saved.
      const c = m.captures[a.pick % Math.max(1, m.captures.length)];
      if (!c) return {};
      const ctx = w.firms[c.firm].ctx;
      const r = c.kind === "order" ? await createOrder(db, ctx, c.input as Parameters<typeof createOrder>[2]) : await createDispatch(db, ctx, c.input as Parameters<typeof createDispatch>[2]);
      expect(r.duplicate).toBe(true);
      return { refused: true };
    }
  }
}

async function check(w: World, m: Model, step: string, last: Awaited<ReturnType<typeof run>>) {
  const { db } = w;
  const why = (s2: string) => `${step}: ${s2}`;
  const sent = sentNow(m);

  // ---- stock screen (same numbers whichever firm looks at it)
  const stock = await stockOverview(db, w.firms[0].viewer);
  expect(await stockOverview(db, w.firms[1].viewer), why("both firms see the same godown")).toEqual(stock);
  for (const k of w.keys) {
    const uk = unitKey(k.itemId, k.unit);
    const row = stock.find((r) => r.itemId === k.itemId && r.unitCode === k.unit);
    const inStock = (m.moved.get(uk) ?? 0) - (sent.get(uk) ?? 0);
    if (!row) {
      expect(inStock, why(`missing row for ${uk}`)).toBe(0);
      continue;
    }
    expect(row.inStock, why(`in stock ${uk}`)).toBe(inStock);
    expect(row.free, why(`free ${uk}`)).toBe(row.inStock - row.owed);
    expect(row.low, why(`low ${uk}`)).toBe(row.free <= row.lowLevel);
    expect(row.lowLevel).toBe(w.lowLevel.get(k.itemId));
  }

  // ---- ledger consistency, per firm
  const owedAll = new Map<string, number>();
  for (const [fi, f] of w.firms.entries()) {
    const st = await loadState(db, f.ctx.companyId);
    let given = 0;
    let taken = 0;
    for (const l of st.lines) {
      expect(l.dispatched, why("order line got a negative quantity")).toBeGreaterThanOrEqual(0);
      expect(l.dispatched, why("order line got more than ordered")).toBeLessThanOrEqual(l.ordered);
      taken += l.dispatched;
      add(owedAll, unitKey(l.itemId, l.unit), balance(l));
    }
    for (const d of st.dispatchLines) {
      expect(d.allocated, why("dispatch line allocated negative")).toBeGreaterThanOrEqual(0);
      expect(d.allocated, why("dispatch line gave away more than it sent")).toBeLessThanOrEqual(d.quantity);
      given += d.allocated;
    }
    expect(taken, why("what orders received ≠ what dispatches gave")).toBe(given);

    // Dispatches the app counts = dispatches this test made and did not cancel.
    const appSent = new Map<string, number>();
    for (const d of st.dispatchLines) add(appSent, unitKey(d.itemId, d.unit), d.quantity);
    const mine = new Map<string, number>();
    for (const d of m.sends) if (d.firm === fi && !d.cancelled) for (const [k, q] of d.qty) add(mine, k, q);
    expect(Object.fromEntries([...appSent].filter(([, q]) => q))).toEqual(Object.fromEntries([...mine].filter(([, q]) => q)));

    // Pending screen, report pending, unmatched badge.
    const pending = await getPending(db, f.viewer);
    const pTotal = pending.lines.reduce((t, l) => t + balance(l), 0);
    for (const rows of [pending.byParty, pending.byItem]) {
      expect(rows.reduce((t, r) => t + r.balance, 0), why("pending groups ≠ pending lines")).toBe(pTotal);
      for (const r of rows) expect(r.ordered, why("pending: ordered = sent + cancelled + balance")).toBe(r.sent + r.cancelled + r.balance);
    }

    const report = await buildReport(db, f.viewer, { from: addDays(TODAY, -10), to: TODAY });
    const rPending = report.pending.byItem.reduce((t, i) => t + i.pending, 0);
    expect(rPending, why("report pending ≠ pending screen")).toBe(pTotal);
    const sumUnits = (rows: { qty: Record<string, number> }[]) => {
      const out: Record<string, number> = {};
      for (const r of rows) for (const [u, q] of Object.entries(r.qty)) out[u] = (out[u] ?? 0) + q;
      return out;
    };
    expect(sumUnits(report.dispatched.byDay), why("report: by day ≠ total")).toEqual(report.dispatched.total);
    expect(sumUnits(report.dispatched.byParty), why("report: by client ≠ total")).toEqual(report.dispatched.total);
    const byItem: Record<string, number> = {};
    for (const i of report.dispatched.byItem) byItem[i.unit] = (byItem[i.unit] ?? 0) + i.qty;
    expect(byItem, why("report: by item ≠ total")).toEqual(report.dispatched.total);
    expect(Object.values(report.dispatched.total).reduce((a2, b2) => a2 + b2, 0), why("report total ≠ dispatches")).toBe([...mine.values()].reduce((a2, b2) => a2 + b2, 0));
    for (const i of report.orders.byItem) expect(i.ordered, why(`ordered = sent + pending + cancelled for ${i.name}`)).toBe(i.sent + i.pending + i.cancelled);

    const badge = await unmatchedCount(db, f.ctx.companyId);
    expect(badge.lines, why("unmatched badge")).toBe(st.dispatchLines.filter((d) => unmatched(d) > 0).length);

    // FIFO: right after a dispatch, anything unmatched means nothing more is owed for it.
    if (last.checkFifo?.firm === fi) {
      for (const d of st.dispatchLines.filter((x) => x.dispatchId === last.checkFifo!.dispatchId && unmatched(x) > 0)) {
        const stillOwed = st.lines.filter((l) => l.partyId === d.partyId && l.itemId === d.itemId && l.unit === d.unit).reduce((t, l) => t + balance(l), 0);
        expect(stillOwed, why("dispatch left goods unmatched while the client still owed that item")).toBe(0);
      }
    }
    // Applying unmatched to a new order: either nothing unmatched is left or the order is full.
    if (last.applied?.firm === fi) {
      for (const l of st.lines.filter((x) => x.orderId === last.applied!.orderId)) {
        const left = st.dispatchLines.filter((d) => d.partyId === l.partyId && d.itemId === l.itemId && d.unit === l.unit).reduce((t, d) => t + unmatched(d), 0);
        expect(left === 0 || balance(l) === 0, why("new order skipped goods already sent")).toBe(true);
      }
    }
  }
  // Owed on the stock screen = both firms' pending, together.
  for (const row of stock) expect(row.owed, why(`owed ${row.name} ${row.unit}`)).toBe(owedAll.get(unitKey(row.itemId, row.unitCode)) ?? 0);
}

describe("random histories keep every number consistent", () => {
  it(
    "stock, orders, dispatches, links and reports across two firms sharing a godown",
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(action, { minLength: 5, maxLength: 28 }), async (actions) => {
          const w = await world();
          const m: Model = { moved: new Map(), stockBatches: [], orders: [], sends: [], captures: [] };
          for (const [i, a] of actions.entries()) {
            const before = await snapshot(w);
            const r = await run(w, m, a);
            if (r.refused) expect(await snapshot(w), `step ${i} ${a.t}: a refused action changed something`).toBe(before);
            await check(w, m, `step ${i} ${JSON.stringify(a)}`, r);
          }
        }),
        {
          numRuns: RUNS,
          seed: process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined,
          path: process.env.FC_PATH,
          endOnFailure: !process.env.FC_SHRINK, // FC_SHRINK=1 to cut a failure down to the shortest history (slow)
        },
      );
    },
    RUNS * 30_000,
  );
});

// ---------------------------------------------------------------- pure functions

describe("quantities never drift", () => {
  it("centi ↔ decimal round-trips for every quantity", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9_999_999_999 }), (c) => {
        expect(toCenti(centiToDecimal(c))).toBe(c);
      }),
    );
  });
  it("adding as typed equals adding in centi (no float error)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 50 }), (cs) => {
        const typed = cs.map(centiToDecimal);
        expect(typed.reduce((t, x) => t + toCenti(x), 0)).toBe(cs.reduce((t, x) => t + x, 0));
      }),
    );
  });
  it("rejects anything that is not a plain amount with at most 2 decimals", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constantFrom("", "-1", "1.234", "1e3", "abc", "1,000", " . ", "NaN", "Infinity", "0x10", "1.2.3", "+-1"), fc.string().filter((x) => !/^\s*\d+(\.\d{1,2})?\s*$/.test(x))), (bad) => {
        expect(() => toCenti(bad)).toThrow();
      }),
    );
  });
});

describe("dates read the same on the server and the phone", () => {
  const ist = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...o });
  const instant = fc.date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true });

  it("time of day in India, for any moment", () => {
    fc.assert(
      fc.property(instant, (d) => {
        expect(formatTimeIST(d)).toBe(ist(d, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, " ").toLowerCase());
      }),
    );
  });
  it("calendar day and weekday, for any date", () => {
    fc.assert(
      fc.property(instant, (d) => {
        const day = todayIST(d);
        const [y, mo, da] = day.split("-").map(Number);
        const noon = new Date(Date.UTC(y, mo - 1, da, 6, 30)); // noon in India that day
        // Node writes "Sept" for en-IN where phones write "Sep"; ours is always "Sep".
        expect(formatDay(day, { weekday: true, year: true })).toBe(`${ist(noon, { weekday: "short" })}, ${ist(noon, { day: "numeric", month: "short" }).replace("Sept", "Sep")} ${y}`);
        expect(formatDateTimeIST(d)).toBe(`${formatDay(day)}, ${formatTimeIST(d)}`);
      }),
    );
  });
  it("midnight and noon edges", () => {
    expect(formatTimeIST(new Date("2026-10-20T18:30:00Z"))).toBe("12:00 am"); // midnight in India
    expect(formatTimeIST(new Date("2026-10-20T06:30:00Z"))).toBe("12:00 pm");
    expect(formatDateTimeIST(new Date("2026-10-20T18:29:00Z"))).toBe("20 Oct, 11:59 pm");
    expect(formatDateTimeIST(new Date("2026-10-20T18:30:00Z"))).toBe("21 Oct, 12:00 am");
    expect(formatDay("2028-02-29", { weekday: true, year: true })).toBe("Tue, 29 Feb 2028");
  });
});
