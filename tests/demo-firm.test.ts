/**
 * The demo firm for client presentations: built through the normal
 * services, with the mix a demo needs, and never added twice.
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { createDemoFirm, DemoFirmExists } from "@/dev/demo-firm";
import { findUnmatched, getPending } from "@/ledger/service";
import { stockOverview } from "@/stock/service";
import { freshDb, NOW } from "./helpers";

describe("demo firm", async () => {
  const db = await freshDb();
  const firm = await createDemoFirm(db, { ownerPhone: "+1 555 555 0123", ownerName: "Arsh", now: NOW });
  const team = await db.select().from(users).where(eq(users.companyId, firm.id));
  const owner = team.find((u) => u.role === "owner")!;
  const ctx = { companyId: firm.id, userId: owner.id, role: "owner" as const, now: NOW };

  it("belongs to the given number; nobody else on it can get a code", () => {
    expect(owner).toMatchObject({ phone: "+15555550123", name: "Arsh" });
    expect(team.filter((u) => u.role !== "owner").map((u) => u.phone)).toEqual(["+910000000002", "+910000000003", "+910000000004"]);
  });

  it("has pending orders, some overdue, and goods sent with no order", async () => {
    const pending = await getPending(db, ctx);
    const owing = pending.byParty.filter((r) => r.balance > 0);
    expect(owing.length).toBeGreaterThanOrEqual(6);
    expect(owing.filter((r) => r.overdueLines > 0).length).toBeGreaterThanOrEqual(3);
    expect(owing.filter((r) => r.overdueLines === 0).length).toBeGreaterThanOrEqual(2);
    expect((await findUnmatched(db, ctx)).length).toBe(1);
  });

  it("has stock on every item and a few running low", async () => {
    const rows = await stockOverview(db, ctx);
    expect(rows.length).toBe(16);
    expect(rows.every((r) => r.inStock > 0)).toBe(true);
    const low = rows.filter((r) => r.low).map((r) => r.name);
    if (process.env.SHOW_DEMO) console.table(rows.map((r) => ({ name: r.name, inStock: r.inStock / 100, owed: r.owed / 100, free: r.free / 100, low: r.low })));
    expect(low.length).toBeGreaterThanOrEqual(2);
    expect(low.length).toBeLessThanOrEqual(6);
  });

  it("is not added twice for the same owner", async () => {
    await expect(createDemoFirm(db, { ownerPhone: "+15555550123", now: NOW })).rejects.toBeInstanceOf(DemoFirmExists);
  });

  it("refuses a number that isn't one", async () => {
    await expect(createDemoFirm(db, { ownerPhone: "5555550123", now: NOW })).rejects.toThrow(/Not a phone number/);
  });
});
