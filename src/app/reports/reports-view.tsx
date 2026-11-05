"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { messages, type Lang, type Messages } from "@/i18n/messages";
import type { ByUnit, Report } from "@/reports/service";
import { getJson, NetworkError } from "@/client/api";
import { errorText } from "@/components/entry/entry-form";
import { formatQty } from "@/lib/qty";
import { addDays, formatDay } from "@/lib/dates";

type Tab = "dispatched" | "orders" | "pending" | "slow";
type Preset = "today" | "week" | "month" | "lastMonth" | "30" | "custom";

/** "1,200 pcs · 30 dabba": never added across units. */
const units = (q: ByUnit) =>
  Object.entries(q)
    .filter(([, v]) => v)
    .sort((a, b) => b[1] - a[1])
    .map(([u, v]) => `${formatQty(v)} ${u}`)
    .join(" · ") || "0";
const fmtDate = (d: string) => formatDay(d, { year: true });

function range(p: Preset, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const first = `${today.slice(0, 7)}-01`;
  if (p === "today") return { from: today, to: today };
  if (p === "week") {
    // Week starts Monday.
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    return { from: addDays(today, -dow), to: today };
  }
  if (p === "month") return { from: first, to: today };
  if (p === "lastMonth") {
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const start = `${py}-${String(pm).padStart(2, "0")}-01`;
    return { from: start, to: addDays(first, -1) };
  }
  return { from: addDays(today, -29), to: today };
}

