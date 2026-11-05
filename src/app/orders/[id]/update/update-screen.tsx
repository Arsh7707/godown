"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import type { ChangeProposal } from "@/extraction/change";
import { NetworkError, newId, postJson, upload } from "@/client/api";
import { useRecorder } from "@/client/media";
import { EditScreen } from "@/components/entry/edit-screen";
import { CancelButton } from "@/components/order-actions";

type Step = { s: "capture" } | { s: "busy" } | { s: "proposal"; p: ChangeProposal; rev: number };

/** Change an order by saying or typing what changed. */
export function UpdateScreen(props: {
  lang: Lang;
  today: string;
  orderId: string;
  rev: number;
  partyId: string;
  partyName: string;
  orderDate: string;
  notes: string | null;
  lines: string[];
}) {
  const t = messages(props.lang);
  const [step, setStep] = useState<Step>({ s: "capture" });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const back = `/orders/${props.orderId}`;

  const interpret = useCallback(
    async (body: Record<string, unknown>) => {
      setStep({ s: "busy" });
      setError(null);
      try {
        const r = await postJson<{ proposal: ChangeProposal; rev: number }>(`/api/orders/${props.orderId}/interpret`, { captureId: newId(), ...body });
        if (!r.ok) {
          setError(r.code === "EMPTY" ? t.o.noChange : (t.err[r.code] ?? t.e.readFailed));
          return setStep({ s: "capture" });
        }
        if (!r.proposal.understood) {
          setError(t.o.noChange);
          return setStep({ s: "capture" });
        }
        setStep({ s: "proposal", p: r.proposal, rev: r.rev });
      } catch (e) {
        setError(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
        setStep({ s: "capture" });
      }
    },
    [props.orderId, t],
  );

  const onVoice = useCallback(
    async (blob: Blob, seconds: number) => {
      setStep({ s: "busy" });
      try {
        const id = newId();
        const attachmentId = await upload(id, "voice_note", blob);
        await interpret({ audioAttachmentId: attachmentId, audioSeconds: seconds });
      } catch (e) {
        setError(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
        setStep({ s: "capture" });
      }
    },
    [interpret, t],
  );
  const { state, elapsed, toggle } = useRecorder(onVoice);

  if (step.s === "proposal") {
    const p = step.p;
    const banner = (
      <div className="mb-5 space-y-2 rounded-card bg-brand-soft p-4 text-brand-strong">
        <p className="font-semibold">
          {t.o.understood}: {p.summary ?? ""}
        </p>
        {p.changes.length > 0 && (
          <ul className="space-y-0.5 text-sm">
            {p.changes.map((c, i) => (
              <li key={i}>
                {c.itemName}: {c.before ?? "—"} → <b>{c.after ?? "✕"}</b>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs opacity-70">“{p.sourceText}”</p>
      </div>
    );
    if (p.cancelRemaining) {
      return (
        <Shell title={`${t.o.updateTitle}: ${props.partyName}`} back={back} t={t}>
          {banner}
          <p className="mb-3 text-lg">{t.o.willCancel}</p>
          <CancelButton t={t} url={`/api/orders/${props.orderId}/cancel`} baseRev={step.rev} label={t.o.cancelOrder} confirmText={t.o.cancelOrderConfirm} />
          <Link href={back} className="mt-4 block text-center text-brand">
            {t.e.back}
          </Link>
        </Shell>
      );
    }
    return (
      <EditScreen
        kind="order"
        lang={props.lang}
        today={props.today}
        title={`${t.o.updateTitle}: ${props.partyName}`}
        backHref={back}
        banner={banner}
        mode={{ type: "correctOrder", orderId: props.orderId, baseRev: step.rev }}
        initial={{
          partyId: props.partyId,
          partyMention: null,
          partyCandidates: [],
          date: props.orderDate,
          promisedDate: p.promisedDate ?? "",
          takenBy: "",
          transport: "",
          lrNumber: "",
          notes: [props.notes, p.note].filter(Boolean).join("; "),
          lines: p.lines.map((l, i) => ({
            key: l.orderLineId ?? `new${i}`,
            orderLineId: l.orderLineId,
            itemId: l.itemId,
            mention: l.mention,
            candidates: l.candidates,
            quantity: l.quantity,
            unitSaid: l.unitSaid,
            unit: l.unit,
          })),
        }}
      />
    );
  }

  const recording = state === "recording";
  return (
    <Shell title={`${t.o.updateTitle}: ${props.partyName}`} back={back} t={t}>
      <div className="mb-4 rounded-card bg-surface p-4 text-ink-muted shadow-card">
        {props.lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      {error && <p className="mb-4 rounded-control bg-status-pending-bg p-3 text-status-pending">{error}</p>}
      {step.s === "busy" ? (
        <div className="flex flex-col items-center gap-4 py-16 text-ink-muted" aria-live="polite">
          <div className="size-12 animate-spin rounded-full border-4 border-line border-t-brand" />
          <p className="text-lg">{t.e.reading}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-ink-muted">{t.o.updateHint}</p>
          <button
            className={`flex w-full select-none items-center justify-center gap-3 rounded-card py-8 text-2xl font-bold text-ink-inverse shadow-card ${recording ? "bg-danger" : "bg-go"}`}
            onClick={toggle}
          aria-pressed={recording}
          >
            🎤 {recording ? `${Math.floor(elapsed)}s · ${t.e.releaseToSend}` : t.e.holdToRecord}
          </button>
          {state === "tooShort" && <p className="text-center text-ink-muted">{t.e.holdLonger}</p>}
          {state === "blocked" && <p className="rounded-control bg-danger-soft p-3 text-danger">{t.e.micBlocked}</p>}
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.e.type} className="w-full rounded-card border border-line-strong bg-surface p-4 text-lg outline-none focus:border-brand" />
          <button disabled={!text.trim()} onClick={() => interpret({ text: text.trim() })} className="w-full rounded-control bg-brand py-4 text-lg font-semibold text-ink-inverse disabled:opacity-40">
            {t.e.readIt}
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ title, back, t, children }: { title: string; back: string; t: ReturnType<typeof messages>; children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 pb-3 pt-[max(.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <Link href={back} className="-ml-2 rounded-lg px-2 py-1 text-3xl leading-none text-brand" aria-label={t.e.back}>
            ‹
          </Link>
          <h1 className="break-words text-xl font-bold text-brand">{title}</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">{children}</main>
    </>
  );
}
