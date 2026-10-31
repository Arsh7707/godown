"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/messages";
import { NetworkError, postJson } from "@/client/api";
import { errorText } from "./entry/entry-form";
import { STATE_NAMES } from "@/lib/india";
import { Icon } from "./ui/icons";
import { inputClass } from "./ui/field";

export const mfield = inputClass();
export const mlabel = "block text-sm font-semibold text-ink-muted";

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
  const message = msg && <p className={`rounded-control p-3 ${msg.ok ? "bg-go-soft text-go-strong" : "bg-danger-soft text-danger"}`}>{msg.text}</p>;
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
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-sunken py-1 pl-3 pr-1">
            {a.alias}
            <button aria-label={`${t.m.delete} ${a.alias}`} disabled={busy} onClick={() => onRemove(a.id)} className="flex size-12 items-center justify-center rounded-full text-ink-subtle active:bg-line">
              <Icon name="close" size={18} />
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
          className="shrink-0 rounded-control bg-brand px-5 font-semibold text-ink-inverse disabled:opacity-40"
        >
          {t.m.addName}
        </button>
      </div>
      <p className="text-sm text-ink-subtle">{t.m.extraNamesHint}</p>
    </div>
  );
}

/** Hide/show plus delete-if-unused, with a confirm step for delete. */
export function HideDelete({ t, active, canDelete, onToggle, onDelete, busy }: { t: Messages; active: boolean; canDelete: boolean; onToggle: () => void; onDelete: () => void; busy: boolean }) {
  const [sure, setSure] = useState(false);
  return (
    <div className="space-y-2 border-t border-line pt-4">
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={onToggle} className="rounded-control border-2 border-line-strong px-4 py-3 font-semibold">
          {active ? t.m.hide : t.m.show}
        </button>
        {canDelete && (
          <button disabled={busy} onClick={() => (sure ? onDelete() : setSure(true))} className={`rounded-control px-4 py-3 font-semibold ${sure ? "bg-danger text-ink-inverse" : "border-2 border-danger/30 text-danger"}`}>
            {sure ? t.m.deleteConfirm : t.m.delete}
          </button>
        )}
      </div>
      <p className="text-sm text-ink-subtle">
        {t.m.hideHint} {canDelete ? "" : t.m.cantDelete}
      </p>
    </div>
  );
}

/** City + state (Indian states/UTs, or "Outside India"). */
export function PlaceFields({ t, city, state, onCity, onState }: { t: Messages; city: string; state: string; onCity: (v: string) => void; onState: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block space-y-1.5">
        <span className={mlabel}>{t.m.city}</span>
        <input value={city} onChange={(e) => onCity(e.target.value)} className={mfield} autoComplete="address-level2" />
      </label>
      <label className="block space-y-1.5">
        <span className={mlabel}>{t.m.state}</span>
        <select value={state} onChange={(e) => onState(e.target.value)} className={`${mfield} px-2`}>
          <option value="">{t.m.pickState}</option>
          {STATE_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
