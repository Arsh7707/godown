"use client";
import { formatDay } from "@/lib/dates";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Button, ButtonLink } from "../ui/button";
import { Notice } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Qty } from "../ui/screen";
import { inputClass } from "../ui/field";
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
    <div className="mb-4 flex items-center justify-between gap-3 rounded-card bg-brand-soft px-4 py-1 font-semibold text-brand-strong">
      <span className="flex items-center gap-2">
        <Icon name="image" size={20} />
        {t.e.photoOf} {photoPos.i + 1}/{photoPos.total}
      </span>
      {nextPhoto !== null && step.s !== "done" && step.s !== "queuedCapture" && (
        <Button variant="ghost" size="md" trailingIcon="arrowRight" onClick={() => showPhoto(nextPhoto)}>
          {t.e.skipPhoto}
        </Button>
      )}
    </div>
  );
  const nextPhotoButton = nextPhoto !== null && (
    <Button variant="primary" size="lg" block icon="image" trailingIcon="arrowRight" onClick={() => showPhoto(nextPhoto)}>
      {t.e.nextPhoto} ({nextPhoto + 1}/{photoPos!.total})
    </Button>
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
        {error && (
          <div className="mb-4">
            <Notice tone="warn" role="alert">
              {error}
            </Notice>
          </div>
        )}
        {step.back?.s === "review" && step.entryIndex !== null && step.back.result.entries.length > 1 && (
          <p className="mb-3 text-sm font-semibold text-ink-subtle">
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
      {!online && (
        <p role="status" className="mb-4 flex items-start gap-3 rounded-card bg-ink p-4 text-base text-ink-inverse">
          <Icon name="wifiOff" size={22} className="mt-0.5" />
          {t.offline}
        </p>
      )}
      {photoBar}
      {error && (
          <div className="mb-4">
            <Notice tone="warn" role="alert">
              {error}
            </Notice>
          </div>
        )}

      {step.s === "queuedCapture" && (
        <div className="space-y-4 py-6 text-center">
          <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-status-pending-bg text-status-pending">
            <Icon name="inbox" size={40} />
          </span>
          <p className="text-lg">{t.e.queuedCapture}</p>
          {nextPhotoButton}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button variant="primary" size="lg" icon="plus" onClick={() => setStep({ s: "capture" })}>
              {t.e.another}
            </Button>
            <ButtonLink href="/" variant="secondary" size="lg" icon="home">
              {t.e.home}
            </ButtonLink>
          </div>
        </div>
      )}

      {step.s === "capture" && nextPhotoButton && <div className="mb-4">{nextPhotoButton}</div>}
      {step.s === "capture" && <CapturePanel t={t} onPhoto={onPhoto} onVoice={onVoice} onImport={onImportMany} onType={() => setStep({ s: "typing" })} />}

      {step.s === "typing" && (
        <div className="space-y-4">
          <textarea autoFocus rows={5} aria-label={t.e.type} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.e.typeHint} className={inputClass(false, "min-h-40")} />
          <Button
            variant="primary"
            size="lg"
            block
            icon="arrowRight"
            disabled={!text.trim()}
            onClick={() => {
              const captureId = newId();
              read({ captureId, inputMethod: "text", attachmentId: null }, { text: text.trim() });
            }}
          >
            {t.e.readIt}
          </Button>
          <Button variant="secondary" size="lg" block icon="edit" onClick={() => manualForm({ s: "typing" })}>
            {t.e.fillForm}
          </Button>
        </div>
      )}

      {step.s === "busy" && (
        <div className="flex flex-col items-center gap-4 py-24 text-ink-muted" role="status" aria-live="polite">
          <div className="size-14 animate-spin rounded-full border-4 border-line border-t-brand" aria-hidden />
          <p className="text-lg">{step.label}</p>
        </div>
      )}

      {step.s === "review" && (
        <div className="space-y-4">
          {step.result.entries.length === 0 ? (
            <div className="space-y-4">
              <Notice tone="info">{t.e.notRelevant}</Notice>
              {step.result.summary && <p className="text-ink-muted">“{step.result.summary}”</p>}
              <Button variant="secondary" size="lg" block icon="edit" onClick={() => manualForm(step)}>
                {t.e.fillForm}
              </Button>
            </div>
          ) : (
            <>
              {step.result.entries.length > 1 && <p className="text-ink-muted">{t.e.checkEachEntry}</p>}
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
        <div className="space-y-4 pb-8">
          <div className="flex flex-col items-center gap-2 py-4 text-center" role="status">
            <span className="flex size-20 items-center justify-center rounded-full bg-status-fulfilled-bg text-status-fulfilled">
              <Icon name="check" size={44} strokeWidth={2.6} />
            </span>
            <p className="text-2xl font-bold text-status-fulfilled">{t.e.saved}</p>
          </div>
          {step.outcomes.map((s, i) =>
            "queued" in s ? (
              <div key={i} className="space-y-1 rounded-card bg-ink p-4 text-ink-inverse">
                <p className="text-lg break-words">{s.label}</p>
                <p className="flex items-center gap-2 text-sm opacity-90">
                  <Icon name="inbox" size={18} />
                  {t.e.queuedSave}
                </p>
              </div>
            ) : (
              <div key={i} className="space-y-3 rounded-card bg-surface p-4 shadow-card">
                <p className="text-lg break-words">{s.text}</p>
                <a href={s.url} target="_blank" rel="noreferrer" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-whatsapp text-lg font-semibold text-ink-inverse shadow-card active:brightness-95">
                  <Icon name="share" size={22} />
                  {t.e.share}
                </a>
                {kind === "order" && s.orderId && (
                  <div className="grid grid-cols-2 gap-3">
                    <ButtonLink href={`/orders/${s.orderId}`} variant="secondary" size="md" icon="orders">
                      {t.o.addedToPending}
                    </ButtonLink>
                    <ButtonLink href={`/dispatch/new?order=${s.orderId}`} variant="go" size="md" icon="truck">
                      {t.o.dispatchNow}
                    </ButtonLink>
                  </div>
                )}
              </div>
            ),
          )}
          {nextPhotoButton}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button
              variant="primary"
              size="lg"
              icon="plus"
              onClick={() => {
                setText("");
                batch.current = null;
                setPhotoPos(null);
                setStep({ s: "capture" });
              }}
            >
              {t.e.another}
            </Button>
            <ButtonLink href={isStock(kind) ? "/stock" : "/"} variant="secondary" size="lg" icon={isStock(kind) ? "stock" : "home"}>
              {isStock(kind) ? t.s.title : t.e.home}
            </ButtonLink>
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
  const recording = state === "recording";
  const tile = "flex min-h-28 flex-col items-center justify-center gap-2 rounded-card px-2 py-4 text-lg font-semibold shadow-card select-none active:scale-[.98] transition-transform";

  return (
    <div className="space-y-4">
      {/* Three ways in, as big as possible: a picture and one word each. */}
      <div className="grid grid-cols-3 gap-3">
        <button type="button" className={`${tile} bg-brand text-ink-inverse`} onClick={() => fileRef.current?.click()}>
          <Icon name="camera" size={40} strokeWidth={1.8} />
          <span className="text-center leading-tight">{t.e.takePhoto}</span>
        </button>
        <button type="button" className={`${tile} ${recording ? "bg-danger text-ink-inverse ring-4 ring-danger/30" : "bg-go text-ink-inverse"}`} onClick={toggle} aria-pressed={recording}>
          <Icon name="mic" size={40} strokeWidth={1.8} className={recording ? "animate-pulse" : ""} />
          <span className="num text-center leading-tight">{recording ? `${Math.floor(elapsed)}s` : t.e.voice}</span>
        </button>
        <button type="button" className={`${tile} border-2 border-line-strong bg-surface text-ink`} onClick={onType}>
          <Icon name="keyboard" size={40} strokeWidth={1.8} />
          <span className="text-center leading-tight">{t.e.type}</span>
        </button>
      </div>
      <p className="text-center text-base text-ink-muted" aria-live="polite">
        {recording ? t.e.releaseToSend : state === "tooShort" ? t.e.holdLonger : t.e.holdToRecord}
      </p>
      {state === "blocked" && (
        <Notice tone="error" role="alert">
          {t.e.micBlocked}
        </Notice>
      )}
      <div className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
        <button type="button" onClick={() => galleryRef.current?.click()} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-sunken">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Icon name="image" size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t.e.gallery}</span>
            <span className="block text-sm text-ink-subtle">{t.e.galleryHint}</span>
          </span>
          <Icon name="chevron" size={20} className="text-ink-subtle" />
        </button>
        <button type="button" onClick={() => importRef.current?.click()} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-sunken">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-go-soft text-go">
            <Icon name="paperclip" size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t.e.importFile}</span>
            <span className="block text-sm text-ink-subtle">{t.e.importHint}</span>
          </span>
          <Icon name="chevron" size={20} className="text-ink-subtle" />
        </button>
      </div>
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
      <div className="flex min-h-14 items-center justify-between gap-3 rounded-card bg-sunken p-4 text-ink-muted">
        <span className="break-words">{isStock(kind) ? title : (partyName ?? d.party.mention ?? "?")}</span>
        <span className={`flex shrink-0 items-center gap-1.5 font-semibold ${status.state === "saved" ? "text-status-fulfilled" : ""}`}>
          {status.state === "saved" && <Icon name={"queued" in status.outcome ? "inbox" : "checkCircle"} size={20} />}
          {status.state === "saved" ? ("queued" in status.outcome ? t.e.queuedShort : t.e.saved) : t.e.skipped}
        </span>
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
    <div className={`space-y-3 rounded-card border-2 bg-surface p-4 shadow-card ${entry.readyToConfirm ? "border-go/40" : "border-status-pending/40"}`}>
      {total > 1 && (
        <p className="text-sm font-semibold text-ink-subtle">
          {t.e.entryOf} {index + 1}/{total}
        </p>
      )}
      {isStock(kind) ? (
        <p className="text-xl font-bold">{title}</p>
      ) : (
        <p className={`text-xl font-bold break-words ${partyName ? "" : "text-status-pending"}`}>{partyName ?? `“${d.party.mention ?? "?"}”`}</p>
      )}
      <ul className="divide-y divide-line">
        {d.lines.map((l, i) => {
          const m = l.item.status === "matched" ? l.item : null;
          return (
            <li key={i} className="flex items-baseline justify-between gap-3 py-2 text-lg">
              <span className={`min-w-0 flex-1 break-words ${m ? "" : "text-status-pending"}`}>{m ? m.name : `“${l.item.mention}”`}</span>
              {/* Show the unit as said; it may differ from the item's unit (flagged below). */}
              <Qty n={l.quantity != null ? String(l.quantity) : "?"} unit={l.unit ?? l.unitSaid ?? (m ? (catalog.items.find((x) => x.id === m.id)?.unit ?? "") : "")} className="text-xl font-bold" />
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-ink-muted">
        {fmtDate(d.entryDate)}
        {d.promisedDate && ` → ${fmtDate(d.promisedDate)}`}
        {[d.takenBy, d.transport, d.lrNumber && `LR ${d.lrNumber}`].filter(Boolean).map((x) => ` · ${x}`)}
      </p>
      {d.notes && (
        <p className="flex gap-2 rounded-control bg-sunken p-3 text-sm text-ink-muted">
          <Icon name="note" size={18} className="mt-0.5" />
          <span className="break-words">{d.notes}</span>
        </p>
      )}
      {entry.issues.length > 0 && (
        <ul className="space-y-1 text-sm">
          {entry.issues.map((i, k) => (
            <li key={k} className={`flex gap-2 ${i.blocking ? "font-semibold text-status-pending" : "text-ink-subtle"}`}>
              <Icon name={i.blocking ? "alert" : "question"} size={16} className="mt-1" />
              {t.issue[i.code] ?? i.code}
              {/* The unclear party/item name is already shown above in orange. */}
              {i.detail && i.code !== "PARTY_UNCERTAIN" && i.code !== "ITEM_UNCERTAIN" ? ` (${i.detail})` : ""}
            </li>
          ))}
        </ul>
      )}
      {plan && <Allocation t={t} plan={plan} itemById={itemById} />}
      {shortfalls.length > 0 && (
        <Notice tone="error" role="alert">
          {shortfalls.map((s) => (
            <p key={unitKey(s.itemId, s.unit)} className="font-semibold">
              {itemById.get(s.itemId)?.name}: {stockPhrase(t, stock[unitKey(s.itemId, s.unit)] ?? 0, unitLabel(s.unit, itemById.get(s.itemId)?.unit ?? ""))}, {fill(t.ui.stock.sending, { n: words(s.quantity, unitLabel(s.unit, itemById.get(s.itemId)?.unit ?? "")) })}
            </p>
          ))}
          {overStockOk && <p className="text-sm">{t.s.tapAgain}</p>}
        </Notice>
      )}
      {error && (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      )}
      <div className="flex gap-2 pt-1">
        <Button variant="ghost" size="md" className="text-ink-muted" onClick={() => onDone({ state: "skipped" })}>
          {t.e.skip}
        </Button>
        <Button variant={blocking.length ? "primary" : "secondary"} size="lg" icon="edit" className="flex-1" onClick={onEdit}>
          {blocking.length ? t.e.needsFix : t.e.edit}
        </Button>
        {entry.readyToConfirm && (
          <Button variant={shortfalls.length && overStockOk ? "destructive" : "go"} size="lg" icon="check" className="flex-1" disabled={busy} onClick={confirm}>
            {busy ? t.e.saving : shortfalls.length && overStockOk ? t.s.sendAnyway : t.e.confirm}
          </Button>
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
    <button type="button" onClick={onEdit} className="flex min-h-12 w-full items-center gap-2 rounded-control bg-brand-soft p-3 text-left text-sm text-brand-strong">
      <Icon name="question" size={18} />
      <span className="flex-1">
        {t.e.unmatchedOffer} {formatQty(n.qty)}
      </span>
      <b>{t.e.edit}</b>
      <Icon name="chevron" size={16} />
    </button>
  );
}
