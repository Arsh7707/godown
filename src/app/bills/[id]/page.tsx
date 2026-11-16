import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { isUuid } from "@/lib/ids";
import { ctxFor, requireUser } from "@/auth/session";
import { billDetail, canMakeBills, canSeeBills } from "@/billing/service";
import { LedgerError } from "@/lib/errors";
import { formatDateTimeIST } from "@/lib/dates";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { Page } from "@/components/ui/screen";
import { Notice } from "@/components/ui/feedback";
import { SectionTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { BillSheet } from "@/components/bill/bill-sheet";
import { BillActions } from "@/components/bill/bill-actions";

export default async function BillPage({ params }: PageProps<"/bills/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await requireUser();
  const ctx = ctxFor(user);
  if (!canSeeBills(ctx)) redirect("/");
  const t = messages(user.language);
  const b = await billDetail(db, ctx, id).catch((e) => {
    if (e instanceof LedgerError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/bills" title={`${t.b.bill} ${b.number}`} />
      <Page>
        {b.status === "active" && b.dispatchCancelled && <Notice tone="warn">{t.b.dispatchCancelled}</Notice>}
        {b.status === "active" && !b.dispatchCancelled && b.dispatchChanged && <Notice tone="warn">{t.b.dispatchChanged}</Notice>}
        <BillActions t={t} canChange={canMakeBills(ctx)} bill={{ id: b.id, rev: b.rev, number: b.number, total: b.totals.total, shareToken: b.shareToken, partyPhone: b.party.phone, status: b.status }} />
        <BillSheet bill={b} />
        <div className="space-y-2 print:hidden">
          <ButtonLink variant="secondary" block icon="truck" href={`/dispatches/${b.dispatchId}`}>
            {t.b.openDispatch}
          </ButtonLink>
          <SectionTitle>{t.b.history}</SectionTitle>
          <ol className="space-y-1 text-sm text-ink-muted">
            {b.history.map((h, i) => (
              <li key={h.rev}>
                {h.rev === 1 ? t.b.made : h.status === "cancelled" ? t.b.cancelled : t.b.changed} · {h.by} · {formatDateTimeIST(h.at)}
                {i > 0 && h.number !== b.history[i - 1].number && (
                  <span>
                    {" "}
                    · {t.b.newNumber} {h.number}
                  </span>
                )}
                {h.reason && <span className="text-ink-subtle"> · “{h.reason}”</span>}
              </li>
            ))}
          </ol>
        </div>
      </Page>
    </>
  );
}
