import { db } from "@/db/client";
import { createFirm, myFirms, setFirmStock, switchFirm } from "@/masters/firms";
import { fail, json, withUser, readJson } from "@/lib/api";

/** The person's firms: list, switch, add, and own stock vs shared godown. */
export async function GET() {
  return withUser(async (user) => json({ ok: true, firms: await myFirms(db, user) }));
}

export async function POST(req: Request) {
  return withUser(async (user) => {
    const b = (await readJson(req)) as Record<string, unknown>;
    const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : null);
    switch (b.action) {
      case "switch":
        if (!str("companyId")) return fail("NOT_FOUND", 404);
        return json({ ok: true, ...(await switchFirm(db, user, str("companyId")!)) });
      case "create": {
        const r = await createFirm(db, user, {
          name: str("name") ?? "",
          city: str("city"),
          state: str("state"),
          stockCompanyId: str("stockCompanyId"),
          copyTeam: b.copyTeam === true,
        });
        // Open the new firm straight away.
        await switchFirm(db, user, r.companyId);
        return json({ ok: true, ...r });
      }
      case "stock":
        if (!str("companyId")) return fail("NOT_FOUND", 404);
        return json({ ok: true, ...(await setFirmStock(db, user, str("companyId")!, str("stockCompanyId"))) });
      default:
        return fail("UNKNOWN_ACTION");
    }
  });
}
