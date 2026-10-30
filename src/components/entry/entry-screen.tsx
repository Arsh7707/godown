"use client";
import { formatDay } from "@/lib/dates";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { messages, type Lang, type Messages } from "@/i18n/messages";
import type { DraftEntry, ExtractionResult, Issue } from "@/extraction/types";
import type { DispatchPlan } from "@/ledger/service";
import { formatQty, toCenti } from "@/lib/qty";
import { unitKey, unitLabel } from "@/lib/units";
import { NetworkError, newId, postJson, upload } from "@/client/api";
import { useCatalog, type CatalogItem } from "@/client/catalog";
import { get as outboxGet, put as queue, remove as outboxRemove, useAutoSync } from "@/client/outbox";
import { clearShared, readShared } from "@/client/shared";
import { audioSeconds, compressImage, normalizeAudio, useRecorder } from "@/client/media";
import { Allocation, EntryForm, stockPhrase, type SaveOutcome } from "./entry-form";
import { SourceSummary } from "./source-summary";
import { fill, words } from "@/lib/text";
import { TaskHeader } from "./task-header";
import { emptyForm, extractionKind, formFromDraft, isStock, payload, saveUrl, type EntrySource, type FormKind, type FormState } from "./form-state";

type Kind = FormKind;
interface Capture {
  captureId: string;
  inputMethod: "photo" | "voice" | "text";
  attachmentId: string | null;
}
type BatchReady = { attachmentId: string } | { error: "network" | "other" };
interface BatchPhoto {
  captureId: string;
  blob: Promise<Blob>;
  ready: Promise<BatchReady>;
}
type EntryStatus = { state: "open" } | { state: "saved"; outcome: SaveOutcome } | { state: "skipped" };

type Step =
  | { s: "capture" }
  | { s: "typing" }
  | { s: "busy"; label: string }
  | { s: "review"; capture: Capture; result: Extract<ExtractionResult, { ok: true }>; status: EntryStatus[] }
  | { s: "form"; initial: FormState; source: EntrySource; issues: Issue[]; back: Step | null; entryIndex: number | null }
  | { s: "queuedCapture" }
  | { s: "done"; outcomes: SaveOutcome[] };

