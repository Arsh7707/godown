"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import type { StockRow } from "@/stock/service";
import { formatQty } from "@/lib/qty";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
const signed = (c: number) => (c < 0 ? `−${formatQty(-c)}` : formatQty(c));

export function StockView({ lang, rows, canEnter, isOwner }: { lang: Lang; rows: StockRow[]; canEnter: boolean; isOwner: boolean }) {
  const t = messages(lang);
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const shown = useMemo(() => rows.filter((r) => (!lowOnly || r.low || r.inStock < 0) && norm(r.name).includes(norm(q))), [rows, q, lowOnly]);
  const groups = useMemo(() => {
    const m = new Map<string, StockRow[]>();
    for (const r of shown) m.set(r.product, [...(m.get(r.product) ?? []), r]);
    return [...m.entries()];
  }, [shown]);
  const lowCount = rows.filter((r) => r.low || r.inStock < 0).length;

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-4">
      {canEnter && (
        <div className="grid grid-cols-2 gap-3">
          <Link href="/stock/in?mode=receipt" className="rounded-2xl bg-[#2e7d4f] px-4 py-4 text-white shadow-sm">
            <span className="block text-xl font-bold">📥 {t.s.goodsIn}</span>
            <span className="block text-sm opacity-80">{t.s.goodsInHint}</span>
          </Link>
          <Link href="/stock/in?mode=count" className="rounded-2xl bg-[#1f4e79] px-4 py-4 text-white shadow-sm">
            <span className="block text-xl font-bold">🔢 {t.s.count}</span>
            <span className="block text-sm opacity-80">{t.s.countHint}</span>
          </Link>
        </div>
      )}
      <div className="flex gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.s.search} className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg outline-none focus:border-[#1f4e79]" />
        {lowCount > 0 && (
          <button onClick={() => setLowOnly((v) => !v)} aria-pressed={lowOnly} className={`shrink-0 rounded-xl px-3 font-semibold ${lowOnly ? "bg-red-600 text-white" : "border-2 border-red-300 text-red-700"}`}>
            ⚠ {lowCount}
          </button>
        )}
      </div>
      <p className="text-right text-xs text-stone-400">● {t.s.live}</p>

      {groups.length === 0 && <p className="py-16 text-center text-stone-500">{t.s.none}</p>}
      {groups.map(([product, items]) => (
        <section key={product} className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {items.length > 1 || items[0].variant ? <p className="border-b border-stone-100 px-4 pt-3 pb-2 font-bold">{product}</p> : null}
          <table className="w-full">
            {(items.length > 1 || items[0].variant) && (
              <thead className="text-xs text-stone-500">
                <tr>
                  <th />
                  <th className="px-2 text-right font-normal">{t.s.inStock}</th>
                  <th className="px-2 text-right font-normal">{t.s.owed}</th>
                  <th className="px-4 text-right font-normal">{t.s.free}</th>
                </tr>
              </thead>
            )}
            <tbody>
              {items.map((r) => (
                <tr key={`${r.itemId}|${r.unitCode ?? ""}`} className="border-t border-stone-100 first:border-t-0">
                  <td className="py-3 pl-4">
                    <Link href={`/stock/item/${r.itemId}`} className="block font-semibold text-[#1f4e79]">
                      {r.variant ?? r.name}
                      {r.unitCode && <span className="font-normal text-stone-500"> · {r.unit}</span>}
                    </Link>
                    {!(items.length > 1 || items[0].variant) && (
                      <span className="text-xs text-stone-500">
                        {t.s.inStock} {signed(r.inStock)} · {t.s.owed} {formatQty(r.owed)}
                      </span>
                    )}
                  </td>
                  {(items.length > 1 || items[0].variant) && (
                    <>
                      <td className={`px-2 text-right tabular-nums ${r.inStock < 0 ? "font-bold text-red-700" : ""}`}>{signed(r.inStock)}</td>
                      <td className="px-2 text-right tabular-nums text-stone-600">{formatQty(r.owed)}</td>
                    </>
                  )}
                  <td className="py-3 pr-4 text-right">
                    <span className={`text-xl font-bold tabular-nums ${r.free < 0 ? "text-red-700" : r.low ? "text-amber-700" : ""}`}>{signed(r.free)}</span>
                    <span className="block text-xs text-stone-500">
                      {r.low || r.inStock < 0 ? <b className="text-red-700">⚠ {t.s.low} · </b> : null}
                      {t.s.free} · {r.unit}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {isOwner && (
        <Link href="/stock/new-product" className="block rounded-2xl border-2 border-dashed border-stone-300 py-4 text-center text-lg font-semibold text-stone-700">
          + {t.s.newProduct}
        </Link>
      )}
    </main>
  );
}
