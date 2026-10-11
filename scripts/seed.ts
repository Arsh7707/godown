/**
 * Creates a company and its users, or adds missing users to an existing one.
 * Safe to run more than once. Usage: npm run seed [-- path/to/company.json]
 * Default file: seed/company.local.json (git-ignored; see seed/company.example.json).
 */
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, companies, items, parties, users } from "@/db/schema";
import { createItem, createParty } from "@/masters/service";
import { normalizePhone } from "@/lib/phone";

interface SeedFile {
  company: string;
  users: { name: string; phone: string; role: "owner" | "staff" | "viewer"; language?: "hi" | "en" }[];
  /** Optional starting lists; skipped if a party/item with the same name exists. */
  parties?: { name: string; aliases?: string[] }[];
  items?: { name: string; unit: string; aliases?: string[] }[];
}

async function main() {
  const file = process.argv[2] ?? "seed/company.local.json";
  const seed = JSON.parse(readFileSync(file, "utf8")) as SeedFile;
  if (!seed.users.some((u) => u.role === "owner")) throw new Error("At least one owner is required");

  let [company] = await db.select().from(companies).where(eq(companies.name, seed.company));
  if (!company) {
    [company] = await db.insert(companies).values({ name: seed.company }).returning();
    console.log(`Created company ${company.name}`);
  } else {
    console.log(`Company ${company.name} exists`);
  }

  for (const u of seed.users) {
    const phone = normalizePhone(u.phone);
    if (!phone) throw new Error(`Invalid phone for ${u.name}: ${u.phone}`);
    const [existing] = await db.select().from(users).where(and(eq(users.companyId, company.id), eq(users.phone, phone)));
    if (existing) {
      console.log(`  ${u.name} (${phone}) already there`);
      continue;
    }
    const [created] = await db
      .insert(users)
      .values({ companyId: company.id, name: u.name, phone, role: u.role, language: u.language ?? "hi" })
      .returning();
    // The first owner is recorded as the actor for seeding.
    const [actor] = await db.select().from(users).where(and(eq(users.companyId, company.id), eq(users.role, "owner")));
    await db.insert(auditLog).values({
      companyId: company.id,
      userId: actor.id,
      action: "user.create",
      entityType: "user",
      entityId: created.id,
      details: { name: u.name, phone, role: u.role, via: "seed" },
    });
    console.log(`  added ${u.name} (${phone}) as ${u.role}`);
  }

  const [owner] = await db.select().from(users).where(and(eq(users.companyId, company.id), eq(users.role, "owner")));
  const ctx = { companyId: company.id, userId: owner.id, role: "owner" as const };
  for (const p of seed.parties ?? []) {
    const [exists] = await db.select({ id: parties.id }).from(parties).where(and(eq(parties.companyId, company.id), eq(parties.name, p.name)));
    if (exists) continue;
    await createParty(db, ctx, { name: p.name, aliases: p.aliases });
    console.log(`  party ${p.name}`);
  }
  for (const it of seed.items ?? []) {
    const [exists] = await db.select({ id: items.id }).from(items).where(and(eq(items.companyId, company.id), eq(items.name, it.name)));
    if (exists) continue;
    await createItem(db, ctx, { name: it.name, unit: it.unit, aliases: it.aliases });
    console.log(`  item ${it.name} (${it.unit})`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
