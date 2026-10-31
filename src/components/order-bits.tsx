import Link from "next/link";
import type { Messages } from "@/i18n/messages";
import { formatDay } from "@/lib/dates";
import { formatQty } from "@/lib/qty";
import { Icon } from "./ui/icons";
import { Qty } from "./ui/screen";
import { orderStatus, StatusBadge, type OrderStatus } from "./ui/status";

type Line = { itemName: string; unit: string; ordered: number; sent: number; balance: number; cancelled?: number };

/** What is left, added up per unit (20 pcs and 2 dabba are never added together). */
export function leftByUnit(lines: Line[]): { n: number; unit: string }[] {
  const m = new Map<string, number>();
  for (const l of lines) if (l.balance > 0) m.set(l.unit, (m.get(l.unit) ?? 0) + l.balance);
  return [...m].map(([unit, n]) => ({ n, unit }));
}

/** Share of the order already sent, 0..1 (each line counts equally, so units never mix). */
export function sentShare(lines: Line[]): number {
  const live = lines.filter((l) => l.ordered - (l.cancelled ?? 0) > 0);
  if (!live.length) return 1;
  return live.reduce((s, l) => s + Math.min(1, l.sent / (l.ordered - (l.cancelled ?? 0))), 0) / live.length;
}

/** The hero number: what is still to send, big, with its unit. */
export function LeftHero({ t, lines, status, size = "row" }: { t: Messages; lines: Line[]; status: OrderStatus; size?: "row" | "hero" }) {
  const left = leftByUnit(lines);
  const big = size === "hero" ? "text-hero" : "text-2xl";
  if (status === "cancelled") return null;
  if (!left.length)
    return (
      <span className={`flex items-center gap-1.5 font-semibold text-status-fulfilled ${size === "hero" ? "text-xl" : "text-base"}`}>
        <Icon name="checkCircle" size={size === "hero" ? 28 : 20} />
        {t.ui.orders.allSent}
      </span>
    );
  return (
    <span className={`flex flex-col ${size === "hero" ? "items-start" : "items-end"}`}>
      {left.map((x) => (
        <Qty key={x.unit} n={formatQty(x.n)} unit={x.unit} className={`${big} font-bold text-ink`} />
      ))}
      <span className="text-sm text-ink-subtle">{t.ui.left}</span>
    </span>
  );
}

export function SentBar({ lines, status, label }: { lines: Line[]; status: OrderStatus; label: string }) {
  const pct = Math.round(sentShare(lines) * 100);
  const color = status === "fulfilled" ? "bg-status-fulfilled" : status === "overdue" ? "bg-status-overdue" : status === "cancelled" ? "bg-status-cancelled" : "bg-status-partial";
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-sunken">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** One order in a list: who, when, what is left (hero), status. Tapping opens it. */
export function OrderRow({
  t,
  o,
  showParty = true,
}: {
  t: Messages;
  o: { orderId: string; partyName?: string; orderDate: string; cancelled?: boolean; overdue: boolean; daysOld: number; lines: Line[] };
  showParty?: boolean;
}) {
  const status = orderStatus(o);
  const done = status === "fulfilled" || status === "cancelled";
  const names = o.lines.map((l) => l.itemName);
  return (
    <Link href={`/orders/${o.orderId}`} className={`block rounded-card bg-surface p-4 shadow-card active:bg-sunken ${done ? "bg-surface/70" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {showParty && <p className="text-lg leading-snug font-bold break-words">{o.partyName}</p>}
          <p className={`break-words text-ink-muted ${showParty ? "text-sm" : "text-base font-semibold"}`}>{names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "")}</p>
          <p className="text-sm text-ink-subtle">
            {formatDay(o.orderDate)}
            {!done && o.daysOld > 0 ? ` · ${o.daysOld} ${t.p.days}` : ""}
          </p>
        </div>
        <LeftHero t={t} lines={o.lines} status={status} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <StatusBadge t={t} status={status} size="sm" />
        {status !== "cancelled" && <SentBar lines={o.lines} status={status} label={t.p.sent} />}
        <Icon name="chevron" size={20} className="text-ink-subtle" />
      </div>
    </Link>
  );
}
