import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import type { Ctx, Role } from "@/ledger/service";
import { createItem, createParty } from "@/masters/service";

/** 2026-10-08 15:00 IST */
export const NOW = new Date("2026-10-08T09:30:00Z");
export const TODAY = "2026-10-08";

export async function freshDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as Db;
}

export async function makeCompany(db: Db, name = "Test Textiles") {
  const [company] = await db.insert(schema.companies).values({ name }).returning();
  const ctxFor = async (role: Role, phone: string): Promise<Ctx> => {
    const [u] = await db
      .insert(schema.users)
      .values({ companyId: company.id, phone, name: `${role} ${phone}`, role })
      .returning();
    return { companyId: company.id, userId: u.id, role, now: NOW };
  };
  const owner = await ctxFor("owner", "+919800000001");
  const staff = await ctxFor("staff", "+919800000002");
  const viewer = await ctxFor("viewer", "+919800000003");
  const staff2 = await ctxFor("staff", "+919800000004");
  const sharma = await createParty(db, owner, { name: "Sharma Textiles", aliases: ["Sharma", "शर्मा"] });
  const gupta = await createParty(db, owner, { name: "Gupta Traders" });
  const d4012 = await createItem(db, owner, { name: "D-4012", unit: "pcs", aliases: ["4012"] });
  const cotton = await createItem(db, owner, { name: "Cotton Poplin", unit: "meter" });
  return { company, owner, staff, staff2, viewer, sharma, gupta, d4012, cotton };
}

let n = 0;
export const cid = () => `capture-${++n}-${Math.random().toString(36).slice(2)}`;