function Table({ head, rows, empty }: { head: string[]; rows: (string | number | React.ReactNode)[][]; empty: string }) {
  if (!rows.length) return <p className="rounded-card bg-surface p-6 text-center text-ink-subtle shadow-card">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-card bg-surface shadow-card">
      <table className="w-full text-left text-sm">
        <thead className="bg-sunken text-xs uppercase tracking-wide text-ink-subtle">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`px-3 py-2 ${i ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-2 ${j ? "text-right" : "font-medium"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The report as an Excel file: one sheet per part, quantities as numbers with their unit in its own column. */
async function exportReport(t: Messages, r: Report, firm: string) {
  const XLSX = await import("xlsx");
  const num = (c: number) => c / 100;
  const perUnit = (q: ByUnit) => Object.entries(q).map(([u, v]) => ({ u, v: num(v) }));
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: (string | number | null)[][]) => {
    const ws = XLSX.utils.aoa_to_sheet([[`${firm} · ${r.from} → ${r.to}`], [], ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };
  add(t.r.byDay, [[t.r.date, t.r.dispatches, t.r.qty, t.r.unit], ...r.dispatched.byDay.flatMap((d) => perUnit(d.qty).map((x, i) => [i ? "" : d.date, i ? null : d.dispatches, x.v, x.u]))]);
  add(t.r.sentByClient, [[t.r.client, t.r.dispatches, t.r.qty, t.r.unit], ...r.dispatched.byParty.flatMap((p) => perUnit(p.qty).map((x, i) => [i ? "" : p.name, i ? null : p.dispatches, x.v, x.u]))]);
  add(t.r.sentByItem, [[t.r.item, t.r.qty, t.r.unit, t.r.dispatches, t.r.clients], ...r.dispatched.byItem.map((i) => [i.name, num(i.qty), i.unit, i.dispatches, i.parties])]);
  add(t.r.ordersByItem, [[t.r.item, t.r.unit, t.r.ordered, t.r.sent, t.r.cancelled, t.r.pending], ...r.orders.byItem.map((i) => [i.name, i.unit, num(i.ordered), num(i.sent), num(i.cancelled), num(i.pending)])]);
  add(t.r.ordersByClient, [[t.r.client, t.r.orders, t.r.unit, t.r.ordered, t.r.sent, t.r.pending], ...r.orders.byParty.flatMap((p) => Object.keys(p.ordered).map((u, i) => [i ? "" : p.name, i ? null : p.orders, u, num(p.ordered[u] ?? 0), num(p.sent[u] ?? 0), num(p.pending[u] ?? 0)]))]);
  add(t.r.pendingByClient, [[t.r.client, t.r.qty, t.r.unit, t.r.oldest, t.r.late], ...r.pending.byParty.flatMap((p) => perUnit(p.pending).map((x, i) => [i ? "" : p.name, x.v, x.u, i ? null : p.oldestDays, i ? null : p.overdue]))]);
  add(t.r.pendingByItem, [[t.r.item, t.r.qty, t.r.unit, t.r.clients, t.r.late], ...r.pending.byItem.map((i) => [i.name, num(i.pending), i.unit, i.parties, i.overdue])]);
  add(t.r.slow, [[t.r.item, t.r.inStock, t.r.unit, t.r.free, t.r.lastSent, t.r.daysIdle], ...r.slow.map((s) => [s.name, num(s.inStock), s.unit, num(s.free), s.lastSent ?? t.r.never, s.days])]);
  XLSX.writeFile(wb, `godown-report-${r.from}-to-${r.to}.xlsx`);
}

export function ReportsView({ lang, today, firm }: { lang: Lang; today: string; firm: string }) {
  const t = messages(lang);
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState(() => range("month", today));
  const [slowDays, setSlowDays] = useState(30);
  const [tab, setTab] = useState<Tab>("dispatched");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const { from, to } = preset === "custom" ? custom : range(preset, today);

  useEffect(() => {
    if (!from || !to) return;
    const my = ++seq.current;
    const id = setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        const r = await getJson<{ report: Report }>(`/api/reports?from=${from}&to=${to}&slowDays=${slowDays}`);
        if (my !== seq.current) return;
        if (!r.ok) {
          setReport(null);
          return setErr(errorText(t, r.code));
        }
        setReport(r.report);
      } catch (e) {
        if (my === seq.current) setErr(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [from, to, slowDays, t]);

  const chip = (on: boolean) => `min-h-12 shrink-0 rounded-full px-4 text-base font-semibold whitespace-nowrap ${on ? "bg-brand text-ink-inverse" : "bg-surface text-ink-muted shadow-card"}`;
  const tabBtn = (k: Tab, label: string) => (
    <button onClick={() => setTab(k)} aria-pressed={tab === k} className={`min-h-12 flex-1 rounded-[0.6rem] px-1 py-2 text-base font-semibold ${tab === k ? "bg-surface text-brand shadow-card" : "text-ink-muted"}`}>
      {label}
    </button>
  );
  const r = report;

  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-3 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {(["today", "week", "month", "lastMonth", "30", "custom"] as Preset[]).map((p) => (
          <button key={p} onClick={() => setPreset(p)} className={chip(preset === p)}>
            {t.r.presets[p]}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="grid grid-cols-2 gap-2 text-xs text-ink-subtle">
          <label className="space-y-1">
            {t.a.from}
            <input type="date" value={custom.from} max={custom.to || today} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="w-full rounded-control border border-line-strong bg-surface px-2 py-2 text-base text-ink" />
          </label>
          <label className="space-y-1">
            {t.a.to}
            <input type="date" value={custom.to} min={custom.from} max={today} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="w-full rounded-control border border-line-strong bg-surface px-2 py-2 text-base text-ink" />
          </label>
        </div>
      )}
      <p className="text-sm text-ink-muted">
        {fmtDate(from)} → {fmtDate(r?.to ?? to)}
      </p>

      <div className="flex rounded-control bg-sunken p-1">
        {tabBtn("dispatched", t.r.tabs.dispatched)}
        {tabBtn("orders", t.r.tabs.orders)}
        {tabBtn("pending", t.r.tabs.pending)}
        {tabBtn("slow", t.r.tabs.slow)}
      </div>

      {err && <p className="rounded-control bg-danger-soft p-3 text-danger">{err}</p>}
      {busy && !r && <p className="py-12 text-center text-ink-subtle">…</p>}

      {r && (
        <div className={`space-y-3 ${busy ? "opacity-60" : ""}`}>
          {tab === "dispatched" && (
            <>
              <div className="rounded-card bg-go p-4 text-ink-inverse">
                <p className="text-sm">
                  {r.dispatched.dispatches} {t.r.dispatches}
                </p>
                <p className="text-2xl font-bold">{units(r.dispatched.total)}</p>
              </div>
              <h2 className="pt-1 font-semibold">{t.r.sentByItem}</h2>
              <Table head={[t.r.item, t.r.qty, t.r.clients]} rows={r.dispatched.byItem.map((i) => [i.name, `${formatQty(i.qty)} ${i.unit}`, i.parties])} empty={t.r.none} />
              <h2 className="pt-1 font-semibold">{t.r.sentByClient}</h2>
              <Table
                head={[t.r.client, t.r.qty, t.r.dispatches]}
                rows={r.dispatched.byParty.map((p) => [
                  <Link key={p.partyId} href={`/pending/party/${p.partyId}`} className="text-brand underline">
                    {p.name}
                  </Link>,
                  units(p.qty),
                  p.dispatches,
                ])}
                empty={t.r.none}
              />
              <h2 className="pt-1 font-semibold">{t.r.byDay}</h2>
              <Table head={[t.r.date, t.r.qty, t.r.dispatches]} rows={r.dispatched.byDay.map((d) => [fmtDate(d.date), units(d.qty), d.dispatches])} empty={t.r.none} />
            </>
          )}

          {tab === "orders" && (
            <>
              <div className="rounded-card bg-brand p-4 text-ink-inverse">
                <p className="text-2xl font-bold">
                  {r.orders.orders} {t.r.orders}
                </p>
                {r.orders.cancelledOrders > 0 && (
                  <p className="text-sm">
                    {r.orders.cancelledOrders} {t.r.cancelledOrders}
                  </p>
                )}
              </div>
              <h2 className="pt-1 font-semibold">{t.r.ordersByItem}</h2>
              <Table
                head={[t.r.item, t.r.ordered, t.r.sent, t.r.pending]}
                rows={r.orders.byItem.map((i) => [
                  `${i.name} (${i.unit})`,
                  formatQty(i.ordered),
                  formatQty(i.sent),
                  i.cancelled ? `${formatQty(i.pending)} (${t.r.cancelledShort} ${formatQty(i.cancelled)})` : formatQty(i.pending),
                ])}
                empty={t.r.none}
              />
              <h2 className="pt-1 font-semibold">{t.r.ordersByClient}</h2>
              <Table head={[t.r.client, t.r.ordered, t.r.pending]} rows={r.orders.byParty.map((p) => [p.name, units(p.ordered), units(p.pending)])} empty={t.r.none} />
            </>
          )}

          {tab === "pending" && (
            <>
              <p className="text-sm text-ink-subtle">{t.r.pendingNote}</p>
              <h2 className="pt-1 font-semibold">{t.r.pendingByClient}</h2>
              <Table
                head={[t.r.client, t.r.qty, t.r.oldest]}
                rows={r.pending.byParty.map((p) => [
                  <Link key={p.partyId} href={`/pending/party/${p.partyId}`} className={p.overdue ? "text-danger underline" : "text-brand underline"}>
                    {p.overdue ? "⚠ " : ""}
                    {p.name}
                  </Link>,
                  units(p.pending),
                  `${p.oldestDays} ${t.p.days}`,
                ])}
                empty={t.r.none}
              />
              <h2 className="pt-1 font-semibold">{t.r.pendingByItem}</h2>
              <Table head={[t.r.item, t.r.qty, t.r.clients]} rows={r.pending.byItem.map((i) => [i.overdue ? `⚠ ${i.name}` : i.name, `${formatQty(i.pending)} ${i.unit}`, i.parties])} empty={t.r.none} />
            </>
          )}

          {tab === "slow" && (
            <>
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                {t.r.slowFor}
                <select value={slowDays} onChange={(e) => setSlowDays(Number(e.target.value))} className="min-h-12 rounded-control border border-line-strong bg-surface px-2 py-1.5">
                  {[15, 30, 60, 90, 180].map((d) => (
                    <option key={d} value={d}>
                      {d} {t.p.days}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-ink-subtle">{t.r.slowNote}</p>
              <Table
                head={[t.r.item, t.r.inStock, t.r.lastSent]}
                rows={r.slow.map((s) => [
                  <Link key={`${s.itemId}${s.unit}`} href={`/stock/item/${s.itemId}`} className="text-brand underline">
                    {s.name}
                  </Link>,
                  `${formatQty(s.inStock)} ${s.unit}`,
                  s.lastSent ? `${s.days} ${t.p.days}` : t.r.never,
                ])}
                empty={t.r.noSlow}
              />
            </>
          )}

          <button onClick={() => exportReport(t, r, firm)} className="w-full rounded-control border-2 border-line-strong bg-surface py-3 font-semibold">
            ⬇️ {t.r.download}
          </button>
        </div>
      )}
    </main>
  );
}
