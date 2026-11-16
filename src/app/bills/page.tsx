import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { billList, canSeeBills } from "@/billing/service";
import { formatRupees } from "@/billing/compute";
import { formatDay } from "@/lib/dates";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { Page } from "@/components/ui/screen";
import { ListRow, RowGroup } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";

export default async function BillsPage() {
  const user = await requireUser();
  const ctx = ctxFor(user);
  if (!canSeeBills(ctx)) redirect("/");
  const t = messages(user.language);
  const list = await billList(db, ctx);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.b.title} />
      <Page>
        {list.length === 0 ? (
          <EmptyState icon="bill" title={t.b.none} hint={t.b.noneHint} />
        ) : (
          <RowGroup>
            {list.map((b) => (
              <ListRow
                key={b.id}
                href={`/bills/${b.id}`}
                icon="bill"
                title={b.partyName}
                subtitle={[b.number, formatDay(b.billDate), b.kind === "kacha" ? t.b.kachaBill : null, b.status === "cancelled" ? t.b.cancelled : null].filter(Boolean).join(" · ")}
                value={<span className={`num font-bold ${b.status === "cancelled" ? "text-ink-subtle line-through" : ""}`}>{formatRupees(b.total)}</span>}
              />
            ))}
          </RowGroup>
        )}
      </Page>
    </>
  );
}
