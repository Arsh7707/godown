import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { dispatchDetail } from "@/ledger/queries";
import { LedgerError } from "@/lib/errors";
import { formatQty } from "@/lib/qty";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { CancelButton } from "@/components/order-actions";

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function DispatchPage({ params }: PageProps<"/dispatches/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const t = messages(user.language);
  const d = await dispatchDetail(db, ctxFor(user), id).catch((e) => {
    if (e instanceof LedgerError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const lineOf = (itemId: string, unitCode: string | null) => d.lines.find((l) => l.itemId === itemId && (l.unitCode ?? null) === (unitCode ?? null)) ?? d.lines.find((l) => l.itemId === itemId);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/dispatches" title={d.partyName} />
      <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-4">
        <div className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex justify-between">
            <span className="font-semibold">🚚 {fmtDate(d.dispatchDate)}</span>
            {d.status === "cancelled" && <span className="font-semibold text-red-700">{t.d.cancelled}</span>}
          </div>
          {d.lines.map((l, i) => (
            <div key={i} className="flex justify-between text-lg">
              <span>{l.itemName}</span>
              <span className="font-bold tabular-nums">
                {formatQty(l.quantity)} {l.unit}
              </span>
            </div>
          ))}
          <p className="text-sm text-stone-600">{[d.takenBy && `${t.e.takenBy}: ${d.takenBy}`, d.transport && `${t.e.transport}: ${d.transport}`, d.lrNumber && `LR ${d.lrNumber}`].filter(Boolean).join(" · ")}</p>
          {d.notes && <p className="rounded-lg bg-stone-50 p-2 text-sm">📝 {d.notes}</p>}
        </div>

        {d.status === "active" && (
          <div className="space-y-2">
            <h2 className="font-semibold text-stone-600">{t.d.countedAgainst}</h2>
            {d.goesTo.map((g, i) => (
              <Link key={i} href={`/orders/${g.orderId}`} className="flex justify-between rounded-xl bg-white p-3 shadow-sm">
                <span>
                  {t.d.orderOf} {fmtDate(g.orderDate)}
                </span>
                <span className="tabular-nums">
                  {lineOf(g.itemId, g.unitCode)?.itemName} {formatQty(g.quantity)} {lineOf(g.itemId, g.unitCode)?.unit}
                </span>
              </Link>
            ))}
            {d.unmatched > 0 && (
              <p className="rounded-xl bg-amber-50 p-3 text-amber-900">
                {formatQty(d.unmatched)} {t.d.unmatched}
              </p>
            )}
          </div>
        )}

        {d.canChange && (
          <div className="flex flex-wrap items-start gap-2">
            <Link href={`/dispatches/${id}/edit?back=/dispatches/${id}`} className="rounded-xl border-2 border-stone-300 px-5 py-3 font-semibold">
              {t.e.edit}
            </Link>
            <CancelButton t={t} url={`/api/dispatches/${id}/cancel`} baseRev={d.rev} label={t.o.cancelDispatch} confirmText={t.o.cancelDispatchConfirm} />
          </div>
        )}

        <h2 className="font-semibold text-stone-600">{t.d.history}</h2>
        <ol className="space-y-1 text-sm text-stone-600">
          {d.history.map((h) => (
            <li key={h.rev}>
              {h.rev === 1 ? t.d.created : h.status === "cancelled" ? t.d.cancelled : t.d.corrected} · {h.by} · {fmtTime(h.at)}
              {h.reason && <span className="text-stone-500"> · “{h.reason}”</span>}
            </li>
          ))}
        </ol>
      </main>
    </>
  );
}
