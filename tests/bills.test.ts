/**
 * Bills on dispatches: who can make them, numbering, GST vs kacha, edits
 * and cancelling, details copied at the time of the bill, and rates
 * remembered from earlier bills.
 */
import { describe, expect, it } from "vitest";
import { createDispatch, correctDispatch, cancelDispatch, type Ctx } from "@/ledger/service";
import { updateParty } from "@/masters/manage";
import { setProductTax } from "@/masters/manage";
import { updateCompany } from "@/masters/profiles";
import { billByToken, billDetail, billDraft, billForDispatch, billList, cancelBill, createBill, lastRates, reviseBill, type BillInput } from "@/billing/service";
import { cid, freshDb, makeCompany, NOW, TODAY } from "./helpers";

async function setup() {
  const db = await freshDb();
  const co = await makeCompany(db);
  await updateCompany(db, co.owner, { state: "Punjab" });
  const send = async (partyId = co.sharma.id, qty = "20") =>
    (await createDispatch(db, co.staff, { captureId: cid(), partyId, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: qty }, { itemId: co.cotton.id, quantity: "12.5" }], channel: "app", inputMethod: "form" })).dispatchId;
  const supervisor: Ctx = { ...co.staff2, supervisor: true };
  return { db, co, send, supervisor };
}

const bill = (over: Partial<BillInput> = {}): BillInput => ({
  kind: "gst",
  billDate: TODAY,
  lines: [
    { itemId: null, name: "D-4012", quantity: "20", unit: "pcs", rate: "450", gstRate: "5" },
    { itemId: null, name: "Cotton Poplin", quantity: "12.5", unit: "meter", rate: "99.99", gstRate: "5" },
  ],
  ...over,
});

