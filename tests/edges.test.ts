/**
 * Edge cases of the pure calculation code, written from the gaps mutation
 * testing found (planted bugs no other test noticed): who gets goods first
 * when orders tie, how sent-before-ordered goods are applied, ages and
 * overdue counts, quantity limits and signs, date helpers, and every way a
 * unit is said.
 */
import { describe, expect, it } from "vitest";
import { aggregatePending, fifoCompare, planApplyUnmatched, planFifo, type DispatchLineState, type LineState } from "@/ledger/domain";
import { centiToDecimal, formatQty, toCenti, toPositiveCenti } from "@/lib/qty";
import { addDays, assertEntryDate, assertPromisedDate, isValidDate, pastDay } from "@/lib/dates";
import { canonicalUnit, needsPieces, PACKING_UNITS, sameUnit, storedUnit, unitChoices, unitKey, unitLabel } from "@/lib/units";

const NOW = new Date("2026-10-08T09:30:00Z"); // 15:00 in India, 8 Oct

let seq = 0;
function line(p: Partial<LineState> & { ordered: number }): LineState {
  seq++;
  return {
    orderLineId: `ol-${seq}`,
    orderId: `o-${seq}`,
    lineNo: 1,
    partyId: "P",
    itemId: "I",
    unit: null,
    orderDate: "2026-10-01",
    promisedDate: null,
    orderCreatedAt: new Date("2026-10-01T05:00:00Z"),
    status: "open",
    dispatched: 0,
    ...p,
  };
}
function sent(p: Partial<DispatchLineState> & { quantity: number }): DispatchLineState {
  seq++;
  return { dispatchLineId: `dl-${seq}`, dispatchId: `d-${seq}`, partyId: "P", itemId: "I", unit: null, dispatchDate: "2026-10-02", dispatchCreatedAt: new Date("2026-10-02T05:00:00Z"), allocated: 0, ...p };
}
const firstTo = (lines: LineState[], qty = 100) => planFifo("P", lines, [{ itemId: "I", quantity: qty }])[0].allocations.map((a) => a.orderLineId);

describe("who gets goods first (FIFO tie-breaks)", () => {
  it("older order date first, whatever order they come in", () => {
    const a = line({ ordered: 100, orderDate: "2026-10-03", orderLineId: "a" });
    const b = line({ ordered: 100, orderDate: "2026-10-02", orderLineId: "b" });
    expect(firstTo([a, b])).toEqual(["b"]);
    expect(firstTo([b, a])).toEqual(["b"]);
    expect(fifoCompare(a, b)).toBeGreaterThan(0);
    expect(fifoCompare(b, a)).toBeLessThan(0);
  });
  it("same date: the one entered first", () => {
    const late = line({ ordered: 100, orderLineId: "late", orderId: "o-a", orderCreatedAt: new Date("2026-10-01T09:00:00Z") });
    const early = line({ ordered: 100, orderLineId: "early", orderId: "o-z", orderCreatedAt: new Date("2026-10-01T08:00:00Z") });
    expect(firstTo([late, early])).toEqual(["early"]);
    expect(fifoCompare(late, early)).toBeGreaterThan(0);
  });
  it("same date and moment: by order id, then line number", () => {
    const at = new Date("2026-10-01T08:00:00Z");
    const o2 = line({ ordered: 100, orderLineId: "o2", orderId: "o-2", orderCreatedAt: at });
    const o1 = line({ ordered: 100, orderLineId: "o1", orderId: "o-1", orderCreatedAt: at });
    expect(firstTo([o2, o1])).toEqual(["o1"]);
    expect(fifoCompare(o2, o1)).toBe(1);
    expect(fifoCompare(o1, o2)).toBe(-1);
    const l2 = line({ ordered: 100, orderLineId: "l2", orderId: "o-1", lineNo: 2, orderCreatedAt: at });
    const l1 = line({ ordered: 100, orderLineId: "l1", orderId: "o-1", lineNo: 1, orderCreatedAt: at });
    expect(firstTo([l2, l1])).toEqual(["l1"]);
    expect(fifoCompare(l2, l1)).toBe(1);
    expect(fifoCompare(l1, l1)).toBe(0);
  });
  it("lines already fully sent or of another client are skipped", () => {
    const full = line({ ordered: 100, dispatched: 100, orderLineId: "full", orderDate: "2026-09-01" });
    const other = line({ ordered: 100, orderLineId: "other", partyId: "Q", orderDate: "2026-09-01" });
    const open = line({ ordered: 100, orderLineId: "open" });
    const plan = planFifo("P", [full, other, open], [{ itemId: "I", quantity: 150 }])[0];
    expect(plan.allocations).toEqual([expect.objectContaining({ orderLineId: "open", quantity: 100, balanceAfter: 0 })]);
    expect(plan.unmatched).toBe(50);
  });
  it("two dispatch lines of one item share the balance, never both taking it", () => {
    const o = line({ ordered: 100, orderLineId: "o" });
    const [x, y] = planFifo("P", [o], [{ itemId: "I", quantity: 60 }, { itemId: "I", quantity: 60 }]);
    expect(x.allocations[0].quantity).toBe(60);
    expect(y.allocations[0].quantity).toBe(40);
    expect(y.unmatched).toBe(20);
  });
});

