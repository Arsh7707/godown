"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/messages";
import { NetworkError, postJson } from "@/client/api";
import { errorText } from "./entry/entry-form";
import { Button, ButtonLink, type ButtonSize } from "./ui/button";
import { BottomSheet } from "./ui/sheet";
import { Field, TextInput } from "./ui/field";
import { Notice, useToast } from "./ui/feedback";

/** Cancel with a confirm sheet and optional reason. Used for orders and dispatches. */
export function CancelButton({ t, url, baseRev, label, confirmText, size = "md", block = false }: { t: Messages; url: string; baseRev: number; label: string; confirmText: string; size?: ButtonSize; block?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button variant="destructiveSoft" size={size} block={block} icon="ban" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        closeLabel={t.ui.close}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              {t.e.back}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              className="flex-1"
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await postJson(url, { baseRev, reason: reason.trim() || undefined });
                  if (!r.ok) return setError(errorText(t, r.code, r.details));
                  setOpen(false);
                  toast(label);
                  router.refresh();
                } catch (e) {
                  setError(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {label}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pt-1">
          <p className="text-base">{confirmText}</p>
          <Field label={t.e.reason}>
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.e.reasonHint} />
          </Field>
          {error && (
            <Notice tone="error" role="alert">
              {error}
            </Notice>
          )}
        </div>
      </BottomSheet>
    </>
  );
}

/** Less frequent things to do with an order; Dispatch is the screen's main button. */
export function OrderActions({ t, orderId, rev, canChange }: { t: Messages; orderId: string; rev: number; canChange: boolean }) {
  if (!canChange) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      <ButtonLink href={`/orders/${orderId}/edit`} variant="secondary" size="md" icon="edit">
        {t.e.edit}
      </ButtonLink>
      <ButtonLink href={`/orders/${orderId}/update`} variant="secondary" size="md" icon="mic">
        {t.o.updateByVoice}
      </ButtonLink>
      <div className="col-span-2">
        <CancelButton t={t} url={`/api/orders/${orderId}/cancel`} baseRev={rev} label={t.o.cancelOrder} confirmText={t.o.cancelOrderConfirm} block />
      </div>
    </div>
  );
}
