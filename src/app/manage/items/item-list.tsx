"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/field";
import { messages, type Lang } from "@/i18n/messages";
import { formatQty } from "@/lib/qty";

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
    <main className="mx-auto w-full max-w-lg flex-1 space-y-3 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
      <ButtonLink href="/stock/new-product" variant="secondary" size="md" block icon="plus" className="border-dashed">
        {t.s.newProduct}
      </ButtonLink>
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.m.search} aria-label={t.m.search} />
      <label className="flex min-h-12 items-center justify-end gap-3 text-base text-ink-muted">
        <input type="checkbox" className="size-6 accent-brand" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> {t.m.showHidden}
      </label>
      {groups.map(([product, rows]) => (
        <section key={product} className="overflow-hidden rounded-card bg-surface shadow-card">
          {(rows.length > 1 || rows[0].variant) && <p className="border-b border-line px-4 pt-3 pb-2 font-bold">{product}</p>}
          {rows.map((r) => (
            <Link key={r.id} href={`/manage/items/${r.id}`} className={`flex items-center justify-between gap-3 border-t border-line px-4 py-3 first:border-t-0 active:bg-sunken ${r.active ? "" : "opacity-50"}`}>
              <span className="min-w-0">
                <span className="block break-words font-semibold text-brand">
                  {r.variant ?? r.name} {!r.active && <span className="text-sm font-normal text-ink-subtle">· {t.m.hidden}</span>}
                </span>
                {r.aliases.length > 0 && <span className="block break-words text-xs text-ink-subtle">{r.aliases.map((a) => a.alias).join(" · ")}</span>}
              </span>
              <span className="shrink-0 text-right text-sm tabular-nums">
                <span className={`block font-bold ${r.inStock !== null && r.inStock < 0 ? "text-danger" : ""}`}>
                  {num(r.inStock)} {r.unit}
                </span>
                <span className="block text-xs text-ink-subtle">
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
