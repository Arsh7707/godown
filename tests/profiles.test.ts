import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/db/types";
import { cleanGstin, displayTaxId, isValidAadhaar, isValidGstin, maskAadhaar, stateForGstin } from "@/lib/india";
import { partiesForManage, updateParty } from "@/masters/manage";
import { addUser, companyProfile, revealTaxId, teamList, updateCompany, updateUser } from "@/masters/profiles";
import { partyOrders } from "@/ledger/queries";
import { saveSubscription } from "@/notify/push";
import { freshDb, makeCompany } from "./helpers";

const GST = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** A valid GSTIN from its first 14 characters (the 15th is a checksum). */
const gstin = (first14: string) => first14 + [...GST].find((c) => isValidGstin(first14 + c))!;
/** A valid Aadhaar from its first 11 digits (the 12th is a Verhoeff check digit). */
const aadhaar = (first11: string) => first11 + [..."0123456789"].find((c) => isValidAadhaar(first11 + c))!;

describe("GSTIN and Aadhaar checks", () => {
  it("accepts a real-format GSTIN and exactly one check character", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("27aapfu0939f1zv")).toBe(true); // case doesn't matter
    expect(isValidGstin("27 AAPFU 0939F 1ZV")).toBe(true); // spaces don't matter
    expect([...GST].filter((c) => isValidGstin(`27AAPFU0939F1Z${c}`))).toEqual(["V"]);
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false); // wrong checksum
    expect(isValidGstin("27AAPFU0939F1V")).toBe(false); // too short
    expect(isValidGstin("40AAPFU0939F1ZV")).toBe(false); // no such state code
    expect(isValidGstin("27AAPFU0939F1XV")).toBe(false); // 14th must be Z
    expect(stateForGstin("03AAPFU0939F1ZV")).toBe("Punjab");
    expect(cleanGstin(" 03aapfu-0939f1zv ")).toBe("03AAPFU0939F1ZV");
  });

  it("checks Aadhaar length, first digit and Verhoeff digit; masks it", () => {
    const a = aadhaar("23456789012");
    expect(isValidAadhaar(a)).toBe(true);
    expect(isValidAadhaar(`${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`)).toBe(true);
    expect([..."0123456789"].filter((c) => isValidAadhaar(`23456789012${c}`))).toHaveLength(1);
    expect(isValidAadhaar(a.slice(0, 11) + ((Number(a[11]) + 1) % 10))).toBe(false);
    expect(isValidAadhaar("123456789012")).toBe(false); // can't start with 1
    expect(isValidAadhaar("2345678901")).toBe(false);
    expect(maskAadhaar(a)).toBe(`XXXX XXXX ${a.slice(-4)}`);
    expect(displayTaxId("aadhaar", a)).toBe(`XXXX XXXX ${a.slice(-4)}`);
    expect(displayTaxId("gstin", "27AAPFU0939F1ZV")).toBe("27AAPFU0939F1ZV");
  });
});

let db: Db;
let co: Awaited<ReturnType<typeof makeCompany>>;
beforeEach(async () => {
  db = await freshDb();
  co = await makeCompany(db);
});
const party = async (id = co.sharma.id) => (await db.select().from(s.parties).where(eq(s.parties.id, id)))[0];
const logs = async (action: string) => db.select().from(s.auditLog).where(and(eq(s.auditLog.companyId, co.company.id), eq(s.auditLog.action, action)));

