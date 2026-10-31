import Link from "next/link";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { dayEntries, type DayEntry } from "@/ledger/history";
import { addDays, isValidDate, todayIST } from "@/lib/dates";
import { messages, type Messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { DayPicker } from "./day-picker";
import { Icon } from "@/components/ui/icons";

const ICON: Record<DayEntry["kind"], string> = { order: "📝", dispatch: "🚚", receipt: "📦", count: "🔢", adjustment: "±", reversal: "↩️" };
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtTime = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function fixHref(e: DayEntry) {
  if (e.kind === "order") return `/orders/${e.id}/edit`;
  if (e.kind === "dispatch") return `/dispatches/${e.id}/edit`;
  return e.href; // stock: undo from the item's stock card
}

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const user = await requireUser();
  const t = messages(user.language);
  const today = todayIST();
  const sp = await searchParams;
  const asked = typeof sp.date === "string" ? sp.date : "";
  const day = isValidDate(asked) && asked <= today ? asked : today;
  const entries = await dayEntries(db, ctxFor(user), day);
  const q = day === today ? "" : `?date=${day}`;
  const add = [
    { href: `/order/new${q}`, label: t.h.order, icon: "📝" },
    { href: `/dispatch/new${q}`, label: t.h.dispatch, icon: "🚚" },
    { href: `/stock/in${q}`, label: t.h.receipt, icon: "📦" },
  ];
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.h.title} />
      <main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
        <div className="flex items-center gap-2">
          <Link href={`/history?date=${addDays(day, -1)}`} aria-label="previous day" className="rounded-control border-2 border-line-strong bg-surface px-4 py-3 text-lg font-bold">
            ◀
          </Link>
          <DayPicker day={day} today={today} label={t.h.day} />
          {day < today ? (
            <Link href={`/history?date=${addDays(day, 1)}`} aria-label="next day" className="rounded-control border-2 border-line-strong bg-surface px-4 py-3 text-lg font-bold">
              ▶
            </Link>
          ) : (
            <span className="rounded-control border-2 border-line px-4 py-3 text-lg font-bold text-ink-subtle">▶</span>
          )}
        </div>
        <p className="text-center text-lg font-semibold">
          {fmtDay(day)} {day === today && <span className="text-ink-subtle">· {t.h.today}</span>}
        </p>

        {user.role !== "viewer" && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-ink-muted">{t.h.addForDay}</h2>
            <div className="grid grid-cols-3 gap-2">
              {add.map((a) => (
                <Link key={a.href} href={a.href} className="rounded-control bg-brand py-3 text-center font-semibold text-ink-inverse active:scale-[.98]">
                  {a.icon} {a.label}
                </Link>
              ))}
            </div>
          </section>
        )}

        {entries.length === 0 ? (
          <p className="rounded-card bg-surface p-6 text-center text-ink-subtle shadow-card">{t.h.nothing}</p>
        ) : (
          entries.map((e) => <EntryCard key={`${e.kind}-${e.id}`} t={t} e={e} />)
        )}
        <p className="text-sm text-ink-subtle">{t.h.note}</p>
      </main>
    </>
  );
}

function EntryCard({ t, e }: { t: Messages; e: DayEntry }) {
  const off = e.cancelled || e.undone;
  return (
    <div className={`overflow-hidden rounded-card bg-surface shadow-card ${off ? "opacity-60" : ""}`}>
      <Link href={e.href} className="block space-y-1 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-bold">
            {ICON[e.kind]} {t.h[e.kind]}
            {e.partyName && <span className="font-semibold"> · {e.partyName}</span>}
          </span>
          {(e.cancelled || e.edited || e.undone) && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${off ? "bg-danger-soft text-danger" : "bg-status-pending-bg text-status-pending"}`}>
              {e.cancelled ? t.h.cancelled : e.undone ? t.h.undone : t.h.edited}
            </span>
          )}
        </div>
        <p className={`text-ink-muted ${e.cancelled ? "line-through" : ""}`}>{e.lines.join(", ") || "—"}</p>
        <p className="text-sm text-ink-subtle">
          {[t.h.by, e.by].filter(Boolean).join(" ")} · {fmtTime(e.enteredAt)}
        </p>
      </Link>
      {e.canChange && (
        <Link href={fixHref(e)} className="flex min-h-12 items-center justify-center gap-2 border-t border-line bg-status-pending-bg font-semibold text-status-pending">
          <Icon name="edit" size={18} />
          {t.h.fix}
        </Link>
      )}
    </div>
  );
}
