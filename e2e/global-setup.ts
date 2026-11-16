/**
 * Before the browser tests: wipe the local test database, apply every
 * migration, and add a known company to test against:
 *
 * - "E2E Textiles" (owner, staff, viewer) with two clients and three items,
 *   some goods in, one order part-sent, one dispatch with no order, and a
 *   GST bill on the part-sent dispatch.
 * - "E2E Fabrics", a second firm of the same owner using E2E Textiles' godown.
 *
 * The ids go to e2e/.state/seed.json for the specs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as s from "../src/db/schema";
import type { Db } from "../src/db/types";
import type { Ctx } from "../src/ledger/service";
import { createDispatch, createOrder } from "../src/ledger/service";
import { createItem, createParty } from "../src/masters/service";
import { recordStock } from "../src/stock/service";
import { createBill } from "../src/billing/service";
import { setProductTax } from "../src/masters/manage";
import { todayIST, addDays } from "../src/lib/dates";
import { assertLocalDb, DB_URL, PHONES, SEED_FILE } from "./env";

export default async function globalSetup() {
  assertLocalDb();
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
    const db = drizzle(sql, { schema: s }) as unknown as Db;
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });

    const today = todayIST();
    const [co] = await db
      .insert(s.companies)
      .values({ name: "E2E Textiles", city: "Ludhiana", state: "Punjab", gstin: "03AAPFU0939F1ZV", address: "12 Mall Road", upiId: "e2e@okaxis", billPrefix: "E2E" })
      .returning();
    const [fab] = await db.insert(s.companies).values({ name: "E2E Fabrics", stockCompanyId: co.id }).returning();
    const user = async (companyId: string, role: "owner" | "staff" | "viewer", phone: string, name: string) => {
      const [u] = await db.insert(s.users).values({ companyId, phone: `+91${phone}`, name, role, language: "en" }).returning();
      return { companyId, userId: u.id, role, stockId: co.id } satisfies Ctx;
    };
    const owner = await user(co.id, "owner", PHONES.owner, "Owner Singh");
    const staff = await user(co.id, "staff", PHONES.staff, "Staff Kumar");
    await user(co.id, "viewer", PHONES.viewer, "Viewer Devi");
    const fabOwner = await user(fab.id, "owner", PHONES.owner, "Owner Singh");

    const sharma = await createParty(db, owner, { name: "Sharma Textiles", aliases: ["Sharma"] });
    const gupta = await createParty(db, owner, { name: "Gupta Traders" });
    const mehta = await createParty(db, fabOwner, { name: "Mehta Cloth" });
    const d4012 = await createItem(db, owner, { name: "D-4012", unit: "pcs" });
    const cotton = await createItem(db, owner, { name: "Cotton Poplin", unit: "meter" });
    const rayon = await createItem(db, owner, { name: "Rayon Plain", unit: "pcs" });
    // Used only by the API tests, so they never move the numbers the screen tests check.
    const probe = await createItem(db, owner, { name: "Probe Cloth", unit: "pcs" });

    const app = { channel: "app", inputMethod: "form" } as const;
    let n = 0;
    const cid = () => `seed-${++n}`;
    await recordStock(db, staff, { ...app, captureId: cid(), kind: "receipt", date: addDays(today, -40), lines: [{ itemId: d4012.id, quantity: 100 }, { itemId: cotton.id, quantity: "250.5" }, { itemId: rayon.id, quantity: 40 }] });
    const order = await createOrder(db, staff, { ...app, captureId: cid(), partyId: sharma.id, orderDate: addDays(today, -6), lines: [{ itemId: d4012.id, quantity: 60 }, { itemId: cotton.id, quantity: "20.25" }] });
    const dispatch = await createDispatch(db, staff, { ...app, captureId: cid(), partyId: sharma.id, dispatchDate: addDays(today, -2), transport: "Shree Roadways", lines: [{ itemId: d4012.id, quantity: 25 }] });
    const loose = await createDispatch(db, staff, { ...app, captureId: cid(), partyId: gupta.id, dispatchDate: addDays(today, -1), lines: [{ itemId: cotton.id, quantity: 5 }] });
    await createOrder(db, fabOwner, { ...app, captureId: cid(), partyId: mehta.id, orderDate: today, lines: [{ itemId: d4012.id, quantity: 10 }] });
    // Bills: one made already (for the bill screens and the party's link); one dispatch left for the screen check of a new bill.
    await setProductTax(db, owner, "D-4012", { hsn: "6204", gstRate: "5" });
    await setProductTax(db, owner, "Cotton Poplin", { hsn: "5208", gstRate: "5" });
    const bill = await createBill(db, owner, dispatch.dispatchId, { kind: "gst", billDate: addDays(today, -2), lines: [{ itemId: d4012.id, name: "D-4012", hsn: "6204", quantity: 25, unit: "pcs", rate: "450", gstRate: "5" }], charges: "150" });
    const [{ shareToken }] = await db.select({ shareToken: s.bills.shareToken }).from(s.bills);
    const unbilled = await createDispatch(db, staff, { ...app, captureId: cid(), partyId: gupta.id, dispatchDate: addDays(today, -1), lines: [{ itemId: probe.id, quantity: 1 }] });

    mkdirSync("e2e/.state", { recursive: true });
    const seed = { companyId: co.id, fabricsId: fab.id, sharma: sharma.id, gupta: gupta.id, d4012: d4012.id, cotton: cotton.id, rayon: rayon.id, probe: probe.id, orderId: order.orderId, dispatchId: dispatch.dispatchId, looseDispatchId: loose.dispatchId, billId: bill.billId, billToken: shareToken, unbilledDispatchId: unbilled.dispatchId };
    writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));
  } finally {
    await sql.end();
  }
}
