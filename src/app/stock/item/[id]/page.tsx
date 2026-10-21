import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { isUuid } from "@/lib/ids";
import { ctxFor, requireUser } from "@/auth/session";
import { itemStockHistory } from "@/stock/service";
import { LedgerError } from "@/lib/errors";
import { formatQty } from "@/lib/qty";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { LiveRefresh } from "@/components/live-refresh";
import { ItemStockActions, UndoStockButton } from "./item-actions";

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const signed = (c: number) => (c > 0 ? `+${formatQty(c)}` : c < 0 ? `−${formatQty(-c)}` : "0");

export default async function ItemStockPage({ params }: PageProps<"/stock/item/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await requireUser();
  const t = messages(user.language);
  const { item, unitRows, events } = await itemStockHistory(db, ctxFor(user), id).catch((e) => {
    if (e instanceof LedgerError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const label = { receipt: t.s.receipt, count: t.s.countEvt, adjustment: t.s.adjustment, reversal: t.s.reversal, dispatch: t.s.dispatch };
  const num = (n: number) => (n < 0 ? `−${formatQty(-n)}` : formatQty(n));
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/stock" title={item.name} />
      <LiveRefresh />
      <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-4">
        {unitRows.map((u) => (
          <div key={u.unitCode ?? ""} className="space-y-1">
            {unitRows.length > 1 && <p className="text-sm font-semibold text-stone-600">{u.unit}</p>}
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                [t.s.inStock, u.inStock, u.inStock < 0 ? "text-red-700" : ""],
                [t.s.owed, u.owed, "text-stone-600"],
                [t.s.free, u.free, u.free < 0 ? "text-red-700" : u.low ? "text-amber-700" : "text-[#2e7d4f]"],
              ].map(([l, v, cls]) => (
                <div key={l as string} className="rounded-2xl bg-white p-3 shadow-sm">
                  <p className="text-xs text-stone-500">{l as string}</p>
                  <p className={`text-2xl font-bold tabular-nums ${cls}`}>{num(v as number)}</p>
                  <p className="text-xs text-stone-400">{u.unit}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        {item.inStock < 0 && <p className="rounded-xl bg-red-50 p-3 text-red-800">⚠ {t.s.negative}</p>}
        {item.low && item.inStock >= 0 && (
          <p className="rounded-xl bg-amber-50 p-3 text-amber-900">
            ⚠ {t.s.low}: {t.s.free} {num(item.free)} ≤ {formatQty(item.lowLevel)}
          </p>
        )}

        <ItemStockActions t={t} itemId={id} unit={unitRows.find((u) => u.unitCode === null)?.unit ?? item.unit} lowLevel={formatQty(item.lowLevel)} canEnter={user.role !== "viewer"} isOwner={user.role === "owner"} />

        <h2 className="font-semibold text-stone-600">{t.s.history}</h2>
        <ol className="space-y-2">
          {events.map((e, i) => (
            <li key={i} className={`flex items-start justify-between gap-3 rounded-xl bg-white p-3 shadow-sm ${e.reversed ? "opacity-50" : ""}`}>
              <div className="min-w-0">
                <p className="font-medium">
                  {label[e.kind]}
                  {e.kind === "dispatch" && e.partyName && (
                    <Link href={`/dispatches/${e.dispatchId}`} className="text-[#1f4e79]">
                      {" "}
                      → {e.partyName}
                    </Link>
                  )}
                  {e.kind === "count" && e.counted !== null && e.counted !== undefined && ` ${formatQty(e.counted)}`}
                  {e.reversed && <span className="text-sm text-stone-500"> · {t.s.undone}</span>}
                </p>
                <p className="text-xs text-stone-500">
                  {fmtDate(e.date)} · {e.by}
                  {e.reason ? ` · “${e.reason}”` : ""}
                </p>
                {e.canReverse && e.batchId && <UndoStockButton t={t} batchId={e.batchId} />}
              </div>
              <span className={`shrink-0 text-right text-lg font-bold tabular-nums ${e.change < 0 ? "text-red-700" : "text-[#2e7d4f]"}`}>
                {signed(e.change)}
                <span className="block text-xs font-normal text-stone-500">{e.unit}</span>
              </span>
            </li>
          ))}
        </ol>
      </main>
    </>
  );
}
