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
import { ItemStockActions, UndoStockButton } from "./item-actions";
import { formatDay } from "@/lib/dates";
import { fill, words } from "@/lib/text";
import { Card, SectionTitle } from "@/components/ui/card";
import { Page } from "@/components/ui/screen";
import { Notice } from "@/components/ui/feedback";

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
      <Page>
        {unitRows.map((u) => (
          <section key={u.unitCode ?? ""} className="space-y-2">
            {unitRows.length > 1 && <SectionTitle>{u.unit}</SectionTitle>}
            <Card className="p-5">
              <p className="text-sm font-semibold text-ink-subtle">{t.s.free}</p>
              <p className={`num text-hero font-bold ${u.free < 0 ? "text-status-overdue" : "text-ink"}`}>
                {num(u.free)} <span className="text-xl font-normal text-ink-subtle">{u.unit}</span>
              </p>
              <p className="text-sm text-ink-subtle">{t.ui.stock.freeHelp}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-control bg-sunken p-3">
                  <dt className="text-sm text-ink-subtle">{t.s.inStock}</dt>
                  <dd className={`num text-2xl font-bold ${u.inStock < 0 ? "text-status-overdue" : ""}`}>{num(u.inStock)}</dd>
                  <dd className="text-xs text-ink-subtle">{t.ui.stock.inStockHelp}</dd>
                </div>
                <div className="rounded-control bg-sunken p-3">
                  <dt className="text-sm text-ink-subtle">{t.s.owed}</dt>
                  <dd className="num text-2xl font-bold">{num(u.owed)}</dd>
                  <dd className="text-xs text-ink-subtle">{t.ui.stock.owedHelp}</dd>
                </div>
              </dl>
            </Card>
          </section>
        ))}
        {item.inStock < 0 && (
          <Notice tone="error">
            <p className="font-semibold">{fill(t.ui.stock.short, { n: words(formatQty(-item.inStock), item.unit) })}</p>
            <p>{t.s.negative}</p>
          </Notice>
        )}
        {item.low && item.inStock >= 0 && (
          <Notice tone="warn">
            {t.s.low}: {t.s.free} {num(item.free)} ≤ {formatQty(item.lowLevel)}
          </Notice>
        )}

        <ItemStockActions t={t} itemId={id} unit={unitRows.find((u) => u.unitCode === null)?.unit ?? item.unit} lowLevel={formatQty(item.lowLevel)} canEnter={user.role !== "viewer"} isOwner={user.role === "owner"} />

        <SectionTitle>{t.s.history}</SectionTitle>
        <Card className="divide-y divide-line">
          {events.map((e, i) => (
            <div key={i} className={`flex items-start justify-between gap-3 p-4 ${e.reversed ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold break-words">
                  {label[e.kind]}
                  {e.kind === "dispatch" && e.partyName && (
                    <Link href={`/dispatches/${e.dispatchId}`} className="text-brand underline">
                      {" "}
                      → {e.partyName}
                    </Link>
                  )}
                  {e.kind === "count" && e.counted !== null && e.counted !== undefined && ` ${formatQty(e.counted)}`}
                  {e.reversed && <span className="text-sm font-normal text-ink-subtle"> · {t.s.undone}</span>}
                </p>
                <p className="text-sm text-ink-subtle">
                  {formatDay(e.date)} · {e.by}
                  {e.reason ? ` · “${e.reason}”` : ""}
                </p>
                {e.canReverse && e.batchId && <UndoStockButton t={t} batchId={e.batchId} />}
              </div>
              <span className={`num shrink-0 text-right text-lg font-bold ${e.change < 0 ? "text-status-overdue" : "text-status-fulfilled"}`}>
                {signed(e.change)}
                <span className="block text-xs font-normal text-ink-subtle">{e.unit}</span>
              </span>
            </div>
          ))}
        </Card>
      </Page>
    </>
  );
}
