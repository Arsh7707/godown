"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { messages, type Lang } from "@/i18n/messages";
import { AliasEditor, HideDelete, mfield, mlabel, useManage } from "@/components/manage-ui";

export function ClientEditor({ lang, party, canDelete }: { lang: Lang; party: { id: string; name: string; phone: string | null; active: boolean; aliases: { id: string; alias: string }[] }; canDelete: boolean }) {
  const t = messages(lang);
  const router = useRouter();
  const [name, setName] = useState(party.name);
  const [phone, setPhone] = useState(party.phone ?? "");
  const { act, busy, message } = useManage(t);
  const changed = name.trim() !== party.name || phone.trim() !== (party.phone ?? "");
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-5 px-4 py-5">
      <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <label className="block space-y-1.5">
          <span className={mlabel}>{t.m.name}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={mfield} />
        </label>
        <label className="block space-y-1.5">
          <span className={mlabel}>{t.m.phone}</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={mfield} />
        </label>
        {name.trim() !== party.name && <p className="text-xs text-stone-500">{t.m.renameNote}</p>}
        <button disabled={busy || !changed || !name.trim()} onClick={() => act({ action: "party.update", id: party.id, name: name.trim(), phone: phone.trim() })} className="w-full rounded-xl bg-[#2e7d4f] py-3 text-lg font-semibold text-white disabled:opacity-40">
          {t.m.save}
        </button>
      </div>
      {message}
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <AliasEditor t={t} aliases={party.aliases} busy={busy} onAdd={(alias) => act({ action: "party.alias.add", id: party.id, alias })} onRemove={(aliasId) => act({ action: "party.alias.remove", aliasId })} />
      </div>
      <Link href={`/pending/party/${party.id}`} className="block rounded-xl border-2 border-stone-300 py-3 text-center font-semibold">
        📋 {t.m.openPending}
      </Link>
      <HideDelete
        t={t}
        busy={busy}
        active={party.active}
        canDelete={canDelete}
        onToggle={() => act({ action: "party.update", id: party.id, active: !party.active })}
        onDelete={() => act({ action: "party.delete", id: party.id }, () => router.push("/manage/clients"))}
      />
    </main>
  );
}
