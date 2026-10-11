import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { orderDetail } from "@/ledger/queries";
import { LedgerError } from "@/lib/errors";
import { formatQty } from "@/lib/qty";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { CancelButton, OrderActions } from "@/components/order-actions";
import Link from "next/link";

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const t = messages(user.language);
  const o = await orderDetail(db, ctxFor(user), id).catch((e) => {
    if (e instanceof LedgerError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const via = { photo: t.p.viaPhoto, voice: t.p.viaVoice, text: t.p.viaText, form: t.p.viaForm }[o.inputMethod];

  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back={`/pending/party/${o.party.id}`} title={o.party.name} />
      <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-4">
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex justify-between">
            <span className="font-semibold">
              {t.p.order} · {fmtDate(o.orderDate)}
            </span>
            <span className={o.status === "cancelled" ? "text-stone-500" : o.overdue ? "font-semibold text-red-700" : "text-[#2e7d4f]"}>
              {o.status === "cancelled" ? t.p.statusCancelled : o.overdue ? `⚠ ${t.p.overdue}` : t.p.statusOpen}
            </span>
          </div>
          <table className="w-full">
            <thead className="text-sm text-stone-500">
              <tr>
                <th className="text-left font-normal" />
                <th className="text-right font-normal">{t.p.ordered}</th>
                <th className="text-right font-normal">{t.p.sent}</th>
                <th className="text-right font-normal">{t.p.balance}</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1">{l.itemName}</td>
                  <td className="text-right tabular-nums">{formatQty(l.ordered)}</td>
                  <td className="text-right tabular-nums">{formatQty(l.sent)}</td>
                  <td className="text-right font-bold tabular-nums">
                    {formatQty(l.balance)} <span className="text-sm font-normal text-stone-500">{l.unit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {o.promisedDate && (
            <p className="text-sm text-stone-600">
              {t.p.promised}: {fmtDate(o.promisedDate)}
            </p>
          )}
          {o.notes && <p className="rounded-lg bg-stone-50 p-2 text-sm">📝 {o.notes}</p>}
        </div>

        <OrderActions t={t} orderId={o.orderId} rev={o.rev} canChange={o.canChange} canDispatch={user.role !== "viewer" && o.status === "open" && o.lines.some((l) => l.balance > 0)} />

        <h2 className="font-semibold text-stone-600">{t.p.timeline}</h2>
        <ol className="space-y-3 border-l-2 border-stone-200 pl-4">
          {o.events.map((e, i) => (
            <li key={i} className="relative">
              <span className={`absolute -left-[1.4rem] top-1.5 size-3 rounded-full ${e.kind === "dispatch" ? "bg-[#2e7d4f]" : e.kind === "cancelled" ? "bg-red-600" : "bg-[#1f4e79]"}`} />
              <p className="font-medium">
                {e.kind === "dispatch" && `🚚 ${t.p.dispatched} ${e.itemName} ${formatQty(e.quantity!)} ${e.unit}`}
                {e.kind === "created" && `${t.p.created} (${via})`}
                {e.kind === "corrected" && t.p.corrected}
                {e.kind === "cancelled" && t.p.cancelledEvt}
              </p>
              {e.kind === "dispatch" && (
                <p className="text-sm text-stone-600">
                  {fmtDate(e.date!)}
                  {[e.takenBy, e.transport, e.lrNumber && `LR ${e.lrNumber}`].filter(Boolean).map((x) => ` · ${x}`)}
                </p>
              )}
              {e.text && <p className="text-sm text-stone-600">“{e.text}”</p>}
              {e.kind === "dispatch" && e.canChange && e.dispatchId && (
                <div className="mt-1.5 flex flex-wrap items-start gap-2">
                  <Link href={`/dispatches/${e.dispatchId}/edit?back=/orders/${o.orderId}`} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold">
                    {t.o.editDispatch}
                  </Link>
                  <CancelButton t={t} url={`/api/dispatches/${e.dispatchId}/cancel`} baseRev={e.dispatchRev!} label={t.o.cancelDispatch} confirmText={t.o.cancelDispatchConfirm} />
                </div>
              )}
              <p className="text-xs text-stone-400">
                {t.p.by} {e.by} · {fmtTime(e.at)}
              </p>
            </li>
          ))}
        </ol>
      </main>
    </>
  );
}