describe("goods sent before the order was entered", () => {
  it("oldest dispatch first; same day: the one entered first", () => {
    const newer = sent({ quantity: 50, dispatchLineId: "newer", dispatchDate: "2026-10-03" });
    const older = sent({ quantity: 50, dispatchLineId: "older", dispatchDate: "2026-10-02" });
    const sameDayLate = sent({ quantity: 50, dispatchLineId: "late", dispatchDate: "2026-10-02", dispatchCreatedAt: new Date("2026-10-02T09:00:00Z") });
    const o = line({ ordered: 60, orderLineId: "o" });
    expect(planApplyUnmatched([newer, sameDayLate, older], [o])).toEqual([
      { dispatchLineId: "older", orderLineId: "o", quantity: 50 },
      { dispatchLineId: "late", orderLineId: "o", quantity: 10 },
    ]);
    expect(planApplyUnmatched([older, newer], [o]).map((l) => l.dispatchLineId)).toEqual(["older", "newer"]);
    expect(planApplyUnmatched([newer, older], [o]).map((l) => l.dispatchLineId)).toEqual(["older", "newer"]);
  });
  it("order lines fill by line number; already-matched goods are not used again", () => {
    const d = sent({ quantity: 100, allocated: 30, dispatchLineId: "d" });
    const used = sent({ quantity: 40, allocated: 40, dispatchLineId: "used" });
    const second = line({ ordered: 100, lineNo: 2, orderLineId: "second" });
    const first = line({ ordered: 50, lineNo: 1, orderLineId: "first" });
    expect(planApplyUnmatched([used, d], [second, first])).toEqual([
      { dispatchLineId: "d", orderLineId: "first", quantity: 50 },
      { dispatchLineId: "d", orderLineId: "second", quantity: 20 },
    ]);
  });
  it("only the same client, item and unit", () => {
    const o = line({ ordered: 100, orderLineId: "o", unit: "dabba" });
    const wrong = [sent({ quantity: 10, partyId: "Q", unit: "dabba" }), sent({ quantity: 10, itemId: "J", unit: "dabba" }), sent({ quantity: 10 }), sent({ quantity: 10, unit: "bora" })];
    expect(planApplyUnmatched(wrong, [o])).toEqual([]);
    const right = sent({ quantity: 10, unit: "dabba", dispatchLineId: "r" });
    expect(planApplyUnmatched([...wrong, right], [o])).toEqual([{ dispatchLineId: "r", orderLineId: "o", quantity: 10 }]);
    const pcs = line({ ordered: 5, orderLineId: "pcs" });
    expect(planApplyUnmatched([sent({ quantity: 10, unit: "dabba" }), sent({ quantity: 3, dispatchLineId: "p" })], [pcs])).toEqual([{ dispatchLineId: "p", orderLineId: "pcs", quantity: 3 }]);
  });
  it("stops when the order is full", () => {
    const o = line({ ordered: 30, orderLineId: "o" });
    const links = planApplyUnmatched([sent({ quantity: 20, dispatchLineId: "a" }), sent({ quantity: 20, dispatchLineId: "b" }), sent({ quantity: 20, dispatchLineId: "c" })], [o]);
    expect(links).toEqual([
      { dispatchLineId: "a", orderLineId: "o", quantity: 20 },
      { dispatchLineId: "b", orderLineId: "o", quantity: 10 },
    ]);
  });
});

