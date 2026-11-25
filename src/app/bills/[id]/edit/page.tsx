import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { isUuid } from "@/lib/ids";
import { ctxFor, requireUser } from "@/auth/session";
import { billDetail, canMakeBills } from "@/billing/service";
import { LedgerError } from "@/lib/errors";
import { todayIST } from "@/lib/dates";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { Page } from "@/components/ui/screen";
import { BillForm } from "@/components/bill/bill-form";

export default async function EditBillPage({ params }: PageProps<"/bills/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await requireUser();
  const ctx = ctxFor(user);
  if (!canMakeBills(ctx)) redirect(`/bills/${id}`);
  const t = messages(user.language);
  const b = await billDetail(db, ctx, id).catch((e) => {
    if (e instanceof LedgerError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  if (b.status !== "active") redirect(`/bills/${id}`);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back={`/bills/${id}`} title={`${t.b.edit}: ${b.number}`} />
      <Page>
        <BillForm
          lang={user.language}
          mode={{ type: "edit", billId: id, baseRev: b.rev }}
          initial={{ kind: b.kind, billDate: b.billDate, charges: b.charges, notes: b.notes, lines: b.lines, shipping: { transport: b.transport, docket: b.docket, destination: b.destination, paymentTerms: b.paymentTerms, shipTo: b.shipTo } }}
          sellerHasGstin={!!b.seller.gstin}
          partyHasState={!!b.party.state}
          interstate={b.interstate}
          today={todayIST()}
        />
      </Page>
    </>
  );
}