export function EntryScreen({
  kind,
  lang,
  today,
  resume,
  fix,
  shared,
  prefill,
  day,
}: {
  kind: Kind;
  lang: Lang;
  today: string;
  /** A past day picked in History: the date for new entries that don't say one. */
  day?: string;
  resume?: string;
  fix?: string;
  shared?: string;
  /** Start in the form, e.g. a dispatch filled from a pending order. */
  prefill?: FormState;
}) {
  const t = messages(lang);
  const startDate = day ?? today;
  const online = useAutoSync();
  const { catalog, addParty, addItem } = useCatalog();
  const [step, setStep] = useState<Step>(() =>
    prefill
      ? { s: "form", initial: prefill, source: { entryCaptureId: newId(), captureId: null, inputMethod: "form", sourceAttachmentId: null, sourceText: null }, issues: [], back: { s: "capture" }, entryIndex: null }
      : { s: "capture" },
  );
  const [text, setText] = useState("");
  // Several photos chosen at once: which one is showing (null = not in a batch).
  const batch = useRef<BatchPhoto[] | null>(null);
  const [photoPos, setPhotoPos] = useState<{ i: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemById = useMemo(() => new Map(catalog.items.map((i) => [i.id, i])), [catalog.items]);

  const manualForm = (back: Step | null = { s: "capture" }) =>
    setStep({
      s: "form",
      initial: emptyForm(startDate),
      source: { entryCaptureId: newId(), captureId: null, inputMethod: "form", sourceAttachmentId: null, sourceText: null },
      issues: [],
      back,
      entryIndex: null,
    });

  /** Send a capture for reading; on any failure drop into the form with what was captured. */
  const read = useCallback(
    async (capture: Capture, body: Record<string, unknown>) => {
      setStep({ s: "busy", label: capture.inputMethod === "voice" ? t.e.readingVoice : t.e.reading });
      setError(null);
      let result: ExtractionResult;
      try {
        const r = await postJson<{ result: ExtractionResult }>("/api/extract", { captureId: capture.captureId, kind: extractionKind(kind), inputMethod: capture.inputMethod, defaultDate: day, ...body });
        if (!r.ok) throw new Error(r.code);
        result = r.result;
      } catch (e) {
        if (e instanceof NetworkError) {
          await queueCapture(capture, body);
          return;
        }
        setError(t.e.readFailed);
        setStep({
          s: "form",
          initial: emptyForm(startDate),
          source: { entryCaptureId: `${capture.captureId}-0`, captureId: capture.captureId, inputMethod: capture.inputMethod, sourceAttachmentId: capture.attachmentId, sourceText: (body.text as string) ?? null },
          issues: [],
          back: null,
          entryIndex: null,
        });
        return;
      }
      if (!result.ok) {
        setError(t.e.readFailed);
        setStep({
          s: "form",
          initial: { ...emptyForm(startDate), notes: "" },
          source: { entryCaptureId: `${capture.captureId}-0`, captureId: capture.captureId, inputMethod: capture.inputMethod, sourceAttachmentId: capture.attachmentId, sourceText: result.draft.sourceText },
          issues: [],
          back: null,
          entryIndex: null,
        });
        return;
      }
      setStep({ s: "review", capture, result, status: result.entries.map(() => ({ state: "open" })) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, t, today, day],
  );

  /** No internet: keep the capture on the phone; it is read when back online and waits in the Inbox. */
  async function queueCapture(capture: Capture, body: Record<string, unknown>, blob?: Blob, blobKind?: "slip_photo" | "voice_note") {
    await queue({
      id: capture.captureId,
      type: "capture",
      kind,
      captureId: capture.captureId,
      inputMethod: capture.inputMethod,
      attachmentId: capture.attachmentId ?? undefined,
      blob: capture.attachmentId ? undefined : blob,
      blobKind: blobKind ?? (capture.inputMethod === "photo" ? "slip_photo" : capture.inputMethod === "voice" ? "voice_note" : undefined),
      text: body.text as string | undefined,
      audioSeconds: body.audioSeconds as number | undefined,
      defaultDate: day,
      state: "queued",
    });
    setStep({ s: "queuedCapture" });
  }

  // Opened from the Inbox: show a capture that was read after coming back online, or fix a queued entry.
  useEffect(() => {
    if (!resume && !fix) return;
    void (async () => {
      const item = await outboxGet((resume ?? fix)!);
      if (!item) return;
      if (item.type === "capture") {
        await read({ captureId: item.captureId, inputMethod: item.inputMethod, attachmentId: item.attachmentId ?? null }, { text: item.text, defaultDate: item.defaultDate });
      } else {
        const b = item.body as ReturnType<typeof payload>;
        setStep({
          s: "form",
          initial: {
            ...emptyForm(startDate),
            partyId: b.partyId,
            date: b.date,
            promisedDate: b.promisedDate ?? "",
            takenBy: b.takenBy ?? "",
            transport: b.transport ?? "",
            lrNumber: b.lrNumber ?? "",
            notes: b.notes ?? "",
            lines: b.lines.map((l, i) => ({ key: `fix${i}`, itemId: l.itemId, mention: null, candidates: [], quantity: l.quantity, unitSaid: null })),
          },
          source: { entryCaptureId: b.entryCaptureId, captureId: b.captureId, inputMethod: b.inputMethod, sourceAttachmentId: b.sourceAttachmentId, sourceText: b.sourceText },
          issues: [],
          back: null,
          entryIndex: null,
        });
        if (item.error) setError(t.err[item.error] ?? t.err.UNKNOWN);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared from WhatsApp: read the voice note / photo / message straight away.
  useEffect(() => {
    if (!shared) return;
    void (async () => {
      const item = await readShared(shared);
      if (!item) return;
      await clearShared(shared);
      if (item.files.length) await onImportMany(item.files);
      else if (item.text.trim()) await read({ captureId: newId(), inputMethod: "text", attachmentId: null }, { text: item.text.trim() });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Finished with an Inbox item: drop it from the phone.
  useEffect(() => {
    if (step.s === "done" && (resume || fix)) void outboxRemove((resume ?? fix)!);
  }, [step.s, resume, fix]);

  async function onPhoto(file: File) {
    const captureId = newId();
    setStep({ s: "busy", label: t.e.uploading });
    const blob = await compressImage(file).catch(() => file);
    try {
      const attachmentId = await upload(captureId, "slip_photo", blob);
      await read({ captureId, inputMethod: "photo", attachmentId }, { imageAttachmentId: attachmentId });
    } catch (e) {
      if (e instanceof NetworkError) return queueCapture({ captureId, inputMethod: "photo", attachmentId: null }, {}, blob, "slip_photo");
      setError(t.err.UNKNOWN);
      setStep({ s: "capture" });
    }
  }

  const onVoice = useCallback(
    async (blob: Blob, seconds: number) => {
      const captureId = newId();
      setStep({ s: "busy", label: t.e.uploading });
      try {
        const attachmentId = await upload(captureId, "voice_note", blob);
        await read({ captureId, inputMethod: "voice", attachmentId }, { audioAttachmentId: attachmentId, audioSeconds: seconds });
      } catch (e) {
        if (e instanceof NetworkError) return queueCapture({ captureId, inputMethod: "voice", attachmentId: null }, { audioSeconds: seconds }, blob, "voice_note");
        setError(t.err.UNKNOWN);
        setStep({ s: "capture" });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [read, t],
  );

  /** A photo or voice note saved from WhatsApp (or anywhere on the phone). */
  async function onImport(file: File) {
    if (file.type.startsWith("image/")) return onPhoto(file);
    const audio = normalizeAudio(file);
    if (audio.type.startsWith("audio/") || /\.(opus|ogg|m4a|mp3|aac|wav|amr)$/i.test(file.name)) return onVoice(audio, await audioSeconds(audio));
    setError(t.e.importUnsupported);
  }

  /** Several files at once (gallery, import, or shared from WhatsApp): photos are read one by one; otherwise the first file. */
  async function onImportMany(files: File[]) {
    const photos = files.filter((f) => f.type.startsWith("image/"));
    if (photos.length > 1) return startPhotoBatch(photos);
    return onImport(photos[0] ?? files[0]);
  }

  /**
   * Several photos: each is its own slip. All are uploaded and read in the
   * background, one after another, while the first one is checked; moving to
   * the next photo then just shows its (already stored) reading.
   */
  function startPhotoBatch(files: File[]) {
    let prev: Promise<unknown> = Promise.resolve();
    const list: BatchPhoto[] = files.map((f) => {
      const captureId = newId();
      const blob = compressImage(f).catch(() => f as Blob);
      const ready = prev.then(async (): Promise<BatchReady> => {
        try {
          const b = await blob;
          const attachmentId = await upload(captureId, "slip_photo", b);
          await postJson("/api/extract", { captureId, kind: extractionKind(kind), inputMethod: "photo", imageAttachmentId: attachmentId, defaultDate: day });
          return { attachmentId };
        } catch (e) {
          return { error: e instanceof NetworkError ? "network" : "other" };
        }
      });
      prev = ready;
      return { captureId, blob, ready };
    });
    batch.current = list;
    void showPhoto(0);
  }

  async function showPhoto(i: number) {
    const p = batch.current?.[i];
    if (!p) {
      batch.current = null;
      setPhotoPos(null);
      return;
    }
    setPhotoPos({ i, total: batch.current!.length });
    setError(null);
    setStep({ s: "busy", label: `${t.e.reading} (${t.e.photoOf} ${i + 1}/${batch.current!.length})` });
    const r = await p.ready;
    if ("attachmentId" in r) return read({ captureId: p.captureId, inputMethod: "photo", attachmentId: r.attachmentId }, { imageAttachmentId: r.attachmentId });
    if (r.error === "network") return queueCapture({ captureId: p.captureId, inputMethod: "photo", attachmentId: null }, {}, await p.blob, "slip_photo");
    setError(t.err.UNKNOWN);
    setStep({ s: "capture" });
  }

  const nextPhoto = photoPos && photoPos.i + 1 < photoPos.total ? photoPos.i + 1 : null;
  const photoBar = photoPos && step.s !== "busy" && (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-[#1f4e79]/10 px-4 py-2.5 font-semibold text-[#1f4e79]">
      <span>
        🖼️ {t.e.photoOf} {photoPos.i + 1}/{photoPos.total}
      </span>
      {nextPhoto !== null && step.s !== "done" && step.s !== "queuedCapture" && (
        <button onClick={() => showPhoto(nextPhoto)} className="text-sm underline">
          {t.e.skipPhoto} →
        </button>
      )}
    </div>
  );
  const nextPhotoButton = nextPhoto !== null && (
    <button onClick={() => showPhoto(nextPhoto)} className="w-full rounded-xl bg-[#1f4e79] py-4 text-lg font-semibold text-white">
      🖼️ {t.e.nextPhoto} ({nextPhoto + 1}/{photoPos!.total}) →
    </button>
  );

  function sourceFor(capture: Capture, result: Extract<ExtractionResult, { ok: true }>, i: number): EntrySource {
    return {
      entryCaptureId: `${capture.captureId}-${i}`,
      captureId: capture.captureId,
      inputMethod: capture.inputMethod,
      sourceAttachmentId: capture.attachmentId,
      sourceText: result.sourceText,
      summaryEn: result.summaryEn,
    };
  }

  function finishIfDone(status: EntryStatus[]) {
    if (status.every((x) => x.state !== "open")) {
      setStep({ s: "done", outcomes: status.flatMap((x) => (x.state === "saved" ? [x.outcome] : [])) });
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- render

  const baseTitle = { order: t.e.newOrderTitle, dispatch: t.e.dispatchTitle, receipt: t.s.goodsIn, count: t.s.count }[kind];
  // Entering for a past day (from History): say which day in the title.
  const title = day ? `${baseTitle} · ${formatDay(day)}` : baseTitle;

  if (step.s === "form") {
    return (
      <Shell t={t} title={title} back={day ? `/history?date=${day}` : isStock(kind) ? "/stock" : "/"}>
        {photoBar}
        {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-amber-900">{error}</p>}
        {step.back?.s === "review" && step.entryIndex !== null && step.back.result.entries.length > 1 && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">
            {t.e.entryOf} {step.entryIndex + 1}/{step.back.result.entries.length}
          </p>
        )}
        <EntryForm
          key={`${step.source.entryCaptureId}`}
          kind={kind}
          t={t}
          today={today}
          catalog={catalog}
          addParty={addParty}
          addItem={addItem}
          initial={step.initial}
          source={step.source}
          issues={step.issues}
          onCancel={() => {
            setError(null);
            setStep(step.back ?? { s: "capture" });
          }}
          onSaved={(outcome) => {
            setError(null);
            const back = step.back;
            if (back?.s === "review" && step.entryIndex !== null) {
              const status = back.status.map((x, i) => (i === step.entryIndex ? ({ state: "saved", outcome } as const) : x));
              if (finishIfDone(status)) return;
              const reviewed = { ...back, status };
              // Jump straight to the next entry that still needs a fix; entries that are ready wait on the list for one-tap Confirm.
              const n = status.length;
              const next = Array.from({ length: n }, (_, k) => (step.entryIndex! + 1 + k) % n).find((i) => status[i].state === "open" && !back.result.entries[i].readyToConfirm);
              if (next === undefined) return setStep(reviewed);
              const e = back.result.entries[next];
              setStep({ s: "form", initial: formFromDraft(e.draft), source: sourceFor(back.capture, back.result, next), issues: e.issues, back: reviewed, entryIndex: next });
            } else {
              setStep({ s: "done", outcomes: [outcome] });
            }
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell t={t} title={title} back={day ? `/history?date=${day}` : isStock(kind) ? "/stock" : "/"}>
      {!online && <p className="mb-4 rounded-xl bg-stone-800 p-3 text-sm text-white">{t.offline}</p>}
      {photoBar}
      {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-amber-900">{error}</p>}

      {step.s === "queuedCapture" && (
        <div className="space-y-4 py-6 text-center">
          <p className="text-5xl">📥</p>
          <p className="text-lg">{t.e.queuedCapture}</p>
          {nextPhotoButton}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button onClick={() => setStep({ s: "capture" })} className="rounded-xl bg-[#1f4e79] py-4 text-lg font-semibold text-white">
              {t.e.another}
            </button>
            <Link href="/" className="rounded-xl border-2 border-stone-300 py-4 text-center text-lg font-semibold">
              {t.e.home}
            </Link>
          </div>
        </div>
      )}

      {step.s === "capture" && nextPhotoButton && <div className="mb-4">{nextPhotoButton}</div>}
      {step.s === "capture" && <CapturePanel t={t} onPhoto={onPhoto} onVoice={onVoice} onImport={onImportMany} onType={() => setStep({ s: "typing" })} />}

      {step.s === "typing" && (
        <div className="space-y-4">
          <textarea autoFocus rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.e.typeHint} className="w-full rounded-2xl border border-stone-300 bg-white p-4 text-lg outline-none focus:border-[#1f4e79]" />
          <button
            disabled={!text.trim()}
            onClick={() => {
              const captureId = newId();
              read({ captureId, inputMethod: "text", attachmentId: null }, { text: text.trim() });
            }}
            className="w-full rounded-xl bg-[#1f4e79] py-4 text-lg font-semibold text-white disabled:opacity-40"
          >
            {t.e.readIt}
          </button>
          <button onClick={() => manualForm({ s: "typing" })} className="w-full rounded-xl border-2 border-stone-300 py-4 text-lg font-semibold text-stone-700">
            {t.e.fillForm}
          </button>
        </div>
      )}

      {step.s === "busy" && (
        <div className="flex flex-col items-center gap-4 py-24 text-stone-600" aria-live="polite">
          <div className="size-12 animate-spin rounded-full border-4 border-stone-200 border-t-[#1f4e79]" />
          <p className="text-lg">{step.label}</p>
        </div>
      )}

      {step.s === "review" && (
        <div className="space-y-4">
          {step.result.entries.length === 0 ? (
            <div className="space-y-4">
              <p className="rounded-2xl bg-stone-100 p-4 text-lg">{t.e.notRelevant}</p>
              {step.result.summary && <p className="text-stone-600">“{step.result.summary}”</p>}
              <button onClick={() => manualForm(step)} className="w-full rounded-xl border-2 border-stone-300 py-4 text-lg font-semibold">
                {t.e.fillForm}
              </button>
            </div>
          ) : (
            <>
              {step.result.entries.length > 1 && <p className="text-stone-600">{t.e.checkEachEntry}</p>}
              {step.result.entries.map((entry, i) => (
                <ReviewCard
                  key={i}
                  t={t}
                  kind={kind}
                  index={i}
                  total={step.result.entries.length}
                  entry={entry}
                  status={step.status[i]}
                  catalog={catalog}
                  itemById={itemById}
                  source={sourceFor(step.capture, step.result, i)}
                  title={title}
                  onEdit={() => setStep({ s: "form", initial: formFromDraft(entry.draft), source: sourceFor(step.capture, step.result, i), issues: entry.issues, back: step, entryIndex: i })}
                  onDone={(st) => {
                    const status = step.status.map((x, j) => (j === i ? st : x));
                    if (!finishIfDone(status)) setStep({ ...step, status });
                  }}
                />
              ))}
              <SourceSummary t={t} summary={step.result.summaryEn} text={step.capture.inputMethod !== "text" ? step.result.sourceText : null} />
            </>
          )}
        </div>
      )}

      {step.s === "done" && (
        <div className="space-y-4">
          <p className="text-center text-2xl font-bold text-[#2e7d4f]">✓ {t.e.saved}</p>
          {step.outcomes.map((s, i) =>
            "queued" in s ? (
              <div key={i} className="space-y-1 rounded-2xl bg-stone-800 p-4 text-white">
                <p className="text-lg">{s.label}</p>
                <p className="text-sm opacity-80">📥 {t.e.queuedSave}</p>
              </div>
            ) : (
              <div key={i} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-lg">{s.text}</p>
                <a href={s.url} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25d366] py-4 text-lg font-semibold text-white">
                  {t.e.share}
                </a>
                {kind === "order" && s.orderId && (
                  <Link href={`/orders/${s.orderId}`} className="block text-center text-[#1f4e79] underline">
                    📋 {t.o.addedToPending}
                  </Link>
                )}
                {kind === "order" && s.orderId && (
                  <Link href={`/dispatch/new?order=${s.orderId}`} className="flex w-full items-center justify-center rounded-xl border-2 border-[#2e7d4f] py-3 text-lg font-semibold text-[#2e7d4f]">
                    🚚 {t.o.dispatchNow}
                  </Link>
                )}
              </div>
            ),
          )}
          {nextPhotoButton}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={() => {
                setText("");
                batch.current = null;
                setPhotoPos(null);
                setStep({ s: "capture" });
              }}
              className="rounded-xl bg-[#1f4e79] py-4 text-lg font-semibold text-white"
            >
              {t.e.another}
            </button>
            <Link href={isStock(kind) ? "/stock" : "/"} className="rounded-xl border-2 border-stone-300 py-4 text-center text-lg font-semibold">
              {isStock(kind) ? t.s.title : t.e.home}
            </Link>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ t, title, children, back = "/" }: { t: Messages; title: string; children: React.ReactNode; back?: string }) {
  return (
    <>
      <TaskHeader title={title} back={back} backLabel={t.ui.back} />
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-5">{children}</main>
    </>
  );
}

function CapturePanel({
  t,
  onPhoto,
  onVoice,
  onImport,
  onType,
}: {
  t: Messages;
  onPhoto: (f: File) => void;
  onVoice: (b: Blob, s: number) => void;
  onImport: (files: File[]) => void;
  onType: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const { state, elapsed, toggle } = useRecorder(onVoice);
  const tile = "flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl text-lg font-semibold shadow-sm select-none active:scale-[.98]";
  const recording = state === "recording";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <button className={`${tile} bg-[#1f4e79] text-white`} onClick={() => fileRef.current?.click()}>
          <span className="text-4xl" aria-hidden>📷</span>
          {t.e.takePhoto}
        </button>
        <button
          className={`${tile} ${recording ? "scale-105 bg-red-600 text-white" : "bg-[#2e7d4f] text-white"}`}
          onClick={toggle}
          aria-pressed={recording}
        >
          <span className="text-4xl" aria-hidden>🎤</span>
          {recording ? `${Math.floor(elapsed)}s` : t.e.voice}
        </button>
        <button className={`${tile} border-2 border-stone-300 bg-white`} onClick={onType}>
          <span className="text-4xl" aria-hidden>⌨️</span>
          {t.e.type}
        </button>
      </div>
      <p className="text-center text-stone-600">{recording ? t.e.releaseToSend : state === "tooShort" ? t.e.holdLonger : t.e.holdToRecord}</p>
      {state === "blocked" && <p className="rounded-xl bg-red-50 p-3 text-red-800">{t.e.micBlocked}</p>}
      <button onClick={() => galleryRef.current?.click()} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#1f4e79]/10 py-4 text-lg font-semibold text-[#1f4e79]">
        🖼️ {t.e.gallery} <span className="text-sm font-normal">· {t.e.galleryHint}</span>
      </button>
      <button onClick={() => importRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-stone-300 py-4 text-lg font-semibold text-stone-700">
        📎 {t.e.importFile}
      </button>
      <p className="text-center text-sm text-stone-500">{t.e.importHint}</p>
      <input
        ref={importRef}
        type="file"
        accept="image/*,audio/*,.opus,.ogg,.m4a,.amr"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onImport(files);
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onImport(files);
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPhoto(f);
        }}
      />
    </div>
  );
}

function ReviewCard({
  t,
  kind,
  index,
  total,
  entry,
  status,
  catalog,
  itemById,
  source,
  onEdit,
  onDone,
  title,
}: {
  title: string;
  t: Messages;
  kind: Kind;
  index: number;
  total: number;
  entry: DraftEntry;
  status: EntryStatus;
  catalog: ReturnType<typeof useCatalog>["catalog"];
  itemById: Map<string, CatalogItem>;
  source: EntrySource;
  onEdit: () => void;
  onDone: (s: EntryStatus) => void;
}) {
  const d = entry.draft;
  const form = useMemo(() => formFromDraft(d), [d]);
  const [plan, setPlan] = useState<DispatchPlan | null>(null);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [overStockOk, setOverStockOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partyName = d.party.status === "matched" ? d.party.name : null;

  useEffect(() => {
    if (kind !== "dispatch" || !entry.readyToConfirm || status.state !== "open") return;
    const p = payload(kind, form, source, false);
    postJson<{ plan: DispatchPlan; stock: Record<string, number> }>("/api/dispatches/preview", { partyId: p.partyId, dispatchDate: p.date, lines: p.lines })
      .then((r) => {
        if (!r.ok) return;
        setPlan(r.plan);
        setStock(r.stock ?? {});
      })
      .catch(() => {});
  }, [kind, entry.readyToConfirm, status.state, form, source]);

  if (status.state !== "open") {
    return (
      <div className="flex items-center justify-between rounded-2xl bg-stone-100 p-4 text-stone-600">
        <span>{isStock(kind) ? title : (partyName ?? d.party.mention ?? "?")}</span>
        <span className={status.state === "saved" ? "font-semibold text-[#2e7d4f]" : ""}>{status.state === "saved" ? ("queued" in status.outcome ? `📥 ${t.e.queuedShort}` : `✓ ${t.e.saved}`) : t.e.skipped}</span>
      </div>
    );
  }

  // Dispatch: more than is in stock needs a second tap.
  const shortfalls = plan ? payload(kind, form, source, false).lines.filter((l) => toCenti(l.quantity) > (stock[unitKey(l.itemId, l.unit)] ?? 0)) : [];

  async function confirm() {
    if (shortfalls.length && !overStockOk) return setOverStockOk(true);
    setBusy(true);
    setError(null);
    const body = payload(kind, form, source, false);
    try {
      const r = await postJson<{ share: { text: string; url: string } }>(saveUrl(kind), body);
      if (r.ok) onDone({ state: "saved", outcome: { ...r.share, orderId: (r.share as { orderId?: string }).orderId } });
      else setError(t.err[r.code] ?? r.message ?? t.err.UNKNOWN);
    } catch (e) {
      if (!(e instanceof NetworkError)) return setError(t.err.UNKNOWN);
      // Confirmed by the user, so it can be sent later as-is.
      const label = `${isStock(kind) ? title : (partyName ?? "?")}: ${d.lines.map((l) => `${l.item.status === "matched" ? l.item.name : "?"} ${l.quantity ?? "?"}`).join(", ")}`;
      await queue({ id: body.entryCaptureId, type: "save", kind, body, label, state: "queued" });
      onDone({ state: "saved", outcome: { queued: true, label } });
    } finally {
      setBusy(false);
    }
  }

  const blocking = entry.issues.filter((i) => i.blocking);
  const fmtDate = (s: string) => formatDay(s, { year: true });

  return (
    <div className={`space-y-3 rounded-2xl border-2 bg-white p-4 shadow-sm ${entry.readyToConfirm ? "border-emerald-300" : "border-amber-300"}`}>
      {total > 1 && (
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
          {t.e.entryOf} {index + 1}/{total}
        </p>
      )}
      {isStock(kind) ? (
        <p className="text-xl font-bold">{title}</p>
      ) : (
        <p className={`text-xl font-bold ${partyName ? "" : "text-amber-800"}`}>{partyName ?? `“${d.party.mention ?? "?"}”`}</p>
      )}
      <ul className="space-y-1">
        {d.lines.map((l, i) => {
          const m = l.item.status === "matched" ? l.item : null;
          return (
            <li key={i} className="flex justify-between gap-3 text-lg">
              <span className={m ? "" : "text-amber-800"}>{m ? m.name : `“${l.item.mention}”`}</span>
              <span className="font-semibold tabular-nums">
                {/* Show the unit as said; it may differ from the item's unit (flagged below). */}
                {l.quantity ?? "?"} {l.unit ?? l.unitSaid ?? (m ? (catalog.items.find((x) => x.id === m.id)?.unit ?? "") : "")}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-stone-600">
        {fmtDate(d.entryDate)}
        {d.promisedDate && ` → ${fmtDate(d.promisedDate)}`}
        {[d.takenBy, d.transport, d.lrNumber && `LR ${d.lrNumber}`].filter(Boolean).map((x) => ` · ${x}`)}
      </p>
      {d.notes && <p className="rounded-lg bg-stone-50 p-2 text-sm text-stone-700">📝 {d.notes}</p>}
      {entry.issues.length > 0 && (
        <ul className="space-y-1 text-sm">
          {entry.issues.map((i, k) => (
            <li key={k} className={i.blocking ? "text-amber-800" : "text-stone-500"}>
              • {t.issue[i.code] ?? i.code}
              {/* The unclear party/item name is already shown above in orange. */}
              {i.detail && i.code !== "PARTY_UNCERTAIN" && i.code !== "ITEM_UNCERTAIN" ? ` (${i.detail})` : ""}
            </li>
          ))}
        </ul>
      )}
      {plan && <Allocation t={t} plan={plan} itemById={itemById} />}
      {shortfalls.length > 0 && (
        <div className="space-y-1 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-red-900">
          {shortfalls.map((s) => (
            <p key={unitKey(s.itemId, s.unit)}>
              {itemById.get(s.itemId)?.name}: {stockPhrase(t, stock[unitKey(s.itemId, s.unit)] ?? 0, unitLabel(s.unit, itemById.get(s.itemId)?.unit ?? ""))}, {fill(t.ui.stock.sending, { n: words(s.quantity, unitLabel(s.unit, itemById.get(s.itemId)?.unit ?? "")) })}
            </p>
          ))}
          {overStockOk && <p className="text-sm">{t.s.tapAgain}</p>}
        </div>
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button onClick={() => onDone({ state: "skipped" })} className="rounded-xl px-3 py-3 text-stone-500">
          {t.e.skip}
        </button>
        <button onClick={onEdit} className={`flex-1 rounded-xl py-3 text-lg font-semibold ${blocking.length ? "bg-amber-500 text-white" : "border-2 border-stone-300"}`}>
          {blocking.length ? t.e.needsFix : t.e.edit}
        </button>
        {entry.readyToConfirm && (
          <button disabled={busy} onClick={confirm} className="flex-1 rounded-xl bg-[#2e7d4f] py-3 text-lg font-semibold text-white disabled:opacity-50">
            {busy ? t.e.saving : shortfalls.length && overStockOk ? t.s.sendAnyway : t.e.confirm}
          </button>
        )}
      </div>
      {kind === "order" && entry.readyToConfirm && <UnmatchedHint t={t} partyId={form.partyId} itemIds={form.lines.map((l) => l.itemId).filter(Boolean) as string[]} onEdit={onEdit} />}
    </div>
  );
}

/** For orders confirmed straight from review: if unmatched goods exist, point to Edit where the offer is. */
function UnmatchedHint({ t, partyId, itemIds, onEdit }: { t: Messages; partyId: string | null; itemIds: string[]; onEdit: () => void }) {
  const [n, setN] = useState<{ qty: number } | null>(null);
  const key = itemIds.join(",");
  useEffect(() => {
    if (!partyId || !key) return;
    const qs = new URLSearchParams([["partyId", partyId], ...key.split(",").map((id) => ["itemId", id])]);
    fetch(`/api/unmatched?${qs}`)
      .then((r) => r.json())
      .then((r) => r.ok && r.unmatched.length && setN({ qty: r.unmatched.reduce((s: number, u: { quantity: number }) => s + u.quantity, 0) }))
      .catch(() => {});
  }, [partyId, key]);
  if (!n) return null;
  return (
    <button onClick={onEdit} className="w-full rounded-xl bg-sky-50 p-3 text-left text-sm text-sky-900">
      {t.e.unmatchedOffer} {formatQty(n.qty)} → <b>{t.e.edit}</b>
    </button>
  );
}
