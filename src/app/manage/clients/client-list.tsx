"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { messages, type Lang } from "@/i18n/messages";
import { mfield, useManage } from "@/components/manage-ui";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

export function ClientList({ lang, list }: { lang: Lang; list: { id: string; name: string; phone: string | null; active: boolean; aliases: { alias: string }[] }[] }) {
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
    <main className="mx-auto w-full max-w-md flex-1 space-y-3 px-4 py-4">
      <div className="flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t.m.addClient} className={mfield} />
        <button
          disabled={busy || !newName.trim()}
          onClick={() => act({ action: "party.create", name: newName.trim() }, (r) => router.push(`/manage/clients/${r.id}`))}
          className="shrink-0 rounded-xl bg-[#2e7d4f] px-5 text-2xl font-semibold text-white disabled:opacity-40"
        >
          +
        </button>
      </div>
      {message}
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.m.search} className={mfield} />
      <label className="flex items-center justify-end gap-2 text-sm text-stone-500">
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> {t.m.showHidden}
      </label>
      {shown.map((p) => (
        <Link key={p.id} href={`/manage/clients/${p.id}`} className={`block rounded-2xl bg-white p-4 shadow-sm active:bg-stone-50 ${p.active ? "" : "opacity-50"}`}>
          <p className="text-lg font-bold">
            {p.name} {!p.active && <span className="text-sm font-normal text-stone-500">· {t.m.hidden}</span>}
          </p>
          <p className="truncate text-sm text-stone-500">{[p.phone, ...p.aliases.map((a) => a.alias)].filter(Boolean).join(" · ") || "—"}</p>
        </Link>
      ))}
    </main>
  );
}
