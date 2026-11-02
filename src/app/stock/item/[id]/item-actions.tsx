"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/messages";
import { NetworkError, newId, postJson } from "@/client/api";
import { errorText } from "@/components/entry/entry-form";
import { todayIST } from "@/lib/dates";
import { unitChoices } from "@/lib/units";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";

const field = inputClass();

/** Adjust (+/−) with a reason; owners also set the alert level and extra names. */
export function ItemStockActions({ t, itemId, unit, lowLevel, canEnter, isOwner }: { t: Messages; itemId: string; unit: string; lowLevel: string; canEnter: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState("");
  const [adjUnit, setAdjUnit] = useState<string>("");
  const [reason, setReason] = useState("");
  const [level, setLevel] = useState(lowLevel);
  const [alias, setAlias] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(url: string, body: unknown, after: () => void) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postJson(url, body);
      if (!r.ok) return setMsg(errorText(t, r.code, r.details));
      after();
      router.refresh();
    } catch (e) {
      setMsg(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
    } finally {
      setBusy(false);
    }
  }

  if (!canEnter) return null;
  return (
    <div className="space-y-3">
      <details className="rounded-card bg-surface px-4 shadow-card">
        <summary className="flex min-h-14 cursor-pointer items-center gap-3 font-semibold"><Icon name="edit" size={22} className="text-ink-subtle" />{t.s.adjust}</summary>
        <div className="space-y-3 pb-4">
          <div className="relative">
            <input inputMode="text" aria-label={t.s.adjustHint} value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.+-]/g, ""))} placeholder={t.s.adjustHint} className={field} />
          </div>
          <select value={adjUnit} onChange={(e) => setAdjUnit(e.target.value)} aria-label={t.e.unitLabel} className={field}>
            {unitChoices(unit).map((c) => (
              <option key={c.value ?? ""} value={c.value ?? ""}>
                {c.label}
              </option>
            ))}
          </select>
          <input aria-label={t.s.adjustReason} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.s.adjustReason} className={field} />
          <button
            disabled={busy || !/^[+-]?\d+(\.\d{1,2})?$/.test(qty) || Number(qty) === 0}
            onClick={() =>
              run("/api/stock", { entryCaptureId: newId(), kind: "adjustment", date: todayIST(), notes: reason.trim() || null, lines: [{ itemId, quantity: qty, unit: adjUnit || null }] }, () => {
                setQty("");
                setReason("");
              })
            }
            className="flex min-h-14 w-full items-center justify-center rounded-control bg-brand text-lg font-semibold text-ink-inverse disabled:opacity-50"
          >
            {t.e.save}
          </button>
        </div>
      </details>

      {isOwner && (
        <details className="rounded-card bg-surface px-4 shadow-card">
          <summary className="flex min-h-14 cursor-pointer items-center gap-3 font-semibold"><Icon name="alert" size={22} className="text-ink-subtle" />{t.s.alertLevel}</summary>
          <div className="space-y-3 pb-4">
            <div className="flex gap-2">
              <input inputMode="decimal" aria-label={t.s.alertLevel} value={level} onChange={(e) => setLevel(e.target.value.replace(/[^\d.]/g, ""))} className={field} />
              <button disabled={busy || !level} onClick={() => run(`/api/items/${itemId}/settings`, { lowStockLevel: level }, () => {})} className="min-h-14 min-w-14 shrink-0 rounded-control bg-brand px-5 font-semibold text-ink-inverse disabled:opacity-50">
                {t.s.saveLevel}
              </button>
            </div>
            <label className="block space-y-1">
              <span className="text-sm font-semibold text-ink-muted">{t.s.addAlias}</span>
              <div className="flex gap-2">
                <input value={alias} onChange={(e) => setAlias(e.target.value)} className={field} />
                <button disabled={busy || !alias.trim()} onClick={() => run(`/api/items/${itemId}/settings`, { addAliases: [alias.trim()] }, () => setAlias(""))} className="min-h-14 min-w-14 shrink-0 rounded-control bg-brand px-5 font-semibold text-ink-inverse disabled:opacity-50">
                  +
                </button>
              </div>
            </label>
          </div>
        </details>
      )}
      {msg && (
        <Notice tone="error" role="alert">
          {msg}
        </Notice>
      )}
    </div>
  );
}

export function UndoStockButton({ t, batchId }: { t: Messages; batchId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      <Button
        variant={confirming ? "destructive" : "secondary"}
        size="md"
        icon="undo"
        onClick={async () => {
          if (!confirming) return setConfirming(true);
          const r = await postJson(`/api/stock/${batchId}/reverse`, {}).catch(() => null);
          if (r && !r.ok) return setErr(errorText(t, r.code));
          router.refresh();
        }}
      >
        {confirming ? `${t.s.undo}?` : t.s.undo}
      </Button>
      {err && <span className="text-sm text-danger">{err}</span>}
    </span>
  );
}
