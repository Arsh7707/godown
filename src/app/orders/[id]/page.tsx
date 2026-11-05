import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db/client";
import { isUuid } from "@/lib/ids";
import { ctxFor, requireUser } from "@/auth/session";
import { orderDetail } from "@/ledger/queries";
import { LedgerError } from "@/lib/errors";
import { formatQty } from "@/lib/qty";
import { formatDay, formatDateTimeIST } from "@/lib/dates";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { CancelButton, OrderActions } from "@/components/order-actions";
import { LeftHero, SentBar } from "@/components/order-bits";
import { Card, SectionTitle } from "@/components/ui/card";
import { ActionBar, Page, Qty } from "@/components/ui/screen";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { orderStatus, StatusBadge } from "@/components/ui/status";

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await requireUser();
  const t = messages(user.language);
  const o = await orderDetail(db, ctxFor(user), id).catch((e) => {
    if (e instanceof LedgerError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const via = { photo: t.p.viaPhoto, voice: t.p.viaVoice, text: t.p.viaText, form: t.p.viaForm }[o.inputMethod];
  const status = orderStatus({ cancelled: o.status === "cancelled", overdue: o.overdue, lines: o.lines });
  const canDispatch = user.role !== "viewer" && o.status === "open" && o.lines.some((l) => l.balance > 0);
  const dotColor = { dispatch: "bg-go", cancelled: "bg-danger", created: "bg-brand", corrected: "bg-status-pending" };

  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/orders" title={o.party.name} />
      <Page>
        {/* Hero: what is still to send */}
        <Card className="space-y-4 p-5">
          <StatusBadge t={t} status={status} />
          <LeftHero t={t} lines={o.lines} status={status} size="hero" />
          {status !== "cancelled" && <SentBar lines={o.lines} status={status} label={t.p.sent} />}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-subtle">{t.ui.orders.orderedOn}</dt>
            <dd className="text-right font-semibold">
              {formatDay(o.orderDate, { year: true })}
              {status !== "fulfilled" && status !== "cancelled" && o.daysOld > 0 ? ` · ${o.daysOld} ${t.p.days}` : ""}
            </dd>
            {o.promisedDate && (
              <>
                <dt className="text-ink-subtle">{t.p.promised}</dt>
                <dd className={`text-right font-semibold ${o.overdue ? "text-status-overdue" : ""}`}>{formatDay(o.promisedDate, { year: true })}</dd>
              </>
            )}
          </dl>
        </Card>

        {/* Lines */}
        <SectionTitle>{t.ui.orders.line}</SectionTitle>
        <Card className="divide-y divide-line">
          {o.lines.map((l) => {
            const live = l.ordered - l.cancelled;
            return (
              <div key={l.orderLineId} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 text-base font-semibold break-words">{l.itemName}</p>
                  {l.balance > 0 ? (
                    <span className="text-right">
                      <Qty n={formatQty(l.balance)} unit={l.unit} className="text-xl font-bold" />
                      <span className="block text-xs text-ink-subtle">{t.ui.leftShort}</span>
                    </span>
                  ) : (
                    o.status !== "cancelled" && (
                      <span className="flex items-center gap-1 text-sm font-semibold text-status-fulfilled">
                        <Icon name="check" size={18} />
                        {t.ui.status.fulfilled}
                      </span>
                    )
                  )}
                </div>
                <p className="text-sm text-ink-muted">
                  {t.ui.sentOf} <span className="num font-semibold">{formatQty(l.sent)}</span> {t.ui.of} <span className="num font-semibold">{formatQty(live)}</span> {l.unit}
                  {l.cancelled > 0 && (
                    <span className="text-ink-subtle">
                      {" "}
                      · {t.p.cancelled} {formatQty(l.cancelled)}
                    </span>
                  )}
                </p>
              </div>
            );
          })}
        </Card>

        {o.notes && (
          <Card className="flex gap-3 p-4">
            <Icon name="note" size={22} className="text-ink-subtle" />
            <p className="min-w-0 flex-1 break-words">{o.notes}</p>
          </Card>
        )}

        <OrderActions t={t} orderId={o.orderId} rev={o.rev} canChange={o.canChange} />

        <SectionTitle>{t.p.timeline}</SectionTitle>
        <Card className="p-4">
          <ol className="space-y-5">
            {o.events.map((e, i) => (
              <li key={i} className="relative flex gap-3">
                <span className={`mt-2 size-3 shrink-0 rounded-full ${dotColor[e.kind]}`} aria-hidden />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold break-words">
                    {e.kind === "dispatch" && (
                      <>
                        {t.p.dispatched} {e.itemName} <Qty n={formatQty(e.quantity!)} unit={e.unit} />
                      </>
                    )}
                    {e.kind === "created" && `${t.p.created} (${via})`}
                    {e.kind === "corrected" && t.p.corrected}
                    {e.kind === "cancelled" && t.p.cancelledEvt}
                  </p>
                  {e.kind === "dispatch" && (
                    <p className="text-sm text-ink-muted">
                      {[formatDay(e.date!, { year: true }), e.takenBy, e.transport, e.lrNumber && `LR ${e.lrNumber}`].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {e.text && <p className="text-sm text-ink-muted">“{e.text}”</p>}
                  <p className="text-xs text-ink-subtle">
                    {t.p.by} {e.by} · {formatDateTimeIST(e.at)}
                  </p>
                  {e.kind === "dispatch" && e.canChange && e.dispatchId && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <ButtonLink href={`/dispatches/${e.dispatchId}/edit?back=/orders/${o.orderId}`} variant="secondary" size="md" icon="edit">
                        {t.o.editDispatch}
                      </ButtonLink>
                      <CancelButton t={t} url={`/api/dispatches/${e.dispatchId}/cancel`} baseRev={e.dispatchRev!} label={t.o.cancelDispatch} confirmText={t.o.cancelDispatchConfirm} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Link href={`/pending/party/${o.party.id}`} className="flex min-h-12 items-center justify-center gap-1 font-semibold text-brand underline">
          {t.ui.orders.seeParty}
          <Icon name="chevron" size={18} />
        </Link>

        {canDispatch && (
          <ActionBar>
            <ButtonLink href={`/dispatch/new?order=${o.orderId}`} variant="go" size="lg" block icon="truck">
              {t.dispatch}
            </ButtonLink>
          </ActionBar>
        )}
      </Page>
    </>
  );
}