describe("pending: ages and overdue counts", () => {
  it("oldest days is the oldest line still owed; fully sent lines don't count", () => {
    const rows = aggregatePending(
      [
        line({ ordered: 100, orderDate: "2026-09-20", dispatched: 100 }), // sent in full: no age
        line({ ordered: 100, orderDate: "2026-10-06" }),
        line({ ordered: 100, orderDate: "2026-10-01" }),
        line({ ordered: 100, orderDate: "2026-10-07" }),
      ],
      (l) => l.partyId,
      "2026-10-08",
    );
    expect(rows).toEqual([{ key: "P", ordered: 400, sent: 100, cancelled: 0, balance: 300, oldestDays: 7, overdueLines: 1 }]);
  });
  it("nothing owed: no age, no overdue", () => {
    const rows = aggregatePending([line({ ordered: 100, dispatched: 100, orderDate: "2026-09-01" }), line({ ordered: 50, status: "cancelled", orderDate: "2026-09-01" })], (l) => l.itemId, "2026-10-08");
    expect(rows).toEqual([{ key: "I", ordered: 150, sent: 100, cancelled: 50, balance: 0, oldestDays: null, overdueLines: 0 }]);
  });
  it("overdue counts each late line once, by promised date when there is one", () => {
    const rows = aggregatePending(
      [
        line({ ordered: 100, orderDate: "2026-10-07", promisedDate: "2026-10-07" }), // promised yesterday: late
        line({ ordered: 100, orderDate: "2026-09-01", promisedDate: "2026-10-20" }), // old but promised later: not late
        line({ ordered: 100, orderDate: "2026-10-04" }), // 4 days: not yet
        line({ ordered: 100, orderDate: "2026-10-03" }), // 5 days: late
      ],
      () => "all",
      "2026-10-08",
    );
    expect(rows[0].overdueLines).toBe(2);
    expect(rows[0].oldestDays).toBe(37);
  });
});

describe("quantity limits and signs", () => {
  it("the largest quantity the database holds is accepted, one more is not", () => {
    expect(toCenti("99999999.99")).toBe(9_999_999_999);
    expect(() => toCenti("100000000")).toThrow(expect.objectContaining({ code: "INVALID_QTY" }));
    expect(() => toCenti("99999999999999999999")).toThrow(expect.objectContaining({ code: "INVALID_QTY" }));
  });
  it("a positive quantity passes, zero does not", () => {
    expect(toPositiveCenti("0.01")).toBe(1);
    expect(toPositiveCenti(12)).toBe(1200);
    expect(() => toPositiveCenti("0")).toThrow(expect.objectContaining({ code: "INVALID_QTY" }));
    expect(() => toPositiveCenti("0.00")).toThrow(expect.objectContaining({ code: "INVALID_QTY" }));
  });
  it("negative amounts (stock below zero, adjustments) keep their sign", () => {
    expect(centiToDecimal(-150)).toBe("-1.50");
    expect(centiToDecimal(-5)).toBe("-0.05");
    expect(centiToDecimal(0)).toBe("0.00");
    expect(formatQty(-1400)).toBe("-14");
    expect(formatQty(-1450)).toBe("-14.5");
    expect(formatQty(0)).toBe("0");
    expect(formatQty(1000)).toBe("10");
    expect(formatQty(1005)).toBe("10.05");
  });
  it("numbers as the phone sends them", () => {
    expect(toCenti(12.5)).toBe(1250);
    expect(toCenti(" 7 ")).toBe(700);
    expect(() => toCenti(0.1 + 0.2)).toThrow(expect.objectContaining({ code: "INVALID_QTY" }));
    expect(() => toCenti(-1)).toThrow(expect.objectContaining({ code: "INVALID_QTY" }));
  });
});

