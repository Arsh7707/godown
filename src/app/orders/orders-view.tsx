"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import type { OrderListRow } from "@/ledger/queries";
import { OrderRow } from "@/components/order-bits";
import { orderStatus } from "@/components/ui/status";
import { Chips, SearchInput } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/feedback";
import { ActionBar, Page } from "@/components/ui/screen";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
type Filter = "open" | "done" | "cancelled" | "all";

/** Every order, open ones first by default; pending balance is the big number on each row. */
export function OrdersView({ lang, orders, canEnter, itemId }: { lang: Lang; orders: OrderListRow[]; canEnter: boolean; itemId?: string }) {
  const t = messages(lang);
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const withStatus = useMemo(() => orders.map((o) => ({ o, s: orderStatus(o) })), [orders]);
  const forItem = itemId ? withStatus.filter(({ o }) => o.lines.some((l) => l.itemId === itemId)) : withStatus;
  const itemName = itemId ? orders.flatMap((o) => o.lines).find((l) => l.itemId === itemId)?.itemName : undefined;
  const count = (f: Filter) => forItem.filter(({ s }) => matches(f, s)).length;
  const shown = forItem.filter(({ o, s }) => matches(filter, s) && (!q || norm([o.partyName, ...o.lines.map((l) => l.itemName)].join(" ")).includes(norm(q))));

  return (
    <Page>
      {itemName && (
        <div className="flex items-center justify-between gap-3 rounded-card bg-brand-soft px-4 py-2 text-brand-strong">
          <span className="font-semibold break-words">
            {t.ui.orders.forItem} {itemName}
          </span>
          <Link href="/orders" className="flex min-h-12 shrink-0 items-center gap-1 font-semibold underline">
            <Icon name="close" size={18} />
            {t.ui.orders.clear}
          </Link>
        </div>
      )}
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.ui.orders.search} aria-label={t.ui.orders.search} />
      <Chips
        label={t.ui.orders.filter}
        value={filter}
        onChange={setFilter}
        options={(["open", "done", "cancelled", "all"] as const).map((f) => ({ value: f, label: `${t.ui.orders[f]} · ${count(f)}` }))}
      />
      {shown.length ? (
        <ul className="space-y-3">
          {shown.map(({ o }) => (
            <li key={o.orderId}>
              <OrderRow t={t} o={o} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="orders" title={t.ui.orders.none} hint={filter === "open" ? t.p.nothingPending : t.ui.orders.noneHint} />
      )}
      {canEnter && (
        <ActionBar>
          <ButtonLink href="/order/new" variant="primary" size="lg" block icon="plus">
            {t.newOrder}
          </ButtonLink>
        </ActionBar>
      )}
    </Page>
  );
}

function matches(f: Filter, s: ReturnType<typeof orderStatus>) {
  if (f === "all") return true;
  if (f === "done") return s === "fulfilled";
  if (f === "cancelled") return s === "cancelled";
  return s !== "fulfilled" && s !== "cancelled";
}
