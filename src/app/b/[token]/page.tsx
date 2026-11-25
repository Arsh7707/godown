import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { billByToken } from "@/billing/service";
import { BillSheet } from "@/components/bill/bill-sheet";
import { PrintButton } from "@/components/bill/bill-actions";

/** The link sent to the party: the bill alone, no login. The token in the link is the only key. */
export const metadata: Metadata = { title: "Bill", robots: { index: false, follow: false } };

export default async function SharedBillPage({ params }: PageProps<"/b/[token]">) {
  const { token } = await params;
  const bill = await billByToken(db, token);
  if (!bill) notFound();
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6 print:max-w-none print:space-y-0 print:p-0">
      <div className="flex justify-end print:hidden">
        <PrintButton label="Print or save PDF" />
      </div>
      <BillSheet bill={bill} />
    </main>
  );
}
