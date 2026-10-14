import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/db/types";
import { hmac, newToken } from "@/auth/crypto";
import { userForToken, type SessionUser } from "@/auth/login";
import { createDispatch, createOrder, getPending } from "@/ledger/service";
import { itemStockHistory, recordStock, stockOverview } from "@/stock/service";
import { loadCatalog } from "@/extraction/catalog";
import { createItem, createParty } from "@/masters/service";
import { itemUsed } from "@/masters/manage";
import { createFirm, myFirms, setFirmStock, switchFirm } from "@/masters/firms";
import { saveSubscription, type PushMessage, type PushSender } from "@/notify/push";
import { checkLowStock, notifyStaffActivity, sendMorningDigests } from "@/notify/reminders";
import { dayEntries } from "@/ledger/history";
import { cid, freshDb, makeCompany, NOW, TODAY } from "./helpers";

let db: Db;
let co: Awaited<ReturnType<typeof makeCompany>>;
const app = { channel: "app", inputMethod: "form" } as const;
const OWNER = "+919800000001";

/** A logged-in session for a user row, as the app sees it. */
async function login(userId: string, companyId: string): Promise<SessionUser & { token: string }> {
  const token = newToken();
  await db.insert(s.sessions).values({ tokenHash: hmac(token), userId, companyId, expiresAt: new Date(NOW.getTime() + 86_400_000), createdAt: NOW, lastSeenAt: NOW });
  return { ...(await userForToken(db, token, NOW))!, token };
}
const reload = async (u: { token: string }) => ({ ...(await userForToken(db, u.token, NOW))!, token: u.token });
const ctx = (u: SessionUser) => ({ companyId: u.companyId, userId: u.userId, role: u.role, stockId: u.stockId, now: NOW });

beforeEach(async () => {
  db = await freshDb();
  co = await makeCompany(db, "Smart Homes");
});

