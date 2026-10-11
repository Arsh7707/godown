import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { partyOrders } from "@/ledger/queries";
import { LedgerError } from "@/lib/errors";
import { formatQty } from "@/lib/qty";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function PartyPendingPage({ params }: PageProps<"/pending/party/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const t = messages(user.language);
  const data = await partyOrders(db, ctxFor(user), id).catch((e) => {
    if (e instanceof LedgerError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const card = (o: (typeof data.open)[number], done: boolean) => (
    <div key={o.orderId} className={`overflow-hidden rounded-2xl bg-white shadow-sm ${done ? "opacity-70" : ""}`}>
    <Link href={`/orders/${o.orderId}`} className="block space-y-2 p-4">
      <div className="flex justify-between text-sm">
        <span className="font-semibold">
          {t.p.order} · {fmtDate(o.orderDate)}
        </span>
        <span className={o.overdue ? "font-semibold text-red-700" : "text-stone-500"}>
          {o.overdue && `⚠ ${t.p.overdue} · `}
          {o.daysOld} {t.p.days}
        </span>
      </div>
      {o.lines.map((l, i) => (
        <div key={i} className="flex justify-between gap-3">
          <span>{l.itemName}</span>
          <span className="tabular-nums text-stone-600">
            {formatQty(l.sent)}/{formatQty(l.ordered)} · <b className="text-stone-900">{formatQty(l.balance)}</b> {l.unit}
            {l.cancelled > 0 && <span className="text-stone-400"> ({t.p.cancelled} {formatQty(l.cancelled)})</span>}
          </span>
        </div>
      ))}
      {o.promisedDate && (
        <p className="text-sm text-stone-500">
          {t.p.promised}: {fmtDate(o.promisedDate)}
        </p>
      )}
    </Link>
    {!done && user.role !== "viewer" && (
      <Link href={`/dispatch/new?order=${o.orderId}`} className="block border-t border-stone-100 bg-emerald-50 py-3 text-center font-semibold text-[#2e7d4f]">
        🚚 {t.dispatch}
      </Link>
    )}
    </div>
  );
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/pending" title={data.party.name} />
      <main className="mx-auto w-full max-w-md flex-1 space-y-3 px-4 py-4">
        <h2 className="font-semibold text-stone-600">{t.p.openOrders}</h2>
        {data.open.length ? data.open.map((o) => card(o, false)) : <p className="text-stone-500">{t.p.nothingPending}</p>}
        {data.closed.length > 0 && (
          <>
            <h2 className="pt-3 font-semibold text-stone-600">{t.p.completed}</h2>
            {data.closed.slice(0, 20).map((o) => card(o, true))}
          </>
        )}
      </main>
    </>
  );
}
