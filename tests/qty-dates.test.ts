import { describe, expect, it } from "vitest";
import { centiToDecimal, formatQty, toCenti, toPositiveCenti } from "@/lib/qty";
import { normalizeName } from "@/lib/normalize";
import { assertEntryDate, assertPromisedDate, daysBetween, todayIST } from "@/lib/dates";

describe("quantities", () => {
  it("parses up to two decimals exactly", () => {
    expect(toCenti("12.5")).toBe(1250);
    expect(toCenti("0.1")).toBe(10);
    expect(toCenti(20)).toBe(2000);
    expect(toCenti(" 7.05 ")).toBe(705);
  });
  it("rejects bad input", () => {
    for (const bad of ["1.234", "-5", "abc", "", "1e3", "1,000"]) expect(() => toCenti(bad)).toThrow(/quantity/i);
    expect(() => toPositiveCenti("0")).toThrow(/more than 0/);
  });
  it("round-trips and formats", () => {
    expect(centiToDecimal(1250)).toBe("12.50");
    expect(centiToDecimal(5)).toBe("0.05");
    expect(formatQty(1250)).toBe("12.5");
    expect(formatQty(500)).toBe("5");
    expect(formatQty(0)).toBe("0");
  });
  it("adds without float drift", () => {
    expect(toCenti("0.1") + toCenti("0.2")).toBe(toCenti("0.3"));
  });
});

describe("dates (Asia/Kolkata)", () => {
  it("uses the Indian calendar day, not UTC", () => {
    // 20:00 UTC on Oct 8 is 01:30 IST on Oct 9
    expect(todayIST(new Date("2026-10-08T20:00:00Z"))).toBe("2026-10-09");
    expect(todayIST(new Date("2026-10-08T18:29:59Z"))).toBe("2026-10-08");
  });
  it("allows today and the past for entry dates", () => {
    const now = new Date("2026-10-08T20:00:00Z"); // Oct 9 IST
    expect(() => assertEntryDate("2026-10-09", now)).not.toThrow();
    expect(() => assertEntryDate("2025-01-01", now)).not.toThrow();
  });
  it("rejects future entry dates", () => {
    const now = new Date("2026-10-08T09:00:00Z");
    expect(() => assertEntryDate("2026-10-09", now)).toThrow(/future/);
  });
  it("rejects malformed dates", () => {
    expect(() => assertEntryDate("2026-02-30")).toThrow(/Invalid date/);
    expect(() => assertEntryDate("08/10/2026")).toThrow(/Invalid date/);
  });
  it("allows future promised dates", () => {
    expect(() => assertPromisedDate("2030-01-01")).not.toThrow();
  });
  it("counts days", () => {
    expect(daysBetween("2026-10-01", "2026-10-08")).toBe(7);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });
});

describe("name normalisation", () => {
  it("keeps Indic vowel signs so different words stay different", () => {
    expect(normalizeName("पीस")).not.toBe(normalizeName("पस"));
    expect(normalizeName("शर्मा")).toBe("शर्मा");
    expect(normalizeName("सिंह")).toBe("सिंह");
    expect(normalizeName("ਸਿੰਘ")).toBe("ਸਿੰਘ");
    expect(normalizeName("  M/s. Sharma-Textiles ")).toBe("m s sharma textiles");
  });
});

describe("share line", async () => {
  const { shareText, whatsappUrl } = await import("@/entries/share");
  it("reads like the spec example, in both languages", () => {
    const l = [{ itemName: "D-4012", unit: "pcs", quantity: 500, balance: 600 }];
    expect(shareText("en", "dispatch", "Sharma Textiles", l)).toBe("Sharma Textiles: D-4012 5 pcs sent, 6 pcs balance");
    expect(shareText("hi", "dispatch", "Sharma Textiles", l)).toBe("Sharma Textiles: D-4012 5 pcs भेजा, 6 pcs बाकी");
    expect(shareText("en", "order", "Gupta", [{ itemName: "Poplin", unit: "meter", quantity: 1250, balance: 3000 }])).toBe(
      "Gupta: Poplin 12.5 meter ordered, 30 meter pending",
    );
    expect(whatsappUrl("a b&c")).toBe("https://wa.me/?text=a%20b%26c");
  });
});

describe("stock share line", async () => {
  const { stockShareText } = await import("@/entries/share");
  it("reads clearly", () => {
    expect(stockShareText("en", "receipt", [{ itemName: "Crown", unit: "pcs", change: 2400, after: 4800 }])).toBe("Goods in: Crown +24 pcs (now 48)");
    expect(stockShareText("en", "count", [{ itemName: "Crown", unit: "pcs", change: -500, after: 4000 }])).toBe("Stock count: Crown 40 pcs (−5)");
    expect(stockShareText("hi", "receipt", [{ itemName: "Crown", unit: "pcs", change: 100, after: 100 }])).toBe("माल आया: Crown +1 pcs (अब 1)");
  });
});

describe("UI messages", () => {
  it("are plain strings (they are passed to client components)", async () => {
    const { messages } = await import("@/i18n/messages");
    const walk = (o: unknown, path: string): string[] =>
      typeof o === "function" ? [path] : o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => walk(v, `${path}.${k}`)) : [];
    expect(walk(messages("en"), "en")).toEqual([]);
    expect(walk(messages("hi"), "hi")).toEqual([]);
  });
});
