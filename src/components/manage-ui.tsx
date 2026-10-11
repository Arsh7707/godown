"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/messages";
import { NetworkError, postJson } from "@/client/api";
import { errorText } from "./entry/entry-form";

export const mfield = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg outline-none focus:border-[#1f4e79] disabled:bg-stone-100 disabled:text-stone-500";
export const mlabel = "block text-sm font-medium text-stone-600";

/** Post a Manage action, show its error, refresh the screen. */
export function useManage(t: Messages) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function act(body: Record<string, unknown>, after?: (r: Record<string, unknown>) => void) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postJson<Record<string, unknown>>("/api/manage", body);
      if (!r.ok) return setMsg({ ok: false, text: errorText(t, r.code, r.details) });
      setMsg({ ok: true, text: t.m.saved });
      after?.(r);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN });
    } finally {
      setBusy(false);
    }
  }
  const message = msg && <p className={`rounded-xl p-3 ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>{msg.text}</p>;
  return { act, busy, message };
}

/** Extra names (aliases) with add and remove. */
export function AliasEditor({ t, aliases, onAdd, onRemove, busy }: { t: Messages; aliases: { id: string; alias: string }[]; onAdd: (a: string) => void; onRemove: (id: string) => void; busy: boolean }) {
  const [v, setV] = useState("");
  return (
    <div className="space-y-2">
      <span className={mlabel}>{t.m.extraNames}</span>
      <div className="flex flex-wrap gap-2">
        {aliases.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-1 pl-3 pr-1">
            {a.alias}
            <button aria-label={`${t.m.delete} ${a.alias}`} disabled={busy} onClick={() => onRemove(a.id)} className="rounded-full px-2 text-lg leading-none text-stone-500">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={v} onChange={(e) => setV(e.target.value)} className={mfield} />
        <button
          disabled={busy || !v.trim()}
          onClick={() => {
            onAdd(v.trim());
            setV("");
          }}
          className="shrink-0 rounded-xl bg-[#1f4e79] px-5 font-semibold text-white disabled:opacity-40"
        >
          {t.m.addName}
        </button>
      </div>
      <p className="text-xs text-stone-500">{t.m.extraNamesHint}</p>
    </div>
  );
}

/** Hide/show plus delete-if-unused, with a confirm step for delete. */
export function HideDelete({ t, active, canDelete, onToggle, onDelete, busy }: { t: Messages; active: boolean; canDelete: boolean; onToggle: () => void; onDelete: () => void; busy: boolean }) {
  const [sure, setSure] = useState(false);
  return (
    <div className="space-y-2 border-t border-stone-200 pt-4">
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={onToggle} className="rounded-xl border-2 border-stone-300 px-4 py-3 font-semibold">
          {active ? t.m.hide : t.m.show}
        </button>
        {canDelete && (
          <button disabled={busy} onClick={() => (sure ? onDelete() : setSure(true))} className={`rounded-xl px-4 py-3 font-semibold ${sure ? "bg-red-600 text-white" : "border-2 border-red-200 text-red-700"}`}>
            {sure ? t.m.deleteConfirm : t.m.delete}
          </button>
        )}
      </div>
      <p className="text-xs text-stone-500">
        {t.m.hideHint} {canDelete ? "" : t.m.cantDelete}
      </p>
    </div>
  );
}
