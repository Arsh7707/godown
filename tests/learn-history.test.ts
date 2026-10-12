import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/db/types";
import { cancelOrder, correctOrder, createDispatch, createOrder } from "@/ledger/service";
import { recordStock, reverseStockEntry } from "@/stock/service";
import { createParty } from "@/masters/service";
import { learnAliases } from "@/masters/learn";
import { loadCatalog } from "@/extraction/catalog";
import { matchMention } from "@/extraction/matcher";
import { dayEntries } from "@/ledger/history";
import { cid, freshDb, makeCompany, NOW, TODAY } from "./helpers";

let db: Db;
let co: Awaited<ReturnType<typeof makeCompany>>;
const app = { channel: "app", inputMethod: "form" } as const;
beforeEach(async () => {
  db = await freshDb();
  co = await makeCompany(db);
});
const partyMatch = async (m: string) => matchMention({ asWritten: m }, (await loadCatalog(db, co.company.id)).parties);
const itemMatch = async (m: string) => matchMention({ asWritten: m }, (await loadCatalog(db, co.company.id)).items);

describe("learning extra names from picks", () => {
  it("a picked suggestion matches by itself next time (staff picks count too)", async () => {
    expect((await partyMatch("Guptaa Tredars")).status).toBe("choose");
    const learned = await learnAliases(db, co.staff, [{ kind: "party", id: co.gupta.id, mention: "Guptaa Tredars" }]);
    expect(learned).toHaveLength(1);
    expect(await partyMatch("guptaa tredars")).toMatchObject({ status: "matched", id: co.gupta.id });
    const log = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "party.alias.learn"));
    expect(log[0]).toMatchObject({ userId: co.staff.userId, entityId: co.gupta.id });
  });

  it("works for items and for Hindi / Punjabi letters (saved in Hindi letters)", async () => {
    await learnAliases(db, co.staff, [{ kind: "item", id: co.cotton.id, mention: "ਕਾਟਨ ਪਾਪਲੀਨ" }]);
    const [a] = await db.select().from(s.itemAliases).where(eq(s.itemAliases.itemId, co.cotton.id));
    expect(a.alias).toBe("काटन पापलीन");
    expect(await itemMatch("काटन पापलीन")).toMatchObject({ status: "matched", id: co.cotton.id });
  });

  it("doesn't learn what already matches, what's too short, or a name that could mean two clients", async () => {
    await createParty(db, co.owner, { name: "Sharma Traders" });
    const learned = await learnAliases(db, co.staff, [
      { kind: "party", id: co.sharma.id, mention: "Sharma Textiles" }, // exact already
      { kind: "party", id: co.sharma.id, mention: "शर्मा" }, // existing extra name
      { kind: "party", id: co.sharma.id, mention: "Sharmaa" }, // could be Sharma Textiles or Sharma Traders
      { kind: "party", id: co.sharma.id, mention: "S" }, // too short
      { kind: "party", id: co.sharma.id, mention: "123" }, // no letters
      { kind: "party", id: "00000000-0000-0000-0000-000000000000", mention: "Ghost" }, // not a client
    ]);
    expect(learned).toEqual([]);
    expect((await partyMatch("Sharmaa")).status).toBe("choose");
  });

  it("never takes a name that belongs to another client, and repeats are harmless", async () => {
    const before = await db.select().from(s.partyAliases);
    await learnAliases(db, co.staff, [{ kind: "party", id: co.gupta.id, mention: "Sharma" }]); // alias of Sharma Textiles
    await learnAliases(db, co.staff, [{ kind: "party", id: co.gupta.id, mention: "Gupta Tradrs" }]);
    await learnAliases(db, co.staff, [{ kind: "party", id: co.gupta.id, mention: "gupta  tradrs" }]);
    const after = await db.select().from(s.partyAliases);
    expect(after.length - before.length).toBe(1);
    expect(await partyMatch("Sharma")).toMatchObject({ status: "matched", id: co.sharma.id });
  });

  it("viewers don't teach", async () => {
    expect(await learnAliases(db, co.viewer, [{ kind: "party", id: co.gupta.id, mention: "Guptaa" }])).toEqual([]);
  });
});

describe("history of a day", () => {
  it("lists orders, dispatches and stock entries by the date on them, with who and status", async () => {
    const yesterday = "2026-10-07";
    const o = await createOrder(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: yesterday, lines: [{ itemId: co.d4012.id, quantity: 10 }] });
    const o2 = await createOrder(db, co.owner, { ...app, captureId: cid(), partyId: co.gupta.id, orderDate: yesterday, lines: [{ itemId: co.cotton.id, quantity: 5 }] });
    await cancelOrder(db, co.owner, o2.orderId, { baseRev: 1 });
    await correctOrder(db, co.staff, o.orderId, { baseRev: 1, partyId: co.sharma.id, orderDate: yesterday, lines: [{ itemId: co.d4012.id, quantity: 12 }] }).catch(() => undefined);
    await createDispatch(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, dispatchDate: yesterday, lines: [{ itemId: co.d4012.id, quantity: 4 }] });
    const st = await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: yesterday, lines: [{ itemId: co.d4012.id, quantity: 50 }] });
    await reverseStockEntry(db, co.owner, st.batchId, "wrong");
    await createOrder(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 1 }] });

    const day = await dayEntries(db, co.owner, yesterday);
    expect(day.map((e) => e.kind).sort()).toEqual(["dispatch", "order", "order", "receipt"]);
    const order = day.find((e) => e.kind === "order" && e.partyName === "Sharma Textiles")!;
    expect(order.lines).toEqual(["D-4012 12 pcs"]);
    expect(order).toMatchObject({ edited: true, cancelled: false, canChange: true, by: `staff +919800000002` });
    expect(day.find((e) => e.partyName === "Gupta Traders")).toMatchObject({ cancelled: true, canChange: false });
    expect(day.find((e) => e.kind === "receipt")).toMatchObject({ undone: true, canChange: false, lines: ["D-4012 +50 pcs"] });
    expect(await dayEntries(db, co.owner, "2026-10-01")).toEqual([]);
  });

  it("staff can fix only their own entries made today", async () => {
    await createOrder(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: "2026-10-05", lines: [{ itemId: co.d4012.id, quantity: 1 }] });
    await createOrder(db, co.staff2, { ...app, captureId: cid(), partyId: co.gupta.id, orderDate: "2026-10-05", lines: [{ itemId: co.d4012.id, quantity: 1 }] });
    const forStaff = await dayEntries(db, co.staff, "2026-10-05");
    expect(forStaff.find((e) => e.partyName === "Sharma Textiles")?.canChange).toBe(true); // entered today (NOW), dated a past day
    expect(forStaff.find((e) => e.partyName === "Gupta Traders")?.canChange).toBe(false);
    const forViewer = await dayEntries(db, co.viewer, "2026-10-05");
    expect(forViewer.every((e) => !e.canChange)).toBe(true);
    // Future dates are refused by the server whatever the screen sends.
    await expect(createOrder(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: "2026-10-09", lines: [{ itemId: co.d4012.id, quantity: 1 }] })).rejects.toMatchObject({ code: "FUTURE_DATE" });
    expect(NOW.toISOString().slice(0, 10)).toBe(TODAY);
  });
});
