/**
 * Demo data for the local /dev ledger console. Not the production seed
 * (that comes in Phase 3 with the real company and users).
 */
import { randomUUID } from "node:crypto";
import type { Db } from "@/db/types";
import { companies, users } from "@/db/schema";
import { addDays, todayIST } from "@/lib/dates";
import { createDispatch, createOrder, type Ctx } from "@/ledger/service";
import { createItem, createParty } from "@/masters/service";

export async function createDemoCompany(db: Db) {
  const today = todayIST();
  const [company] = await db
    .insert(companies)
    .values({ name: `Demo Textiles ${new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}` })
    .returning();
  const ctx: Record<string, Ctx> = {};
  for (const [role, phone, name] of [
    ["owner", "+910000000001", "Owner (demo)"],
    ["staff", "+910000000002", "Ramesh (staff)"],
    ["viewer", "+910000000003", "Viewer (demo)"],
  ] as const) {
    const [u] = await db.insert(users).values({ companyId: company.id, phone, name, role }).returning();
    ctx[role] = { companyId: company.id, userId: u.id, role };
  }

  const sharma = await createParty(db, ctx.owner, { name: "Sharma Textiles", aliases: ["Sharma", "शर्मा"] });
  const gupta = await createParty(db, ctx.owner, { name: "Gupta Traders" });
  const mehta = await createParty(db, ctx.owner, { name: "Mehta Fabrics" });
  await createParty(db, ctx.owner, { name: "Singh Cloth House" });
  const d4012 = await createItem(db, ctx.owner, { name: "D-4012", unit: "pcs", aliases: ["4012"] });
  const d4013 = await createItem(db, ctx.owner, { name: "D-4013", unit: "pcs", aliases: ["4013"] });
  const poplin = await createItem(db, ctx.owner, { name: "Cotton Poplin", unit: "meter", aliases: ["poplin"] });

  const src = { channel: "app", inputMethod: "form" } as const;
  const order = (partyId: string, itemId: string, quantity: string, daysAgo: number, promisedIn?: number) =>
    createOrder(db, ctx.staff, {
      ...src,
      captureId: randomUUID(),
      partyId,
      orderDate: addDays(today, -daysAgo),
      promisedDate: promisedIn === undefined ? null : addDays(today, promisedIn),
      lines: [{ itemId, quantity }],
    });
  const send = (partyId: string, itemId: string, quantity: string, daysAgo: number) =>
    createDispatch(db, ctx.staff, {
      ...src,
      captureId: randomUUID(),
      partyId,
      dispatchDate: addDays(today, -daysAgo),
      takenBy: "Ramesh",
      transport: "VRL Logistics",
      lines: [{ itemId, quantity }],
    });

  // Sharma: order 20, sent 5 + 5 + 4 -> 6 pending, 6 days old (overdue).
  await order(sharma.id, d4012.id, "20", 6);
  await send(sharma.id, d4012.id, "5", 5);
  await send(sharma.id, d4012.id, "5", 3);
  await send(sharma.id, d4012.id, "4", 1);
  await order(sharma.id, d4013.id, "10", 2);
  // Gupta: meters, promised in 5 days.
  await order(gupta.id, poplin.id, "50.5", 1, 5);
  await send(gupta.id, poplin.id, "20.25", 0);
  // Mehta: goods sent with no order -> unmatched.
  await send(mehta.id, d4013.id, "3", 0);
  return company;
}
