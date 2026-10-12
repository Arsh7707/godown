import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { createParty } from "@/masters/service";
import { fail, json, withUser } from "@/lib/api";
import { afterStaffAction } from "@/notify/hooks";

export async function POST(req: Request) {
  return withUser(async (user) => {
    const { name } = (await req.json().catch(() => ({}))) as { name?: string };
    if (!name?.trim()) return fail("NAME_REQUIRED");
    const p = await createParty(db, ctxFor(user), { name: name.trim() });
    afterStaffAction(user, { action: "party.create", name: p.name, url: "/pending" });
    return json({ ok: true, party: { id: p.id, name: p.name, aliases: [] } });
  });
}
