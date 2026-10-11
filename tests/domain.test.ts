import { describe, expect, it } from "vitest";
import {
  aggregatePending,
  balance,
  cancelledQty,
  isOverdue,
  planApplyUnmatched,
  planFifo,
  type DispatchLineState,
  type LineState,
} from "@/ledger/domain";

const P = "party-sharma";
const ITEM = "item-d4012";

let seq = 0;
function line(p: Partial<LineState> & { ordered: number }): LineState {
  seq++;
  return {
    orderLineId: `ol-${seq}`,
    orderId: `o-${seq}`,
    lineNo: 1,
    partyId: P,
    itemId: ITEM,
    unit: null,
    orderDate: "2026-10-01",
    promisedDate: null,
    orderCreatedAt: new Date(2026, 9, 1, 0, 0, seq),
    status: "open",
    dispatched: 0,
    ...p,
  };
}

describe("balance", () => {
  it("is ordered minus dispatched", () => {
    expect(balance(line({ ordered: 2000, dispatched: 1400 }))).toBe(600);
  });
  it("is zero for a cancelled (short-closed) order, with the rest counted as cancelled", () => {
    const l = line({ ordered: 2000, dispatched: 1000, status: "cancelled" });
    expect(balance(l)).toBe(0);
    expect(cancelledQty(l)).toBe(1000);
  });
});

describe("FIFO allocation", () => {
  it("fills the oldest open order first and spans orders", () => {
    const older = line({ ordered: 1000, orderDate: "2026-09-20" });
    const newer = line({ ordered: 1000, orderDate: "2026-10-01" });
    const [plan] = planFifo(P, [newer, older], [{ itemId: ITEM, quantity: 1500 }]);
    expect(plan.allocations.map((a) => [a.orderLineId, a.quantity, a.balanceAfter])).toEqual([
      [older.orderLineId, 1000, 0],
      [newer.orderLineId, 500, 500],
    ]);
    expect(plan.unmatched).toBe(0);
  });

  it("breaks same-date ties by entry time", () => {
    const first = line({ ordered: 500, orderCreatedAt: new Date("2026-10-01T05:00:00Z") });
    const second = line({ ordered: 500, orderCreatedAt: new Date("2026-10-01T06:00:00Z") });
    const [plan] = planFifo(P, [second, first], [{ itemId: ITEM, quantity: 500 }]);
    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0].orderLineId).toBe(first.orderLineId);
  });

  it("skips partly sent quantity already counted", () => {
    const l = line({ ordered: 2000, dispatched: 1500 });
    const [plan] = planFifo(P, [l], [{ itemId: ITEM, quantity: 500 }]);
    expect(plan.allocations[0]).toMatchObject({ quantity: 500, balanceAfter: 0 });
  });

  it("puts over-dispatch into unmatched", () => {
    const l = line({ ordered: 600 });
    const [plan] = planFifo(P, [l], [{ itemId: ITEM, quantity: 1000 }]);
    expect(plan.allocations[0].quantity).toBe(600);
    expect(plan.unmatched).toBe(400);
  });

  it("is fully unmatched when the party has no open order for the item", () => {
    const otherItem = line({ ordered: 1000, itemId: "other" });
    const otherParty = line({ ordered: 1000, partyId: "other" });
    const cancelled = line({ ordered: 1000, status: "cancelled" });
    const [plan] = planFifo(P, [otherItem, otherParty, cancelled], [{ itemId: ITEM, quantity: 300 }]);
    expect(plan.allocations).toEqual([]);
    expect(plan.unmatched).toBe(300);
  });

  it("lets two dispatch lines of the same item share the pool without double counting", () => {
    const l = line({ ordered: 1000 });
    const plan = planFifo(P, [l], [
      { itemId: ITEM, quantity: 700 },
      { itemId: ITEM, quantity: 700 },
    ]);
    expect(plan[0].allocations[0].quantity).toBe(700);
    expect(plan[1].allocations[0].quantity).toBe(300);
    expect(plan[1].unmatched).toBe(400);
  });

  it("does not mutate the input lines", () => {
    const l = line({ ordered: 1000 });
    planFifo(P, [l], [{ itemId: ITEM, quantity: 1000 }]);
    expect(l.dispatched).toBe(0);
  });
});

