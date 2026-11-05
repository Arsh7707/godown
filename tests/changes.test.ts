/**
 * The change mark that tells open screens to reload: it moves when anything
 * the firm sees is saved (also by a firm sharing its godown), and stays put
 * otherwise, so cached screens are only thrown away when they are out of date.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import type { Db } from "@/db/types";
import type { Ctx } from "@/ledger/service";
import { createOrder } from "@/ledger/service";
import { changeMark } from "@/ledger/changes";
import { createParty } from "@/masters/service";
import { recordStock } from "@/stock/service";
import { cid, freshDb, makeCompany, TODAY } from "./helpers";

const app = { channel: "app", inputMethod: "form" } as const;

describe("change mark", () => {
  let db: Db;
  let co: Awaited<ReturnType<typeof makeCompany>>;
  beforeEach(async () => {
    db = await freshDb();
    co = await makeCompany(db);
  });

  it("stays the same while nothing is saved", async () => {
    expect(await changeMark(db, co.owner)).toBe(await changeMark(db, co.owner));
  });

  it("moves when an order, stock or a client is saved", async () => {
    let before = await changeMark(db, co.owner);
    await createOrder(db, co.staff, { ...app, captureId: cid(), partyId: co.sharma.id, orderDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 5 }] });
    expect(await changeMark(db, co.owner)).not.toBe(before);

    before = await changeMark(db, co.owner);
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 10 }] });
    expect(await changeMark(db, co.owner)).not.toBe(before);

    before = await changeMark(db, co.owner);
    await createParty(db, co.owner, { name: "Mehta Cloth" });
    expect(await changeMark(db, co.owner)).not.toBe(before);
  });

  it("follows firms sharing the godown, and ignores unrelated firms", async () => {
    const [fab] = await db.insert(s.companies).values({ name: "Fabrics", stockCompanyId: co.company.id }).returning();
    const [u] = await db.insert(s.users).values({ companyId: fab.id, phone: "+919800000009", name: "Fab owner", role: "owner" }).returning();
    const fabOwner: Ctx = { companyId: fab.id, userId: u.id, role: "owner", stockId: co.company.id };
    const godown: Ctx = { ...co.owner, stockId: co.company.id };
    const other = await makeCompany(db, "Other Mills");

    const [g0, f0, o0] = [await changeMark(db, godown), await changeMark(db, fabOwner), await changeMark(db, other.owner)];
    // A sale by the sharing firm moves the godown's stock: both firms' screens reload.
    await createParty(db, fabOwner, { name: "Mehta Cloth" });
    expect(await changeMark(db, godown)).not.toBe(g0);
    expect(await changeMark(db, fabOwner)).not.toBe(f0);
    expect(await changeMark(db, other.owner)).toBe(o0);

    const f1 = await changeMark(db, fabOwner);
    await recordStock(db, godown, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 3 }] });
    expect(await changeMark(db, fabOwner)).not.toBe(f1);
  });
});
