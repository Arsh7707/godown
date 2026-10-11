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
  const { state, elapsed, start, stop } = useRecorder(onVoice);

  if (step.s === "proposal") {
    const p = step.p;
    const banner = (
      <div className="mb-5 space-y-2 rounded-2xl bg-sky-50 p-4 text-sky-950">
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
          <Link href={back} className="mt-4 block text-center text-[#1f4e79]">
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
      <div className="mb-4 rounded-2xl bg-white p-4 text-stone-700 shadow-sm">
        {props.lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-amber-900">{error}</p>}
      {step.s === "busy" ? (
        <div className="flex flex-col items-center gap-4 py-16 text-stone-600" aria-live="polite">
          <div className="size-12 animate-spin rounded-full border-4 border-stone-200 border-t-[#1f4e79]" />
          <p className="text-lg">{t.e.reading}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-stone-600">{t.o.updateHint}</p>
          <button
            className={`flex w-full touch-none select-none items-center justify-center gap-3 rounded-2xl py-8 text-2xl font-bold text-white shadow-sm ${recording ? "bg-red-600" : "bg-[#2e7d4f]"}`}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {}
              start();
            }}
            onPointerUp={stop}
            onPointerCancel={stop}
            onContextMenu={(e) => e.preventDefault()}
          >
            🎤 {recording ? `${Math.floor(elapsed)}s · ${t.e.releaseToSend}` : t.e.holdToRecord}
          </button>
          {state === "tooShort" && <p className="text-center text-stone-600">{t.e.holdLonger}</p>}
          {state === "blocked" && <p className="rounded-xl bg-red-50 p-3 text-red-800">{t.e.micBlocked}</p>}
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.e.type} className="w-full rounded-2xl border border-stone-300 bg-white p-4 text-lg outline-none focus:border-[#1f4e79]" />
          <button disabled={!text.trim()} onClick={() => interpret({ text: text.trim() })} className="w-full rounded-xl bg-[#1f4e79] py-4 text-lg font-semibold text-white disabled:opacity-40">
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
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 px-4 pb-3 pt-[max(.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Link href={back} className="-ml-2 rounded-lg px-2 py-1 text-3xl leading-none text-[#1f4e79]" aria-label={t.e.back}>
            ‹
          </Link>
          <h1 className="truncate text-xl font-bold text-[#1f4e79]">{title}</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-5">{children}</main>
    </>
  );
}
