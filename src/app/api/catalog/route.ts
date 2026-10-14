import { db } from "@/db/client";
import { loadCatalog } from "@/extraction/catalog";
import { json, withUser } from "@/lib/api";

/** Parties and items (with aliases) for autocomplete; cached on the phone for offline use. */
export async function GET() {
  return withUser(async (user) => json({ ok: true, ...(await loadCatalog(db, user.companyId, user.stockId)) }));
}
