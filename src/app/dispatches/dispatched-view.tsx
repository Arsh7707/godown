"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import type { DispatchSummary } from "@/ledger/queries";
import { formatQty } from "@/lib/qty";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export function DispatchedView({ lang, list, showingCancelled }: { lang: Lang; list: DispatchSummary[]; showingCancelled: boolean }) {
  const t = messages(lang);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = norm(q);
    if (!n) return list;
    return list.filter((d) => [d.partyName, d.lrNumber ?? "", d.transport ?? "", d.takenBy ?? "", ...d.lines.map((l) => l.itemName)].some((s) => norm(s).includes(n)));
  }, [list, q]);
  // Group by date
  const groups: [string, DispatchSummary[]][] = [];
  for (const d of shown) {
    const last = groups[groups.length - 1];
    if (last && last[0] === d.dispatchDate) last[1].push(d);
    else groups.push([d.dispatchDate, [d]]);
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-4">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.d.search} className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg outline-none focus:border-[#1f4e79]" />
      <Link href={showingCancelled ? "/dispatches" : "/dispatches?all=1"} className="block text-right text-sm text-stone-500 underline">
        {showingCancelled ? "✓ " : ""}
        {t.d.showCancelled}
      </Link>
      {groups.length === 0 && <p className="py-16 text-center text-stone-500">{t.d.none}</p>}
      {groups.map(([date, ds]) => (
        <section key={date} className="space-y-2">
          <h2 className="text-sm font-semibold text-stone-500">{fmtDate(date)}</h2>
          {ds.map((d) => (
            <Link key={d.dispatchId} href={`/dispatches/${d.dispatchId}`} className={`block space-y-1.5 rounded-2xl bg-white p-4 shadow-sm active:bg-stone-50 ${d.status === "cancelled" ? "opacity-50" : ""}`}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-lg font-bold">{d.partyName}</p>
                {d.status === "cancelled" && <span className="text-sm font-semibold text-red-700">{t.d.cancelled}</span>}
              </div>
              {d.lines.map((l, i) => (
                <div key={i} className="flex justify-between">
                  <span>{l.itemName}</span>
                  <span className="font-semibold tabular-nums">
                    {formatQty(l.quantity)} {l.unit}
                  </span>
                </div>
              ))}
              <p className="text-sm text-stone-500">
                {[d.takenBy, d.transport, d.lrNumber && `LR ${d.lrNumber}`].filter(Boolean).join(" · ") || "—"}
              </p>
              {d.unmatched > 0 && (
                <p className="text-sm text-amber-800">
                  {formatQty(d.unmatched)} {t.d.unmatched}
                </p>
              )}
            </Link>
          ))}
        </section>
      ))}
    </main>
  );
}
