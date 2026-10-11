"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import type { PendingItem, PendingParty } from "@/ledger/queries";
import { formatQty } from "@/lib/qty";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

export function PendingView({ lang, parties, items, canDispatch }: { lang: Lang; parties: PendingParty[]; items: PendingItem[]; canDispatch: boolean }) {
  const t = messages(lang);
  const [tab, setTab] = useState<"party" | "item">("party");
  const [q, setQ] = useState("");
  const shownParties = useMemo(() => parties.filter((p) => norm(p.partyName).includes(norm(q))), [parties, q]);
  const shownItems = useMemo(() => items.filter((i) => norm(i.itemName).includes(norm(q))), [items, q]);
  const age = (d: number | null) => (d === null ? "" : d === 0 ? t.p.today : `${d} ${t.p.days}`);
  const tabBtn = (k: "party" | "item", label: string) => (
    <button onClick={() => setTab(k)} aria-pressed={tab === k} className={`flex-1 rounded-lg py-2.5 text-base font-semibold ${tab === k ? "bg-white text-[#1f4e79] shadow-sm" : "text-stone-600"}`}>
      {label}
    </button>
  );

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-4">
      <div className="flex rounded-xl bg-stone-200 p-1">
        {tabBtn("party", t.p.byParty)}
        {tabBtn("item", t.p.byItem)}
      </div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tab === "party" ? t.p.searchParty : t.p.searchItem}
        className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg outline-none focus:border-[#1f4e79]"
      />

      {tab === "party" &&
        (shownParties.length ? (
          shownParties.map((p) => (
            <div key={p.partyId} className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <Link href={`/pending/party/${p.partyId}`} className="block space-y-2 p-4 active:bg-stone-50">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-lg font-bold">{p.partyName}</p>
                <p className={`shrink-0 text-sm ${p.overdueLines ? "font-semibold text-red-700" : "text-stone-500"}`}>
                  {p.overdueLines ? `⚠ ${t.p.overdue} · ` : ""}
                  {age(p.oldestDays)}
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="text-stone-500">
                  <tr>
                    <th className="text-left font-normal" />
                    <th className="text-right font-normal">{t.p.ordered}</th>
                    <th className="text-right font-normal">{t.p.sent}</th>
                    <th className="text-right font-normal">{t.p.balance}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.items.map((i) => (
                    <tr key={i.itemId}>
                      <td className="py-0.5">{i.itemName}</td>
                      <td className="text-right tabular-nums">{formatQty(i.ordered)}</td>
                      <td className="text-right tabular-nums">{formatQty(i.sent)}</td>
                      <td className="text-right font-bold tabular-nums">
                        {formatQty(i.balance)} <span className="font-normal text-stone-500">{i.unit}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Link>
            {canDispatch && (
              <Link href={`/dispatch/new?party=${p.partyId}`} className="block border-t border-stone-100 bg-emerald-50 py-3 text-center font-semibold text-[#2e7d4f] active:bg-emerald-100">
                🚚 {t.dispatch}
              </Link>
            )}
            </div>
          ))
        ) : (
          <p className="py-16 text-center text-stone-500">{t.p.nothingPending}</p>
        ))}

      {tab === "item" &&
        (shownItems.length ? (
          shownItems.map((i) => (
            <div key={i.itemId} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm">
              <div>
                <p className="text-lg font-bold">{i.itemName}</p>
                <p className="text-sm text-stone-500">
                  {i.parties} {t.p.parties} · {t.p.ordered} {formatQty(i.ordered)} · {t.p.sent} {formatQty(i.sent)}
                  {i.overdueLines ? <span className="font-semibold text-red-700"> · ⚠ {t.p.overdue}</span> : null}
                </p>
              </div>
              <p className="shrink-0 text-right text-xl font-bold tabular-nums">
                {formatQty(i.balance)} <span className="text-sm font-normal text-stone-500">{i.unit}</span>
              </p>
            </div>
          ))
        ) : (
          <p className="py-16 text-center text-stone-500">{t.p.nothingPending}</p>
        ))}
    </main>
  );
}
