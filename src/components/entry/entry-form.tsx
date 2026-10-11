"use client";

import { useEffect, useMemo, useState } from "react";
import type { Messages } from "@/i18n/messages";
import type { Issue } from "@/extraction/types";
import type { DispatchPlan } from "@/ledger/service";
import { formatQty, toCenti } from "@/lib/qty";
import { getJson, NetworkError, postJson } from "@/client/api";
import type { Catalog, CatalogItem, CatalogParty } from "@/client/catalog";
import { put as queue } from "@/client/outbox";
import { Picker } from "./picker";
import { unitChoices, unitKey, unitLabel } from "@/lib/units";
import { SourceSummary } from "./source-summary";
import { emptyLine, formComplete, isStock, payload, qtyValid, saveUrl, unitForPick, type EntrySource, type FormKind, type FormState } from "./form-state";

export interface Share {
  text: string;
  url: string;
  /** Set for a new order, so the user can dispatch it right away. */
  orderId?: string;
}

/** A saved entry's share line, or a marker that it is waiting on the phone to be sent. */
export type SaveOutcome = Share | { queued: true; label: string };

/** New entry, or a correction of an existing order / dispatch. */
export type FormMode = { type: "create" } | { type: "correctOrder"; orderId: string; baseRev: number } | { type: "correctDispatch"; dispatchId: string; baseRev: number };

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg outline-none focus:border-[#1f4e79] focus:ring-2 focus:ring-[#1f4e79]/20";
const label = "block text-sm font-medium text-stone-600";

export function EntryForm({
  kind,
  t,
  today,
  catalog,
  addParty,
  addItem,
  initial,
  source,
  issues: _issues = [],
  mode = { type: "create" },
  onSaved,
  onCancel,
}: {
  kind: FormKind;
  t: Messages;
  today: string;
  catalog: Catalog;
  addParty: (p: CatalogParty) => void;
  addItem: (i: CatalogItem) => void;
  initial: FormState;
  source: EntrySource;
  issues?: Issue[];
  mode?: FormMode;
  onSaved: (outcome: SaveOutcome) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(initial);
  const [picker, setPicker] = useState<{ kind: "party" } | { kind: "item"; key: string } | null>(null);
  // Results are tagged with the inputs they were fetched for and shown only while those still match.
  const [planFor, setPlanFor] = useState<{ key: string; plan: DispatchPlan; stock: Record<string, number> } | null>(null);
  const [overStockOk, setOverStockOk] = useState(false);
  const [unmatchedFor, setUnmatchedFor] = useState<{ key: string; rows: { itemId: string; unit?: string | null; quantity: number }[] } | null>(null);
  const [applyUnmatched, setApplyUnmatched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const correcting = mode.type !== "create";

  const party = catalog.parties.find((p) => p.id === f.partyId);
  const itemById = useMemo(() => new Map(catalog.items.map((i) => [i.id, i])), [catalog.items]);
  const complete = formComplete(f, kind);
  const [showMissing, setShowMissing] = useState(false);
  const qtyOk = (q: string) => qtyValid(q, kind);
  // What still blocks saving, in order, with the element to scroll to.
  const missing: { id: string; text: string }[] = [];
  if (!f.partyId && !isStock(kind)) missing.push({ id: "f-party", text: t.e.missParty });
  f.lines.forEach((l, i) => {
    const used = l.itemId || l.quantity.trim() || l.mention;
    if (!used && f.lines.length > 1) return; // an empty extra line is simply ignored
    if (!l.itemId) missing.push({ id: `f-item-${l.key}`, text: `${t.e.missItem} ${i + 1}${l.mention ? ` (“${l.mention}”)` : ""}` });
    if (!qtyOk(l.quantity)) missing.push({ id: `f-qty-${l.key}`, text: `${t.e.missQty} ${i + 1}` });
  });
  if (!f.date) missing.push({ id: "f-date", text: t.e.missDate });
  if (!complete && !missing.length && f.lines[0]) missing.push({ id: `f-item-${f.lines[0].key}`, text: `${t.e.missItem} 1` });
  const isMissing = (id: string) => showMissing && missing.some((m) => m.id === id);
  const bad = "!border-red-500 !bg-red-50 ring-2 ring-red-200";
  const body = payload(kind, f, source, applyUnmatched);
  const linesKey = JSON.stringify(body.lines);
  const planKey = kind === "dispatch" && complete ? `${f.partyId}|${f.date}|${linesKey}` : null;
  const unmatchedKey = kind === "order" && !correcting && f.partyId && body.lines.length ? `${f.partyId}|${linesKey}` : null;
  const plan = planKey && planFor?.key === planKey ? planFor.plan : null;
  // Dispatch: items that would go below zero in stock (allowed after a warning).
  const shortfalls = plan
    ? body.lines
        .map((l) => ({ itemId: l.itemId, unit: l.unit, sending: toCenti(l.quantity), inStock: planFor!.stock[unitKey(l.itemId, l.unit)] ?? 0 }))
        .filter((s) => s.sending > s.inStock)
    : [];
  const unmatched = unmatchedKey && unmatchedFor?.key === unmatchedKey ? unmatchedFor.rows : [];

  // Dispatch: this party's pending items, to fill lines with one tap.
  const pendingKey = kind === "dispatch" && mode.type === "create" && f.partyId ? f.partyId : null;
  const [pendingFor, setPendingFor] = useState<{ key: string; items: { itemId: string; unitCode: string | null; itemName: string; unit: string; balance: number }[] } | null>(null);
  const partyPending = pendingKey && pendingFor?.key === pendingKey ? pendingFor.items : [];
  useEffect(() => {
    if (!pendingKey) return;
    getJson<{ items: { itemId: string; unitCode: string | null; itemName: string; unit: string; balance: number }[] }>(`/api/parties/${pendingKey}/pending`)
      .then((r) => r.ok && setPendingFor({ key: pendingKey, items: r.items }))
      .catch(() => {});
  }, [pendingKey]);

  function fillFromPending(itemId: string, unit: string | null, balanceCenti: number) {
    const qty = formatQty(balanceCenti);
    setF((s) => {
      const existing = s.lines.find((l) => l.itemId === itemId && (l.unit ?? null) === unit);
      if (existing) return { ...s, lines: s.lines.map((l) => (l.key === existing.key ? { ...l, quantity: qty } : l)) };
      const blank = s.lines.find((l) => !l.itemId && !l.quantity);
      const line = { ...(blank ?? emptyLine()), itemId, unit, quantity: qty };
      return { ...s, lines: blank ? s.lines.map((l) => (l.key === blank.key ? line : l)) : [...s.lines, line] };
    });
  }

  // Dispatch: show where the goods will go (oldest open order first).
  useEffect(() => {
    if (!planKey) return;
    const [partyId, dispatchDate, lines] = planKey.split("|");
    const h = setTimeout(() => {
      postJson<{ plan: DispatchPlan; stock: Record<string, number> }>("/api/dispatches/preview", {
        partyId,
        dispatchDate,
        lines: JSON.parse(lines),
        excludeDispatchId: mode.type === "correctDispatch" ? mode.dispatchId : undefined,
      })
        .then((r) => r.ok && setPlanFor({ key: planKey, plan: r.plan, stock: r.stock ?? {} }))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  // Order: offer goods already sent to this party with no order.
  useEffect(() => {
    if (!unmatchedKey) return;
    const [partyId, lines] = unmatchedKey.split("|");
    const qs = new URLSearchParams([["partyId", partyId], ...(JSON.parse(lines) as { itemId: string }[]).map((l) => ["itemId", l.itemId])]);
    getJson<{ unmatched: { itemId: string; unit?: string | null; quantity: number }[] }>(`/api/unmatched?${qs}`)
      .then((r) => r.ok && setUnmatchedFor({ key: unmatchedKey, rows: r.unmatched }))
      .catch(() => {});
  }, [unmatchedKey]);

  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));
  const setLine = (key: string, patch: Partial<FormState["lines"][number]>) => setF((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  async function save() {
    setBusy(true);
    setError(null);
    const url = mode.type === "correctOrder" ? `/api/orders/${mode.orderId}/correct` : mode.type === "correctDispatch" ? `/api/dispatches/${mode.dispatchId}/correct` : saveUrl(kind);
    const sendBody = correcting ? { ...body, baseRev: mode.baseRev, reason: reason.trim() || null } : body;
    try {
      const r = await postJson<{ share: Share }>(url, sendBody);
      if (r.ok) onSaved(r.share);
      else setError(errorText(t, r.code, r.details));
    } catch (e) {
      if (!(e instanceof NetworkError)) return setError(t.err.UNKNOWN);
      // Edits need the latest version from the server, so they are not queued.
      if (correcting) return setError(t.err.NETWORK);
      // No internet: keep it on the phone; it is sent automatically later.
      const label = `${isStock(kind) ? (kind === "receipt" ? t.s.goodsIn : t.s.count) : (party?.name ?? "?")}: ${body.lines.map((l) => `${itemById.get(l.itemId)?.name ?? "?"} ${l.quantity}`).join(", ")}`;
      await queue({ id: body.entryCaptureId, type: "save", kind, body, label, state: "queued" });
      onSaved({ queued: true, label });
    } finally {
      setBusy(false);
    }
  }

  const pickLine = picker?.kind === "item" ? f.lines.find((l) => l.key === picker.key) : undefined;

  return (
    <div className="space-y-5">
      {/* Party (stock entries have none) */}
      <div className={`space-y-1.5 ${isStock(kind) ? "hidden" : ""}`}>
        <span className={label}>{t.e.party}</span>
        <button id="f-party" type="button" onClick={() => setPicker({ kind: "party" })} className={`${field} text-left ${party ? "" : "border-amber-400 bg-amber-50 text-amber-900"} ${isMissing("f-party") ? bad : ""}`}>
          {party ? party.name : f.partyMention ? `“${f.partyMention}” → ${t.e.pickParty}` : t.e.pickParty}
        </button>
      </div>

      {partyPending.length > 0 && (
        <div className="space-y-2 rounded-2xl bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">{t.o.fromPending}</p>
          <div className="flex flex-wrap gap-2">
            {partyPending.map((p) => (
              <button key={unitKey(p.itemId, p.unitCode)} type="button" onClick={() => fillFromPending(p.itemId, p.unitCode, p.balance)} className="rounded-full border border-emerald-300 bg-white px-4 py-2 text-base active:bg-emerald-100">
                {p.itemName} · <b>{formatQty(p.balance)}</b> {p.unit}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Items */}
      <div className="space-y-3">
        {f.lines.map((l) => {
          const item = l.itemId ? itemById.get(l.itemId) : undefined;
          const choices = item ? unitChoices(item.unit) : [];
          return (
            <div key={l.key} className="rounded-2xl border border-stone-200 bg-white p-3">
              <div className="flex gap-2">
                <button id={`f-item-${l.key}`} type="button" onClick={() => setPicker({ kind: "item", key: l.key })} className={`${field} min-w-0 flex-1 truncate text-left ${item ? "" : "border-amber-400 bg-amber-50 text-amber-900"} ${isMissing(`f-item-${l.key}`) ? bad : ""}`}>
                  {item ? item.name : l.mention ? `“${l.mention}” → ${t.e.pickItem}` : t.e.pickItem}
                </button>
                <div className="relative w-32 shrink-0">
                  <input id={`f-qty-${l.key}`} aria-label={t.e.qty} inputMode="decimal" placeholder={kind === "count" ? t.s.counted : t.e.qty} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value.replace(/[^\d.]/g, "") })} className={`${field} text-right ${isMissing(`f-qty-${l.key}`) ? bad : ""}`} />

                </div>
              </div>
              {/* Unit, saved as chosen (no conversion). Preset from what was read or said. */}
              <div className="mt-2 flex items-center justify-end gap-2">
                <span className="text-sm text-stone-500">{t.e.unitLabel}</span>
                <select
                  aria-label={t.e.unitLabel}
                  disabled={!item}
                  value={l.unit ?? ""}
                  onChange={(e) => setLine(l.key, { unit: e.target.value || null })}
                  className="min-w-28 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-lg outline-none focus:border-[#1f4e79] disabled:bg-stone-100 disabled:text-stone-400"
                >
                  {item ? choices.map((c) => <option key={c.value ?? ""} value={c.value ?? ""}>{c.label}</option>) : <option value="">{l.unitSaid ?? "—"}</option>}
                </select>
              </div>
              {f.lines.length > 1 && (
                <button type="button" className="mt-2 text-sm text-stone-500" onClick={() => set({ lines: f.lines.filter((x) => x.key !== l.key) })}>
                  {t.e.removeLine}
                </button>
              )}
            </div>
          );
        })}
        <button type="button" onClick={() => set({ lines: [...f.lines, emptyLine()] })} className="w-full rounded-xl border-2 border-dashed border-stone-300 py-3 font-semibold text-stone-600">
          {t.e.addLine}
        </button>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-1 gap-4">
        <label className="space-y-1.5">
          <span className={label}>{kind === "order" ? t.e.orderDate : kind === "dispatch" ? t.e.dispatchDate : kind === "receipt" ? t.s.receiptDate : t.s.countDate}</span>
          <input id="f-date" type="date" max={today} value={f.date} onChange={(e) => set({ date: e.target.value })} className={`${field} ${isMissing("f-date") ? bad : ""}`} />
        </label>
        {kind === "order" && (
          <label className="space-y-1.5">
            <span className={label}>{t.e.promisedDate}</span>
            <input type="date" value={f.promisedDate} onChange={(e) => set({ promisedDate: e.target.value })} className={field} />
          </label>
        )}
      </div>

      {kind === "dispatch" && (
        <div className="grid grid-cols-1 gap-4">
          <label className="space-y-1.5">
            <span className={label}>{t.e.takenBy}</span>
            <input value={f.takenBy} onChange={(e) => set({ takenBy: e.target.value })} className={field} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className={label}>{t.e.transport}</span>
              <input value={f.transport} onChange={(e) => set({ transport: e.target.value })} className={field} />
            </label>
            <label className="space-y-1.5">
              <span className={label}>{t.e.lrNumber}</span>
              <input value={f.lrNumber} onChange={(e) => set({ lrNumber: e.target.value })} className={field} />
            </label>
          </div>
        </div>
      )}

      <label className="block space-y-1.5">
        <span className={label}>{t.e.notes}</span>
        <textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} className={field} />
      </label>

      {correcting && (
        <label className="block space-y-1.5">
          <span className={label}>{t.e.reason}</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.e.reasonHint} className={field} />
        </label>
      )}

      {plan && <Allocation t={t} plan={plan} itemById={itemById} />}

      {shortfalls.length > 0 && (
        <div className="space-y-1 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-red-900">
          {shortfalls.map((s) => (
            <p key={unitKey(s.itemId, s.unit)}>
              ⚠ {itemById.get(s.itemId)?.name}: {stockPhrase(t, s.inStock)}, {t.s.sendingShort} {formatQty(s.sending)} {unitLabel(s.unit, itemById.get(s.itemId)?.unit ?? "")}
            </p>
          ))}
          {overStockOk && <p className="text-sm">{t.s.tapAgain}</p>}
        </div>
      )}

      {unmatched.length > 0 && (
        <label className="flex items-start gap-3 rounded-2xl bg-sky-50 p-4 text-sky-900">
          <input type="checkbox" className="mt-1 size-6" checked={applyUnmatched} onChange={(e) => setApplyUnmatched(e.target.checked)} />
          <span>
            {t.e.unmatchedOffer} {unmatched.map((u) => `${itemById.get(u.itemId)?.name ?? "?"} ${formatQty(u.quantity)} ${unitLabel(u.unit, itemById.get(u.itemId)?.unit ?? "")}`).join(", ")}. <b>{t.e.applyUnmatched}</b>
          </span>
        </label>
      )}

      <SourceSummary t={t} summary={source.summaryEn} text={source.sourceText} />

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}

      {/* Room so the pinned bar never covers the last field */}
      <div aria-hidden className="h-32" />

      {/* Save bar pinned to the bottom of the screen. Save is always tappable: if something is
          still missing it points to it instead of silently doing nothing. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-md space-y-2 px-4 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
          {showMissing && missing.length > 0 && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {t.e.stillNeeded}: {missing.map((m) => m.text).join(" · ")}
            </p>
          )}
          {overStockOk && shortfalls.length > 0 && (
            <p role="alert" className="text-sm font-medium text-red-700">
              ⚠{" "}
              {shortfalls
                .map((s) => `${itemById.get(s.itemId)?.name}: ${stockPhrase(t, s.inStock)}, ${t.s.sendingShort} ${formatQty(s.sending)}`)
                .join(" · ")}
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onCancel} className="rounded-xl px-5 py-4 text-lg text-stone-600">
              {t.e.cancel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!complete) {
                  setShowMissing(true);
                  if (missing[0]) document.getElementById(missing[0].id)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  return;
                }
                // Sending more than is in stock: allowed, but only after a second tap on the warning.
                if (shortfalls.length && !overStockOk) {
                  setOverStockOk(true);
                  return;
                }
                save();
              }}
              className={`flex-1 rounded-xl px-4 py-4 text-lg font-semibold text-white disabled:opacity-60 ${complete ? "bg-[#2e7d4f]" : "bg-[#2e7d4f]/70"}`}
            >
              {busy ? t.e.saving : shortfalls.length && overStockOk ? t.s.sendAnyway : t.e.save}
            </button>
          </div>
        </div>
      </div>

      {picker?.kind === "party" && (
        <Picker
          t={t}
          title={t.e.pickParty}
          options={catalog.parties}
          suggested={f.partyCandidates}
          initialQuery={f.partyCandidates.length ? "" : (f.partyMention ?? "")}
          onClose={() => setPicker(null)}
          onPick={(id) => {
            set({ partyId: id });
            setPicker(null);
          }}
          onCreate={async (name) => {
            const r = await postJson<{ party: CatalogParty }>("/api/parties", { name });
            if (!r.ok) return setError(t.err[r.code] ?? t.err.UNKNOWN);
            addParty(r.party);
            set({ partyId: r.party.id });
            setPicker(null);
          }}
        />
      )}
      {picker?.kind === "item" && pickLine && (
        <Picker
          t={t}
          title={t.e.pickItem}
          options={catalog.items.map((i) => ({ ...i, sub: i.unit }))}
          suggested={pickLine.candidates}
          initialQuery={pickLine.candidates.length ? "" : (pickLine.mention ?? "")}
          askUnit
          onClose={() => setPicker(null)}
          onPick={(id) => {
            const it = itemById.get(id);
            setLine(pickLine.key, { itemId: id, unit: it ? unitForPick(pickLine.unitSaid, it.unit) : null });
            setPicker(null);
          }}
          onCreate={async (name, unit) => {
            const r = await postJson<{ item: CatalogItem }>("/api/items", { name, unit });
            if (!r.ok) return setError(t.err[r.code] ?? t.err.UNKNOWN);
            addItem(r.item);
            setLine(pickLine.key, { itemId: r.item.id, unit: unitForPick(pickLine.unitSaid, r.item.unit) });
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

/** "only 5 in stock" / "none in stock (−15)". */
export function stockPhrase(t: Messages, inStock: number): string {
  if (inStock > 0) return `${t.s.onlyInStock} ${formatQty(inStock)} ${t.s.inStockWord}`;
  return `${t.s.noneInStock}${inStock < 0 ? ` (−${formatQty(-inStock)})` : ""}`;
}

/** Rule-violation message, with the number the user needs (e.g. "already sent 10"). */
export function errorText(t: Messages, code: string, details?: Record<string, unknown>): string {
  const base = t.err[code] ?? t.err.UNKNOWN;
  if (code === "BELOW_DISPATCHED" && details?.dispatched) return `${base} (${formatQty(Math.round(Number(details.dispatched) * 100))})`;
  return base;
}

export function Allocation({ t, plan, itemById }: { t: Messages; plan: DispatchPlan; itemById: Map<string, CatalogItem> }) {
  const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <div className="space-y-2 rounded-2xl bg-emerald-50 p-4 text-emerald-950">
      <p className="font-semibold">{t.e.goesTo}</p>
      {plan.lines.map((l, i) => {
        const it = itemById.get(l.itemId);
        const u = unitLabel(l.unit, it?.unit ?? "");
        return (
          <div key={i} className="text-sm">
            <p className="font-medium">
              {it?.name} · {formatQty(l.quantity)} {u}
            </p>
            {l.allocations.map((a) => (
              <p key={a.orderLineId}>
                → {formatQty(a.quantity)} {u} {t.e.orderOf} {fmtDate(a.orderDate)} · {t.e.balanceAfter} {formatQty(a.balanceAfter)}
              </p>
            ))}
            {l.unmatched > 0 && (
              <p className="text-amber-800">
                → {formatQty(l.unmatched)} {u}: {t.e.unmatched}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
