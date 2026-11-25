"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { messages, type Lang } from "@/i18n/messages";
import { computeBill, formatRupees, paiseToText, parseRupees, type BillKind } from "@/billing/compute";
import { NetworkError, postJson } from "@/client/api";
import { formatQty } from "@/lib/qty";
import { errorText } from "@/components/entry/entry-form";
import { Card } from "@/components/ui/card";
import { Field, Segmented, TextArea, TextInput } from "@/components/ui/field";
import { ActionBar } from "@/components/ui/screen";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import type { BillShipping } from "@/billing/service";

/** GST rates in use since the 2025 changes (masters/manage.ts GST_RATES). */
const GST_RATES = [0, 3, 5, 18, 40];

export interface BillFormLine {
  itemId: string | null;
  name: string;
  hsn: string | null;
  /** Hundredths. */
  quantity: number;
  unit: string;
  /** Paise; null when nothing is known yet. */
  rate: number | null;
  /** Hundredths of a percent. */
  discountPct: number;
  /** Hundredths of a percent; null = not set for the item. */
  gstRate: number | null;
  rateFrom?: "party" | "item" | null;
}

interface Row {
  itemId: string | null;
  name: string;
  hsn: string;
  qty: string;
  unit: string;
  rate: string;
  disc: string;
  gst: string;
  rateFrom: "party" | "item" | null;
}

const toRow = (l: BillFormLine): Row => ({
  itemId: l.itemId,
  name: l.name,
  hsn: l.hsn ?? "",
  qty: formatQty(l.quantity),
  unit: l.unit,
  rate: l.rate === null ? "" : paiseToText(l.rate),
  disc: l.discountPct ? formatQty(l.discountPct) : "",
  gst: l.gstRate === null ? "" : formatQty(l.gstRate),
  rateFrom: l.rateFrom ?? null,
});

/** "12.5" → 1250; null if it isn't a number with up to 2 decimals. */
const hundredths = (s: string) => parseRupees(s);