describe("making a bill", () => {
  it("owners make a GST bill from a dispatch: numbered, totalled, details copied in", async () => {
    const { db, co, send } = await setup();
    const d = await send();
    const { billId, number } = await createBill(db, co.owner, d, bill({ charges: "100" }));
    expect(number).toBe("TT/26-27/0001");
    const b = await billDetail(db, co.owner, billId);
    expect(b).toMatchObject({ kind: "gst", status: "active", interstate: false, party: { name: "Sharma Textiles" }, seller: { name: "Test Textiles", state: "Punjab" } });
    expect(b.totals.taxable).toBe(900000 + 124988 + 10000);
    expect(b.totals.total % 100).toBe(0);
    expect(await billForDispatch(db, co.owner, d)).toMatchObject({ id: billId, number, status: "active", total: b.totals.total });
  });

  it("one bill per dispatch", async () => {
    const { db, co, send } = await setup();
    const d = await send();
    await createBill(db, co.owner, d, bill());
    await expect(createBill(db, co.owner, d, bill())).rejects.toMatchObject({ code: "BILL_EXISTS" });
    await expect(billDraft(db, co.owner, d)).rejects.toMatchObject({ code: "BILL_EXISTS" });
  });

  it("owners and supervisors make bills; other staff can't; viewers only look", async () => {
    const { db, co, send, supervisor } = await setup();
    const d = await send();
    await expect(createBill(db, co.staff, d, bill())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createBill(db, co.viewer, d, bill())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { billId } = await createBill(db, supervisor, d, bill());
    expect((await billDetail(db, co.viewer, billId)).number).toBe("TT/26-27/0001");
    await expect(billDetail(db, co.staff, billId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await billForDispatch(db, co.staff, d)).toBeNull();
  });

  it("another firm can't see it", async () => {
    const { db, co, send } = await setup();
    const { billId } = await createBill(db, co.owner, await send(), bill());
    const other = await makeCompany(db, "Other Firm");
    await expect(billDetail(db, other.owner, billId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("no bill for a cancelled dispatch, nor for a future date", async () => {
    const { db, co, send } = await setup();
    const d = await send();
    await cancelDispatch(db, co.staff, d, { baseRev: 1 });
    await expect(createBill(db, co.owner, d, bill())).rejects.toMatchObject({ code: "DISPATCH_CANCELLED" });
    await expect(createBill(db, co.owner, await send(), bill({ billDate: "2026-10-09" }))).rejects.toMatchObject({ code: "FUTURE_DATE" });
  });

  it("refuses bad lines", async () => {
    const { db, co, send } = await setup();
    const d = await send();
    const line = { itemId: null, name: "X", quantity: "1", unit: "pcs", rate: "10" };
    await expect(createBill(db, co.owner, d, bill({ lines: [] }))).rejects.toMatchObject({ code: "NO_LINES" });
    await expect(createBill(db, co.owner, d, bill({ lines: [{ ...line, rate: "ten" }] }))).rejects.toMatchObject({ code: "INVALID_RATE" });
    await expect(createBill(db, co.owner, d, bill({ lines: [{ ...line, quantity: "0" }] }))).rejects.toMatchObject({ code: "INVALID_QTY" });
    await expect(createBill(db, co.owner, d, bill({ lines: [{ ...line, discountPct: "120" }] }))).rejects.toMatchObject({ code: "INVALID_DISCOUNT" });
    await expect(createBill(db, co.owner, d, bill({ lines: [{ ...line, gstRate: "-5" }] }))).rejects.toMatchObject({ code: "INVALID_GST_RATE" });
    await expect(createBill(db, co.owner, d, bill({ lines: [{ ...line, name: " " }] }))).rejects.toMatchObject({ code: "NAME_REQUIRED" });
    await expect(createBill(db, co.owner, d, bill({ kind: "pakka" as never }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("GST and kacha", () => {
  it("kacha bills have no tax and their own number series", async () => {
    const { db, co, send } = await setup();
    const k = await createBill(db, co.owner, await send(), bill({ kind: "kacha" }));
    const g = await createBill(db, co.owner, await send(), bill());
    expect([k.number, g.number]).toEqual(["TT/K/26-27/0001", "TT/26-27/0001"]);
    const kb = await billDetail(db, co.owner, k.billId);
    expect(kb.totals.taxes).toEqual([]);
    expect(kb.totals.total).toBe(Math.round((900000 + 124988) / 100) * 100);
  });

  it("a party in another state gets IGST", async () => {
    const { db, co, send } = await setup();
    await updateParty(db, co.owner, co.gupta.id, { state: "Delhi" });
    const { billId } = await createBill(db, co.owner, await send(co.gupta.id), bill());
    const b = await billDetail(db, co.owner, billId);
    expect(b.interstate).toBe(true);
    expect(b.totals.cgst).toBe(0);
    expect(b.totals.igst).toBeGreaterThan(0);
  });

  it("the firm's own prefix is used when set", async () => {
    const { db, co, send } = await setup();
    await updateCompany(db, co.owner, { billPrefix: "SGT" });
    expect((await createBill(db, co.owner, await send(), bill())).number).toBe("SGT/26-27/0001");
  });
});

describe("changing and cancelling", () => {
  it("an edit keeps the number; switching to kacha takes a new one and the old is never reused", async () => {
    const { db, co, send } = await setup();
    const { billId } = await createBill(db, co.owner, await send(), bill());
    expect(await reviseBill(db, co.owner, billId, { ...bill({ charges: "50" }), baseRev: 1 })).toEqual({ rev: 2, number: "TT/26-27/0001" });
    expect(await reviseBill(db, co.owner, billId, { ...bill({ kind: "kacha" }), baseRev: 2 })).toEqual({ rev: 3, number: "TT/K/26-27/0001" });
    expect((await createBill(db, co.owner, await send(), bill())).number).toBe("TT/26-27/0002");
    const b = await billDetail(db, co.owner, billId);
    expect(b.history.map((h) => [h.rev, h.number, h.kind])).toEqual([
      [1, "TT/26-27/0001", "gst"],
      [2, "TT/26-27/0001", "gst"],
      [3, "TT/K/26-27/0001", "kacha"],
    ]);
  });

  it("someone else's newer change wins: an old screen can't overwrite it", async () => {
    const { db, co, send } = await setup();
    const { billId } = await createBill(db, co.owner, await send(), bill());
    await reviseBill(db, co.owner, billId, { ...bill(), baseRev: 1 });
    await expect(reviseBill(db, co.owner, billId, { ...bill(), baseRev: 1 })).rejects.toMatchObject({ code: "STALE_REVISION" });
  });

  it("a cancelled bill keeps its number, can't be edited, and the next bill moves on", async () => {
    const { db, co, send } = await setup();
    const { billId } = await createBill(db, co.owner, await send(), bill());
    await cancelBill(db, co.owner, billId, { baseRev: 1, reason: "wrong party" });
    const b = await billDetail(db, co.owner, billId);
    expect(b).toMatchObject({ status: "cancelled", number: "TT/26-27/0001", reason: "wrong party" });
    expect(b.lines).toHaveLength(2);
    await expect(reviseBill(db, co.owner, billId, { ...bill(), baseRev: 2 })).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });
    await expect(cancelBill(db, co.owner, billId, { baseRev: 2 })).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });
    expect((await createBill(db, co.owner, await send(), bill())).number).toBe("TT/26-27/0002");
  });

  it("a bill keeps the details it was given; a later edit picks up new ones", async () => {
    const { db, co, send } = await setup();
    const { billId } = await createBill(db, co.owner, await send(), bill());
    await updateParty(db, co.owner, co.sharma.id, { address: "New shop, Hall Bazaar" });
    expect((await billDetail(db, co.owner, billId)).party.address).toBeNull();
    await reviseBill(db, co.owner, billId, { ...bill(), baseRev: 1 });
    expect((await billDetail(db, co.owner, billId)).party.address).toBe("New shop, Hall Bazaar");
  });

  it("shows when the dispatch was changed or cancelled after the bill", async () => {
    const { db, co, send } = await setup();
    const d = await send();
    const { billId } = await createBill(db, co.owner, d, bill());
    expect((await billDetail(db, co.owner, billId)).dispatchChanged).toBe(false);
    await correctDispatch(db, co.staff, d, { baseRev: 1, partyId: co.sharma.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: "18" }] });
    expect((await billDetail(db, co.owner, billId)).dispatchChanged).toBe(true);
    await cancelDispatch(db, co.staff, d, { baseRev: 2 });
    expect((await billDetail(db, co.owner, billId)).dispatchCancelled).toBe(true);
  });
});

describe("filling in a new bill", () => {
  it("starts from the dispatch with HSN, GST rate and the rate this party paid last", async () => {
    const { db, co, send } = await setup();
    await setProductTax(db, co.owner, "D-4012", { hsn: "6204", gstRate: "5" });
    const first = await send();
    await createBill(db, co.owner, first, bill({ lines: [{ itemId: co.d4012.id, name: "D-4012", quantity: "20", unit: "pcs", rate: "450", gstRate: "5" }] }));
    const draft = await billDraft(db, co.owner, await send());
    expect(draft).toMatchObject({ partyId: co.sharma.id, billDate: TODAY, interstate: false, prefix: "TT" });
    expect(draft.lines).toEqual([
      expect.objectContaining({ itemId: co.d4012.id, quantity: 2000, hsn: "6204", gstRate: 500, rate: 45000, rateFrom: "party" }),
      expect.objectContaining({ itemId: co.cotton.id, quantity: 1250, hsn: null, gstRate: null, rate: null, rateFrom: null }),
    ]);
  });

  it("prefers this party's last rate, then anyone's; cancelled bills don't count", async () => {
    const { db, co, send } = await setup();
    const line = (rate: string) => [{ itemId: co.d4012.id, name: "D-4012", quantity: "1", unit: "pcs", rate }];
    await createBill(db, { ...co.owner, now: new Date(NOW.getTime() - 3000) }, await send(co.gupta.id), bill({ lines: line("400") }));
    expect((await lastRates(db, co.owner, co.sharma.id, [co.d4012.id])).get(co.d4012.id)).toEqual({ rate: 40000, forParty: false });
    const s = await createBill(db, { ...co.owner, now: new Date(NOW.getTime() - 2000) }, await send(), bill({ lines: line("450") }));
    await createBill(db, { ...co.owner, now: new Date(NOW.getTime() - 1000) }, await send(co.gupta.id), bill({ lines: line("420") }));
    expect((await lastRates(db, co.owner, co.sharma.id, [co.d4012.id])).get(co.d4012.id)).toEqual({ rate: 45000, forParty: true });
    await cancelBill(db, co.owner, s.billId, { baseRev: 1 });
    expect((await lastRates(db, co.owner, co.sharma.id, [co.d4012.id])).get(co.d4012.id)).toEqual({ rate: 42000, forParty: false });
  });
});

describe("sharing and lists", () => {
  it("the party's link shows the bill without a login; a wrong link shows nothing", async () => {
    const { db, co, send } = await setup();
    const { billId } = await createBill(db, co.owner, await send(), bill());
    const { shareToken } = await billDetail(db, co.owner, billId);
    expect(shareToken).toMatch(/^[\w-]{24}$/);
    expect((await billByToken(db, shareToken))?.id).toBe(billId);
    expect(await billByToken(db, "x".repeat(24))).toBeNull();
    expect(await billByToken(db, "' or 1=1 --")).toBeNull();
  });

  it("lists the current version of each bill, newest first, by party if asked", async () => {
    const { db, co, send } = await setup();
    const a = await createBill(db, co.owner, await send(), bill());
    const b = await createBill(db, { ...co.owner, now: new Date(NOW.getTime() + 1000) }, await send(co.gupta.id), bill({ kind: "kacha" }));
    await reviseBill(db, co.owner, a.billId, { ...bill({ charges: "10" }), baseRev: 1 });
    const all = await billList(db, co.owner);
    expect(all.map((x) => [x.number, x.partyName])).toEqual([
      [b.number, "Gupta Traders"],
      [a.number, "Sharma Textiles"],
    ]);
    expect((await billList(db, co.owner, { partyId: co.gupta.id })).map((x) => x.id)).toEqual([b.billId]);
    await expect(billList(db, co.staff)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
