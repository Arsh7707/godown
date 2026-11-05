"use client";
import { formatDay } from "@/lib/dates";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { messages, type Lang, type Messages } from "@/i18n/messages";
import type { UnmatchedLine, UnmatchedParty } from "@/ledger/unmatched";
import { NetworkError, newId, postJson } from "@/client/api";
import { errorText } from "@/components/entry/entry-form";
import { formatQty } from "@/lib/qty";

const fmtDate = (d: string) => formatDay(d);

/** "12.5" → 1250; null if not a positive amount with at most 2 decimals. */
function toCenti(s: string): number | null {
  const v = s.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [w, f = ""] = v.split(".");
  const c = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return c > 0 ? c : null;
}
const asText = (c: number) => formatQty(c);

function useAct(t: Messages) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(body: Record<string, unknown>, okText: string, after?: (r: Record<string, unknown>) => void) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postJson<Record<string, unknown>>("/api/unmatched", body);
      if (!r.ok) setMsg({ ok: false, text: errorText(t, r.code, r.details) });
      else {
        setMsg({ ok: true, text: okText });
        after?.(r);
      }
      // Someone else may have settled it meanwhile: always show the fresh state.
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN });
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, msg };
}

function LineCard({ t, line, owner, run, busy }: { t: Messages; line: UnmatchedLine; owner: boolean; run: ReturnType<typeof useAct>["run"]; busy: boolean }) {
  // Amount per open order line, prefilled with the oldest-first suggestion.
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(line.orders.map((o) => [o.orderLineId, asText(line.suggestion.find((s) => s.orderLineId === o.orderLineId)?.quantity ?? 0).replace(/^0$/, "")])),
  );
  const [okOpen, setOkOpen] = useState(false);
  const [reason, setReason] = useState("");
  const chosen = line.orders.map((o) => ({ o, c: toCenti(amounts[o.orderLineId] ?? "") })).filter((x) => x.c !== null) as { o: UnmatchedLine["orders"][number]; c: number }[];
  const total = chosen.reduce((s, x) => s + x.c, 0);
  const tooMuch = total > line.unmatched || chosen.some((x) => x.c > x.o.balance);
  const bad = line.orders.some((o) => (amounts[o.orderLineId] ?? "").trim() && toCenti(amounts[o.orderLineId]) === null);

  return (
    <div className="space-y-3 border-t border-line pt-3 first:border-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold">{line.itemName}</p>
          <Link href={`/dispatches/${line.dispatchId}`} className="inline-flex min-h-12 items-center text-sm text-brand underline">
            {t.u.sentOn} {fmtDate(line.dispatchDate)} · {line.days === 0 ? t.p.today : `${line.days} ${t.p.days}`}
          </Link>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xl font-bold text-status-pending">
            {formatQty(line.unmatched)} <span className="text-sm font-normal">{line.unit}</span>
          </p>
          {line.sent !== line.unmatched && (
            <p className="text-xs text-ink-subtle">
              {t.u.ofSent} {formatQty(line.sent)}
            </p>
          )}
        </div>
      </div>

      {line.orders.length > 0 ? (
        <div className="space-y-2 rounded-control bg-sunken p-3">
          <p className="text-sm font-medium text-ink-muted">{owner ? t.u.linkTo : t.u.openOrders}</p>
          {line.orders.map((o) => (
            <div key={o.orderLineId} className="flex items-center gap-2">
              <Link href={`/orders/${o.orderId}`} className="flex min-h-12 min-w-0 flex-1 items-center text-sm underline">
                {t.u.orderOf} {fmtDate(o.orderDate)} · {t.u.owes} {formatQty(o.balance)}
              </Link>
              {owner && (
                <input
                  inputMode="decimal"
                  aria-label={`${t.u.amount} ${fmtDate(o.orderDate)}`}
                  value={amounts[o.orderLineId] ?? ""}
                  onChange={(e) => setAmounts((a) => ({ ...a, [o.orderLineId]: e.target.value }))}
                  className="w-20 rounded-lg border border-line-strong bg-surface px-2 py-2 text-right text-lg"
                  placeholder="0"
                />
              )}
            </div>
          ))}
          {owner && (
            <>
              {(tooMuch || bad) && <p className="text-sm text-danger">{bad ? t.err.INVALID_QTY : t.u.tooMuch}</p>}
              <button
                disabled={busy || !chosen.length || tooMuch || bad}
                onClick={() =>
                  run({ action: "link", links: chosen.map((x) => ({ dispatchLineId: line.dispatchLineId, orderLineId: x.o.orderLineId, quantity: asText(x.c) })) }, t.u.linked)
                }
                className="w-full rounded-control bg-go py-2.5 font-semibold text-ink-inverse disabled:opacity-40"
              >
                {t.u.link} {total > 0 ? `${formatQty(total)} ${line.unit}` : ""}
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="rounded-control bg-sunken p-3 text-sm text-ink-muted">{t.u.noOrder}</p>
      )}

      {owner &&
        (okOpen ? (
          <div className="space-y-2 rounded-control border-2 border-line p-3">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t.u.okReason} className="w-full rounded-lg border border-line-strong px-3 py-2" />
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => run({ action: "ok", dispatchLineId: line.dispatchLineId, reason }, t.u.markedOk)} className="flex-1 rounded-control bg-ink py-2.5 font-semibold text-ink-inverse disabled:opacity-40">
                {t.u.markOk}
              </button>
              <button onClick={() => setOkOpen(false)} className="rounded-control border-2 border-line-strong px-4 font-semibold">
                {t.f.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setOkOpen(true)} className="min-h-12 text-sm font-semibold text-ink-muted underline">
            {t.u.nothingOwed}
          </button>
        ))}
    </div>
  );
}