describe("client profile", () => {
  it("saves city, state and a GSTIN; the GSTIN fills in the state", async () => {
    const g = gstin("03AAPFU0939F1Z");
    await updateParty(db, co.owner, co.sharma.id, { city: " Ludhiana ", taxIdType: "gstin", taxId: g.toLowerCase() });
    expect(await party()).toMatchObject({ city: "Ludhiana", state: "Punjab", taxIdType: "gstin", taxId: g });
    // A state the owner chose is kept.
    await updateParty(db, co.owner, co.gupta.id, { state: "Haryana", taxIdType: "gstin", taxId: gstin("03BBBBB1234B1Z") });
    expect((await party(co.gupta.id)).state).toBe("Haryana");
  });

  it("rejects bad numbers, unknown states, and a GSTIN already used by another client", async () => {
    await expect(updateParty(db, co.owner, co.sharma.id, { taxIdType: "gstin", taxId: "03AAPFU0939F1ZX" })).rejects.toMatchObject({ code: "INVALID_GSTIN" });
    await expect(updateParty(db, co.owner, co.sharma.id, { taxIdType: "aadhaar", taxId: "1234 5678 9012" })).rejects.toMatchObject({ code: "INVALID_AADHAAR" });
    await expect(updateParty(db, co.owner, co.sharma.id, { state: "Punjaab" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const g = gstin("03AAPFU0939F1Z");
    await updateParty(db, co.owner, co.sharma.id, { taxIdType: "gstin", taxId: g });
    await expect(updateParty(db, co.owner, co.gupta.id, { taxIdType: "gstin", taxId: g })).rejects.toMatchObject({ code: "TAX_ID_TAKEN" });
    // The same Aadhaar may be on two clients (one person, two shops).
    const a = aadhaar("98765432109");
    await updateParty(db, co.owner, co.sharma.id, { taxIdType: "aadhaar", taxId: a });
    await updateParty(db, co.owner, co.gupta.id, { taxIdType: "aadhaar", taxId: a });
  });

  it("Aadhaar: stored in full, shown masked everywhere, full number only for owners (and logged)", async () => {
    const a = aadhaar("23456789012");
    await updateParty(db, co.owner, co.sharma.id, { taxIdType: "aadhaar", taxId: `${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}` });
    expect((await party()).taxId).toBe(a);
    const masked = `XXXX XXXX ${a.slice(-4)}`;
    expect((await partiesForManage(db, co.owner)).find((p) => p.id === co.sharma.id)?.taxId).toBe(masked);
    expect((await partyOrders(db, co.staff, co.sharma.id)).party.taxId).toBe(masked);
    // The audit log never holds the full number.
    expect(JSON.stringify(await logs("party.update"))).not.toContain(a);
    await expect(revealTaxId(db, co.staff, co.sharma.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await revealTaxId(db, co.owner, co.sharma.id)).toBe(a);
    expect(await logs("party.taxid.reveal")).toHaveLength(1);
  });

  it("clearing the tax ID removes both type and number; leaving it out keeps it", async () => {
    await updateParty(db, co.owner, co.sharma.id, { taxIdType: "gstin", taxId: gstin("03AAPFU0939F1Z") });
    await updateParty(db, co.owner, co.sharma.id, { city: "Amritsar" });
    expect((await party()).taxIdType).toBe("gstin");
    await updateParty(db, co.owner, co.sharma.id, { taxIdType: null });
    expect(await party()).toMatchObject({ taxIdType: null, taxId: null, city: "Amritsar" });
  });

  it("staff can't change client profiles", async () => {
    await expect(updateParty(db, co.staff, co.sharma.id, { city: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("company and team", () => {
  it("company name, city and state", async () => {
    await updateCompany(db, co.owner, { name: "Smart Homes Inc.", city: "Ludhiana", state: "Punjab" });
    expect(await companyProfile(db, co.owner)).toEqual({ name: "Smart Homes Inc.", city: "Ludhiana", state: "Punjab" });
    await expect(updateCompany(db, co.owner, { name: " " })).rejects.toMatchObject({ code: "NAME_REQUIRED" });
    await expect(updateCompany(db, co.staff, { city: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("adds people with a normalised phone; no duplicates", async () => {
    await addUser(db, co.owner, { name: "Ramesh", phone: "098765 43210", role: "staff", city: "Ludhiana", state: "Punjab", stockKeeper: true });
    const r = (await teamList(db, co.owner)).find((u) => u.name === "Ramesh")!;
    expect(r).toMatchObject({ phone: "+919876543210", role: "staff", stockKeeper: true, state: "Punjab" });
    await expect(addUser(db, co.owner, { name: "Ramesh 2", phone: "+91 98765 43210", role: "staff" })).rejects.toMatchObject({ code: "DUPLICATE_PHONE" });
    await expect(addUser(db, co.owner, { name: "X", phone: "12345", role: "staff" })).rejects.toMatchObject({ code: "INVALID_PHONE" });
    await expect(addUser(db, co.owner, { name: " ", phone: "9876543211", role: "staff" })).rejects.toMatchObject({ code: "NAME_REQUIRED" });
  });

  it("keeps at least one owner, and owners can't remove themselves", async () => {
    await expect(updateUser(db, co.owner, co.owner.userId, { role: "staff" })).rejects.toMatchObject({ code: "SELF_CHANGE" });
    const second = await addUser(db, co.owner, { name: "Owner 2", phone: "9876500001", role: "owner" });
    await updateUser(db, co.owner, second.id, { role: "staff" }); // another owner remains
    await updateUser(db, co.owner, second.id, { role: "owner" });
    const ctx2 = { ...co.owner, userId: second.id };
    await updateUser(db, ctx2, co.owner.userId, { active: false });
    await expect(updateUser(db, co.owner, second.id, { active: false })).rejects.toMatchObject({ code: "LAST_OWNER" });
  });

  it("removing access logs the person out and stops their reminders", async () => {
    const [sess] = await db.insert(s.sessions).values({ tokenHash: "h1", userId: co.staff.userId, companyId: co.company.id, expiresAt: new Date(Date.now() + 86400_000) }).returning();
    await saveSubscription(db, co.staff, { endpoint: "https://push/staff", p256dh: "k", auth: "a" }, null);
    await updateUser(db, co.owner, co.staff.userId, { active: false });
    expect((await db.select().from(s.sessions).where(eq(s.sessions.id, sess.id)))[0].revokedAt).not.toBeNull();
    expect(await db.select().from(s.pushSubscriptions)).toHaveLength(0);
  });
});
