/**
 * Bill details: the firm's GSTIN, address and bank/UPI, each item's HSN
 * and GST rate, the client's billing address, and supervisors (staff who
 * can make bills).
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { isValidGstin } from "@/lib/india";
import { requestCode, userForToken, verifyCode } from "@/auth/login";
import { DevOtpProvider } from "@/auth/otp-provider";
import { itemsForManage, partiesForManage, setProductTax, updateParty } from "@/masters/manage";
import { addUser, companyProfile, teamList, updateCompany, updateUser } from "@/masters/profiles";
import { createProduct } from "@/masters/service";
import { freshDb, makeCompany } from "./helpers";

const GST = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const gstin = (first14: string) => first14 + [...GST].find((c) => isValidGstin(first14 + c))!;

describe("firm details for bills", () => {
  it("saves GSTIN, address, phone, bank and UPI, cleaned up; the GSTIN fills in the state", async () => {
    const db = await freshDb();
    const co = await makeCompany(db);
    const g = gstin("03AAPFU0939F1Z");
    await updateCompany(db, co.owner, {
      gstin: ` ${g.toLowerCase()} `,
      address: "  12 Mall Road\nLudhiana ",
      phone: "0161 2345678",
      bankName: "State Bank of India",
      bankAccount: "3012 3456 7890",
      bankIfsc: "sbin0001234",
      upiId: "Ganesh@OKSBI",
      billPrefix: "sgt",
    });
    expect(await companyProfile(db, co.owner)).toMatchObject({
      gstin: g,
      state: "Punjab",
      address: "12 Mall Road\nLudhiana",
      bankAccount: "301234567890",
      bankIfsc: "SBIN0001234",
      upiId: "ganesh@oksbi",
      billPrefix: "SGT",
    });
  });

  it("keeps a state the owner picked, and empty clears a field", async () => {
    const db = await freshDb();
    const co = await makeCompany(db);
    await updateCompany(db, co.owner, { state: "Delhi", upiId: "a@okaxis" });
    await updateCompany(db, co.owner, { gstin: gstin("03AAPFU0939F1Z"), upiId: "" });
    expect(await companyProfile(db, co.owner)).toMatchObject({ state: "Delhi", upiId: null });
  });

  it.each([
    [{ gstin: "03AAPFU0939F1ZX" }, "INVALID_GSTIN"],
    [{ bankIfsc: "SBIN1234" }, "INVALID_IFSC"],
    [{ upiId: "not-a-upi" }, "INVALID_UPI"],
    [{ billPrefix: "SGT/25" }, "INVALID_PREFIX"],
  ])("refuses %o", async (input, code) => {
    const db = await freshDb();
    const co = await makeCompany(db);
    await expect(updateCompany(db, co.owner, input)).rejects.toMatchObject({ code });
  });

  it("only owners change it, and the change is logged", async () => {
    const db = await freshDb();
    const co = await makeCompany(db);
    await expect(updateCompany(db, co.staff, { upiId: "a@okaxis" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateCompany(db, co.owner, { upiId: "a@okaxis" });
    const [row] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "company.update"));
    expect(row.details).toEqual({ before: { upiId: null }, after: { upiId: "a@okaxis" } });
  });
});

describe("HSN and GST rate", () => {
  it("is set for the whole product: every colour gets the same", async () => {
    const db = await freshDb();
    const co = await makeCompany(db);
    await createProduct(db, co.owner, { name: "Poplin", unit: "meter", variants: ["White", "Black"] });
    await setProductTax(db, co.owner, "Poplin", { hsn: "5208", gstRate: "5" });
    const poplin = (await itemsForManage(db, co.owner)).filter((i) => i.product === "Poplin");
    expect(poplin.map((i) => [i.hsn, i.gstRate])).toEqual([["5208", 5], ["5208", 5]]);
    const other = (await itemsForManage(db, co.owner)).find((i) => i.name === "D-4012")!;
    expect([other.hsn, other.gstRate]).toEqual([null, null]);
  });

  it("can be cleared, and refuses bad values", async () => {
    const db = await freshDb();
    const co = await makeCompany(db);
    await setProductTax(db, co.owner, "D-4012", { hsn: "6204 42", gstRate: 18 });
    expect((await itemsForManage(db, co.owner)).find((i) => i.name === "D-4012")).toMatchObject({ hsn: "620442", gstRate: 18 });
    await setProductTax(db, co.owner, "D-4012", { hsn: null, gstRate: null });
    expect((await itemsForManage(db, co.owner)).find((i) => i.name === "D-4012")).toMatchObject({ hsn: null, gstRate: null });
    await expect(setProductTax(db, co.owner, "D-4012", { hsn: "52", gstRate: 5 })).rejects.toMatchObject({ code: "INVALID_HSN" });
    await expect(setProductTax(db, co.owner, "D-4012", { hsn: null, gstRate: "120" })).rejects.toMatchObject({ code: "INVALID_GST_RATE" });
    await expect(setProductTax(db, co.owner, "D-4012", { hsn: null, gstRate: "five" })).rejects.toMatchObject({ code: "INVALID_GST_RATE" });
    await expect(setProductTax(db, co.staff, "D-4012", { hsn: null, gstRate: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setProductTax(db, co.owner, "Nothing", { hsn: null, gstRate: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("client billing address", () => {
  it("is saved, trimmed, and cleared when empty", async () => {
    const db = await freshDb();
    const co = await makeCompany(db);
    await updateParty(db, co.owner, co.sharma.id, { address: " Shop 4, Hall Bazaar\nAmritsar " });
    expect((await partiesForManage(db, co.owner)).find((p) => p.id === co.sharma.id)?.address).toBe("Shop 4, Hall Bazaar\nAmritsar");
    await updateParty(db, co.owner, co.sharma.id, { address: "" });
    expect((await partiesForManage(db, co.owner)).find((p) => p.id === co.sharma.id)?.address).toBeNull();
  });
});

describe("supervisors", () => {
  it("are staff marked to make bills; the login session knows", async () => {
    const db = await freshDb();
    const co = await makeCompany(db);
    const u = await addUser(db, co.owner, { name: "Vikas", phone: "+919811111111", role: "staff", supervisor: true });
    expect((await teamList(db, co.owner)).find((p) => p.id === u.id)?.supervisor).toBe(true);
    const { showCode } = await requestCode(db, new DevOtpProvider(), { phone: "+919811111111" });
    const { token } = await verifyCode(db, { phone: "+919811111111", code: showCode! });
    expect((await userForToken(db, token))?.supervisor).toBe(true);
    await updateUser(db, co.owner, u.id, { supervisor: false });
    expect((await userForToken(db, token))?.supervisor).toBe(false);
  });
});
