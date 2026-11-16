"use client";

import type { Messages } from "@/i18n/messages";
import { formatRupees } from "@/billing/compute";
import { normalizePhone } from "@/lib/phone";
import { Button, ButtonLink } from "@/components/ui/button";
import { CancelButton } from "@/components/order-actions";

/** Send the bill's link on WhatsApp (to the party's number when known), print it, edit or cancel it. */
export function BillActions({ t, bill, canChange }: { t: Messages; bill: { id: string; rev: number; number: string; total: number; shareToken: string; partyPhone: string | null; status: string }; canChange: boolean }) {
  const share = () => {
    const url = `${window.location.origin}/b/${bill.shareToken}`;
    const text = `${t.b.shareText} ${bill.number}: ${formatRupees(bill.total)}\n${url}`;
    const phone = bill.partyPhone ? normalizePhone(bill.partyPhone) : null;
    window.open(`https://wa.me/${phone ? phone.replace(/^\+/, "") : ""}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button variant="whatsapp" icon="share" onClick={share}>
        {t.b.shareWhatsApp}
      </Button>
      <Button variant="secondary" icon="download" onClick={() => window.print()}>
        {t.b.print}
      </Button>
      {canChange && bill.status === "active" && (
        <>
          <ButtonLink variant="secondary" icon="edit" href={`/bills/${bill.id}/edit`}>
            {t.b.edit}
          </ButtonLink>
          <CancelButton t={t} url={`/api/bills/${bill.id}/cancel`} baseRev={bill.rev} label={t.b.cancel} confirmText={t.b.cancelConfirm} />
        </>
      )}
    </div>
  );
}

/** For the party's link: just print. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" icon="download" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
