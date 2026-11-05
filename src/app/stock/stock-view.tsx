"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { messages, type Lang, type Messages } from "@/i18n/messages";
import type { StockRow } from "@/stock/service";
import { formatQty } from "@/lib/qty";
import { fill } from "@/lib/text";
import { ActionBar, Page } from "@/components/ui/screen";
import { SearchInput } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
const signed = (c: number) => (c < 0 ? `−${formatQty(-c)}` : formatQty(c));

/** Below zero or low: a badge with an icon and words, never colour alone. */
export function StockFlag({ t, r }: { t: Messages; r: { inStock: number; low: boolean } }) {
  if (r.inStock < 0)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-overdue-bg px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-status-overdue">
        <Icon name="alert" size={14} strokeWidth={2.4} />
        {fill(t.ui.stock.shortBadge, { n: formatQty(-r.inStock) })}
      </span>
    );
  if (r.low)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-pending-bg px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-status-pending">
        <Icon name="alert" size={14} strokeWidth={2.4} />
        {t.s.low}
      </span>
    );
  return null;
}

/**
 * Stock: per item, what is free to sell (big), with what is in the godown and
 * what is promised to open orders under it.
 */
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
    <Page>
      <div className="flex gap-2">
        <SearchInput className="min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.s.search} aria-label={t.s.search} />
        {lowCount > 0 && (
          <button
            type="button"
            onClick={() => setLowOnly((v) => !v)}
            aria-pressed={lowOnly}
            aria-label={`${lowCount} ${t.ui.stock.lowOnly}`}
            className={`flex min-h-14 shrink-0 items-center gap-1.5 rounded-control border-2 px-3 font-bold ${lowOnly ? "border-status-overdue bg-status-overdue text-ink-inverse" : "border-status-overdue/40 bg-surface text-status-overdue"}`}
          >
            <Icon name="alert" size={20} />
            {lowCount}
          </button>
        )}
      </div>
      <p className="flex items-center justify-end gap-1.5 text-xs text-ink-subtle">
        <span className="size-2 rounded-full bg-go" aria-hidden />
        {t.s.live}
      </p>

      {groups.length === 0 && <EmptyState icon="stock" title={t.s.none} />}
      {groups.map(([product, items]) => {
        const grouped = items.length > 1 || !!items[0].variant;
        return (
          <section key={product} className="overflow-hidden rounded-card bg-surface shadow-card">
            {grouped && <h2 className="border-b border-line px-4 pt-3 pb-2 font-bold break-words">{product}</h2>}
            <ul className="divide-y divide-line">
              {items.map((r) => (
                <li key={`${r.itemId}|${r.unitCode ?? ""}`} data-stock-item={r.name}>
                  <Link href={`/stock/item/${r.itemId}`} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-sunken">
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block font-semibold break-words text-brand">
                        {grouped ? (r.variant ?? r.name) : r.name}
                        {r.unitCode && <span className="font-normal text-ink-subtle"> · {r.unit}</span>}
                      </span>
                      <span className="block text-sm text-ink-muted">
                        <span data-stock="in" className={`num font-semibold ${r.inStock < 0 ? "text-status-overdue" : "text-ink"}`}>
                          {signed(r.inStock)}
                        </span>{" "}
                        {t.ui.stock.inStockHelp} ·{" "}
                        <span data-stock="owed" className="num font-semibold text-ink">
                          {formatQty(r.owed)}
                        </span>{" "}
                        {t.ui.stock.owedHelp}
                      </span>
                      <StockFlag t={t} r={r} />
                    </span>
                    <span className="shrink-0 text-right">
                      <span data-stock="free" className={`num block text-2xl leading-tight font-bold ${r.free < 0 ? "text-status-overdue" : "text-ink"}`}>
                        {signed(r.free)}
                      </span>
                      <span className="block text-xs text-ink-subtle">
                        {r.unit} {t.ui.stock.freeHelp}
                      </span>
                    </span>
                    <Icon name="chevron" size={20} className="text-ink-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {isOwner && (
        <ButtonLink href="/stock/new-product" variant="secondary" size="md" block icon="plus" className="border-dashed">
          {t.s.newProduct}
        </ButtonLink>
      )}

      {canEnter && (
        <ActionBar>
          <ButtonLink href="/stock/in?mode=count" variant="secondary" size="lg" icon="count" className="flex-1 whitespace-nowrap">
            {t.s.count}
          </ButtonLink>
          <ButtonLink href="/stock/in?mode=receipt" variant="go" size="lg" icon="download" className="flex-1 whitespace-nowrap">
            {t.s.goodsIn}
          </ButtonLink>
        </ActionBar>
      )}
    </Page>
  );
}
