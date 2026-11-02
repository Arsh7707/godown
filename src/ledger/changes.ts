/**
 * A mark that moves whenever something a firm's screens show is saved: every
 * change (orders, dispatches, stock, clients, items, team) writes an audit
 * row, in the firm itself or in a firm sharing its godown. Open screens check
 * the mark and reload only when it moves, so pages already visited can be
 * shown again instantly.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { auditLog, companies } from "@/db/schema";
import { stockOf, type Ctx } from "./service";

export async function changeMark(db: Db, ctx: Pick<Ctx, "companyId" | "stockId">): Promise<string> {
  const stockId = stockOf(ctx);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int`, last: sql<string | null>`max(${auditLog.createdAt})::text` })
    .from(auditLog)
    .where(
      sql`${auditLog.companyId} in (select ${companies.id} from ${companies} where ${companies.id} = ${ctx.companyId} or ${companies.id} = ${stockId} or ${companies.stockCompanyId} = ${stockId})`,
    );
  return `${r.n}.${r.last ?? ""}`;
}
