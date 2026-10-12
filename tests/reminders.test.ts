import { beforeEach, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import type { Db } from "@/db/types";
import { createDispatch, createOrder } from "@/ledger/service";
import { recordStock } from "@/stock/service";
import { saveSubscription, type PushMessage, type PushSender } from "@/notify/push";
import { buildDigest, checkLowStock, checkOverStock, digestMessage, notifyStaffActivity, sendMorningDigests, sendStockKeeperReminders } from "@/notify/reminders";
import { unitKey } from "@/lib/units";
import { eq } from "drizzle-orm";
import { cid, freshDb, makeCompany, NOW, TODAY } from "./helpers";

let db: Db;
let co: Awaited<ReturnType<typeof makeCompany>>;
let sent: { endpoint: string; msg: PushMessage }[];
let gone: Set<string>;
const app = { channel: "app", inputMethod: "form" } as const;
const sender: PushSender = async (t, msg) => {
  if (gone.has(t.endpoint)) return "gone";
  sent.push({ endpoint: t.endpoint, msg });
  return "ok";
};
const subscribe = (ctx: { userId: string; companyId: string }, endpoint: string) => saveSubscription(db, ctx, { endpoint, p256dh: "k", auth: "a" }, null);

beforeEach(async () => {
  db = await freshDb();
  co = await makeCompany(db);
  sent = [];
  gone = new Set();
});

const order = (qty: number, date = TODAY, partyId = co.sharma.id) =>
  createOrder(db, co.staff, { ...app, captureId: cid(), partyId, orderDate: date, lines: [{ itemId: co.d4012.id, quantity: qty }] });
const goodsIn = (qty: number) => recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: qty }] });

describe("morning digest", () => {
  it("is empty when nothing is overdue or unmatched", async () => {
    await order(5);
    expect(await buildDigest(db, co.company.id, TODAY)).toBeNull();
  });

  it("lists overdue orders by party, oldest first, and unmatched dispatches", async () => {
    await order(5, "2026-10-01"); // 7 days, no promised date → overdue
    await order(5, "2026-10-02", co.gupta.id);
    await order(5, "2026-10-07"); // recent: not overdue
    await createDispatch(db, co.staff, { ...app, captureId: cid(), partyId: co.gupta.id, dispatchDate: TODAY, lines: [{ itemId: co.cotton.id, quantity: 3 }] });
    const d = (await buildDigest(db, co.company.id, TODAY))!;
    expect(d).toMatchObject({ overdueOrders: 2, unmatchedDispatches: 1 });
    expect(d.overdue.map((p) => p.partyName)).toEqual(["Sharma Textiles", "Gupta Traders"]);
    const m = digestMessage(d, "en");
    expect(m.body).toContain("2 overdue orders: Sharma Textiles (7 days), Gupta Traders (6 days)");
    expect(m.body).toContain("1 dispatch not matched to an order");
    expect(digestMessage(d, "hi").body).toContain("2 ऑर्डर लेट");
  });

  it("goes only to owners, and drops phones that unsubscribed", async () => {
    await order(5, "2026-10-01");
    await subscribe(co.owner, "https://push/owner");
    await subscribe(co.owner, "https://push/owner-old");
    await subscribe(co.staff, "https://push/staff");
    gone.add("https://push/owner-old");
    expect(await sendMorningDigests(db, sender, NOW)).toBe(1);
    expect(sent.map((x) => x.endpoint)).toEqual(["https://push/owner"]);
    expect((await db.select().from(s.pushSubscriptions)).map((r) => r.endpoint).sort()).toEqual(["https://push/owner", "https://push/staff"]);
  });
});

