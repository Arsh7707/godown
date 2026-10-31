"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import type { PendingItem, PendingParty } from "@/ledger/queries";
import { formatQty } from "@/lib/qty";
import { Page, Qty } from "@/components/ui/screen";
import { SearchInput, Segmented } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { StatusBadge } from "@/components/ui/status";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

/** "Which pieces are still left?": by party (tap → its orders) or by item (tap → orders with it). */
export function PendingView({ lang, parties, items, canDispatch }: { lang: Lang; parties: PendingParty[]; items: PendingItem[]; canDispatch: boolean }) {
  const t = messages(lang);
  const [tab, setTab] = useState<"party" | "item">("party");
  const [q, setQ] = useState("");
  const shownParties = useMemo(() => parties.filter((p) => norm([p.partyName, ...p.items.map((i) => i.itemName)].join(" ")).includes(norm(q))), [parties, q]);
  const shownItems = useMemo(() => items.filter((i) => norm(i.itemName).includes(norm(q))), [items, q]);
  const age = (d: number | null) => (d === null ? "" : d === 0 ? t.p.today : `${d} ${t.p.days}`);

  return (
    <Page>
      <Segmented
        label={t.p.title}
        value={tab}
        onChange={setTab}
        options={[
          { value: "party", label: `${t.p.byParty} · ${parties.length}` },
          { value: "item", label: `${t.p.byItem} · ${items.length}` },
        ]}
      />
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "party" ? t.p.searchParty : t.p.searchItem} aria-label={tab === "party" ? t.p.searchParty : t.p.searchItem} />

      {tab === "party" &&
        (shownParties.length ? (
          <ul className="space-y-3">
            {shownParties.map((p) => (
              <li key={p.partyId} className="overflow-hidden rounded-card bg-surface shadow-card">
                <Link href={`/pending/party/${p.partyId}`} className="block space-y-3 p-4 active:bg-sunken">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-lg leading-snug font-bold break-words">{p.partyName}</p>
                    {p.overdueLines ? <StatusBadge t={t} status="overdue" size="sm" /> : <span className="shrink-0 text-sm text-ink-subtle">{age(p.oldestDays)}</span>}
                  </div>
                  <ul className="divide-y divide-line">
                    {p.items.map((i) => (
                      <li key={`${i.itemId}|${i.unitCode ?? ""}`} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold break-words">{i.itemName}</span>
                          <span className="block text-sm text-ink-subtle">
                            {t.ui.sentOf} <span className="num">{formatQty(i.sent)}</span> {t.ui.of} <span className="num">{formatQty(i.ordered)}</span>
                          </span>
                        </span>
                        <span className="text-right">
                          <Qty n={formatQty(i.balance)} unit={i.unit} className="text-xl font-bold" />
                          <span className="block text-xs text-ink-subtle">{t.ui.leftShort}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {p.overdueLines > 0 && <p className="text-sm text-ink-subtle">{age(p.oldestDays)}</p>}
                </Link>
                {canDispatch && (
                  <div className="border-t border-line p-3">
                    <ButtonLink href={`/dispatch/new?party=${p.partyId}`} variant="go" size="md" block icon="truck">
                      {t.dispatch}
                    </ButtonLink>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="checkCircle" title={t.p.nothingPending} hint={q ? undefined : t.ui.home.allClear} />
        ))}

      {tab === "item" &&
        (shownItems.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
            {shownItems.map((i) => (
              <li key={`${i.itemId}|${i.unitCode ?? ""}`}>
                <Link href={`/orders?item=${i.itemId}`} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-sunken">
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block font-semibold break-words">{i.itemName}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-subtle">
                      <span className="flex items-center gap-1">
                        <Icon name="users" size={16} />
                        {i.parties} {t.p.parties}
                      </span>
                      <span>
                        · {t.ui.sentOf} <span className="num">{formatQty(i.sent)}</span> {t.ui.of} <span className="num">{formatQty(i.ordered)}</span>
                      </span>
                      {i.overdueLines > 0 && <StatusBadge t={t} status="overdue" size="sm" />}
                    </span>
                  </span>
                  <span className="text-right">
                    <Qty n={formatQty(i.balance)} unit={i.unit} className="text-xl font-bold" />
                    <span className="block text-xs text-ink-subtle">{t.ui.leftShort}</span>
                  </span>
                  <Icon name="chevron" size={20} className="text-ink-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="checkCircle" title={t.p.nothingPending} />
        ))}
    </Page>
  );
}
