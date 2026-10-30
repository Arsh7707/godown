"use client";
import { formatDay } from "@/lib/dates";

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
import { fill, words } from "@/lib/text";
import { Button, IconButton } from "../ui/button";
import { Field, inputClass } from "../ui/field";
import { Notice } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { ActionBar, Qty } from "../ui/screen";
import { QtyStepper } from "../ui/stepper";
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
  // Date, notes, transport…: folded away unless something is already in them (or it is a correction).
  const [details, setDetails] = useState(() => correcting || !!(initial.promisedDate || initial.notes || initial.takenBy || initial.transport || initial.lrNumber) || (!!initial.date && initial.date !== today));

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
  const body = payload(kind, f, source, applyUnmatched);
  const linesKey = JSON.stringify(body.lines);
  const planKey = kind === "dispatch" && complete ? `${f.partyId}|${f.date}|${linesKey}` : null;
  const unmatchedKey = kind === "order" && !correcting && f.partyId && body.lines.length ? `${f.partyId}|${linesKey}` : null;
  const plan = planKey && planFor?.key === planKey ? planFor.plan : null;
  // Dispatch: items that would go below zero in stock (allowed after a warning).
  const shortfallsIn = (stock: Record<string, number>) =>
    body.lines.map((l) => ({ itemId: l.itemId, unit: l.unit, sending: toCenti(l.quantity), inStock: stock[unitKey(l.itemId, l.unit)] ?? 0 })).filter((s) => s.sending > s.inStock);
  const shortfalls = plan ? shortfallsIn(planFor!.stock) : [];
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
  async function loadPlan(key: string) {
    const [partyId, dispatchDate, lines] = key.split("|");
    const r = await postJson<{ plan: DispatchPlan; stock: Record<string, number> }>("/api/dispatches/preview", {
      partyId,
      dispatchDate,
      lines: JSON.parse(lines),
      excludeDispatchId: mode.type === "correctDispatch" ? mode.dispatchId : undefined,
    }).catch(() => null);
    if (!r?.ok) return null;
    const loaded = { key, plan: r.plan, stock: r.stock ?? {} };
    setPlanFor(loaded);
    return loaded;
  }
  useEffect(() => {
    if (!planKey) return;
    const h = setTimeout(() => loadPlan(planKey), 400);
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
  const itemUnit = (itemId: string) => itemById.get(itemId)?.unit ?? "";
  const shortText = (s: { itemId: string; unit: string | null | undefined; sending: number; inStock: number }) =>
    `${itemById.get(s.itemId)?.name}: ${stockPhrase(t, s.inStock, unitLabel(s.unit, itemUnit(s.itemId)))}, ${fill(t.ui.stock.sending, { n: words(formatQty(s.sending), unitLabel(s.unit, itemUnit(s.itemId))) })}`;
  const added = (itemId: string, unit: string | null) => f.lines.some((l) => l.itemId === itemId && (l.unit ?? null) === unit && l.quantity.trim());
  const dateLabel = kind === "order" ? t.e.orderDate : kind === "dispatch" ? t.e.dispatchDate : kind === "receipt" ? t.s.receiptDate : t.s.countDate;
  const pickBtn = (missingNow: boolean, filled: boolean) =>
    `flex min-h-14 w-full items-center gap-3 rounded-control border-2 px-4 py-3 text-left text-lg ${missingNow ? "border-danger bg-danger-soft" : filled ? "border-line bg-surface" : "border-dashed border-brand/50 bg-brand-soft/60 text-brand-strong"}`;

  return (
    <div className="space-y-5">
      {/* Party (stock entries have none) */}
      {!isStock(kind) && (
        <div className="space-y-1.5">
          <span className="block text-sm font-semibold text-ink-muted">{t.e.party}</span>
          <button id="f-party" type="button" onClick={() => setPicker({ kind: "party" })} className={pickBtn(isMissing("f-party"), !!party)}>
            <Icon name="user" size={24} className={party ? "text-ink-subtle" : ""} />
            <span className={`min-w-0 flex-1 break-words ${party ? "font-semibold" : ""}`}>{party ? party.name : f.partyMention ? `“${f.partyMention}” → ${t.e.pickParty}` : t.e.pickParty}</span>
            <Icon name={party ? "edit" : "chevron"} size={20} className="text-ink-subtle" />
          </button>
        </div>
      )}

      {/* Dispatch: what this party still has pending, one tap to add (full pending amount). */}
      {partyPending.length > 0 && (
        <div className="space-y-2 rounded-card bg-go-soft p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-go-strong">{t.ui.dispatch.pendingHere}</p>
            {partyPending.length > 1 && (
              <Button variant="ghost" size="md" className="shrink-0 whitespace-nowrap text-go-strong" onClick={() => partyPending.forEach((p) => fillFromPending(p.itemId, p.unitCode, p.balance))}>
                {t.ui.dispatch.addAll}
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {partyPending.map((p) => {
              const on = added(p.itemId, p.unitCode);
              return (
                <button
                  key={unitKey(p.itemId, p.unitCode)}
                  type="button"
                  onClick={() => fillFromPending(p.itemId, p.unitCode, p.balance)}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-control border-2 bg-surface px-3 py-2 text-left ${on ? "border-go" : "border-transparent"}`}
                >
                  <Icon name={on ? "checkCircle" : "plus"} size={22} className="text-go" />
                  <span className="min-w-0 flex-1 break-words">{p.itemName}</span>
                  <Qty n={formatQty(p.balance)} unit={p.unit} className="font-bold" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Items */}
      <div className="space-y-3">
        {f.lines.map((l, i) => {
          const item = l.itemId ? itemById.get(l.itemId) : undefined;
          const choices = item ? unitChoices(item.unit) : [];
          return (
            <div key={l.key} className="space-y-3 rounded-card bg-surface p-3 shadow-card">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink-subtle">
                  {t.e.item} {f.lines.length > 1 ? i + 1 : ""}
                </span>
                <span className="flex-1" />
                {f.lines.length > 1 && (
                  <IconButton icon="trash" label={`${t.e.removeLine} ${i + 1}`} className="text-ink-subtle" onClick={() => set({ lines: f.lines.filter((x) => x.key !== l.key) })} />
                )}
              </div>
              <button id={`f-item-${l.key}`} type="button" onClick={() => setPicker({ kind: "item", key: l.key })} className={pickBtn(isMissing(`f-item-${l.key}`), !!item)}>
                <Icon name="tag" size={22} className={item ? "text-ink-subtle" : ""} />
                <span className={`min-w-0 flex-1 break-words ${item ? "font-semibold" : ""}`}>{item ? item.name : l.mention ? `“${l.mention}” → ${t.e.pickItem}` : t.e.pickItem}</span>
                <Icon name={item ? "edit" : "chevron"} size={20} className="text-ink-subtle" />
              </button>
              <QtyStepper
                id={`f-qty-${l.key}`}
                label={t.e.qty}
                placeholder={kind === "count" ? t.s.counted : t.e.qty}
                value={l.quantity}
                onChange={(v) => setLine(l.key, { quantity: v })}
                decLabel={t.ui.decrease}
                incLabel={t.ui.increase}
                invalid={isMissing(`f-qty-${l.key}`)}
              />
              {/* Unit, saved as chosen (no conversion). Preset from what was read or said. */}
              <label className="flex items-center justify-end gap-3">
                <span className="text-sm text-ink-subtle">{t.e.unitLabel}</span>
                <select aria-label={t.e.unitLabel} disabled={!item} value={l.unit ?? ""} onChange={(e) => setLine(l.key, { unit: e.target.value || null })} className={inputClass(false, "!min-h-12 !w-auto min-w-32 !py-2")}>
                  {item ? choices.map((c) => <option key={c.value ?? ""} value={c.value ?? ""}>{c.label}</option>) : <option value="">{l.unitSaid ?? "—"}</option>}
                </select>
              </label>
            </div>
          );
        })}
        <Button variant="secondary" size="md" block icon="plus" className="border-dashed" onClick={() => set({ lines: [...f.lines, emptyLine()] })}>
          {t.e.addLine.replace(/^\+\s*/, "")}
        </Button>
      </div>

      {plan && <Allocation t={t} plan={plan} itemById={itemById} />}

      {shortfalls.length > 0 && (
        <Notice tone="error">
          {shortfalls.map((s) => (
            <p key={unitKey(s.itemId, s.unit)} className="font-semibold">
              {shortText(s)}
            </p>
          ))}
          {overStockOk && <p className="text-sm">{t.s.tapAgain}</p>}
        </Notice>
      )}

      {unmatched.length > 0 && (
        <label className="flex min-h-12 items-start gap-3 rounded-card bg-brand-soft p-4 text-brand-strong">
          <input type="checkbox" className="mt-1 size-6 shrink-0 accent-brand" checked={applyUnmatched} onChange={(e) => setApplyUnmatched(e.target.checked)} />
          <span>
            {t.e.unmatchedOffer} {unmatched.map((u) => words(itemById.get(u.itemId)?.name ?? "?", formatQty(u.quantity), unitLabel(u.unit, itemUnit(u.itemId)))).join(", ")}. <b>{t.e.applyUnmatched}</b>
          </span>
        </label>
      )}

      {/* Dates and the rest: folded away unless needed, so the screen shows only what most entries need. */}
      <div className="rounded-card bg-surface shadow-card">
        <button type="button" onClick={() => setDetails((v) => !v)} aria-expanded={details} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
          <Icon name="calendar" size={22} className="text-ink-subtle" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{f.date === today ? t.ui.today : f.date ? formatDay(f.date, { year: true }) : dateLabel}</span>
            {!details && <span className="block text-sm text-ink-subtle">{kind === "dispatch" ? t.ui.moreDispatchDetails : isStock(kind) ? dateLabel : t.ui.moreDetails}</span>}
          </span>
          <Icon name="down" size={20} className={`text-ink-subtle transition-transform ${details ? "rotate-180" : ""}`} />
        </button>
        {details && (
          <div className="space-y-4 border-t border-line p-4">
            <Field label={dateLabel} htmlFor="f-date">
              <input id="f-date" type="date" max={today} value={f.date} onChange={(e) => set({ date: e.target.value })} className={inputClass(isMissing("f-date"))} />
            </Field>
            {kind === "order" && (
              <Field label={t.e.promisedDate} htmlFor="f-promised">
                <input id="f-promised" type="date" value={f.promisedDate} onChange={(e) => set({ promisedDate: e.target.value })} className={inputClass()} />
              </Field>
            )}
            {kind === "dispatch" && (
              <>
                <Field label={t.e.takenBy} htmlFor="f-taken">
                  <input id="f-taken" value={f.takenBy} onChange={(e) => set({ takenBy: e.target.value })} className={inputClass()} />
                </Field>
                <Field label={t.e.transport} htmlFor="f-transport">
                  <input id="f-transport" value={f.transport} onChange={(e) => set({ transport: e.target.value })} className={inputClass()} />
                </Field>
                <Field label={t.e.lrNumber} htmlFor="f-lr">
                  <input id="f-lr" value={f.lrNumber} onChange={(e) => set({ lrNumber: e.target.value })} className={inputClass()} />
                </Field>
              </>
            )}
            <Field label={t.e.notes} htmlFor="f-notes">
              <textarea id="f-notes" rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} className={inputClass(false, "min-h-24")} />
            </Field>
          </div>
        )}
      </div>

      {correcting && (
        <Field label={t.e.reason} htmlFor="f-reason">
          <input id="f-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.e.reasonHint} className={inputClass()} />
        </Field>
      )}

      <SourceSummary t={t} summary={source.summaryEn} text={source.sourceText} />

      {error && (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      )}

      {/* Save bar: sticky at the bottom but part of the page, so it never covers the last field.
          Save is always tappable: if something is still missing it points to it instead of silently doing nothing. */}
      <ActionBar
        above={
          (showMissing && missing.length > 0) || (overStockOk && shortfalls.length > 0) ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {showMissing && missing.length > 0 ? `${t.e.stillNeeded}: ${missing.map((m) => m.text).join(" · ")}` : shortfalls.map(shortText).join(" · ")}
            </p>
          ) : undefined
        }
      >
        <Button variant="secondary" size="lg" onClick={onCancel}>
          {t.e.cancel}
        </Button>
        <Button
          variant={shortfalls.length && overStockOk ? "destructive" : "go"}
          size="lg"
          disabled={busy}
          className={`flex-1 ${complete ? "" : "opacity-80"}`}
          icon={kind === "dispatch" ? "truck" : "check"}
          onClick={async () => {
            if (!complete) {
              setShowMissing(true);
              const first = missing[0];
              if (first?.id === "f-date") setDetails(true);
              if (first) setTimeout(() => document.getElementById(first.id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
              return;
            }
            // The stock check loads a moment after typing; a quick tap on Save waits for it
            // (offline it can't load, and the dispatch is kept on the phone as before).
            let short = shortfalls;
            if (planKey && !plan) {
              setBusy(true);
              const loaded = await loadPlan(planKey);
              setBusy(false);
              if (loaded) short = shortfallsIn(loaded.stock);
            }
            // Sending more than is in stock: allowed, but only after a second tap on the warning.
            if (short.length && !overStockOk) {
              setOverStockOk(true);
              return;
            }
            save();
          }}
        >
          {busy ? t.e.saving : shortfalls.length && overStockOk ? t.s.sendAnyway : t.e.save}
        </Button>
      </ActionBar>

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
            const unit = it ? unitForPick(pickLine.unitSaid, it.unit) : null;
            // Dispatch: start from everything still pending for this party.
            const pend = !pickLine.quantity.trim() ? partyPending.find((p) => p.itemId === id && (p.unitCode ?? null) === unit) : undefined;
            setLine(pickLine.key, { itemId: id, unit, ...(pend ? { quantity: formatQty(pend.balance) } : {}) });
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

/** Plain words for what is in stock: "Only 5 pcs in stock", "None in stock", "Stock is already 4 pcs below zero". */
export function stockPhrase(t: Messages, inStock: number, unit?: string): string {
  if (inStock > 0) return fill(t.ui.stock.only, { n: words(formatQty(inStock), unit) });
  if (inStock === 0) return t.ui.stock.none;
  return fill(t.ui.stock.short, { n: words(formatQty(-inStock), unit) });
}

/** Rule-violation message, with the number the user needs (e.g. "already sent 10"). */
export function errorText(t: Messages, code: string, details?: Record<string, unknown>): string {
  const base = t.err[code] ?? t.err.UNKNOWN;
  if (code === "BELOW_DISPATCHED" && details?.dispatched) return `${base} (${formatQty(Math.round(Number(details.dispatched) * 100))})`;
  return base;
}

/** Live preview of a dispatch: which orders it fills (oldest first) and what each has left after it. */
export function Allocation({ t, plan, itemById }: { t: Messages; plan: DispatchPlan; itemById: Map<string, CatalogItem> }) {
  return (
    <div className="space-y-3 rounded-card bg-surface p-4 shadow-card" aria-live="polite">
      <p className="flex items-center gap-2 font-bold text-go-strong">
        <Icon name="truck" size={22} />
        {t.e.goesTo}
      </p>
      {plan.lines.map((l, i) => {
        const it = itemById.get(l.itemId);
        const u = unitLabel(l.unit, it?.unit ?? "");
        return (
          <div key={i} className="space-y-2">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-semibold break-words">{it?.name}</span>
              <span className="text-sm text-ink-muted">
                {t.ui.dispatch.sendNow} <Qty n={formatQty(l.quantity)} unit={u} className="font-bold text-ink" />
              </span>
            </p>
            {l.allocations.map((a) => (
              <div key={a.orderLineId} className="flex items-center gap-3 rounded-control bg-sunken px-3 py-2">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block text-ink-subtle">
                    {t.p.order} · {formatDay(a.orderDate)}
                  </span>
                  <span className="block font-semibold">
                    <Icon name="arrowRight" size={16} className="inline align-[-2px]" /> <Qty n={formatQty(a.quantity)} unit={u} />
                  </span>
                </span>
                {a.balanceAfter > 0 ? (
                  <span className="text-right">
                    <Qty n={formatQty(a.balanceAfter)} unit={u} className="text-lg font-bold" />
                    <span className="block text-xs text-ink-subtle">{t.ui.dispatch.leftAfter}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-sm font-semibold text-status-fulfilled">
                    <Icon name="checkCircle" size={18} />
                    {t.ui.dispatch.completes}
                  </span>
                )}
              </div>
            ))}
            {l.unmatched > 0 && (
              <p className="flex items-start gap-2 rounded-control bg-status-pending-bg px-3 py-2 text-sm text-status-pending">
                <Icon name="alert" size={18} className="mt-0.5" />
                <span>
                  <Qty n={formatQty(l.unmatched)} unit={u} className="font-bold" />: {t.ui.dispatch.noOrder}
                </span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