export function BillForm({
  lang,
  mode,
  initial,
  sellerHasGstin,
  partyHasState,
  interstate,
  today,
}: {
  lang: Lang;
  mode: { type: "create"; dispatchId: string } | { type: "edit"; billId: string; baseRev: number };
  initial: { kind: BillKind; billDate: string; lines: BillFormLine[]; charges: number; notes: string | null; shipping: BillShipping };
  sellerHasGstin: boolean;
  partyHasState: boolean;
  interstate: boolean;
  today: string;
}) {
  const t = messages(lang);
  const router = useRouter();
  const [kind, setKind] = useState<BillKind>(initial.kind);
  const [billDate, setBillDate] = useState(initial.billDate);
  const [rows, setRows] = useState<Row[]>(() => initial.lines.map(toRow));
  const [charges, setCharges] = useState(initial.charges ? paiseToText(initial.charges) : "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [ship, setShip] = useState(() => ({
    transport: initial.shipping.transport ?? "",
    docket: initial.shipping.docket ?? "",
    destination: initial.shipping.destination ?? "",
    paymentTerms: initial.shipping.paymentTerms ?? "",
    other: !!initial.shipping.shipTo,
    shipToName: initial.shipping.shipTo?.name ?? "",
    shipToAddress: initial.shipping.shipTo?.address ?? "",
  }));
  const setS = (k: keyof typeof ship) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setShip((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gst = kind === "gst";

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const parsed = rows.map((r) => ({ quantity: hundredths(r.qty), rate: parseRupees(r.rate), discountPct: r.disc ? hundredths(r.disc) : 0, gstRate: r.gst ? hundredths(r.gst) : 0 }));
  const chargesPaise = charges ? parseRupees(charges) : 0;
  const totals = computeBill(kind, parsed.map((p) => ({ quantity: p.quantity ?? 0, rate: p.rate ?? 0, discountPct: p.discountPct ?? 0, gstRate: p.gstRate ?? 0 })), { interstate, charges: chargesPaise ?? 0 });
  const missingRate = parsed.some((p) => p.rate === null);
  const invalid = parsed.some((p) => !p.quantity || p.discountPct === null || p.gstRate === null) || chargesPaise === null || rows.some((r) => !r.name.trim()) || (ship.other && !ship.shipToName.trim());

  const gstOptions = (current: string) => {
    const c = current ? Number(current) : null;
    return c === null || GST_RATES.includes(c) ? GST_RATES : [...GST_RATES, c].sort((a, b) => a - b);
  };

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      kind,
      billDate,
      charges: charges || "0",
      notes: notes.trim() || null,
      transport: ship.transport.trim() || null,
      docket: ship.docket.trim() || null,
      destination: ship.destination.trim() || null,
      paymentTerms: ship.paymentTerms.trim() || null,
      shipTo: ship.other && ship.shipToName.trim() ? { name: ship.shipToName.trim(), address: ship.shipToAddress.trim() || null } : null,
      lines: rows.map((r) => ({ itemId: r.itemId, name: r.name.trim(), hsn: gst ? r.hsn.trim() || null : r.hsn.trim() || null, quantity: r.qty, unit: r.unit.trim(), rate: r.rate, discountPct: r.disc || "0", gstRate: r.gst || "0" })),
    };
    try {
      const res =
        mode.type === "create"
          ? await postJson<{ billId: string }>("/api/bills", { ...body, dispatchId: mode.dispatchId })
          : await postJson("/api/bills/" + mode.billId, { ...body, baseRev: mode.baseRev, reason: reason.trim() || undefined });
      if (!res.ok) {
        if (res.code === "BILL_EXISTS" && typeof res.details?.billId === "string") return router.replace(`/bills/${res.details.billId}`);
        return setError(errorText(t, res.code, res.details));
      }
      router.replace(`/bills/${mode.type === "create" ? (res as unknown as { billId: string }).billId : mode.billId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="space-y-3 p-4">
        <Segmented
          label={t.b.bill}
          value={kind}
          onChange={setKind}
          options={[
            { value: "gst", label: t.b.gstBill },
            { value: "kacha", label: t.b.kachaBill },
          ]}
        />
        {!gst && <p className="text-sm text-ink-subtle">{t.b.kindHint}</p>}
        <Field label={t.b.billDate} htmlFor="bill-date">
          <TextInput id="bill-date" type="date" value={billDate} max={today} onChange={(e) => setBillDate(e.target.value)} />
        </Field>
        {gst && !sellerHasGstin && <Notice tone="warn">{t.b.noGstin}</Notice>}
        {gst && !partyHasState && <Notice tone="info">{t.b.noPartyState}</Notice>}
        {gst && interstate && <Notice tone="info">{t.b.interstate}</Notice>}
      </Card>

      {rows.map((r, i) => {
        const p = parsed[i];
        return (
          <Card key={i} className="space-y-3 p-4">
            <div className="flex items-start gap-2">
              <TextInput aria-label={t.b.item} value={r.name} onChange={(e) => set(i, { name: e.target.value })} className="font-semibold" />
              {rows.length > 1 && (
                <button type="button" aria-label={t.b.removeLine} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="min-h-14 shrink-0 rounded-control px-3 text-xl text-danger active:bg-danger-soft">
                  ✕
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label={t.b.qty} htmlFor={`qty-${i}`}>
                <TextInput id={`qty-${i}`} inputMode="decimal" value={r.qty} invalid={!p.quantity} onChange={(e) => set(i, { qty: e.target.value })} />
              </Field>
              <Field label={t.b.unit} htmlFor={`unit-${i}`}>
                <TextInput id={`unit-${i}`} value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} />
              </Field>
              <Field label={t.b.rate} htmlFor={`rate-${i}`}>
                <TextInput id={`rate-${i}`} inputMode="decimal" value={r.rate} placeholder="0" invalid={p.rate === null} onChange={(e) => set(i, { rate: e.target.value, rateFrom: null })} />
              </Field>
            </div>
            <p className="text-sm text-ink-subtle">{p.rate === null ? <span className="font-semibold text-status-pending">{t.b.rateMissing}</span> : r.rateFrom === "party" ? t.b.rateFromParty : r.rateFrom === "item" ? t.b.rateFromItem : null}</p>
            <div className="grid grid-cols-3 gap-2">
              {gst && (
                <Field label={t.b.gst} htmlFor={`gst-${i}`}>
                  <select id={`gst-${i}`} value={r.gst} onChange={(e) => set(i, { gst: e.target.value })} className="w-full min-h-14 rounded-control border-2 border-line bg-surface px-3 text-lg">
                    <option value="">0%</option>
                    {gstOptions(r.gst)
                      .filter((g) => g !== 0)
                      .map((g) => (
                        <option key={g} value={String(g)}>
                          {g}%
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <Field label={t.b.discount} htmlFor={`disc-${i}`}>
                <TextInput id={`disc-${i}`} inputMode="decimal" value={r.disc} placeholder="0" invalid={p.discountPct === null} onChange={(e) => set(i, { disc: e.target.value })} />
              </Field>
              {gst && (
                <Field label={t.b.hsn} htmlFor={`hsn-${i}`}>
                  <TextInput id={`hsn-${i}`} inputMode="numeric" value={r.hsn} onChange={(e) => set(i, { hsn: e.target.value.replace(/\D/g, "") })} />
                </Field>
              )}
            </div>
            <p className="flex justify-between text-base">
              <span className="text-ink-muted">{t.b.amount}</span>
              <span className="num font-bold">{formatRupees(totals.lines[i]?.taxable ?? 0)}</span>
            </p>
          </Card>
        );
      })}

      <Button variant="secondary" block icon="plus" onClick={() => setRows((rs) => [...rs, { itemId: null, name: "", hsn: "", qty: "1", unit: "pcs", rate: "", disc: "", gst: rs[rs.length - 1]?.gst ?? "", rateFrom: null }])}>
        {t.b.addLine}
      </Button>

      <Card className="space-y-3 p-4">
        <h2 className="text-lg font-bold">{t.b.transportTitle}</h2>
        <Field label={t.b.transport} htmlFor="bill-transport">
          <TextInput id="bill-transport" value={ship.transport} maxLength={120} onChange={setS("transport")} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t.b.docket} htmlFor="bill-docket">
            <TextInput id="bill-docket" value={ship.docket} maxLength={120} onChange={setS("docket")} />
          </Field>
          <Field label={t.b.destination} htmlFor="bill-destination">
            <TextInput id="bill-destination" value={ship.destination} maxLength={120} onChange={setS("destination")} />
          </Field>
        </div>
        <Field label={t.b.paymentTerms} htmlFor="bill-terms">
          <TextInput id="bill-terms" value={ship.paymentTerms} maxLength={120} placeholder={t.b.paymentTermsHint} onChange={setS("paymentTerms")} />
        </Field>
        <label className="flex min-h-12 items-center gap-3 text-base">
          <input type="checkbox" checked={ship.other} onChange={setS("other")} className="size-6 accent-brand" />
          {t.b.shipToOther}
        </label>
        {ship.other && (
          <>
            <Field label={t.b.shipToName} htmlFor="bill-shipto-name">
              <TextInput id="bill-shipto-name" value={ship.shipToName} maxLength={120} invalid={!ship.shipToName.trim()} onChange={setS("shipToName")} />
            </Field>
            <Field label={t.b.shipToAddress} htmlFor="bill-shipto-address">
              <TextArea id="bill-shipto-address" value={ship.shipToAddress} maxLength={400} rows={3} onChange={setS("shipToAddress")} />
            </Field>
          </>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <Field label={t.b.charges} htmlFor="bill-charges">
          <TextInput id="bill-charges" inputMode="decimal" placeholder="0" value={charges} invalid={chargesPaise === null} onChange={(e) => setCharges(e.target.value)} />
        </Field>
        <Field label={t.b.notes} htmlFor="bill-notes">
          <TextArea id="bill-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {mode.type === "edit" && (
          <Field label={t.b.reasonLabel} htmlFor="bill-reason">
            <TextInput id="bill-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </Card>

      <Card className="space-y-1 p-4 text-base">
        {gst && (
          <p className="flex justify-between">
            <span className="text-ink-muted">{t.b.taxable}</span>
            <span className="num">{formatRupees(totals.taxable)}</span>
          </p>
        )}
        {gst && (
          <p className="flex justify-between">
            <span className="text-ink-muted">{t.b.tax}</span>
            <span className="num">{formatRupees(totals.cgst + totals.sgst + totals.igst)}</span>
          </p>
        )}
        <p className="flex justify-between text-xl font-bold">
          <span>{t.b.total}</span>
          <span className="num">{formatRupees(totals.total)}</span>
        </p>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}

      <ActionBar keepWithKeyboard>
        <Button variant="go" size="xl" block disabled={busy || invalid || missingRate || !billDate} onClick={save}>
          {mode.type === "create" ? t.b.save : t.b.saveChanges}
        </Button>
      </ActionBar>
    </>
  );
}
