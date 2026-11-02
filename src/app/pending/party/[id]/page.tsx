import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { isUuid } from "@/lib/ids";
import { ctxFor, requireUser } from "@/auth/session";
import { partyOrders } from "@/ledger/queries";
import { LedgerError } from "@/lib/errors";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { OrderRow } from "@/components/order-bits";
import { Card, SectionTitle } from "@/components/ui/card";
import { ActionBar, Page } from "@/components/ui/screen";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";

/** One party: its open orders (what is left on each), then the ones already done. */
export default async function PartyPendingPage({ params }: PageProps<"/pending/party/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await requireUser();
  const t = messages(user.language);
  const data = await partyOrders(db, ctxFor(user), id).catch((e) => {
    if (e instanceof LedgerError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const row = (o: (typeof data.open)[number]) => <OrderRow t={t} showParty={false} o={{ ...o, cancelled: o.status === "cancelled" }} />;
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/pending" title={data.party.name} />
      <Page>
        {(data.party.city || data.party.state || data.party.taxId) && (
          <Card className="flex items-start gap-3 p-4 text-sm text-ink-muted">
            <div className="min-w-0 flex-1 space-y-1">
              {(data.party.city || data.party.state) && <p className="break-words">{[data.party.city, data.party.state].filter(Boolean).join(", ")}</p>}
              {data.party.taxId && (
                <p className="font-mono break-all">
                  {data.party.taxIdType === "gstin" ? t.m.gstin : t.m.aadhaar}: {data.party.taxId}
                </p>
              )}
            </div>
            {user.role === "owner" && (
              <Link href={`/manage/clients/${data.party.id}`} aria-label={t.e.edit} className="-m-2 flex size-12 shrink-0 items-center justify-center rounded-control text-brand active:bg-brand-soft">
                <Icon name="edit" size={22} />
              </Link>
            )}
          </Card>
        )}
        <SectionTitle>{t.p.openOrders}</SectionTitle>
        {data.open.length ? (
          <ul className="space-y-3">
            {data.open.map((o) => (
              <li key={o.orderId}>{row(o)}</li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="checkCircle" title={t.p.nothingPending} />
        )}
        {data.closed.length > 0 && (
          <>
            <SectionTitle>{t.p.completed}</SectionTitle>
            <ul className="space-y-3">
              {data.closed.slice(0, 20).map((o) => (
                <li key={o.orderId}>{row(o)}</li>
              ))}
            </ul>
          </>
        )}
        {data.open.length > 0 && user.role !== "viewer" && (
          <ActionBar>
            <ButtonLink href={`/dispatch/new?party=${data.party.id}`} variant="go" size="lg" block icon="truck">
              {t.dispatch}
            </ButtonLink>
          </ActionBar>
        )}
      </Page>
    </>
  );
}