export function UnmatchedView({ lang, open, dismissed, role }: { lang: Lang; open: UnmatchedParty[]; dismissed: UnmatchedParty[]; role: "owner" | "staff" | "viewer" }) {
  const t = messages(lang);
  const owner = role === "owner";
  const { run, busy, msg } = useAct(t);
  // One id per party press: tapping "make order" twice makes one order.
  const orderIds = useRef(new Map<string, string>());
  const [showOk, setShowOk] = useState(false);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
      <p className="text-sm text-ink-muted">{t.u.hint}</p>
      {msg && <p className={`rounded-control p-3 ${msg.ok ? "bg-go-soft text-go-strong" : "bg-danger-soft text-danger"}`}>{msg.text}</p>}
      {!open.length && <p className="py-12 text-center text-lg text-ink-subtle">✓ {t.u.none}</p>}

      {open.map((p) => {
        const suggested = p.lines.flatMap((l) => l.suggestion.map((s) => ({ dispatchLineId: l.dispatchLineId, orderLineId: s.orderLineId, quantity: asText(s.quantity) })));
        return (
          <section key={p.partyId} className="space-y-3 rounded-card bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/pending/party/${p.partyId}`} className="flex min-h-12 min-w-0 items-center break-words text-xl font-bold text-brand">
                {p.partyName}
              </Link>
              <span className="shrink-0 rounded-full bg-status-pending-bg px-2.5 py-1 text-xs font-bold text-status-pending">
                {t.u.lines}: {p.lines.length}
              </span>
            </div>
            {owner && suggested.length > 0 && (
              <button disabled={busy} onClick={() => run({ action: "link", links: suggested }, t.u.linked)} className="w-full rounded-control border-2 border-go py-2.5 font-semibold text-go disabled:opacity-40">
                {t.u.linkAll}
              </button>
            )}
            {p.lines.map((l) => (
              <LineCard key={`${l.dispatchLineId}-${l.unmatched}`} t={t} line={l} owner={owner} run={run} busy={busy} />
            ))}
            {/* Only for goods no open order could take: otherwise linking is the right fix, not a second order. */}
            {role !== "viewer" && p.lines.some((l) => !l.orders.length) && (
              <button
                disabled={busy}
                onClick={() => {
                  if (!orderIds.current.has(p.partyId)) orderIds.current.set(p.partyId, newId());
                  void run({ action: "order", partyId: p.partyId, dispatchLineIds: p.lines.filter((l) => !l.orders.length).map((l) => l.dispatchLineId), captureId: orderIds.current.get(p.partyId) }, t.u.orderMade, () => orderIds.current.delete(p.partyId));
                }}
                className="w-full rounded-control bg-brand py-3 font-semibold text-ink-inverse disabled:opacity-40"
              >
                📝 {t.u.makeOrder}
              </button>
            )}
          </section>
        );
      })}

      {dismissed.length > 0 && (
        <section className="space-y-2">
          <button onClick={() => setShowOk((v) => !v)} className="text-sm font-semibold text-ink-muted underline">
            {showOk ? "▾" : "▸"} {t.u.okList} ({dismissed.reduce((s, p) => s + p.lines.length, 0)})
          </button>
          {showOk &&
            dismissed.map((p) => (
              <div key={p.partyId} className="space-y-2 rounded-card bg-surface p-4 text-ink-muted shadow-card">
                <p className="font-semibold">{p.partyName}</p>
                {p.lines.map((l) => (
                  <div key={l.dispatchLineId} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      {l.itemName} · {formatQty(l.unmatched)} {l.unit} · {fmtDate(l.dispatchDate)}
                      <span className="block text-xs text-ink-subtle">
                        ✓ {l.dismissed?.by}
                        {l.dismissed?.reason ? `: ${l.dismissed.reason}` : ""}
                      </span>
                    </span>
                    {owner && (
                      <button disabled={busy} onClick={() => run({ action: "reopen", dispatchLineId: l.dispatchLineId }, t.u.reopened)} className="shrink-0 underline">
                        {t.u.reopen}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
        </section>
      )}
    </main>
  );
}
