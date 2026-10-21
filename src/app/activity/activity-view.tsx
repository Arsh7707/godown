"use client";
import { formatDay, formatTimeIST } from "@/lib/dates";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import type { ActivityEntry, ActivityGroup } from "@/ledger/activity";
import { getJson, NetworkError } from "@/client/api";
import { errorText } from "@/components/entry/entry-form";

const GROUPS: ActivityGroup[] = ["orders", "dispatches", "stock", "clients", "items", "settings", "imports"];
const ICON: Record<string, string> = { order: "📝", dispatch: "🚚", stock: "📦", party: "👥", item: "🏷️", product: "🏷️", user: "🧑", company: "🏢", firm: "🏭", import: "📊" };
const istDay = (d: Date) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const istTime = (d: Date) => formatTimeIST(d);
const dayTitle = (d: string) => formatDay(d, { weekday: true, year: true });

export function ActivityView({ lang, people, today }: { lang: Lang; people: { id: string; name: string; active: boolean }[]; today: string }) {
  const t = messages(lang);
  const [group, setGroup] = useState<ActivityGroup | "">("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (after?: ActivityEntry) => {
      const my = ++seq.current;
      setBusy(true);
      setErr(null);
      const q = new URLSearchParams();
      if (group) q.set("group", group);
      if (userId) q.set("userId", userId);
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      if (after) {
        q.set("beforeAt", new Date(after.at).toISOString());
        q.set("beforeId", after.id);
      }
      try {
        const r = await getJson<{ entries: ActivityEntry[]; more: boolean }>(`/api/activity?${q}`);
        // A newer filter was picked while this was loading: drop this answer.
        if (my !== seq.current) return;
        if (!r.ok) return setErr(errorText(t, r.code));
        setEntries((cur) => (after ? [...cur, ...r.entries] : r.entries));
        setMore(r.more);
      } catch (e) {
        if (my === seq.current) setErr(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
      } finally {
        if (my === seq.current) setBusy(false);
      }
    },
    [group, userId, from, to, t],
  );

  useEffect(() => {
    // Filters changed: start again from the newest.
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const field = (f: string) => t.a.fields[f] ?? f;
  const val = (v: string) => (v === "true" ? t.a.yes : v === "false" ? t.a.no : (t.m[`role${v[0]?.toUpperCase()}${v.slice(1)}` as keyof typeof t.m] as string | undefined) ?? v);
  const chip = (on: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${on ? "bg-[#1f4e79] text-white" : "bg-white text-stone-700 shadow-sm"}`;

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-3 px-4 py-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <button onClick={() => setGroup("")} className={chip(group === "")}>
          {t.a.all}
        </button>
        {GROUPS.map((g) => (
          <button key={g} onClick={() => setGroup(g)} className={chip(group === g)}>
            {t.a.groups[g]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label={t.a.person} className="col-span-3 rounded-xl border border-stone-300 bg-white px-3 py-2.5">
          <option value="">{t.a.everyone}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.active ? "" : ` (${t.a.removed})`}
            </option>
          ))}
        </select>
        <label className="col-span-3 grid grid-cols-2 gap-2 text-xs text-stone-500">
          <span className="space-y-1">
            {t.a.from}
            <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-xl border border-stone-300 bg-white px-2 py-2 text-base text-stone-900" />
          </span>
          <span className="space-y-1">
            {t.a.to}
            <input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} className="w-full rounded-xl border border-stone-300 bg-white px-2 py-2 text-base text-stone-900" />
          </span>
        </label>
        {(group || userId || from || to) && (
          <button
            onClick={() => {
              setGroup("");
              setUserId("");
              setFrom("");
              setTo("");
            }}
            className="col-span-3 text-left text-sm text-stone-500 underline"
          >
            {t.a.clear}
          </button>
        )}
      </div>

      {err && <p className="rounded-xl bg-red-50 p-3 text-red-800">{err}</p>}
      {!busy && !entries.length && !err && <p className="py-12 text-center text-stone-500">{t.a.nothing}</p>}

      {entries.map((e, idx) => {
        const day = istDay(e.at);
        const head = idx === 0 || istDay(entries[idx - 1].at) !== day;
        const kind = e.action.split(".")[0];
        const body = (
          <div className="space-y-1 rounded-2xl bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0">
                <span aria-hidden>{ICON[kind] ?? "•"} </span>
                <b>{t.a.act[e.action] ?? e.action}</b>
                {e.subject && <> · {e.subject}</>}
              </p>
              <span className="shrink-0 text-xs text-stone-400">{istTime(e.at)}</span>
            </div>
            <p className="text-sm text-stone-500">
              {e.by}
              {e.forDate && e.forDate !== day && ` · ${t.a.forDate} ${dayTitle(e.forDate)}`}
            </p>
            {e.lines.length > 0 && <p className="text-sm">{e.lines.map(val).join(" · ")}</p>}
            {e.counts && (
              <p className="text-sm">
                {t.imp.created}: <b>{e.counts.created}</b> · {t.imp.updated}: <b>{e.counts.updated}</b>
              </p>
            )}
            {e.changes.length > 0 && (
              <ul className="space-y-0.5 text-sm">
                {e.changes.map((c, i) => (
                  <li key={i}>
                    <span className="text-stone-500">{field(c.field)}:</span> {c.from !== null ? <s className="text-stone-400">{val(c.from)}</s> : <i className="text-stone-400">{t.a.empty}</i>} → {c.to !== null ? <b>{val(c.to)}</b> : <i className="text-stone-400">{t.a.removedValue}</i>}
                  </li>
                ))}
              </ul>
            )}
            {e.reason && <p className="text-sm italic text-stone-600">“{e.reason}”</p>}
          </div>
        );
        return (
          <div key={e.id} className="space-y-2">
            {head && <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{day === today ? t.p.today : dayTitle(day)}</p>}
            {e.href ? (
              <Link href={e.href} className="block active:opacity-80">
                {body}
              </Link>
            ) : (
              body
            )}
          </div>
        );
      })}
      {busy && <p className="py-4 text-center text-stone-400">…</p>}
      {more && !busy && (
        <button onClick={() => load(entries[entries.length - 1])} className="w-full rounded-xl border-2 border-stone-300 py-3 font-semibold">
          {t.a.older}
        </button>
      )}
    </main>
  );
}