describe("units are kept apart (saved as said, never converted)", () => {
  it("dabba fills only dabba orders; pieces fill only piece orders", () => {
    const pcs = line({ ordered: 2000 });
    const dabba = line({ ordered: 300, unit: "dabba" });
    const plan = planFifo(P, [pcs, dabba], [
      { itemId: ITEM, quantity: 200, unit: "dabba" },
      { itemId: ITEM, quantity: 500, unit: null },
      { itemId: ITEM, quantity: 100, unit: "bora" },
    ]);
    expect(plan[0].allocations.map((a) => [a.orderLineId, a.quantity])).toEqual([[dabba.orderLineId, 200]]);
    expect(plan[1].allocations.map((a) => [a.orderLineId, a.quantity])).toEqual([[pcs.orderLineId, 500]]);
    expect(plan[2]).toMatchObject({ unit: "bora", allocations: [], unmatched: 100 });
  });
});

describe("apply unmatched to a new order", () => {
  const d = (p: Partial<DispatchLineState> & { quantity: number }): DispatchLineState => ({
    dispatchLineId: `dl-${++seq}`,
    dispatchId: `d-${seq}`,
    partyId: P,
    itemId: ITEM,
    unit: null,
    dispatchDate: "2026-10-05",
    dispatchCreatedAt: new Date(2026, 9, 5, 0, 0, seq),
    allocated: 0,
    ...p,
  });

  it("uses the oldest unmatched first and stops at the order's balance", () => {
    const newer = d({ quantity: 500, dispatchDate: "2026-10-06" });
    const older = d({ quantity: 500, allocated: 200, dispatchDate: "2026-10-02" });
    const order = line({ ordered: 600 });
    const links = planApplyUnmatched([newer, older], [order]);
    expect(links).toEqual([
      { dispatchLineId: older.dispatchLineId, orderLineId: order.orderLineId, quantity: 300 },
      { dispatchLineId: newer.dispatchLineId, orderLineId: order.orderLineId, quantity: 300 },
    ]);
  });

  it("only matches same party and item", () => {
    const links = planApplyUnmatched(
      [d({ quantity: 500, itemId: "x" }), d({ quantity: 500, partyId: "y" })],
      [line({ ordered: 600 })],
    );
    expect(links).toEqual([]);
  });
});

describe("overdue", () => {
  const today = "2026-10-08";
  it("is overdue after the promised date", () => {
    expect(isOverdue(line({ ordered: 100, promisedDate: "2026-10-07" }), today)).toBe(true);
    expect(isOverdue(line({ ordered: 100, promisedDate: "2026-10-08" }), today)).toBe(false);
  });
  it("uses more than 4 days old when there is no promised date", () => {
    expect(isOverdue(line({ ordered: 100, orderDate: "2026-10-04" }), today)).toBe(false); // 4 days
    expect(isOverdue(line({ ordered: 100, orderDate: "2026-10-03" }), today)).toBe(true); // 5 days
  });
  it("promised date in the future overrides age", () => {
    expect(isOverdue(line({ ordered: 100, orderDate: "2026-09-01", promisedDate: "2026-10-20" }), today)).toBe(false);
  });
  it("is never overdue with no balance", () => {
    expect(isOverdue(line({ ordered: 100, dispatched: 100, orderDate: "2026-09-01" }), today)).toBe(false);
    expect(isOverdue(line({ ordered: 100, status: "cancelled", orderDate: "2026-09-01" }), today)).toBe(false);
  });
});

describe("pending aggregation", () => {
  it("sums by key and reports the oldest pending age", () => {
    const rows = aggregatePending(
      [
        line({ ordered: 2000, dispatched: 1400, orderDate: "2026-10-01" }),
        line({ ordered: 1000, dispatched: 1000, orderDate: "2026-09-01" }), // done; not counted in age
        line({ ordered: 500, dispatched: 200, status: "cancelled" }),
      ],
      (l) => l.partyId,
      "2026-10-08",
    );
    expect(rows).toEqual([
      { key: P, ordered: 3500, sent: 2600, cancelled: 300, balance: 600, oldestDays: 7, overdueLines: 1 },
    ]);
  });
});
