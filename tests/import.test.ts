import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/db/types";
import { isValidAadhaar, isValidGstin } from "@/lib/india";
import { cellText, findHeaderRow, guessKind, mapHeadings, readLayout, toRecords, type Row } from "@/import/columns";
import { parsePhone, parseQty, parseState, parseTaxId, splitAliases } from "@/import/values";
import { applyClients, applyItems, planClients, planItems, MAX_ROWS } from "@/import/plan";
import { exportClients, exportItems } from "@/import/export";
import { stockOverview, recordStock } from "@/stock/service";
import { createDispatch, createOrder } from "@/ledger/service";
import { createItem, createParty } from "@/masters/service";
import { cid, freshDb, makeCompany, NOW, TODAY } from "./helpers";

const GST = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const gstin = (first14: string) => first14 + [...GST].find((c) => isValidGstin(first14 + c))!;
const aadhaar = (first11: string) => first11 + [..."0123456789"].find((c) => isValidAadhaar(first11 + c))!;
const G1 = gstin("03AAPFU0939F1Z"); // Punjab
const G2 = gstin("09AABCS1429B1Z"); // Uttar Pradesh
const app = { channel: "app", inputMethod: "form" } as const;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

describe("reading a sheet's layout", () => {
  it("finds the headings below title rows, in English, Hinglish or Hindi", () => {
    const rows = [
      ["Smart Homes Inc."],
      ["Party list as on 01-10-2026"],
      [],
      ["S.No", "Party Name", "Mobile No.", "City", "GSTIN/UIN"],
      ["1", "Sharma Textiles", "98123 45678", "Ludhiana", G1],
    ];
    expect(findHeaderRow(rows)).toBe(3);
    const l = readLayout(rows);
    expect(l).toMatchObject({ headerRow: 3, kind: "clients", mapping: { name: 1, phone: 2, city: 3, gstin: 4 } });
    expect(toRecords(rows, l)).toEqual([{ rowNo: 5, name: "Sharma Textiles", phone: "98123 45678", city: "Ludhiana", gstin: G1 }]);
    expect(mapHeadings(["नाम", "फ़ोन", "शहर", "राज्य"], "clients")).toEqual({ name: 0, phone: 1, city: 2, state: 3 });
    expect(mapHeadings(["Naam", "Mob", "Shehar"], "clients")).toEqual({ name: 0, phone: 1, city: 2 });
  });

  it("prefers the specific field when a heading mentions two (\"Customer GSTIN\")", () => {
    expect(mapHeadings(["Customer Name", "Customer GSTIN", "Customer Mobile"], "clients")).toEqual({ name: 0, gstin: 1, phone: 2 });
  });

  it("tells clients from items, and takes a plain \"Name\" column as the item", () => {
    expect(guessKind(["Item Name", "Colour", "Closing Stock", "Unit"]).kind).toBe("items");
    expect(guessKind(["Name", "Phone", "GST No"]).kind).toBe("clients");
    expect(guessKind(["Name", "Qty", "Unit"]).kind).toBe("items");
    expect(mapHeadings(["Name", "Qty (pcs)", "Min"], "items")).toEqual({ item: 0, qty: 1, low: 2 });
    expect(mapHeadings(["माल", "रंग", "स्टॉक"], "items")).toEqual({ item: 0, colour: 1, qty: 2 });
  });

  it("drops blank and total rows; works without headings", () => {
    const rows = [["Item", "Qty"], ["A", "5"], ["", ""], ["B", "6"], ["Total", "11"], ["Grand Total", "11"], ["कुल", "11"]];
    expect(toRecords(rows, readLayout(rows)).map((r) => r.item)).toEqual(["A", "B"]);
    const bare = [["Sharma", "9812345678"], ["Gupta", ""]];
    const l = readLayout(bare);
    expect(l.headerRow).toBe(-1);
    expect(toRecords(bare, l).map((r) => [r.rowNo, r.name])).toEqual([
      [1, "Sharma"],
      [2, "Gupta"],
    ]);
  });

  it("turns cells into text without losing digits", () => {
    expect(cellText(9812345678)).toBe("9812345678");
    expect(cellText(919812345678)).toBe("919812345678");
    expect(cellText(0.1 + 0.2)).toBe("0.3");
    expect(cellText(12.5)).toBe("12.5");
    expect(cellText(null)).toBe("");
    expect(cellText(true)).toBe("");
    expect(cellText(" Sharma  Textiles​ ")).toBe("Sharma Textiles");
    expect(cellText(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10-01");
  });
});

describe("cleaning cells", () => {
  it("reads quantities as people write them", () => {
    expect(parseQty("1,20,000")).toEqual({ ok: true, centi: 12_000_000 });
    expect(parseQty("12.5 mtr")).toEqual({ ok: true, centi: 1250, unit: "meter" });
    expect(parseQty("१२ नग")).toEqual({ ok: true, centi: 1200, unit: "nag" });
    expect(parseQty("(5)")).toEqual({ ok: true, centi: -500 });
    expect(parseQty("-5")).toEqual({ ok: true, centi: -500 });
    expect(parseQty("12.50")).toEqual({ ok: true, centi: 1250 });
    expect(parseQty(".5")).toEqual({ ok: true, centi: 50 });
    expect(parseQty("0")).toEqual({ ok: true, centi: 0 });
    for (const empty of ["", "-", "—", "nil", "NA"]) expect(parseQty(empty)).toEqual({ ok: true, empty: true });
    expect(parseQty("12.505")).toEqual({ ok: false, reason: "TOO_MANY_DECIMALS" });
    expect(parseQty("abc")).toEqual({ ok: false, reason: "NOT_A_NUMBER" });
    expect(parseQty("1e9")).toEqual({ ok: false, reason: "NOT_A_NUMBER" });
    expect(parseQty("99999999999")).toEqual({ ok: false, reason: "TOO_LARGE" });
  });

  it("reads phones, states and tax IDs", () => {
    expect(parsePhone("98123 45678")).toEqual({ phone: "+919812345678", more: false });
    expect(parsePhone("098123-45678 / 9711111111")).toEqual({ phone: "+919812345678", more: true });
    expect(parsePhone("9812345678 9711111111")).toEqual({ phone: "+919812345678", more: true });
    expect(parsePhone("12345")).toEqual({ phone: null, bad: true });
    expect(parsePhone("")).toEqual({ phone: null, bad: false });
    expect(parseState("UP")).toBe("Uttar Pradesh");
    expect(parseState("U.P.")).toBe("Uttar Pradesh");
    expect(parseState("उत्तर प्रदेश")).toBe("Uttar Pradesh");
    expect(parseState("09")).toBe("Uttar Pradesh");
    expect(parseState("03-Punjab")).toBe("Punjab");
    expect(parseState("Maharastra")).toBe("Maharashtra");
    expect(parseState("delhi ncr")).toBe("Delhi");
    expect(parseState("Narnia")).toBeNull();
    expect(parseTaxId(G1.toLowerCase(), "any")).toEqual({ type: "gstin", value: G1 });
    const a = aadhaar("23456789012");
    expect(parseTaxId(`${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`, "aadhaar")).toEqual({ type: "aadhaar", value: a });
    expect(parseTaxId("XXXX XXXX 1234", "aadhaar")).toEqual({ type: null, problem: "MASKED", last4: "1234" });
    expect(parseTaxId("27AAPFU0939F1ZW", "gstin")).toEqual({ type: null, problem: "INVALID_GSTIN" });
    expect(parseTaxId("ABCDE1234F", "any")).toEqual({ type: null, problem: "UNKNOWN_TAX_ID" });
    expect(parseTaxId("Unregistered", "gstin")).toBeNull();
    expect(splitAliases("Sharma, Sharma ji; शर्मा, Sharma")).toEqual(["Sharma", "Sharma ji", "शर्मा"]);
  });
});

describe("importing clients", () => {
  let db: Db;
  let co: Awaited<ReturnType<typeof makeCompany>>;
  beforeEach(async () => {
    db = await freshDb();
    co = await makeCompany(db);
  });
  const rows = (...r: Omit<Row, "rowNo">[]): Row[] => r.map((x, i) => ({ rowNo: i + 2, ...x }));

  it("plans new, unchanged, updated, and close-spelling rows without saving anything", async () => {
    const plan = await planClients(
      db,
      co.owner,
      rows(
        { name: "Verma Cloth House", phone: "9812345678", city: "Ludhiana", gstin: G1 },
        { name: "Sharma Textiles" },
        { name: "Gupta Traders", city: "Delhi", state: "DL" },
        { name: "Sharma Textile" },
        { name: "" , phone: "9811111111" },
      ),
    );
    const by = (r: number) => plan.rows.find((x) => x.rows[0] === r)!;
    expect(by(2)).toMatchObject({ status: "new", changes: expect.arrayContaining([{ field: "state", to: "Punjab" }, { field: "taxId", to: G1 }]) });
    expect(by(3)).toMatchObject({ status: "same", targetId: co.sharma.id, matchedBy: "name" });
    expect(by(4)).toMatchObject({ status: "update", changes: [{ field: "city", from: null, to: "Delhi" }, { field: "state", from: null, to: "Delhi" }] });
    expect(by(5)).toMatchObject({ status: "choose", candidates: [expect.objectContaining({ id: co.sharma.id })] });
    expect(by(6)).toMatchObject({ status: "error", error: "NO_NAME" });
    expect(plan.counts).toEqual({ new: 1, update: 1, same: 1, choose: 1, skip: 0, error: 1 });
    expect(await db.select().from(s.parties).where(eq(s.parties.companyId, co.company.id))).toHaveLength(2);
  });

  it("applies with the person's choices, once per import id", async () => {
    const input = rows({ name: "Verma Cloth House", phone: "98123 45678", gstin: G1, aliases: "Verma, वर्मा" }, { name: "Sharma Textile", phone: "9811111111" }, { name: "Gupta Traders" });
    const id = uuid();
    const r = await applyClients(db, co.owner, id, input, {}, { 3: { action: "match", id: co.sharma.id }, 4: { action: "skip" } });
    expect(r).toMatchObject({ created: 1, updated: 1, duplicate: false });
    const [verma] = await db.select().from(s.parties).where(eq(s.parties.name, "Verma Cloth House"));
    expect(verma).toMatchObject({ phone: "+919812345678", state: "Punjab", taxIdType: "gstin", taxId: G1 });
    const [sharma] = await db.select().from(s.parties).where(eq(s.parties.id, co.sharma.id));
    expect(sharma.phone).toBe("+919811111111");
    // The picked spelling is now an extra name, so it matches by itself next time.
    const aliases = await db.select().from(s.partyAliases);
    expect(aliases.map((a) => a.alias)).toEqual(expect.arrayContaining(["Sharma Textile", "Verma", "वर्मा"]));
    expect((await planClients(db, co.owner, input)).rows.map((x) => x.status)).toEqual(["same", "same", "same"]);
    // Pressing import twice saves once.
    expect(await applyClients(db, co.owner, id, input, {}, {})).toMatchObject({ duplicate: true, created: 1 });
    expect(await db.select().from(s.parties).where(eq(s.parties.companyId, co.company.id))).toHaveLength(3);
    const log = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "import.clients"));
    expect(log).toHaveLength(1);
  });

  it("matches by GSTIN first, keeps saved details unless told to replace them", async () => {
    await db.update(s.parties).set({ phone: "+919800000099", taxIdType: "gstin", taxId: G1, state: "Punjab" }).where(eq(s.parties.id, co.sharma.id));
    const input = rows({ name: "M/s Sharma Textile Mills", phone: "9812345678", gstin: G1 });
    const keep = await planClients(db, co.owner, input);
    expect(keep.rows[0]).toMatchObject({ status: "update", targetId: co.sharma.id, matchedBy: "gstin", changes: [{ field: "alias", to: "M/s Sharma Textile Mills" }] });
    expect(keep.rows[0].notes).toContainEqual({ code: "KEPT", detail: "phone: +919800000099" });
    const replace = await planClients(db, co.owner, input, { overwrite: true });
    expect(replace.rows[0].changes).toContainEqual({ field: "phone", from: "+919800000099", to: "+919812345678" });
  });

  it("handles duplicates and clashes inside the sheet", async () => {
    const plan = await planClients(
      db,
      co.owner,
      rows(
        { name: "Kapoor Fabrics", phone: "9812345678" },
        { name: "KAPOOR  FABRICS", city: "Amritsar" },
        { name: "Kapoor Fabrics", gstin: G2 },
        { name: "Mehta Sons", gstin: G2 },
        { name: "Ram Lal", gstin: G1 },
        { name: "Ram Lal", gstin: gstin("03AAPFU0939F2Z") },
      ),
    );
    // Rows 2–4 are one client (same name); the city from row 3 and GSTIN from row 4 fill in.
    // Row 5 has that GSTIN under another name: the same business, its name becomes an extra name.
    const kapoor = plan.rows.find((r) => r.rows[0] === 2)!;
    expect(kapoor.rows).toEqual([2, 3, 4, 5]);
    expect(kapoor.changes).toEqual(expect.arrayContaining([{ field: "city", to: "Amritsar" }, { field: "taxId", to: G2 }, { field: "alias", to: "Mehta Sons" }]));
    expect(plan.rows.find((r) => r.rows[0] === 6)).toMatchObject({ status: "new" });
    // Same name, different GSTIN: two businesses that can't be told apart.
    expect(plan.rows.find((r) => r.rows[0] === 7)).toMatchObject({ status: "error", error: "SAME_NAME_OTHER_GSTIN" });
  });

  it("never saves a GSTIN twice, and flags bad values without dropping the row", async () => {
    await db.update(s.parties).set({ taxIdType: "gstin", taxId: G1 }).where(eq(s.parties.id, co.gupta.id));
    const plan = await planClients(
      db,
      co.owner,
      rows({ name: "Sharma Textiles", gstin: G1, phone: "12345", state: "Narnia", aadhaar: "XXXX XXXX 1234" }, { name: "Dua Sons", gstin: "27AAPFU0939F1ZW" }),
    );
    // The name is Sharma's, the GSTIN Gupta's: asked, not guessed.
    expect(plan.rows[0]).toMatchObject({ status: "choose", candidates: [{ id: co.gupta.id }, { id: co.sharma.id }] });
    expect(plan.rows[0].notes.map((x) => x.code)).toEqual(expect.arrayContaining(["BAD_PHONE", "UNKNOWN_STATE", "TAX_ID_TAKEN"]));
    // Picking Sharma: Gupta's GSTIN is not copied onto Sharma; the bad values are left out.
    const picked = await planClients(db, co.owner, rows({ name: "Sharma Textiles", gstin: G1, phone: "12345", state: "Narnia", aadhaar: "XXXX XXXX 1234" }), {}, { 2: { action: "match", id: co.sharma.id } });
    expect(picked.rows[0]).toMatchObject({ status: "same", targetId: co.sharma.id });
    expect(picked.rows[0].notes.map((x) => x.code)).toEqual(expect.arrayContaining(["BAD_PHONE", "UNKNOWN_STATE", "MASKED", "TAX_ID_TAKEN"]));
    expect(plan.rows[1]).toMatchObject({ status: "new" });
    expect(plan.rows[1].notes.map((x) => x.code)).toContain("INVALID_GSTIN");
  });

  it("shows a hidden client again; refuses \"new\" for a saved name", async () => {
    await db.update(s.parties).set({ active: false }).where(eq(s.parties.id, co.gupta.id));
    const p = await planClients(db, co.owner, rows({ name: "Gupta Traders" }, { name: "Sharma Textiles" }), {}, { 3: { action: "new" } });
    expect(p.rows[0]).toMatchObject({ status: "update", changes: [{ field: "show", to: "yes" }] });
    expect(p.rows[1]).toMatchObject({ status: "error", error: "NAME_EXISTS" });
  });

  it("owners only; limits size", async () => {
    await expect(planClients(db, co.staff, rows({ name: "X" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(planClients(db, co.owner, [])).rejects.toMatchObject({ code: "IMPORT_EMPTY" });
    const many = Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({ rowNo: i + 2, name: `C${i}` }));
    await expect(planClients(db, co.owner, many)).rejects.toMatchObject({ code: "IMPORT_TOO_BIG" });
  });

  it("round-trips through its own export", async () => {
    const a = aadhaar("34567890123");
    await db.update(s.parties).set({ phone: "+919812345678", city: "Ludhiana", state: "Punjab", taxIdType: "aadhaar", taxId: a }).where(eq(s.parties.id, co.sharma.id));
    const sheet = await exportClients(db, co.owner);
    expect(sheet[0]).toEqual(["Name", "Phone", "City", "State", "GSTIN", "Aadhaar", "Other names"]);
    expect(sheet.flat().join(" ")).not.toContain(a); // Aadhaar masked
    const l = readLayout(sheet);
    const plan = await planClients(db, co.owner, toRecords(sheet, l));
    expect(plan.rows.map((r) => [r.name, r.status, r.notes.length])).toEqual([
      ["Gupta Traders", "same", 0],
      ["Sharma Textiles", "same", 0],
    ]);
  });
});

describe("importing items and stock", () => {
  let db: Db;
  let co: Awaited<ReturnType<typeof makeCompany>>;
  beforeEach(async () => {
    db = await freshDb();
    co = await makeCompany(db);
  });
  const rows = (...r: Omit<Row, "rowNo">[]): Row[] => r.map((x, i) => ({ rowNo: i + 2, ...x }));
  const level = async (itemId: string, unit: string | null = null) => (await stockOverview(db, co.owner)).find((r) => r.itemId === itemId && r.unitCode === unit);

  it("\"what's in the godown now\" sets stock; new items and colours are created", async () => {
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 40 }] });
    const input = rows(
      { item: "D-4012", qty: "25" },
      { item: "Vistara", colour: "Red", unit: "pcs", qty: "10", low: "3" },
      { item: "Vistara", colour: "Blue", qty: "1,200" },
      { item: "Silk", qty: "5" },
      { item: "Cotton Poplin", qty: "12.5", unit: "mtr" },
    );
    const plan = await planItems(db, co.owner, input, { stockMode: "set", defaultUnit: "pcs" });
    expect(plan.stockKind).toBe("count");
    expect(plan.rows[0]).toMatchObject({ status: "update", stock: { before: 4000, after: 2500, change: -1500 } });
    expect(plan.rows[1]).toMatchObject({ status: "new", name: "Vistara · Red", stock: { before: null, after: 1000 } });
    // Blue gets the unit of its sibling Red? Not yet saved, so the default unit, noted.
    expect(plan.rows[2].notes).toContainEqual({ code: "UNIT_DEFAULTED", detail: "pcs" });
    expect(plan.rows[4]).toMatchObject({ status: "update", stock: { after: 1250 } });
    const r = await applyItems(db, co.owner, uuid(), input, { stockMode: "set", defaultUnit: "pcs" }, {});
    expect(r).toMatchObject({ created: 3, stockLines: 5, stockKind: "count" });
    expect(await level(co.d4012.id)).toMatchObject({ inStock: 2500 });
    const [red] = await db.select().from(s.items).where(eq(s.items.name, "Vistara · Red"));
    expect(red).toMatchObject({ product: "Vistara", variant: "Red", unit: "pcs", lowStockLevel: "3.00" });
    expect(await level(red.id)).toMatchObject({ inStock: 1000 });
    // A later new colour of Vistara takes Vistara's unit.
    const p2 = await planItems(db, co.owner, rows({ item: "Vistara", colour: "Green" }), { stockMode: "none" });
    expect(p2.rows[0].notes).toEqual([]);
    expect(p2.rows[0].changes).toContainEqual({ field: "unit", to: "pcs" });
  });

  it("\"new goods\" adds; duplicate rows add up; bad rows are refused", async () => {
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 40 }] });
    const input = rows({ item: "D-4012", qty: "10" }, { item: "d-4012", qty: "5" }, { item: "4012", qty: "1" }, { item: "D-4012", qty: "-3" }, { item: "D-4012", qty: "abc" }, { item: "Cotton Poplin", qty: "2", unit: "kg" }, { item: "D-4012", qty: "0" });
    const plan = await planItems(db, co.owner, input, { stockMode: "add" });
    const by = (n: number) => plan.rows.find((r) => r.rows.includes(n))!;
    // Rows 2 and 3 are the same item and merge; row 4 ("4012" is an extra name) adds onto them.
    expect(by(2)).toMatchObject({ rows: [2, 3, 8], stock: { before: 4000, after: 5600, change: 1600 } });
    expect(by(4).notes).toContainEqual({ code: "STOCK_ON_ROW", detail: "2" });
    expect(by(5)).toMatchObject({ status: "error", error: "NEGATIVE_ADD" });
    expect(by(6)).toMatchObject({ status: "error", error: "NOT_A_NUMBER" });
    expect(by(7)).toMatchObject({ status: "error", error: "UNIT_MISMATCH" });
    await applyItems(db, co.owner, uuid(), input, { stockMode: "add" }, {});
    expect(await level(co.d4012.id)).toMatchObject({ inStock: 5600 });
    const moves = await db.select().from(s.stockMovements).where(eq(s.stockMovements.kind, "receipt"));
    expect(moves).toHaveLength(2); // the first goods in + one import line
  });

  it("packing units are stock of their own; dispatched and owed stay as they are", async () => {
    await createOrder(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 5 }] });
    await createDispatch(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 2 }] });
    const input = rows({ item: "D-4012", qty: "100 pcs" }, { item: "D-4012", qty: "4", unit: "dabba" });
    await applyItems(db, co.owner, uuid(), input, { stockMode: "set" }, {});
    // A count means: now there are 100 pcs on the shelf, after what was already sent.
    expect(await level(co.d4012.id)).toMatchObject({ inStock: 10000, owed: 300, free: 9700 });
    expect(await level(co.d4012.id, "dabba")).toMatchObject({ inStock: 400 });
  });

  it("matching an item by choice saves the sheet's spelling; same import twice saves once", async () => {
    const input = rows({ item: "D 4O12 design", qty: "7" });
    const p = await planItems(db, co.owner, input, { stockMode: "add" });
    expect(p.rows[0].status).not.toBe("update");
    const id = uuid();
    await applyItems(db, co.owner, id, input, { stockMode: "add" }, { 2: { action: "match", id: co.d4012.id } });
    await applyItems(db, co.owner, id, input, { stockMode: "add" }, { 2: { action: "match", id: co.d4012.id } });
    expect(await level(co.d4012.id)).toMatchObject({ inStock: 700 });
    const aliases = await db.select().from(s.itemAliases).where(eq(s.itemAliases.itemId, co.d4012.id));
    expect(aliases.map((a) => a.alias)).toContain("D 4O12 design");
  });

  it("refuses a future stock date; \"don't change stock\" only touches items", async () => {
    await expect(planItems(db, co.owner, rows({ item: "X", qty: "1" }), { stockMode: "set", date: "2026-10-09" })).rejects.toMatchObject({ code: "FUTURE_DATE" });
    const r = await applyItems(db, co.owner, uuid(), rows({ item: "D-4012", qty: "99", low: "20" }, { item: "New One", unit: "kg" }), { stockMode: "none" }, {});
    expect(r).toMatchObject({ created: 1, updated: 1, stockLines: 0 });
    expect(await level(co.d4012.id)).toMatchObject({ inStock: 0, lowLevel: 2000 });
  });

  it("a firm sharing a godown imports into the shared items", async () => {
    const [b] = await db.insert(s.companies).values({ name: "B", stockCompanyId: co.company.id }).returning();
    const [bo] = await db.insert(s.users).values({ companyId: b.id, phone: "+919800000001", name: "o", role: "owner" }).returning();
    const bCtx = { companyId: b.id, userId: bo.id, role: "owner" as const, stockId: co.company.id, now: NOW };
    await applyItems(db, bCtx, uuid(), rows({ item: "D-4012", qty: "9" }, { item: "Shared New", unit: "pcs", qty: "3" }), { stockMode: "set" }, {});
    expect(await level(co.d4012.id)).toMatchObject({ inStock: 900 });
    const [it] = await db.select().from(s.items).where(eq(s.items.name, "Shared New"));
    expect(it.companyId).toBe(co.company.id);
  });

  it("round-trips through its own export", async () => {
    const red = await createItem(db, co.owner, { name: "Vistara · Red", product: "Vistara", variant: "Red", unit: "pcs", aliases: ["laal vistara"] });
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: red.id, quantity: 8 }, { itemId: co.d4012.id, quantity: 3, unit: "dabba" }] });
    const p = await createParty(db, co.owner, { name: "Shop" });
    await createDispatch(db, co.staff, { ...app, captureId: cid(), partyId: p.id, dispatchDate: TODAY, lines: [{ itemId: co.cotton.id, quantity: 2 }] });
    const sheet = await exportItems(db, co.owner);
    expect(sheet[0]).toEqual(["Item", "Colour", "Unit", "Stock", "Free", "Low stock level", "Other names"]);
    const plan = await planItems(db, co.owner, toRecords(sheet, readLayout(sheet)), { stockMode: "set" });
    expect(plan.rows.map((r) => [r.name, r.status])).toEqual(
      expect.arrayContaining([
        ["Cotton Poplin", "same"],
        ["D-4012", "same"],
        ["Vistara · Red", "same"],
      ]),
    );
    expect(plan.counts.error).toBe(0);
    // Below zero in the export (sent more than was in): re-importing it changes nothing.
    expect(plan.rows.find((r) => r.name === "Cotton Poplin")!.stock).toBeUndefined();
    const other = await planItems(db, co.owner, rows({ item: "Cotton Poplin", qty: "-5" }), { stockMode: "set" });
    expect(other.rows[0]).toMatchObject({ status: "error", error: "NEGATIVE_COUNT" });
  });
});
