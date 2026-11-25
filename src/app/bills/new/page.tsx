import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { isUuid } from "@/lib/ids";
import { ctxFor, requireUser } from "@/auth/session";
import { billDraft, canMakeBills } from "@/billing/service";
import { LedgerError } from "@/lib/errors";
import { todayIST } from "@/lib/dates";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { Page } from "@/components/ui/screen";
import { BillForm } from "@/components/bill/bill-form";

export default async function NewBillPage({ searchParams }: PageProps<"/bills/new">) {
  const { dispatch } = await searchParams;
  if (typeof dispatch !== "string" || !isUuid(dispatch)) notFound();
  const user = await requireUser();
  const ctx = ctxFor(user);
  if (!canMakeBills(ctx)) redirect(`/dispatches/${dispatch}`);
  const t = messages(user.language);
  const draft = await billDraft(db, ctx, dispatch).catch((e) => {
    if (e instanceof LedgerError && e.code === "BILL_EXISTS") redirect(`/bills/${e.details.billId}`);
    if (e instanceof LedgerError && (e.code === "NOT_FOUND" || e.code === "DISPATCH_CANCELLED")) redirect(`/dispatches/${dispatch}`);
    throw e;
  });
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back={`/dispatches/${dispatch}`} title={`${t.b.makeBill}: ${draft.party.name}`} />
      <Page>
        <BillForm
          lang={user.language}
          mode={{ type: "create", dispatchId: dispatch }}
          initial={{ kind: draft.seller.gstin ? "gst" : "kacha", billDate: draft.billDate, charges: 0, notes: null, shipping: draft.shipping, lines: draft.lines.map((l) => ({ ...l, discountPct: 0 })) }}
          sellerHasGstin={!!draft.seller.gstin}
          partyHasState={!!draft.party.state}
          interstate={draft.interstate}
          today={todayIST()}
        />
      </Page>
    </>
  );
}
