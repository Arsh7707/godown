import { amountInWords, formatRupees } from "@/billing/compute";
import type { BillView } from "@/billing/service";
import { formatDay } from "@/lib/dates";
import { formatQty } from "@/lib/qty";

/**
 * The bill as the party sees it: on the phone, on the shared link, and
 * printed or saved as PDF. Always in English, like most bills in India.
 */
export function BillSheet({ bill }: { bill: BillView }) {
  const { seller, party, totals } = bill;
  const gst = bill.kind === "gst";
  const pct = (h: number) => `${formatQty(h)}%`;
  const place = (x: { city: string | null; state: string | null }) => [x.city, x.state].filter(Boolean).join(", ");
  return (
    <article className="relative overflow-hidden rounded-card bg-surface p-5 text-ink shadow-card print:rounded-none print:p-0 print:shadow-none">
      {bill.status === "cancelled" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-12 rounded-lg border-4 border-danger/60 px-6 py-2 text-5xl font-black tracking-widest text-danger/60">CANCELLED</span>
        </div>
      )}

      <header className="border-b-2 border-ink pb-3 text-center">
        <h2 className="text-2xl font-bold">{seller.name}</h2>
        {seller.address && <p className="text-sm whitespace-pre-line">{seller.address}</p>}
        {place(seller) && <p className="text-sm">{place(seller)}</p>}
        <p className="text-sm">{[seller.phone && `Phone ${seller.phone}`, seller.gstin && `GSTIN ${seller.gstin}`].filter(Boolean).join(" · ")}</p>
      </header>

      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-3">
        <p className="text-lg font-bold tracking-wide">{gst ? "TAX INVOICE" : "ESTIMATE"}</p>
        <p className="text-right text-sm">
          <span className="num block font-semibold">No. {bill.number}</span>
          <span className="block">Date {formatDay(bill.billDate, { year: true })}</span>
        </p>
      </div>

      <section className="border-b border-line py-3 text-sm">
        <p className="text-xs font-semibold text-ink-subtle uppercase">Bill to</p>
        <p className="text-base font-bold">{party.name}</p>
        {party.address && <p className="whitespace-pre-line">{party.address}</p>}
        {place(party) && <p>{place(party)}</p>}
        <p>{[party.gstin && `GSTIN ${party.gstin}`, party.phone && `Phone ${party.phone}`].filter(Boolean).join(" · ")}</p>
        {gst && <p className="text-ink-subtle">{bill.interstate ? "Supply to another state: IGST" : "Supply within the state: CGST + SGST"}</p>}
      </section>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink text-left text-xs text-ink-subtle uppercase">
            <th className="py-2 pr-2 font-semibold">Item</th>
            <th className="py-2 pr-2 text-right font-semibold">Qty</th>
            <th className="py-2 pr-2 text-right font-semibold">Rate</th>
            <th className="py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {bill.lines.map((l, i) => {
            const t = totals.lines[i];
            const extra = [gst && l.hsn && `HSN ${l.hsn}`, gst && `GST ${pct(l.gstRate)}`, l.discountPct > 0 && `Disc ${pct(l.discountPct)}`].filter(Boolean).join(" · ");
            return (
              <tr key={i} className="border-b border-line align-top">
                <td className="py-2 pr-2">
                  <span className="block font-semibold break-words">{l.name}</span>
                  {extra && <span className="block text-xs text-ink-subtle">{extra}</span>}
                </td>
                <td className="num py-2 pr-2 text-right whitespace-nowrap">
                  {formatQty(l.quantity)} {l.unit}
                </td>
                <td className="num py-2 pr-2 text-right whitespace-nowrap">{formatRupees(l.rate)}</td>
                <td className="num py-2 text-right whitespace-nowrap">{formatRupees(t.taxable)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="ml-auto mt-3 w-full max-w-xs space-y-1 text-sm">
        {totals.discount > 0 && (
          <>
            <Row label="Gross" value={formatRupees(totals.gross)} />
            <Row label="Discount" value={`−${formatRupees(totals.discount)}`} />
          </>
        )}
        {totals.charges > 0 && <Row label="Freight / packing" value={formatRupees(totals.charges)} />}
        {gst && <Row label="Taxable value" value={formatRupees(totals.taxable)} />}
        {totals.taxes
          .filter((x) => x.gstRate > 0)
          .flatMap((x) =>
            bill.interstate
              ? [<Row key={`i${x.gstRate}`} label={`IGST ${pct(x.gstRate)}`} value={formatRupees(x.igst)} />]
              : [<Row key={`c${x.gstRate}`} label={`CGST ${pct(x.gstRate / 2)}`} value={formatRupees(x.cgst)} />, <Row key={`s${x.gstRate}`} label={`SGST ${pct(x.gstRate / 2)}`} value={formatRupees(x.sgst)} />],
          )}
        {totals.roundOff !== 0 && <Row label="Round off" value={`${totals.roundOff > 0 ? "+" : "−"}${formatRupees(Math.abs(totals.roundOff))}`} />}
        <div className="flex justify-between border-t-2 border-ink pt-2 text-lg font-bold">
          <dt>Total</dt>
          <dd className="num">{formatRupees(totals.total)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-sm font-semibold">{amountInWords(totals.total)}</p>

      {bill.notes && <p className="mt-3 rounded-lg bg-sunken p-2 text-sm whitespace-pre-line print:bg-transparent print:p-0">{bill.notes}</p>}

      {(seller.bankAccount || seller.upiId) && (
        <section className="mt-4 border-t border-line pt-3 text-sm">
          <p className="text-xs font-semibold text-ink-subtle uppercase">Pay to</p>
          {seller.bankAccount && <p>{[seller.bankName, `A/c ${seller.bankAccount}`, seller.bankIfsc && `IFSC ${seller.bankIfsc}`].filter(Boolean).join(" · ")}</p>}
          {seller.upiId && <p>UPI {seller.upiId}</p>}
        </section>
      )}

      <footer className="mt-6 flex items-end justify-between gap-4 text-sm">
        <p className="text-xs text-ink-subtle">Computer-generated bill.</p>
        <p className="text-right">
          <span className="block h-10" />
          For {seller.name}
        </p>
      </footer>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
