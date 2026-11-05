"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { messages, type Lang } from "@/i18n/messages";
import { mfield, useManage } from "@/components/manage-ui";
import { Icon } from "@/components/ui/icons";
import { SearchInput } from "@/components/ui/field";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

export function ClientList({ lang, list }: { lang: Lang; list: { id: string; name: string; phone: string | null; city: string | null; active: boolean; aliases: { alias: string }[] }[] }) {
  const t = messages(lang);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hidden, setHidden] = useState(false);
  const [newName, setNewName] = useState("");
  const { act, busy, message } = useManage(t);
  const shown = useMemo(
    () => list.filter((p) => (hidden || p.active) && [p.name, ...p.aliases.map((a) => a.alias)].some((s) => norm(s).includes(norm(q)))),
    [list, q, hidden],
  );
  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-3 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
      <div className="flex gap-2">
        <input aria-label={t.m.addClient} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t.m.addClient} className={mfield} />
        <button
          disabled={busy || !newName.trim()}
          onClick={() => act({ action: "party.create", name: newName.trim() }, (r) => router.push(`/manage/clients/${r.id}`))}
          aria-label={t.m.addClient}
          className="flex min-h-14 min-w-14 shrink-0 items-center justify-center rounded-control bg-go text-ink-inverse disabled:opacity-50"
        >
          <Icon name="plus" size={26} strokeWidth={2.6} />
        </button>
      </div>
      {message}
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.m.search} aria-label={t.m.search} />
      <label className="flex min-h-12 items-center justify-end gap-3 text-base text-ink-muted">
        <input type="checkbox" className="size-6 accent-brand" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> {t.m.showHidden}
      </label>
      {shown.map((p) => (
        <Link key={p.id} href={`/manage/clients/${p.id}`} className={`flex min-h-16 flex-col justify-center rounded-card bg-surface p-4 shadow-card active:bg-sunken ${p.active ? "" : "opacity-60"}`}>
          <p className="text-lg font-bold">
            {p.name} {!p.active && <span className="text-sm font-normal text-ink-subtle">· {t.m.hidden}</span>}
          </p>
          <p className="break-words text-sm text-ink-subtle">{[p.city, p.phone, ...p.aliases.map((a) => a.alias)].filter(Boolean).join(" · ") || "—"}</p>
        </Link>
      ))}
    </main>
  );
}
