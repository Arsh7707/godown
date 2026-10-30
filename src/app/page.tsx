import Link from "next/link";
import { ctxFor, requireUser } from "@/auth/session";
import { db } from "@/db/client";
import { stockOverview } from "@/stock/service";
import { orderList } from "@/ledger/queries";
import { LiveRefresh } from "@/components/live-refresh";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { InstallPrompt } from "@/components/install-prompt";
import { OutboxStatus } from "@/components/outbox-status";
import { OrderRow } from "@/components/order-bits";
import { orderStatus } from "@/components/ui/status";
import { RowGroup, SectionTitle, ListRow } from "@/components/ui/card";
import { ActionBar, Page } from "@/components/ui/screen";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { myFirms } from "@/masters/firms";
import { unmatchedCount } from "@/ledger/unmatched";

/** Home: today's pending at a glance, the orders waiting longest, and New Order within thumb reach. */
export default async function Home() {
  const user = await requireUser();
  const t = messages(user.language);
  const ctx = ctxFor(user);
  const [overview, orders, firms, unmatched] = await Promise.all([stockOverview(db, ctx), orderList(db, ctx), myFirms(db, user), unmatchedCount(db, user.companyId)]);
  const lowItems = overview.filter((r) => r.low || r.inStock < 0);
  const open = orders.filter((o) => {
    const s = orderStatus(o);
    return s !== "fulfilled" && s !== "cancelled";
  });
  const overdue = open.filter((o) => o.overdue).length;
  const parties = new Set(open.map((o) => o.partyId)).size;
  const oldest = [...open].sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.daysOld - a.daysOld).slice(0, 3);
  const canEnter = user.role !== "viewer";

  return (
    <>
      <AppHeader
        companyName={user.companyName}
        userName={user.name}
        lang={user.language}
        menu={{ role: user.role, stockKeeper: user.stockKeeper, lowCount: lowItems.length, unmatchedCount: unmatched.lines, firms: firms.map((f) => ({ companyId: f.companyId, name: f.name, current: f.current })) }}
      />
      <LiveRefresh seconds={30} />
      <Page>
        <OutboxStatus t={t} />

        {/* Today's pending at a glance */}
        <Link href="/pending" className="block rounded-card bg-brand p-5 text-ink-inverse shadow-raised active:bg-brand-strong">
          <p className="text-sm font-semibold opacity-90">{t.ui.home.title}</p>
          {open.length ? (
            <>
              <p className="mt-1 flex items-baseline gap-3">
                <span className="num text-hero font-bold">{open.length}</span>
                <span className="text-xl font-semibold">{t.ui.home.openOrders}</span>
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <span className={`flex items-center gap-2 rounded-control px-3 py-2 ${overdue ? "bg-status-overdue-bg text-status-overdue" : "bg-white/15"}`}>
                  <Icon name={overdue ? "alert" : "checkCircle"} size={20} />
                  <span>
                    <span className="num block text-xl leading-tight font-bold">{overdue}</span>
                    <span className="block text-sm">{t.ui.home.overdue}</span>
                  </span>
                </span>
                <span className="flex items-center gap-2 rounded-control bg-white/15 px-3 py-2">
                  <Icon name="users" size={20} />
                  <span>
                    <span className="num block text-xl leading-tight font-bold">{parties}</span>
                    <span className="block text-sm">{t.ui.home.parties}</span>
                  </span>
                </span>
              </div>
            </>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-xl font-semibold">
              <Icon name="checkCircle" size={28} />
              {t.ui.home.allClear}
            </p>
          )}
        </Link>

        {oldest.length > 0 && (
          <>
            <SectionTitle
              action={
                <Link href="/pending" className="flex min-h-12 items-center gap-1 text-sm font-semibold text-brand">
                  {t.ui.home.seeAll}
                  <Icon name="chevron" size={16} />
                </Link>
              }
            >
              {t.ui.home.waitingLongest}
            </SectionTitle>
            <ul className="space-y-3">
              {oldest.map((o) => (
                <li key={o.orderId}>
                  <OrderRow t={t} o={o} />
                </li>
              ))}
            </ul>
          </>
        )}

        {(lowItems.length > 0 || (user.role === "owner" && unmatched.dispatches > 0)) && (
          <RowGroup>
            {lowItems.length > 0 && (
              <ListRow
                href="/stock"
                icon="alert"
                title={`${t.ui.home.lowStock} · ${lowItems.length}`}
                subtitle={
                  lowItems
                    .slice(0, 3)
                    .map((r) => r.name)
                    .join(", ") + (lowItems.length > 3 ? "…" : "")
                }
              />
            )}
            {user.role === "owner" && unmatched.dispatches > 0 && <ListRow href="/unmatched" icon="question" title={`${t.ui.home.unmatched} · ${unmatched.dispatches}`} subtitle={t.u.settle} />}
          </RowGroup>
        )}


        <InstallPrompt t={t} />

        {canEnter && (
          <ActionBar>
            <ButtonLink href="/dispatch/new" variant="secondary" size="lg" icon="truck" className="flex-1 whitespace-nowrap">
              {t.dispatch}
            </ButtonLink>
            <ButtonLink href="/order/new" variant="primary" size="lg" icon="plus" className="flex-1 whitespace-nowrap">
              {t.newOrder}
            </ButtonLink>
          </ActionBar>
        )}
      </Page>
    </>
  );
}
