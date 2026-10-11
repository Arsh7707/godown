"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/messages";
import { NetworkError, postJson } from "@/client/api";
import { errorText } from "./entry/entry-form";

/** Cancel with a confirm step and optional reason. Used for orders and dispatches. */
export function CancelButton({ t, url, baseRev, label, confirmText }: { t: Messages; url: string; baseRev: number; label: string; confirmText: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="rounded-xl border-2 border-red-200 px-4 py-3 font-semibold text-red-700">
        {label}
      </button>
    );
  return (
    <div className="w-full space-y-3 rounded-2xl border-2 border-red-200 bg-red-50 p-4">
      <p className="text-red-900">{confirmText}</p>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.e.reason} className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3" />
      {error && <p className="text-red-800">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="flex-1 rounded-xl py-3 text-stone-600">
          {t.e.back}
        </button>
        <button
          disabled={busy}
          className="flex-1 rounded-xl bg-red-600 py-3 font-semibold text-white disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            try {
              const r = await postJson(url, { baseRev, reason: reason.trim() || undefined });
              if (!r.ok) return setError(errorText(t, r.code, r.details));
              setOpen(false);
              router.refresh();
            } catch (e) {
              setError(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
            } finally {
              setBusy(false);
            }
          }}
        >
          {label}
        </button>
      </div>
    </div>
  );
}

export function OrderActions({ t, orderId, rev, canChange, canDispatch }: { t: Messages; orderId: string; rev: number; canChange: boolean; canDispatch: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {canDispatch && (
        <Link href={`/dispatch/new?order=${orderId}`} className="flex-1 rounded-xl bg-[#2e7d4f] px-4 py-3 text-center font-semibold text-white">
          🚚 {t.dispatch}
        </Link>
      )}
      {canChange && (
        <>
          <Link href={`/orders/${orderId}/update`} className="flex-1 rounded-xl bg-[#1f4e79] px-4 py-3 text-center font-semibold text-white">
            🎤 {t.o.updateByVoice}
          </Link>
          <Link href={`/orders/${orderId}/edit`} className="rounded-xl border-2 border-stone-300 px-4 py-3 text-center font-semibold">
            {t.e.edit}
          </Link>
          <CancelButton t={t} url={`/api/orders/${orderId}/cancel`} baseRev={rev} label={t.o.cancelOrder} confirmText={t.o.cancelOrderConfirm} />
        </>
      )}
    </div>
  );
}
