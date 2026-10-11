import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import { createDispatch } from "@/ledger/service";
import { createParty, createProduct } from "@/masters/service";
import {
  addItemAlias,
  addPartyAlias,
  addVariant,
  deleteItem,
  deleteParty,
  itemsForManage,
  partiesForManage,
  removePartyAlias,
  renameProduct,
  updateItem,
  updateParty,
} from "@/masters/manage";
import { loadCatalog } from "@/extraction/catalog";
import { matchMention } from "@/extraction/matcher";
import { recordStock, stockOverview } from "@/stock/service";
import { cid, freshDb, makeCompany, TODAY } from "./helpers";

let db: Db;
let co: Awaited<ReturnType<typeof makeCompany>>;
beforeEach(async () => {
  db = await freshDb();
  co = await makeCompany(db);
});
const app = { channel: "app", inputMethod: "form" } as const;

describe("clients", () => {
  it("rename keeps the old name matching", async () => {
    await updateParty(db, co.owner, co.gupta.id, { name: "Gupta Traders Pvt Ltd", phone: "9812345678" });
    const cat = await loadCatalog(db, co.company.id);
    expect(matchMention({ asWritten: "Gupta Traders" }, cat.parties)).toMatchObject({ status: "matched", id: co.gupta.id, name: "Gupta Traders Pvt Ltd" });
    const list = await partiesForManage(db, co.owner);
    expect(list.find((p) => p.id === co.gupta.id)).toMatchObject({ phone: "9812345678", aliases: [expect.objectContaining({ alias: "Gupta Traders" })] });
  });

  it("refuses a name another client already has, and an alias already taken", async () => {
    await expect(updateParty(db, co.owner, co.gupta.id, { name: "sharma textiles" })).rejects.toMatchObject({ code: "DUPLICATE_NAME" });
    await expect(addPartyAlias(db, co.owner, co.gupta.id, "Sharma")).rejects.toMatchObject({ code: "ALIAS_TAKEN" });
  });

  it("extra names can be added and removed", async () => {
    await addPartyAlias(db, co.owner, co.gupta.id, "GT");
    const a = (await partiesForManage(db, co.owner)).find((p) => p.id === co.gupta.id)!.aliases[0];
    await removePartyAlias(db, co.owner, a.id);
    expect((await partiesForManage(db, co.owner)).find((p) => p.id === co.gupta.id)!.aliases).toEqual([]);
  });

  it("delete only if never used; hidden clients leave the pickers", async () => {
    await createDispatch(db, co.staff, { ...app, captureId: cid(), partyId: co.gupta.id, dispatchDate: TODAY, lines: [{ itemId: co.d4012.id, quantity: 1 }] });
    await expect(deleteParty(db, co.owner, co.gupta.id)).rejects.toMatchObject({ code: "IN_USE" });
    await updateParty(db, co.owner, co.gupta.id, { active: false });
    expect((await loadCatalog(db, co.company.id)).parties.map((p) => p.id)).not.toContain(co.gupta.id);
    const unused = await createParty(db, co.owner, { name: "Typo Party" });
    await deleteParty(db, co.owner, unused.id);
    expect((await partiesForManage(db, co.owner)).map((p) => p.name)).not.toContain("Typo Party");
  });

  it("owners only", async () => {
    await expect(updateParty(db, co.staff, co.gupta.id, { name: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(partiesForManage(db, co.viewer)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("items", () => {
  it("rename keeps the old name; stock and orders follow because it's the same item", async () => {
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.d4012.id, quantity: 10 }] });
    await updateItem(db, co.owner, co.d4012.id, { name: "Design 4012" });
    const row = (await stockOverview(db, co.viewer)).find((r) => r.itemId === co.d4012.id)!;
    expect(row).toMatchObject({ name: "Design 4012", inStock: 1000 });
    const cat = await loadCatalog(db, co.company.id);
    expect(matchMention({ asWritten: "D-4012" }, cat.items)).toMatchObject({ status: "matched", id: co.d4012.id });
  });

  it("unit can change only before the item is used", async () => {
    await updateItem(db, co.owner, co.cotton.id, { unit: "thaan" });
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.cotton.id, quantity: 1 }] });
    await expect(updateItem(db, co.owner, co.cotton.id, { unit: "meter" })).rejects.toMatchObject({ code: "UNIT_LOCKED" });
    await updateItem(db, co.owner, co.cotton.id, { lowStockLevel: 3 }); // other changes still fine
  });

  it("colours: rename one colour, add a colour, rename the whole product", async () => {
    const [red] = await createProduct(db, co.owner, { name: "Vistara", unit: "pcs", variants: ["Red", "Blue"] });
    await updateItem(db, co.owner, red.id, { variant: "Maroon" });
    await addVariant(db, co.owner, "Vistara", "Green");
    await renameProduct(db, co.owner, "Vistara", "Vistara Plus");
    const names = (await itemsForManage(db, co.owner)).filter((i) => i.product === "Vistara Plus").map((i) => i.name);
    expect(names.sort()).toEqual(["Vistara Plus · Blue", "Vistara Plus · Green", "Vistara Plus · Maroon"]);
    const cat = await loadCatalog(db, co.company.id);
    expect(matchMention({ asWritten: "Vistara Red" }, cat.items)).toMatchObject({ status: "matched", id: red.id }); // old name still works
    await expect(addVariant(db, co.owner, "Vistara Plus", "blue")).rejects.toMatchObject({ code: "DUPLICATE_NAME" });
  });

  it("delete only if unused; hide otherwise", async () => {
    await expect(deleteItem(db, co.owner, co.d4012.id)).resolves.toBeUndefined(); // never used
    await recordStock(db, co.staff, { ...app, captureId: cid(), kind: "receipt", date: TODAY, lines: [{ itemId: co.cotton.id, quantity: 1 }] });
    await expect(deleteItem(db, co.owner, co.cotton.id)).rejects.toMatchObject({ code: "IN_USE" });
    await updateItem(db, co.owner, co.cotton.id, { active: false });
    expect((await loadCatalog(db, co.company.id)).items.map((i) => i.id)).not.toContain(co.cotton.id);
    await addItemAlias(db, co.owner, co.cotton.id, "kapda");
  });

  it("keeps companies apart", async () => {
    const other = await makeCompany(db, "Other");
    await expect(updateItem(db, other.owner, co.d4012.id, { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateParty(db, other.owner, co.sharma.id, { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
