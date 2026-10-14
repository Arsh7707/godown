import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { fail, json, withUser } from "@/lib/api";
import { CLIENT_FIELDS, ITEM_FIELDS, type Row } from "@/import/columns";
import { applyClients, applyItems, MAX_ROWS, planClients, planItems, type Decision, type Decisions, type ItemOptions } from "@/import/plan";
import { exportClients, exportItems } from "@/import/export";
import { afterStockChange } from "@/notify/hooks";

export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only known fields, only text, row numbers kept. */
function cleanRows(raw: unknown, kind: "clients" | "items"): Row[] | null {
  if (!Array.isArray(raw)) return null;
  const fields: readonly string[] = kind === "clients" ? CLIENT_FIELDS : ITEM_FIELDS;
  return raw.slice(0, MAX_ROWS + 1).map((r, i) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const row: Row = { rowNo: Number.isSafeInteger(o.rowNo) ? (o.rowNo as number) : i + 2 };
    for (const f of fields) if (typeof o[f] === "string" && (o[f] as string).trim()) (row as Record<string, unknown>)[f] = (o[f] as string).slice(0, 500);
    return row;
  });
}

function cleanDecisions(raw: unknown): Decisions {
  const out: Decisions = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(k);
    const d = v as Partial<{ action: string; id: string }>;
    if (!Number.isSafeInteger(n) || !d) continue;
    if (d.action === "skip" || d.action === "new") out[n] = { action: d.action } as Decision;
    else if (d.action === "match" && typeof d.id === "string" && UUID.test(d.id)) out[n] = { action: "match", id: d.id };
  }
  return out;
}

/** Download what's saved, in the same columns the import reads (so a sheet can go out, be edited, and come back). */
export async function GET(req: Request) {
  return withUser(async (user) => {
    if (user.role !== "owner") return fail("FORBIDDEN", 403);
    const kind = new URL(req.url).searchParams.get("kind");
    const ctx = ctxFor(user);
    if (kind === "clients") return json({ ok: true, rows: await exportClients(db, ctx) });
    if (kind === "items") return json({ ok: true, rows: await exportItems(db, ctx) });
    return fail("UNKNOWN_ACTION");
  });
}

/** Excel import: "preview" changes nothing; "apply" saves (owners only). */
export async function POST(req: Request) {
  return withUser(async (user) => {
    if (user.role !== "owner") return fail("FORBIDDEN", 403);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = b.kind === "items" ? "items" : b.kind === "clients" ? "clients" : null;
    if (!kind) return fail("UNKNOWN_ACTION");
    const rows = cleanRows(b.rows, kind);
    if (!rows) return fail("IMPORT_EMPTY");
    const ctx = ctxFor(user);
    const decisions = cleanDecisions(b.decisions);
    const o = (b.options ?? {}) as Record<string, unknown>;
    const itemOpts: ItemOptions = {
      stockMode: o.stockMode === "set" || o.stockMode === "add" ? o.stockMode : "none",
      date: typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : undefined,
      defaultUnit: typeof o.defaultUnit === "string" && o.defaultUnit.trim() ? o.defaultUnit.trim().slice(0, 20) : "pcs",
    };
    const clientOpts = { overwrite: o.overwrite === true };
    const label = typeof b.label === "string" ? b.label.slice(0, 120) : undefined;

    if (b.action === "preview") {
      const plan = kind === "clients" ? await planClients(db, ctx, rows, clientOpts, decisions) : await planItems(db, ctx, rows, itemOpts, decisions);
      return json({ ok: true, plan });
    }
    if (b.action === "apply") {
      if (typeof b.importId !== "string" || !UUID.test(b.importId)) return fail("UNKNOWN_ACTION");
      const r =
        kind === "clients"
          ? await applyClients(db, ctx, b.importId, rows, clientOpts, decisions)
          : await applyItems(db, ctx, b.importId, rows, itemOpts, decisions, label);
      if (kind === "items" && !r.duplicate) afterStockChange(user);
      return json({ ok: true, result: { ...r, plan: undefined } });
    }
    return fail("UNKNOWN_ACTION");
  });
}
