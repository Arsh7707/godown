"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/messages";
import { NetworkError, newId, postJson } from "@/client/api";
import { errorText } from "@/components/entry/entry-form";
import { todayIST } from "@/lib/dates";
import { unitChoices } from "@/lib/units";

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg outline-none focus:border-[#1f4e79]";

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
      <details className="rounded-2xl bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-semibold">± {t.s.adjust}</summary>
        <div className="mt-3 space-y-3">
          <div className="relative">
            <input inputMode="text" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.+-]/g, ""))} placeholder={t.s.adjustHint} className={field} />
          </div>
          <select value={adjUnit} onChange={(e) => setAdjUnit(e.target.value)} aria-label={t.e.unitLabel} className={field}>
            {unitChoices(unit).map((c) => (
              <option key={c.value ?? ""} value={c.value ?? ""}>
                {c.label}
              </option>
            ))}
          </select>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.s.adjustReason} className={field} />
          <button
            disabled={busy || !/^[+-]?\d+(\.\d{1,2})?$/.test(qty) || Number(qty) === 0}
            onClick={() =>
              run("/api/stock", { entryCaptureId: newId(), kind: "adjustment", date: todayIST(), notes: reason.trim() || null, lines: [{ itemId, quantity: qty, unit: adjUnit || null }] }, () => {
                setQty("");
                setReason("");
              })
            }
            className="w-full rounded-xl bg-[#1f4e79] py-3 text-lg font-semibold text-white disabled:opacity-40"
          >
            {t.e.save}
          </button>
        </div>
      </details>

      {isOwner && (
        <details className="rounded-2xl bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold">⚙ {t.s.alertLevel}</summary>
          <div className="mt-3 space-y-3">
            <div className="flex gap-2">
              <input inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value.replace(/[^\d.]/g, ""))} className={field} />
              <button disabled={busy || !level} onClick={() => run(`/api/items/${itemId}/settings`, { lowStockLevel: level }, () => {})} className="rounded-xl bg-[#1f4e79] px-5 font-semibold text-white disabled:opacity-40">
                {t.s.saveLevel}
              </button>
            </div>
            <label className="block space-y-1">
              <span className="text-sm text-stone-600">{t.s.addAlias}</span>
              <div className="flex gap-2">
                <input value={alias} onChange={(e) => setAlias(e.target.value)} className={field} />
                <button disabled={busy || !alias.trim()} onClick={() => run(`/api/items/${itemId}/settings`, { addAliases: [alias.trim()] }, () => setAlias(""))} className="rounded-xl bg-[#1f4e79] px-5 font-semibold text-white disabled:opacity-40">
                  +
                </button>
              </div>
            </label>
          </div>
        </details>
      )}
      {msg && <p className="rounded-xl bg-red-50 p-3 text-red-800">{msg}</p>}
    </div>
  );
}

export function UndoStockButton({ t, batchId }: { t: Messages; batchId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="mt-1 inline-flex items-center gap-2">
      <button
        onClick={async () => {
          if (!confirming) return setConfirming(true);
          const r = await postJson(`/api/stock/${batchId}/reverse`, {}).catch(() => null);
          if (r && !r.ok) return setErr(errorText(t, r.code));
          router.refresh();
        }}
        className={`rounded-lg px-3 py-1 text-sm font-semibold ${confirming ? "bg-red-600 text-white" : "border border-stone-300"}`}
      >
        {confirming ? `${t.s.undo}?` : t.s.undo}
      </button>
      {err && <span className="text-sm text-red-700">{err}</span>}
    </span>
  );
}