describe("firms: add, list, switch", () => {
  it("an owner adds a firm, becomes its owner, and lands in it", async () => {
    const me = await login(co.owner.userId, co.company.id);
    const { companyId } = await createFirm(db, me, { name: "  Smart   Fabrics ", city: "Ludhiana", state: "Punjab" });
    const firms = await myFirms(db, me);
    expect(firms.map((f) => [f.name, f.role, f.current])).toEqual([
      ["Smart Homes", "owner", true],
      ["Smart Fabrics", "owner", false],
    ]);
    await switchFirm(db, me, companyId);
    const now = await reload(me);
    expect(now).toMatchObject({ companyId, companyName: "Smart Fabrics", role: "owner", phone: OWNER, stockId: companyId });
    // The new firm starts empty: no clients or items from the first one.
    const cat = await loadCatalog(db, now.companyId, now.stockId);
    expect(cat).toEqual({ parties: [], items: [] });
    expect((await myFirms(db, now)).find((f) => f.current)!.name).toBe("Smart Fabrics");
  });

  it("checks name, state, role and the firm limit", async () => {
    const me = await login(co.owner.userId, co.company.id);
    await expect(createFirm(db, me, { name: "   " })).rejects.toMatchObject({ code: "NAME_REQUIRED" });
    await expect(createFirm(db, me, { name: "x".repeat(81) })).rejects.toMatchObject({ code: "NAME_TOO_LONG" });
    await expect(createFirm(db, me, { name: "smart homes" })).rejects.toMatchObject({ code: "FIRM_NAME_TAKEN" });
    await expect(createFirm(db, me, { name: "B", state: "Narnia" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const staff = await login(co.staff.userId, co.company.id);
    await expect(createFirm(db, staff, { name: "Mine" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (let i = 1; i < 20; i++) await createFirm(db, me, { name: `Firm ${i}` });
    await expect(createFirm(db, me, { name: "Firm 21" })).rejects.toMatchObject({ code: "TOO_MANY_FIRMS" });
  });

  it("can bring the team along, with the same roles", async () => {
    const me = await login(co.owner.userId, co.company.id);
    const { companyId, copied } = await createFirm(db, me, { name: "B", copyTeam: true });
    expect(copied).toBe(3);
    const team = await db.select().from(s.users).where(eq(s.users.companyId, companyId));
    expect(team.map((u) => [u.phone, u.role]).sort()).toEqual([
      ["+919800000001", "owner"],
      ["+919800000002", "staff"],
      ["+919800000003", "viewer"],
      ["+919800000004", "staff"],
    ]);
  });

  it("switches only into firms this phone is active in", async () => {
    const me = await login(co.owner.userId, co.company.id);
    const other = await makeCompany(db, "Someone Else"); // same test phones, so: deactivate ours there first
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, other.owner.userId));
    await expect(switchFirm(db, me, other.company.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(switchFirm(db, me, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await reload(me)).companyId).toBe(co.company.id);
    // The staff member keeps their own role in each firm.
    const staffA = await login(co.staff.userId, co.company.id);
    await switchFirm(db, staffA, other.company.id);
    expect(await reload(staffA)).toMatchObject({ companyId: other.company.id, role: "staff", companyName: "Someone Else" });
  });
});

describe("shared godown", () => {
  async function twoFirms() {
    const me = await login(co.owner.userId, co.company.id);
    const { companyId: bId } = await createFirm(db, me, { name: "Smart Fabrics", stockCompanyId: co.company.id });
    await switchFirm(db, me, bId);
    const b = await reload(me);
    const [bStaffRow] = await db.insert(s.users).values({ companyId: bId, phone: "+919811111111", name: "B staff", role: "staff" }).returning();
    const bStaff = await login(bStaffRow.id, bId);
    return { bId, b, bStaff };
  }

  it("a firm can use another firm's items and stock; its clients stay its own", async () => {
    const { b, bId } = await twoFirms();
    expect(b.stockId).toBe(co.company.id);
    const cat = await loadCatalog(db, b.companyId, b.stockId);
    expect(cat.items.map((i) => i.name).sort()).toEqual(["Cotton Poplin", "D-4012"]);
    expect(cat.parties).toEqual([]);
    const shop = await createParty(db, ctx(b), { name: "B Client" });
    expect((await loadCatalog(db, co.company.id)).parties.map((p) => p.name)).not.toContain("B Client");
    // A new item made in B is an item of the shared godown.
    const it = await createItem(db, ctx(b), { name: "New Design", unit: "pcs" });
    expect(it.companyId).toBe(co.company.id);
    expect((await loadCatalog(db, co.company.id)).items.map((i) => i.name)).toContain("New Design");
    // Orders stay in the firm they were made in.
    await createOrder(db, ctx(b), { ...app, captureId: cid(), partyId: shop.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 4 }] });
    expect((await getPending(db, co.owner)).lines).toHaveLength(0);
    expect((await getPending(db, ctx(b))).lines).toHaveLength(1);
    expect(bId).not.toBe(co.company.id);
  });

  it("one stock: goods in from either firm, dispatches and orders of both firms count", async () => {
    const { b, bStaff } = await twoFirms();
    const shop = await createParty(db, ctx(b), { name: "B Client" });
    await recordStock(db, ctx(bStaff), { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 100 }] });
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 50 }] });
    await createOrder(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 30 }] });
    await createOrder(db, ctx(bStaff), { ...app, captureId: cid(), partyId: shop.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 40 }] });
    await createDispatch(db, ctx(bStaff), { ...app, captureId: cid(), partyId: shop.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 25 }] });
    const row = (rows: Awaited<ReturnType<typeof stockOverview>>) => rows.find((r) => r.itemId === co.d4012.id)!;
    // 150 in − 25 sent = 125; owed: A 30 + B (40 − 25) = 45; free 80. Same numbers seen from both firms.
    for (const c of [co.owner, ctx(b)]) expect(row(await stockOverview(db, c))).toMatchObject({ inStock: 12500, owed: 4500, free: 8000 });
    // A's stock card shows B's dispatch as the firm, not B's client, and no link into B.
    const card = await itemStockHistory(db, co.owner, co.d4012.id);
    const d = card.events.find((e) => e.kind === "dispatch")!;
    expect(d).toMatchObject({ partyName: "🏢 Smart Fabrics", dispatchId: undefined, by: "B staff" });
    // B's own card links its own dispatch.
    const own = (await itemStockHistory(db, ctx(b), co.d4012.id)).events.find((e) => e.kind === "dispatch")!;
    expect(own).toMatchObject({ partyName: "B Client" });
    expect(own.dispatchId).toBeTruthy();
    // History of the day in B shows goods in of the godown, with names from either firm.
    const day = await dayEntries(db, ctx(b), TODAY);
    expect(day.filter((e) => e.kind === "receipt").map((e) => e.by).sort()).toEqual(["B staff", "staff +919800000002"]);
    // An item used only by B still counts as used.
    const it = await createItem(db, ctx(b), { name: "Only B", unit: "pcs" });
    expect(await itemUsed(db, co.company.id, it.id)).toBe(false);
    await createOrder(db, ctx(b), { ...app, captureId: cid(), partyId: shop.id, orderDate: TODAY, lines: [{ itemId: it.id, quantity: 1 }] });
    expect(await itemUsed(db, co.company.id, it.id)).toBe(true);
  });

  it("items of another, unrelated company are still refused", async () => {
    const { b } = await twoFirms();
    const shop = await createParty(db, ctx(b), { name: "B Client" });
    const other = await makeCompany(db, "Other Co");
    await expect(
      createOrder(db, ctx(b), { ...app, captureId: cid(), partyId: shop.id, orderDate: TODAY, lines: [{ itemId: other.d4012.id, quantity: 1 }] }),
    ).rejects.toMatchObject({ code: "UNKNOWN_ITEM" });
    // And A's clients can't be used from B.
    await expect(
      createOrder(db, ctx(b), { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 1 }] }),
    ).rejects.toMatchObject({ code: "UNKNOWN_PARTY" });
  });

  it("sharing can only be set or changed while it can't strand anything", async () => {
    const me = await login(co.owner.userId, co.company.id);
    const { companyId: bId } = await createFirm(db, me, { name: "B" });
    const { companyId: cId } = await createFirm(db, me, { name: "C" });
    // B (empty) joins A's godown; C joins B's → follows to A (no chains).
    expect(await setFirmStock(db, me, bId, co.company.id)).toEqual({ changed: true });
    await setFirmStock(db, me, cId, bId);
    const [c] = await db.select().from(s.companies).where(eq(s.companies.id, cId));
    expect(c.stockCompanyId).toBe(co.company.id);
    expect(await setFirmStock(db, me, cId, co.company.id)).toEqual({ changed: false });
    // A is used by others: it keeps its own stock.
    await expect(setFirmStock(db, me, co.company.id, bId)).rejects.toMatchObject({ code: "STOCK_LOOP" });
    const { companyId: dId } = await createFirm(db, me, { name: "D" });
    await expect(setFirmStock(db, me, co.company.id, dId)).rejects.toMatchObject({ code: "STOCK_SHARED_BY_OTHERS" });
    // A firm with its own items can't join; one with orders can't leave.
    await switchFirm(db, me, dId);
    const d = await reload(me);
    await createItem(db, ctx(d), { name: "D item", unit: "pcs" });
    await expect(setFirmStock(db, me, dId, co.company.id)).rejects.toMatchObject({ code: "FIRM_HAS_ITEMS" });
    await switchFirm(db, me, bId);
    const b = await reload(me);
    const shop = await createParty(db, ctx(b), { name: "Shop" });
    await createOrder(db, ctx(b), { ...app, captureId: cid(), partyId: shop.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 1 }] });
    await expect(setFirmStock(db, me, bId, null)).rejects.toMatchObject({ code: "FIRM_HAS_ENTRIES" });
    // Pointing at itself means "own stock".
    await expect(setFirmStock(db, me, bId, bId)).rejects.toMatchObject({ code: "FIRM_HAS_ENTRIES" });
  });

  it("only an owner of both firms can share a godown", async () => {
    const me = await login(co.owner.userId, co.company.id);
    const { companyId: bId } = await createFirm(db, me, { name: "B" });
    // Only staff in another company (same test phones): can't point at it.
    const other = await makeCompany(db, "Other");
    await db.update(s.users).set({ role: "staff" }).where(eq(s.users.id, other.owner.userId));
    await expect(setFirmStock(db, me, bId, other.company.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createFirm(db, me, { name: "C", stockCompanyId: other.company.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A staff member of B can't change B.
    const [row] = await db.insert(s.users).values({ companyId: bId, phone: "+919822222222", name: "S", role: "staff" }).returning();
    const staffB = await login(row.id, bId);
    await expect(setFirmStock(db, staffB, bId, co.company.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("reminders reach the person in every firm", () => {
  let sent: { endpoint: string; msg: PushMessage }[];
  const sender: PushSender = async (t, msg) => {
    sent.push({ endpoint: t.endpoint, msg });
    return "ok";
  };
  beforeEach(() => {
    sent = [];
  });

  it("a phone subscribed in firm A gets firm B's alerts, named and opening firm B", async () => {
    const me = await login(co.owner.userId, co.company.id);
    await saveSubscription(db, co.owner, { endpoint: "https://push/owner", p256dh: "k", auth: "a" }, null);
    const { companyId: bId } = await createFirm(db, me, { name: "Smart Fabrics", copyTeam: true });
    const [bStaff] = await db.select().from(s.users).where(eq(s.users.companyId, bId)).then((r) => r.filter((u) => u.role === "staff"));
    const shop = await createParty(db, { companyId: bId, userId: bStaff.id, role: "staff", now: NOW }, { name: "Shop" });
    await notifyStaffActivity(db, sender, { companyId: bId, userId: bStaff.id, name: bStaff.name, role: "staff" }, { action: "order.create", partyId: shop.id, url: "/pending" });
    expect(sent).toHaveLength(1);
    expect(sent[0].msg.title).toMatch(/^Smart Fabrics · /);
    expect(sent[0].msg.url).toBe(`/firm/switch?to=${bId}&next=%2Fpending`);
    // Firm A's alert is named too (two firms now), and each firm's digest keeps its own tag.
    sent = [];
    await createOrder(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: "2026-10-01", lines: [{ itemId: co.d4012.id, quantity: 1 }] });
    await createOrder(db, { companyId: bId, userId: bStaff.id, role: "staff", now: NOW }, {
      ...app,
      captureId: cid(),
      partyId: shop.id,
      orderDate: "2026-10-01",
      lines: [{ itemId: (await createItem(db, { companyId: bId, userId: bStaff.id, role: "staff" }, { name: "X", unit: "pcs" })).id, quantity: 1 }],
    });
    await sendMorningDigests(db, sender, NOW);
    expect(sent.map((x) => x.msg.title.split(" · ")[0]).sort()).toEqual(["Smart Fabrics", "Smart Homes"]);
    expect(new Set(sent.map((x) => x.msg.tag)).size).toBe(2);
  });

  it("one person alone in one firm sees no firm name; low stock in a shared godown goes once per person", async () => {
    await saveSubscription(db, co.owner, { endpoint: "https://push/owner", p256dh: "k", auth: "a" }, null);
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 20 }] });
    await checkLowStock(db, sender, co.company.id, co.staff.userId);
    await createOrder(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 15 }] });
    await checkLowStock(db, sender, co.company.id, co.staff.userId);
    expect(sent).toHaveLength(1);
    expect(sent[0].msg.url).toBe(`/stock/item/${co.d4012.id}`);
    expect(sent[0].msg.title).not.toContain("·");

    // Now a second firm shares the godown; the same owner is owner in both: still one alert.
    sent = [];
    const me = await login(co.owner.userId, co.company.id);
    const { companyId: bId } = await createFirm(db, me, { name: "B", stockCompanyId: co.company.id });
    const [bOwner2] = await db.insert(s.users).values({ companyId: bId, phone: "+919833333333", name: "B partner", role: "owner" }).returning();
    await saveSubscription(db, { userId: bOwner2.id, companyId: bId }, { endpoint: "https://push/partner", p256dh: "k", auth: "a" }, null);
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 20 }] });
    await checkLowStock(db, sender, co.company.id, co.staff.userId); // back above: re-arms
    await createOrder(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 20 }] });
    await checkLowStock(db, sender, co.company.id, co.staff.userId);
    expect(sent.map((x) => x.endpoint).sort()).toEqual(["https://push/owner", "https://push/partner"]);
  });
});