describe("instant stock alerts", () => {
  beforeEach(async () => {
    await db.update(s.users).set({ language: "en" }).where(eq(s.users.id, co.owner.userId));
    await subscribe(co.owner, "https://push/owner");
  });

  it("alerts once when free stock crosses to the low level, not on the first look or again", async () => {
    await checkLowStock(db, sender, co.company.id, co.staff.userId); // first run: just records
    expect(sent).toHaveLength(0);
    await goodsIn(20);
    await checkLowStock(db, sender, co.company.id, co.staff.userId); // 20 free > 10: OK now
    expect(sent).toHaveLength(0);
    await order(15); // free 5 ≤ 10
    await checkLowStock(db, sender, co.company.id, co.staff.userId);
    expect(sent).toHaveLength(1);
    expect(sent[0].msg).toMatchObject({ title: "Stock running low", url: `/stock/item/${co.d4012.id}` });
    expect(sent[0].msg.body).toContain("D-4012: 5 pcs free");
    await checkLowStock(db, sender, co.company.id, co.staff.userId);
    expect(sent).toHaveLength(1);
  });

  it("doesn't alert the owner about their own entry", async () => {
    await checkLowStock(db, sender, co.company.id, co.owner.userId);
    await goodsIn(20);
    await checkLowStock(db, sender, co.company.id, co.owner.userId);
    await order(15);
    expect(await checkLowStock(db, sender, co.company.id, co.owner.userId)).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it("alerts when a dispatch sends more than is in stock", async () => {
    await goodsIn(5);
    await createDispatch(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 8 }] });
    const ctx = { companyId: co.company.id, actorId: co.staff.userId, actorName: "Ramesh", partyId: co.sharma.id };
    const lines = [{ itemId: co.d4012.id, unit: null }];
    expect(await checkOverStock(db, sender, ctx, lines, new Set())).toHaveLength(0); // correction that didn't send more
    await checkOverStock(db, sender, ctx, lines, new Set([unitKey(co.d4012.id, null)]));
    expect(sent).toHaveLength(1);
    expect(sent[0].msg.title).toBe("Sent more than stock");
    expect(sent[0].msg.body).toBe("D-4012: 3 pcs short\nto Sharma Textiles · by Ramesh");
  });
});

describe("staff activity alerts", () => {
  beforeEach(async () => {
    await db.update(s.users).set({ language: "en" }).where(eq(s.users.id, co.owner.userId));
    await subscribe(co.owner, "https://push/owner");
    await subscribe(co.staff, "https://push/staff");
  });
  const staff = () => ({ companyId: co.company.id, userId: co.staff.userId, name: "Ramesh", role: "staff" });

  it("tells owners what a staff member entered, with client and items", async () => {
    await notifyStaffActivity(db, sender, staff(), { action: "order.create", partyId: co.sharma.id, lines: [{ itemId: co.d4012.id, quantity: "10" }, { itemId: co.cotton.id, quantity: "2.5", unit: null }], url: "/orders/x" });
    expect(sent).toEqual([{ endpoint: "https://push/owner", msg: expect.objectContaining({ title: "Ramesh · New order", body: "Sharma Textiles: D-4012 10 pcs, Cotton Poplin 2.5 meter", url: "/orders/x" }) }]);
  });

  it("covers edits, cancels, stock and new names", async () => {
    await notifyStaffActivity(db, sender, staff(), { action: "dispatch.cancel", partyId: co.gupta.id, url: "/dispatches/x" });
    await notifyStaffActivity(db, sender, staff(), { action: "stock.adjustment", lines: [{ itemId: co.d4012.id, quantity: "-2" }], url: "/stock" });
    await notifyStaffActivity(db, sender, staff(), { action: "party.create", name: "New Shop", url: "/pending" });
    expect(sent.map((x) => [x.msg.title, x.msg.body])).toEqual([
      ["Ramesh · Dispatch cancelled", "Gupta Traders"],
      ["Ramesh · Stock adjusted", "D-4012 -2 pcs"],
      ["Ramesh · New client", "New Shop"],
    ]);
  });

  it("owners' own actions and viewers don't alert anyone", async () => {
    await notifyStaffActivity(db, sender, { ...staff(), userId: co.owner.userId, role: "owner" }, { action: "order.create", partyId: co.sharma.id, url: "/" });
    await notifyStaffActivity(db, sender, { ...staff(), role: "viewer" }, { action: "order.create", url: "/" });
    expect(sent).toEqual([]);
  });
});

describe("stock keeper reminder (11 AM)", () => {
  beforeEach(async () => {
    await db.update(s.users).set({ stockKeeper: true, language: "en" }).where(eq(s.users.id, co.staff2.userId));
    await subscribe(co.staff2, "https://push/keeper");
    await subscribe(co.owner, "https://push/owner");
  });

  it("asks the stock keeper only, when no goods in was entered today", async () => {
    expect(await sendStockKeeperReminders(db, sender, NOW)).toBe(1);
    expect(sent).toEqual([{ endpoint: "https://push/keeper", msg: expect.objectContaining({ title: "Maal add kiya?", url: "/stock/in" }) }]);
  });

  it("skips the day once goods in was entered (even if dated another day); a count doesn't count", async () => {
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "count", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 5 }] });
    expect(await sendStockKeeperReminders(db, sender, NOW)).toBe(1);
    sent = [];
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: "2026-10-01", lines: [{ itemId: co.d4012.id, quantity: 5 }] });
    expect(await sendStockKeeperReminders(db, sender, NOW)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("no stock keeper set: nothing sent; removed people aren't reminded", async () => {
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, co.staff2.userId));
    expect(await sendStockKeeperReminders(db, sender, NOW)).toBe(0);
  });
});
