/**
 * Bill arithmetic: amounts, GST split, round-off, numbering and words.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { amountInWords, billNumber, computeBill, defaultPrefix, financialYear, formatAmount, formatRupees, hsnSummary, paiseToText, parseRupees } from "@/billing/compute";

describe("bill amounts", () => {
  it("a GST bill in the firm's state: CGST + SGST, rounded to the rupee", () => {
    // 20 pcs × ₹450 at 5%, 12.5 m × ₹99.99 at 5%
    const b = computeBill("gst", [{ quantity: 2000, rate: 45000, gstRate: 500 }, { quantity: 1250, rate: 9999, gstRate: 500 }], { interstate: false });
    expect(b.lines.map((l) => l.taxable)).toEqual([900000, 124988]);
    expect(b.taxable).toBe(1024988);
    expect(b.taxes).toEqual([{ gstRate: 500, taxable: 1024988, cgst: 25625, sgst: 25625, igst: 0 }]);
    expect(b.total).toBe(1076200);
    expect(b.roundOff).toBe(1076200 - (1024988 + 51250));
  });

  it("to another state: IGST only", () => {
    const b = computeBill("gst", [{ quantity: 100, rate: 100000, gstRate: 1800 }], { interstate: true });
    expect([b.cgst, b.sgst, b.igst]).toEqual([0, 0, 18000]);
    expect(b.total).toBe(118000);
  });

  it("groups tax by rate, discount comes off before tax, freight is taxed at the highest rate", () => {
    const b = computeBill(
      "gst",
      [
        { quantity: 1000, rate: 10000, gstRate: 500, discountPct: 1000 }, // ₹1,000 − 10%
        { quantity: 100, rate: 200000, gstRate: 1800 }, // ₹2,000
      ],
      { interstate: false, charges: 50000 },
    );
    expect(b.discount).toBe(10000);
    expect(b.taxes).toEqual([
      { gstRate: 500, taxable: 90000, cgst: 2250, sgst: 2250, igst: 0 },
      { gstRate: 1800, taxable: 250000, cgst: 22500, sgst: 22500, igst: 0 },
    ]);
    expect(b.total).toBe(90000 + 250000 + 4500 + 45000);
  });

  it("a kacha bill has no tax, even if the items have a GST rate", () => {
    const b = computeBill("kacha", [{ quantity: 2000, rate: 45050, gstRate: 500 }], { interstate: false, charges: 2000 });
    expect(b.taxes).toEqual([]);
    expect(b.taxable).toBe(901000 + 2000);
    expect(b.total).toBe(903000);
    expect(b.roundOff).toBe(0);
  });

  it("always adds up, and rounds to a whole rupee by at most 50 paise", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("gst" as const, "kacha" as const),
        fc.boolean(),
        fc.array(fc.record({ quantity: fc.integer({ min: 1, max: 1_000_000 }), rate: fc.integer({ min: 0, max: 10_000_000 }), discountPct: fc.integer({ min: 0, max: 10_000 }), gstRate: fc.constantFrom(0, 300, 500, 1800, 4000) }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (kind, interstate, lines, charges) => {
          const b = computeBill(kind, lines, { interstate, charges });
          expect(b.total % 100).toBe(0);
          expect(Math.abs(b.roundOff)).toBeLessThanOrEqual(50);
          expect(b.total).toBe(b.taxable + b.cgst + b.sgst + b.igst + b.roundOff);
          expect(b.taxable).toBe(b.gross - b.discount + b.charges);
          expect(b.cgst).toBe(b.sgst);
          if (interstate) expect(b.cgst).toBe(0);
          else expect(b.igst).toBe(0);
        },
      ),
    );
  });
});

describe("bill numbers", () => {
  it("financial year runs April to March", () => {
    expect(financialYear("2026-03-31")).toBe("25-26");
    expect(financialYear("2026-04-01")).toBe("26-27");
    expect(financialYear("2099-12-01")).toBe("99-00");
  });

  it("GST and kacha bills have separate series", () => {
    expect(billNumber("SGT", "gst", "26-27", 7)).toBe("SGT/26-27/0007");
    expect(billNumber("SGT", "kacha", "26-27", 12345)).toBe("SGT/K/26-27/12345");
  });

  it("a firm without a prefix uses its initials", () => {
    expect(defaultPrefix("Shree Ganesh Textiles")).toBe("SGT");
    expect(defaultPrefix("M/s. Gupta & Sons Cloth House")).toBe("MGSC");
    expect(defaultPrefix("गणेश")).toBe("BILL");
  });
});

describe("money text", () => {
  it("shows rupees with Indian grouping", () => {
    expect(formatRupees(12345678)).toBe("₹1,23,456.78");
    expect(formatRupees(99900)).toBe("₹999.00");
    expect(formatRupees(-5000)).toBe("−₹50.00");
    expect(formatRupees(1_00_00_000_00)).toBe("₹1,00,00,000.00");
  });

  it("reads typed amounts and writes them back", () => {
    expect(parseRupees("450")).toBe(45000);
    expect(parseRupees("450.5")).toBe(45050);
    expect(parseRupees("₹ 1,200.75")).toBe(120075);
    expect(parseRupees("4.505")).toBeNull();
    expect(parseRupees("abc")).toBeNull();
    expect(paiseToText(45050)).toBe("450.50");
    expect(paiseToText(45000)).toBe("450");
  });

  it("says the amount in words, Indian system", () => {
    expect(amountInWords(1245000)).toBe("Rupees Twelve Thousand Four Hundred Fifty Only");
    expect(amountInWords(12345600)).toBe("Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only");
    expect(amountInWords(25_00_00_000_00 + 7550)).toBe("Rupees Twenty Five Crore Seventy Five and Fifty Paise Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });
});

describe("HSN-wise tax table", () => {
  it("one row per HSN and rate, freight on its own row, IGST to another state", () => {
    const lines = [
      { quantity: 1000, rate: 62500, gstRate: 500, hsn: "94044010" },
      { quantity: 200, rate: 26000, gstRate: 500, hsn: "63041930" },
      { quantity: 200, rate: 85000, gstRate: 500, hsn: "63014000" },
    ];
    const totals = computeBill("gst", lines, { interstate: true });
    expect(totals.total).toBe(889400);
    expect(totals.roundOff).toBe(50);
    expect(hsnSummary(lines, totals, true)).toEqual([
      { hsn: "94044010", gstRate: 500, taxable: 625000, cgst: 0, sgst: 0, igst: 31250 },
      { hsn: "63041930", gstRate: 500, taxable: 52000, cgst: 0, sgst: 0, igst: 2600 },
      { hsn: "63014000", gstRate: 500, taxable: 170000, cgst: 0, sgst: 0, igst: 8500 },
    ]);
  });

  it("same HSN twice is one row; freight is taxed at the top rate", () => {
    const lines = [
      { quantity: 100, rate: 10000, gstRate: 500, hsn: "5208" },
      { quantity: 100, rate: 20000, gstRate: 500, hsn: "5208" },
      { quantity: 100, rate: 10000, gstRate: 1800, hsn: null },
    ];
    const totals = computeBill("gst", lines, { interstate: false, charges: 5000 });
    expect(hsnSummary(lines, totals, false)).toEqual([
      { hsn: "5208", gstRate: 500, taxable: 30000, cgst: 750, sgst: 750, igst: 0 },
      { hsn: null, gstRate: 1800, taxable: 10000, cgst: 900, sgst: 900, igst: 0 },
      { hsn: null, charges: true, gstRate: 1800, taxable: 5000, cgst: 450, sgst: 450, igst: 0 },
    ]);
  });

  it("a kacha bill has no tax table", () => {
    const lines = [{ quantity: 100, rate: 10000, gstRate: 500, hsn: "5208" }];
    expect(hsnSummary(lines, computeBill("kacha", lines, { interstate: false }), false)).toEqual([]);
  });

  it("the rows always add up to the bill's tax, paisa for paisa", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.array(fc.record({ quantity: fc.integer({ min: 1, max: 100_000 }), rate: fc.integer({ min: 0, max: 1_000_000 }), discountPct: fc.integer({ min: 0, max: 5000 }), gstRate: fc.constantFrom(0, 300, 500, 1800), hsn: fc.constantFrom("5208", "6304", "9404", null) }), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 100_000 }),
        (interstate, lines, charges) => {
          const totals = computeBill("gst", lines, { interstate, charges });
          const rows = hsnSummary(lines, totals, interstate);
          const sum = (f: (r: { taxable: number; cgst: number; sgst: number; igst: number }) => number) => rows.reduce((s, r) => s + f(r), 0);
          expect(sum((r) => r.taxable)).toBe(totals.taxable);
          expect([sum((r) => r.cgst), sum((r) => r.sgst), sum((r) => r.igst)]).toEqual([totals.cgst, totals.sgst, totals.igst]);
        },
      ),
    );
  });
});

it("bill columns show amounts without the rupee sign", () => {
  expect(formatAmount(889400)).toBe("8,894.00");
  expect(formatAmount(-50)).toBe("−0.50");
});
