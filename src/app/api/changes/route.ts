import { db } from "@/db/client";
import { changeMark } from "@/ledger/changes";
import { json, withUser } from "@/lib/api";

/** Has anything been saved since the screen was drawn? Open screens ask every few seconds. */
export async function GET() {
  return withUser(async (user) => json({ ok: true, mark: await changeMark(db, user) }));
}
