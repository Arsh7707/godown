/**
 * A demo firm for showing Godown to clients: a textile wholesaler with
 * three weeks of believable history (orders, part dispatches, overdue
 * orders, goods sent with no order, low stock). Everything goes through the
 * normal services, so it looks exactly like real use.
 *
 * Only the owner's number is real. Staff and the viewer have numbers that
 * can't exist in India (+91 00000 …), so no code is ever sent to a stranger.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { companies, users } from "@/db/schema";
import { addDays, todayIST } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import { createDispatch, createOrder, type Ctx, type InputMethod } from "@/ledger/service";
import { createItem, createParty, createProduct } from "@/masters/service";
import { recordStock } from "@/stock/service";

export const DEMO_FIRM_NAME = "Shree Ganesh Textiles";

export interface DemoFirmOptions {
  ownerPhone: string;
  ownerName?: string;
  name?: string;
  language?: "hi" | "en";
  now?: Date;
}

export class DemoFirmExists extends Error {}

export async function createDemoFirm(db: Db, opts: DemoFirmOptions) {
  const ownerPhone = normalizePhone(opts.ownerPhone);
  if (!ownerPhone) throw new Error(`Not a phone number: ${opts.ownerPhone} (use +1… or +91…)`);
  const name = opts.name ?? DEMO_FIRM_NAME;
  const realNow = opts.now ?? new Date();
  const today = todayIST(realNow);

  const [existing] = await db
    .select({ id: companies.id })
    .from(companies)
    .innerJoin(users, eq(users.companyId, companies.id))
    .where(and(eq(companies.name, name), eq(users.phone, ownerPhone), eq(users.role, "owner")));
  if (existing) throw new DemoFirmExists(`${name} already exists for ${ownerPhone}`);

  const [firm] = await db.insert(companies).values({ name, city: "Ludhiana", state: "Punjab" }).returning();
  const person = async (role: Ctx["role"], phone: string, personName: string, extra: Partial<typeof users.$inferInsert> = {}) => {
    const [u] = await db
      .insert(users)
      .values({ companyId: firm.id, phone, name: personName, role, language: opts.language ?? "en", city: "Ludhiana", state: "Punjab", ...extra })
      .returning();
    return { companyId: firm.id, userId: u.id, role } satisfies Ctx;
  };
  const owner = await person("owner", ownerPhone, opts.ownerName ?? "Owner");
  const ramesh = await person("staff", "+910000000002", "Ramesh Kumar", { language: "hi", stockKeeper: true });
  const sunil = await person("staff", "+910000000003", "Sunil", { language: "hi" });
  await person("viewer", "+910000000004", "Accountant");

  /** The same person, as if acting `daysAgo` days back at that hour (IST). */
  const on = (who: Ctx, daysAgo: number, hour: number): Ctx => {
    const at = new Date(`${addDays(today, -daysAgo)}T${String(hour).padStart(2, "0")}:15:00+05:30`);
    return { ...who, now: at > realNow ? new Date(realNow.getTime() - 60_000) : at };
  };
  const day = (daysAgo: number) => addDays(today, -daysAgo);

  // ------------------------------------------------------------ clients
  const party = (n: string, aliases: string[] = []) => createParty(db, on(owner, 21, 10), { name: n, aliases });
  const sharma = await party("Sharma Cloth House", ["Sharma ji", "शर्मा"]);
  const gupta = await party("Gupta Traders", ["Gupta ji", "गुप्ता"]);
  const mehta = await party("Mehta Fabrics", ["Mehta", "मेहता"]);
  const singh = await party("Singh Garments", ["Singh ji", "सिंह"]);
  const bansal = await party("Bansal Saree Centre", ["Bansal", "बंसल"]);
  const kapoor = await party("Kapoor Textiles", ["Kapoor", "कपूर"]);
  const arora = await party("Arora Hosiery", ["Arora", "अरोड़ा"]);
  const jain = await party("Jain Brothers", ["Jain", "जैन"]);

  // ------------------------------------------------------------ items
  const setup = on(owner, 21, 11);
  const product = async (n: string, unit: string, variants: string[], low: number, aliases: string[] = []) => {
    const made = await createProduct(db, setup, { name: n, unit, variants, lowStockLevel: low, aliases });
    return Object.fromEntries(made.map((it) => [it.variant ?? "", it.id])) as Record<string, string>;
  };
  const poplin = await product("Cotton Poplin", "meter", ["White", "Sky Blue", "Black"], 200);
  const suit12 = await product("D-4012 Suit", "pcs", ["Red", "Maroon", "Green"], 20);
  const suit13 = await product("D-4013 Suit", "pcs", ["Pink", "Yellow"], 20);
  const shawl = await product("Woollen Shawl", "pcs", ["Grey", "Black", "Maroon"], 15);
  const legging = await product("Lycra Legging", "pcs", ["Black", "White", "Navy"], 50);
  const denim = (await createItem(db, setup, { name: "Denim 10oz", unit: "meter", aliases: ["denim", "डेनिम"], lowStockLevel: 300 })).id;
  const saree = (await createItem(db, setup, { name: "Georgette Saree", unit: "pcs", aliases: ["saree", "georgette", "साड़ी"], lowStockLevel: 30 })).id;

  // ------------------------------------------------------------ stock
  type Line = [itemId: string, quantity: number];
  const lines = (ls: Line[]) => ls.map(([itemId, quantity]) => ({ itemId, quantity }));
  const stock = (who: Ctx, kind: "receipt" | "count", daysAgo: number, ls: Line[], method: InputMethod = "form") =>
    recordStock(db, on(who, daysAgo, 10), { captureId: randomUUID(), kind, date: day(daysAgo), lines: lines(ls), channel: "app", inputMethod: method });
  await stock(ramesh, "receipt", 20, [
    [poplin.White, 1200], [poplin["Sky Blue"], 500], [poplin.Black, 600],
    [suit12.Red, 120], [suit12.Maroon, 80], [suit12.Green, 60],
    [suit13.Pink, 70], [suit13.Yellow, 50],
    [shawl.Grey, 90], [shawl.Black, 70], [shawl.Maroon, 22],
    [legging.Black, 140], [legging.White, 120], [legging.Navy, 100],
    [denim, 900], [saree, 150],
  ]);
  await stock(ramesh, "receipt", 9, [[poplin["Sky Blue"], 300], [denim, 500]], "voice");
  await stock(ramesh, "count", 6, [[denim, 1390]]);

  // ------------------------------------------------------------ orders
  const order = (who: Ctx, daysAgo: number, partyId: string, ls: Line[], promisedIn: number | null, how: { method?: InputMethod; said?: string } = {}) =>
    createOrder(db, on(who, daysAgo, 12), {
      captureId: randomUUID(),
      partyId,
      orderDate: day(daysAgo),
      promisedDate: promisedIn === null ? null : addDays(today, promisedIn),
      lines: lines(ls),
      channel: "app",
      inputMethod: how.method ?? "form",
      sourceText: how.said ?? null,
    });
  const send = (who: Ctx, daysAgo: number, partyId: string, ls: Line[], transport: string, lr: string) =>
    createDispatch(db, on(who, daysAgo, 17), {
      captureId: randomUUID(),
      partyId,
      dispatchDate: day(daysAgo),
      takenBy: who === sunil ? "Sunil" : "Ramesh",
      transport,
      lrNumber: lr,
      lines: lines(ls),
      channel: "app",
      inputMethod: "form",
    });

  // Oldest first, so dispatches settle the orders they were sent for.
  await order(ramesh, 18, sharma.id, [[poplin.White, 300], [poplin["Sky Blue"], 200]], -11, { method: "voice", said: "शर्मा जी का ऑर्डर, पॉपलिन सफ़ेद 300 मीटर, स्काई ब्लू 200 मीटर" });
  await order(owner, 16, gupta.id, [[suit12.Red, 40], [suit12.Maroon, 30]], -9);
  await send(ramesh, 15, sharma.id, [[poplin.White, 300], [poplin["Sky Blue"], 120]], "VRL Logistics", "VRL 48213");
  await order(sunil, 14, mehta.id, [[saree, 60]], -7, { method: "text", said: "Mehta Fabrics 60 georgette saree" });
  await send(sunil, 14, gupta.id, [[suit12.Red, 40], [suit12.Maroon, 30]], "Gati", "GT 77120");
  await order(ramesh, 12, singh.id, [[shawl.Grey, 40], [shawl.Black, 30], [shawl.Maroon, 20]], -5, { method: "voice", said: "सिंह गारमेंट्स, शॉल ग्रे 40, ब्लैक 30, मरून 20" });
  await order(owner, 11, bansal.id, [[saree, 40]], -4);
  await send(ramesh, 10, mehta.id, [[saree, 35]], "Safexpress", "SX 30981");
  await order(sunil, 9, kapoor.id, [[denim, 400]], -2);
  await order(ramesh, 8, arora.id, [[legging.Black, 120], [legging.White, 60], [legging.Navy, 40]], 2, { method: "voice", said: "अरोड़ा होज़री, लेगिंग ब्लैक 120, व्हाइट 60, नेवी 40" });
  await send(ramesh, 8, singh.id, [[shawl.Grey, 40], [shawl.Black, 30], [shawl.Maroon, 10]], "VRL Logistics", "VRL 48377");
  await send(sunil, 7, bansal.id, [[saree, 40]], "Gati", "GT 77291");
  await order(owner, 6, jain.id, [[suit13.Pink, 30], [suit13.Yellow, 20]], 1);
  await order(ramesh, 5, sharma.id, [[suit12.Green, 25]], 3, { method: "voice", said: "शर्मा जी को 25 पीस 4012 हरा" });
  await send(ramesh, 5, kapoor.id, [[denim, 250]], "Safexpress", "SX 31044");
  await order(sunil, 4, gupta.id, [[poplin.Black, 250]], 4);
  await send(ramesh, 4, arora.id, [[legging.Black, 100]], "VRL Logistics", "VRL 48502");
  await order(ramesh, 3, singh.id, [[shawl.Grey, 25], [shawl.Black, 20]], 5);
  // Goods sent with no order: shows up under Unmatched.
  await send(sunil, 3, jain.id, [[suit12.Maroon, 12]], "Gati", "GT 77408");
  await order(owner, 2, mehta.id, [[denim, 300]], 6);
  await send(ramesh, 2, sharma.id, [[suit12.Green, 15]], "VRL Logistics", "VRL 48611");
  await order(sunil, 1, kapoor.id, [[legging.Black, 60]], 7);
  await send(ramesh, 1, gupta.id, [[poplin.Black, 250]], "Gati", "GT 77533");
  await order(ramesh, 0, arora.id, [[poplin.White, 150], [poplin["Sky Blue"], 100]], 8, { method: "voice", said: "अरोड़ा जी, पॉपलिन सफ़ेद 150, स्काई ब्लू 100" });
  await order(owner, 0, bansal.id, [[saree, 20], [suit12.Red, 10]], null);

  return firm;
}