describe("date helpers", () => {
  it("only a whole YYYY-MM-DD that exists is a date", () => {
    for (const ok of ["2026-10-08", "2028-02-29", "2000-02-29"]) expect(isValidDate(ok), ok).toBe(true);
    for (const bad of ["2026-02-29", "1900-02-29", "2026-13-01", "2026-10-32", "x2026-10-08", "2026-10-08x", "2026-10-08T00:00", "26-10-08", "2026-1-8", ""]) expect(isValidDate(bad), bad).toBe(false);
  });
  it("entry dates: today or before", () => {
    expect(() => assertEntryDate("2026-10-08", NOW)).not.toThrow();
    expect(() => assertEntryDate("2020-01-01", NOW)).not.toThrow();
    expect(() => assertEntryDate("2026-10-09", NOW)).toThrow(expect.objectContaining({ code: "FUTURE_DATE", details: { date: "2026-10-09", today: "2026-10-08" } }));
    expect(() => assertEntryDate("2026-10-xx", NOW)).toThrow(expect.objectContaining({ code: "INVALID_DATE" }));
    // 23:59 in India on the 8th is still the 8th; 00:00 on the 9th allows the 9th.
    expect(() => assertEntryDate("2026-10-09", new Date("2026-10-08T18:29:00Z"))).toThrow();
    expect(() => assertEntryDate("2026-10-09", new Date("2026-10-08T18:30:00Z"))).not.toThrow();
  });
  it("promised dates: any real date, past or future", () => {
    expect(() => assertPromisedDate("2030-01-01")).not.toThrow();
    expect(() => assertPromisedDate("2020-01-01")).not.toThrow();
    expect(() => assertPromisedDate("2026-02-30")).toThrow(expect.objectContaining({ code: "INVALID_DATE" }));
  });
  it("adding days crosses months, years and leap days", () => {
    expect(addDays("2026-10-08", 1)).toBe("2026-10-09");
    expect(addDays("2026-10-08", -8)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-10-08", 0)).toBe("2026-10-08");
    expect(addDays("2026-10-08", 365)).toBe("2027-10-08");
  });
  it("a History day must be a real day before today", () => {
    expect(pastDay("2026-10-07", NOW)).toBe("2026-10-07");
    expect(pastDay("2026-10-08", NOW)).toBeUndefined(); // today
    expect(pastDay("2026-10-09", NOW)).toBeUndefined(); // future
    expect(pastDay("2026-02-30", NOW)).toBeUndefined();
    expect(pastDay("", NOW)).toBeUndefined();
    expect(pastDay(undefined, NOW)).toBeUndefined();
  });
});

describe("units, however they are said", () => {
  const said: [string, string][] = [
    ["pc", "pcs"], ["pcs", "pcs"], ["piece", "pcs"], ["pieces", "pcs"], ["peace", "pcs"], ["PCS", "pcs"], [" Pieces ", "pcs"], ["पीस", "pcs"], ["ਪੀਸ", "pcs"],
    ["m", "meter"], ["mtr", "meter"], ["mtrs", "meter"], ["meter", "meter"], ["meters", "meter"], ["metre", "meter"], ["metres", "meter"], ["मीटर", "meter"], ["ਮੀਟਰ", "meter"],
    ["kg", "kg"], ["kgs", "kg"], ["kilo", "kg"], ["किलो", "kg"], ["ਕਿਲੋ", "kg"],
    ["than", "thaan"], ["thaan", "thaan"], ["thans", "thaan"], ["थान", "thaan"], ["ਥਾਨ", "thaan"],
    ["nag", "nag"], ["nags", "nag"], ["नग", "nag"], ["नंग", "nag"], ["ਨਗ", "nag"],
    ["bora", "bora"], ["bore", "bora"], ["boras", "bora"], ["bori", "bora"], ["बोरा", "bora"], ["बोरे", "bora"], ["बोरी", "bora"], ["ਬੋਰਾ", "bora"], ["ਬੋਰੇ", "bora"], ["ਬੋਰੀ", "bora"],
    ["dabba", "dabba"], ["dibba", "dabba"], ["box", "dabba"], ["boxes", "dabba"], ["carton", "dabba"], ["डिब्बा", "dabba"], ["डब्बा", "dabba"], ["ਡੱਬਾ", "dabba"], ["ਡੱਬੇ", "dabba"],
  ];
  it.each(said)("%s → %s", (word, unit) => {
    expect(canonicalUnit(word)).toBe(unit);
  });
  it("unknown units stay as said (cleaned)", () => {
    expect(canonicalUnit("Roll")).toBe("roll");
    expect(canonicalUnit("gross pack")).toBe("grosspack");
  });
  it("same unit, said differently", () => {
    expect(sameUnit("mtr", "Meter")).toBe(true);
    expect(sameUnit("pcs", "meter")).toBe(false);
  });
  it("when the piece count must be typed by hand", () => {
    expect(needsPieces(null, "pcs")).toBe(false);
    expect(needsPieces("", "pcs")).toBe(false);
    expect(needsPieces("piece", "pcs")).toBe(false);
    expect(needsPieces("dabba", "pcs")).toBe(true);
    expect(needsPieces("meter", "pcs")).toBe(true);
    // Item not known yet: only packing units need it.
    expect(needsPieces("dabba", null)).toBe(true);
    expect(needsPieces("डिब्बा", undefined)).toBe(true);
    expect(needsPieces("pcs", null)).toBe(false);
    expect(needsPieces("roll", null)).toBe(false);
  });
  it("how a line's unit is saved", () => {
    expect(storedUnit(null, "pcs")).toBeNull();
    expect(storedUnit(undefined, "pcs")).toBeNull();
    expect(storedUnit("  ", "pcs")).toBeNull();
    expect(storedUnit("piece", "pcs")).toBeNull(); // the item's own unit
    expect(storedUnit("Box", "pcs")).toBe("dabba");
    expect(storedUnit("ਬੋਰੀ", "meter")).toBe("bora");
    expect(storedUnit("meter", "pcs")).toBeUndefined(); // neither: not allowed
    expect(storedUnit("roll", "pcs")).toBeUndefined();
  });
  it("dropdown: own unit first, then packing units, never the same twice", () => {
    expect(unitChoices("pcs")).toEqual([{ value: null, label: "pcs" }, ...PACKING_UNITS.map((u) => ({ value: u, label: u }))]);
    expect(unitChoices("thaan").map((c) => c.value)).toEqual([null, "nag", "dabba", "bora"]);
  });
  it("labels and keys", () => {
    expect(unitLabel(null, "pcs")).toBe("pcs");
    expect(unitLabel(undefined, "meter")).toBe("meter");
    expect(unitLabel("dabba", "pcs")).toBe("dabba");
    expect(unitKey("I", null)).toBe("I|");
    expect(unitKey("I", undefined)).toBe("I|");
    expect(unitKey("I", "dabba")).toBe("I|dabba");
    expect(unitKey("I", "dabba")).not.toBe(unitKey("I", null));
  });
});
