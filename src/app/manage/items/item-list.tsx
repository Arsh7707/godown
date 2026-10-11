"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import { formatQty } from "@/lib/qty";
import { mfield } from "@/components/manage-ui";

interface Row {
  id: string;
  name: string;
  product: string;
  variant: string | null;
  unit: string;
  active: boolean;
  inStock: number | null;
  free: number | null;
  aliases: { alias: string }[];
}
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
const num = (c: number | null) => (c === null ? "—" : c < 0 ? `−${formatQty(-c)}` : formatQty(c));

export function ItemList({ lang, list }: { lang: Lang; list: Row[] }) {
  const t = messages(lang);
  const [q, setQ] = useState("");
  const [hidden, setHidden] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of list) {
      if (!hidden && !r.active) continue;
      if (![r.name, ...r.aliases.map((a) => a.alias)].some((s) => norm(s).includes(norm(q)))) continue;
      m.set(r.product, [...(m.get(r.product) ?? []), r]);
    }
    return [...m.entries()];
  }, [list, q, hidden]);
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-3 px-4 py-4">
      <Link href="/stock/new-product" className="block rounded-2xl border-2 border-dashed border-stone-300 py-4 text-center text-lg font-semibold text-stone-700">
        + {t.s.newProduct}
      </Link>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.m.search} className={mfield} />
      <label className="flex items-center justify-end gap-2 text-sm text-stone-500">
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> {t.m.showHidden}
      </label>
      {groups.map(([product, rows]) => (
        <section key={product} className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {(rows.length > 1 || rows[0].variant) && <p className="border-b border-stone-100 px-4 pt-3 pb-2 font-bold">{product}</p>}
          {rows.map((r) => (
            <Link key={r.id} href={`/manage/items/${r.id}`} className={`flex items-center justify-between gap-3 border-t border-stone-100 px-4 py-3 first:border-t-0 active:bg-stone-50 ${r.active ? "" : "opacity-50"}`}>
              <span className="min-w-0">
                <span className="block truncate font-semibold text-[#1f4e79]">
                  {r.variant ?? r.name} {!r.active && <span className="text-sm font-normal text-stone-500">· {t.m.hidden}</span>}
                </span>
                {r.aliases.length > 0 && <span className="block truncate text-xs text-stone-500">{r.aliases.map((a) => a.alias).join(" · ")}</span>}
              </span>
              <span className="shrink-0 text-right text-sm tabular-nums">
                <span className={`block font-bold ${r.inStock !== null && r.inStock < 0 ? "text-red-700" : ""}`}>
                  {num(r.inStock)} {r.unit}
                </span>
                <span className="block text-xs text-stone-500">
                  {t.s.free} {num(r.free)}
                </span>
              </span>
            </Link>
          ))}
        </section>
      ))}
    </main>
  );
}
