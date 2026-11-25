import { amountInWords, formatAmount, formatRupees, hsnSummary } from "@/billing/compute";
import type { BillView, PartyOnBill } from "@/billing/service";
import { formatDay } from "@/lib/dates";
import { stateCode } from "@/lib/india";
import { formatQty } from "@/lib/qty";
import { FitWidth } from "./fit-width";

/** A4 less the 12 mm print margins (globals.css), in CSS pixels. */
const PAGE_WIDTH = 703;

/**
 * The bill as the party sees it: on the phone, on the shared link, and
 * printed or saved as PDF. Laid out like the Tally tax invoice traders
 * already use, always in English. Paper is white in dark mode too.
 */
export function BillSheet({ bill }: { bill: BillView }) {
  const { seller, party, totals } = bill;
  const gst = bill.kind === "gst";
  const pct = (h: number) => `${formatQty(h)}%`;
  const hsn = gst ? hsnSummary(bill.lines, totals, bill.interstate) : [];
  const tax = totals.cgst + totals.sgst + totals.igst;
  const units = new Set(bill.lines.map((l) => l.unit.toLowerCase()));
  const totalQty = units.size === 1 ? `${formatQty(bill.lines.reduce((s, l) => s + l.quantity, 0))} ${bill.lines[0].unit}` : "";
  const shipTo = bill.shipTo ?? { name: party.name, address: [party.address, place(party)].filter(Boolean).join("\n") || null };
  const discount = bill.lines.some((l) => l.discountPct > 0);
  // Columns: Sl, Description, [HSN], Qty, Rate, per, [Disc], Amount
  const cols = 6 + (gst ? 1 : 0) + (discount ? 1 : 0);
  const taxRows: [string, number][] = gst
    ? bill.interstate
      ? [["IGST", totals.igst]]
      : [
          ["CGST", totals.cgst],
          ["SGST", totals.sgst],
        ]
    : [];

  return (
    <FitWidth width={PAGE_WIDTH}>
      <article data-paper className="relative bg-white text-[11px] leading-snug text-black print:text-[10px]">
        {bill.status === "cancelled" && (
          <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="-rotate-12 rounded-lg border-4 border-red-700/60 px-6 py-2 text-6xl font-black tracking-widest text-red-700/60">CANCELLED</span>
          </div>
        )}
        <p className="pb-1 text-center text-sm font-bold">{gst ? "Tax Invoice" : "Estimate"}</p>

        <div className="border border-black">
          {/* Seller, consignee, buyer | invoice details */}
          <div className="grid grid-cols-[55%_45%]">
            <div className="border-r border-black">
              <div className="border-b border-black p-1.5">
                <p className="text-sm font-bold uppercase">{seller.name}</p>
                {seller.address && <p className="whitespace-pre-line">{seller.address}</p>}
                {place(seller) && <p>{place(seller)}</p>}
                {seller.phone && <p>Phone : {seller.phone}</p>}
                {gst && seller.gstin && <p>GSTIN/UIN : {seller.gstin}</p>}
                {seller.state && <p>{stateLine(seller.state)}</p>}
                {seller.email && <p>E-Mail : {seller.email}</p>}
              </div>
              <div className="border-b border-black p-1.5">
                <p className="text-[10px]">Consignee (Ship to)</p>
                <p className="font-bold">{shipTo.name}</p>
                {shipTo.address && <p className="whitespace-pre-line">{shipTo.address}</p>}
              </div>
              <div className="p-1.5">
                <p className="text-[10px]">Buyer (Bill to)</p>
                <p className="font-bold">{party.name}</p>
                {party.address && <p className="whitespace-pre-line">{party.address}</p>}
                {place(party) && <p>{place(party)}</p>}
                {party.gstin ? <p>GSTIN/UIN : {party.gstin}</p> : party.aadhaar ? <p>Aadhaar : {party.aadhaar}</p> : null}
                {party.phone && <p>Phone : {party.phone}</p>}
                {party.state && <p>{stateLine(party.state)}</p>}
                {gst && party.state && <p>Place of Supply : {party.state}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 content-start">
              <Cell label="Invoice No." value={bill.number} />
              <Cell label="Dated" value={formatDay(bill.billDate, { year: true })} last />
              <Cell label="Dispatch Doc No." value={bill.docket} />
              <Cell label="Mode/Terms of Payment" value={bill.paymentTerms} last />
              <Cell label="Dispatched through" value={bill.transport} />
              <Cell label="Destination" value={bill.destination} last />
              <div className="col-span-2 min-h-12 p-1.5">
                <p className="text-[10px]">Terms of Delivery</p>
                {bill.notes && <p className="font-bold whitespace-pre-line">{bill.notes}</p>}
              </div>
            </div>
          </div>

          {/* Goods */}
          <table className="w-full border-collapse border-t border-black">
            <thead>
              <tr className="border-b border-black text-[10px]">
                <Th className="w-6">Sl No.</Th>
                <Th className="text-center">Description of Goods</Th>
                {gst && <Th className="w-16">HSN/SAC</Th>}
                <Th className="w-20 text-right">Quantity</Th>
                <Th className="w-16 text-right">Rate</Th>
                <Th className="w-9">per</Th>
                {discount && <Th className="w-10 text-right">Disc. %</Th>}
                <Th className="w-24 text-right" last>
                  Amount
                </Th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((l, i) => (
                <tr key={i} className="align-top">
                  <Td>{i + 1}</Td>
                  <Td className="font-bold break-words">{l.name}</Td>
                  {gst && <Td>{l.hsn}</Td>}
                  <Td className="text-right font-bold whitespace-nowrap">
                    {formatQty(l.quantity)} {l.unit}
                  </Td>
                  <Td className="text-right whitespace-nowrap">{formatAmount(l.rate)}</Td>
                  <Td>{l.unit}</Td>
                  {discount && <Td className="text-right">{l.discountPct ? pct(l.discountPct) : ""}</Td>}
                  <Td className="text-right font-bold whitespace-nowrap" last>
                    {formatAmount(totals.lines[i].taxable)}
                  </Td>
                </tr>
              ))}
              {totals.charges > 0 && <ChargeRow cols={cols} label="Freight / Packing" amount={formatAmount(totals.charges)} />}
              {gst && tax > 0 && <ChargeRow cols={cols} label="" amount={formatAmount(totals.taxable)} rule />}
              {taxRows.map(([label, amount]) => (
                <ChargeRow key={label} cols={cols} label={label} amount={formatAmount(amount)} bold />
              ))}
              {totals.roundOff !== 0 && <ChargeRow cols={cols} label="Round Off" amount={`${totals.roundOff < 0 ? "−" : ""}${formatAmount(Math.abs(totals.roundOff))}`} />}
              {/* Empty space down to the total, as on a printed bill. */}
              <tr className="h-40">
                {Array.from({ length: cols }, (_, i) => (
                  <Td key={i} last={i === cols - 1} />
                ))}
              </tr>
              <tr className="border-t border-black font-bold">
                <Td />
                <Td className="text-right">Total</Td>
                {gst && <Td />}
                <Td className="text-right whitespace-nowrap">{totalQty}</Td>
                <Td />
                <Td />
                {discount && <Td />}
                <Td className="text-right text-xs whitespace-nowrap" last>
                  {formatRupees(totals.total)}
                </Td>
              </tr>
            </tbody>
          </table>

          <div className="border-t border-black p-1.5">
            <p className="flex justify-between text-[10px]">
              <span>Amount Chargeable (in words)</span>
              <span className="italic">E. &amp; O.E</span>
            </p>
            <p className="font-bold">{amountInWords(totals.total)}</p>
          </div>

          {/* HSN-wise tax */}
          {hsn.length > 0 && (
            <table className="w-full border-collapse border-t border-black text-right">
              <thead className="text-[10px]">
                <tr className="border-b border-black">
                  <Th className="text-left" rowSpan={2}>
                    HSN/SAC
                  </Th>
                  <Th className="w-20" rowSpan={2}>
                    Taxable Value
                  </Th>
                  {(bill.interstate ? ["IGST"] : ["CGST", "SGST"]).map((h) => (
                    <Th key={h} className="text-center" colSpan={2}>
                      {h}
                    </Th>
                  ))}
                  <Th className="w-20" rowSpan={2} last>
                    Total Tax Amount
                  </Th>
                </tr>
                <tr className="border-b border-black">
                  {(bill.interstate ? [1] : [1, 2]).flatMap((k) => [
                    <Th key={`r${k}`} className="w-10">
                      Rate
                    </Th>,
                    <Th key={`a${k}`} className="w-20">
                      Amount
                    </Th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {hsn.map((r, i) => (
                  <tr key={i}>
                    <Td className="text-left">{r.charges ? "Freight / Packing" : (r.hsn ?? "—")}</Td>
                    <Td>{formatAmount(r.taxable)}</Td>
                    {bill.interstate ? (
                      <>
                        <Td>{pct(r.gstRate)}</Td>
                        <Td>{formatAmount(r.igst)}</Td>
                      </>
                    ) : (
                      <>
                        <Td>{pct(r.gstRate / 2)}</Td>
                        <Td>{formatAmount(r.cgst)}</Td>
                        <Td>{pct(r.gstRate / 2)}</Td>
                        <Td>{formatAmount(r.sgst)}</Td>
                      </>
                    )}
                    <Td last>{formatAmount(r.cgst + r.sgst + r.igst)}</Td>
                  </tr>
                ))}
                <tr className="border-t border-black font-bold">
                  <Td className="text-right">Total</Td>
                  <Td>{formatAmount(hsn.reduce((s, r) => s + r.taxable, 0))}</Td>
                  {bill.interstate ? (
                    <>
                      <Td />
                      <Td>{formatAmount(totals.igst)}</Td>
                    </>
                  ) : (
                    <>
                      <Td />
                      <Td>{formatAmount(totals.cgst)}</Td>
                      <Td />
                      <Td>{formatAmount(totals.sgst)}</Td>
                    </>
                  )}
                  <Td last>{formatAmount(tax)}</Td>
                </tr>
              </tbody>
            </table>
          )}
          {gst && (
            <p className="border-t border-black p-1.5">
              <span className="text-[10px]">Tax Amount (in words) : </span>
              <span className="font-bold">{amountInWords(tax)}</span>
            </p>
          )}

          {/* Declaration | bank and signature */}
          <div className="grid grid-cols-2 border-t border-black">
            <div className="flex flex-col justify-end p-1.5">
              <p className="text-[10px] underline">Declaration</p>
              <p>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</p>
            </div>
            <div className="border-l border-black">
              {(seller.bankAccount || seller.upiId) && (
                <div className="p-1.5">
                  <p className="text-[10px]">Company&apos;s Bank Details</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-1">
                    <BankRow label="A/c Holder's Name" value={seller.name} />
                    <BankRow label="Bank Name" value={seller.bankName} />
                    <BankRow label="A/c No." value={seller.bankAccount} />
                    <BankRow label="IFS Code" value={seller.bankIfsc} />
                    <BankRow label="UPI" value={seller.upiId} />
                  </dl>
                </div>
              )}
              <div className="flex min-h-16 flex-col justify-between border-t border-black p-1.5 text-right">
                <p className="font-bold">for {seller.name}</p>
                <p className="text-[10px]">Authorised Signatory</p>
              </div>
            </div>
          </div>
        </div>
        <p className="pt-1 text-center text-[10px]">This is a Computer Generated {gst ? "Invoice" : "Estimate"}</p>
      </article>
    </FitWidth>
  );
}

const place = (x: Pick<PartyOnBill, "city" | "state">) => [x.city, x.state].filter(Boolean).join(", ");

function stateLine(state: string) {
  const code = stateCode(state);
  return `State Name : ${state}${code ? `, Code : ${code}` : ""}`;
}

function Cell({ label, value, last }: { label: string; value: string | null; last?: boolean }) {
  return (
    <div className={`min-h-10 border-b border-black p-1.5 ${last ? "" : "border-r"}`}>
      <p className="text-[10px]">{label}</p>
      <p className="font-bold break-words">{value}</p>
    </div>
  );
}

function Th({ children, className = "", last, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement> & { last?: boolean }) {
  return (
    <th className={`px-1 py-1 font-normal ${last ? "" : "border-r border-black"} ${className}`} {...rest}>
      {children}
    </th>
  );
}

function Td({ children, className = "", last }: { children?: React.ReactNode; className?: string; last?: boolean }) {
  return <td className={`px-1 py-0.5 ${last ? "" : "border-r border-black"} ${className}`}>{children}</td>;
}

/** Freight, tax and round-off: right-aligned in the description column, amount in the last. */
function ChargeRow({ cols, label, amount, bold, rule }: { cols: number; label: string; amount: string; bold?: boolean; rule?: boolean }) {
  return (
    <tr>
      <Td />
      <Td className={`text-right italic ${bold ? "font-bold" : ""}`}>{label}</Td>
      {Array.from({ length: cols - 3 }, (_, i) => (
        <Td key={i} />
      ))}
      <Td className={`text-right whitespace-nowrap ${bold ? "font-bold" : ""} ${rule ? "border-t border-black" : ""}`} last>
        {amount}
      </Td>
    </tr>
  );
}

function BankRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd className="font-bold break-words">: {value}</dd>
    </>
  );
}
