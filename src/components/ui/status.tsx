import type { Messages } from "@/i18n/messages";
import { Icon, type IconName } from "./icons";

/**
 * Where an order (or a line of one) stands. Shown on screen as icon + word +
 * colour, so it reads without colour too. Derived from the numbers, never stored:
 * an open order with nothing left to send shows as Fulfilled.
 */
export type OrderStatus = "pending" | "partial" | "fulfilled" | "overdue" | "cancelled";

export function orderStatus(o: { cancelled?: boolean; overdue?: boolean; lines: { sent: number; balance: number }[] }): OrderStatus {
  if (o.cancelled) return "cancelled";
  const left = o.lines.some((l) => l.balance > 0);
  if (!left) return "fulfilled";
  if (o.overdue) return "overdue";
  return o.lines.some((l) => l.sent > 0) ? "partial" : "pending";
}

const LOOK: Record<OrderStatus, { icon: IconName; cls: string; text: string }> = {
  pending: { icon: "circle", cls: "bg-status-pending-bg text-status-pending", text: "text-status-pending" },
  partial: { icon: "halfCircle", cls: "bg-status-partial-bg text-status-partial", text: "text-status-partial" },
  fulfilled: { icon: "checkCircle", cls: "bg-status-fulfilled-bg text-status-fulfilled", text: "text-status-fulfilled" },
  overdue: { icon: "alert", cls: "bg-status-overdue-bg text-status-overdue", text: "text-status-overdue" },
  cancelled: { icon: "ban", cls: "bg-status-cancelled-bg text-status-cancelled", text: "text-status-cancelled" },
};

export const statusText = (s: OrderStatus) => LOOK[s].text;

export function statusLabel(t: Messages, s: OrderStatus) {
  return t.ui.status[s];
}

export function StatusBadge({ t, status, size = "md" }: { t: Messages; status: OrderStatus; size?: "sm" | "md" }) {
  const l = LOOK[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ${l.cls} ${size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"}`}>
      <Icon name={l.icon} size={size === "sm" ? 14 : 16} strokeWidth={2.4} />
      {statusLabel(t, status)}
    </span>
  );
}

/** A plain count badge (e.g. on a tab or menu row). */
export function CountBadge({ n, label }: { n: number; label: string }) {
  if (!n) return null;
  return (
    <span aria-label={label} className="inline-flex min-w-6 items-center justify-center rounded-full bg-danger px-1.5 text-xs leading-6 font-bold text-ink-inverse">
      {n > 99 ? "99+" : n}
    </span>
  );
}
