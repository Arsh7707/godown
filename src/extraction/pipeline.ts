/**
 * Capture → (transcribe) → extract → match → draft.
 *
 * Writes nothing: the result pre-fills the confirm/edit form, and only the
 * user's Confirm saves (through the ledger service). On any failure or
 * timeout it still returns an empty draft carrying whatever was captured, so
 * the app can drop the user into the manual form.
 */
import { todayIST, TZ } from "@/lib/dates";
import { displayScript } from "@/lib/script";
import { buildEntries, emptyDraft } from "./draft";
import type { EntryKind } from "./schema";
import {
  ExtractionError,
  type Catalog,
  type ExtractionResult,
  type Extractor,
  type ImageMime,
  type Transcriber,
} from "./types";

export const IMAGE_MIMES: readonly ImageMime[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
/** Claude's limit is 10 MB base64, about 7.5 MB raw. Phones compress to well under this before upload. */
export const MAX_IMAGE_BYTES = 7_000_000;
export const MAX_AUDIO_BYTES = 10_000_000;
const DEFAULT_TIMEOUT_MS = 45_000;

export interface PipelineDeps {
  extractor: Extractor;
  transcriber: Transcriber;
  /** Overall budget for transcription + extraction. */
  timeoutMs?: number;
  now?: () => Date;
}

export interface PipelineInput {
  kind: EntryKind;
  catalog: Catalog;
  text?: string | null;
  image?: { data: Buffer; mimeType: string };
  audio?: { data: Buffer; mimeType: string };
}

const weekdayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long" });

/** Rejects when the signal fires, even if the underlying call ignores it. */
function bounded<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new ExtractionError("timeout", "Timed out"));
    const onAbort = () => reject(new ExtractionError("timeout", "Timed out"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function keytermsFor(catalog: Catalog): string[] {
  return [...catalog.parties, ...catalog.items].flatMap((e) => [e.name, ...e.aliases]);
}

export async function runExtraction(deps: PipelineDeps, input: PipelineInput): Promise<ExtractionResult> {
  const started = Date.now();
  const now = deps.now?.() ?? new Date();
  const today = todayIST(now);
  const signal = AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  // Punjabi is shown in Hindi script for now (see lib/script.ts).
  const typed = input.text?.trim() ? displayScript(input.text.trim()) : null;
  let sourceText = typed;

  try {
    if (!typed && !input.image && !input.audio) throw new ExtractionError("empty_input", "Nothing to read");
    if (input.image) {
      if (!IMAGE_MIMES.includes(input.image.mimeType as ImageMime)) {
        throw new ExtractionError("error", `Unsupported image type ${input.image.mimeType}`);
      }
      if (input.image.data.length > MAX_IMAGE_BYTES) throw new ExtractionError("error", "Image too large");
    }

    let transcript: string | null = null;
    if (input.audio) {
      if (input.audio.data.length > MAX_AUDIO_BYTES) throw new ExtractionError("error", "Voice note too large");
      const t = await bounded(
        deps.transcriber.transcribe(input.audio, { keyterms: keytermsFor(input.catalog), signal }),
        signal,
      );
      transcript = displayScript(t.text.trim()) || null;
      if (!transcript) throw new ExtractionError("transcription_failed", "Could not hear anything in the voice note");
      sourceText = [typed, transcript].filter(Boolean).join("\n");
    }

    const out = await bounded(
      deps.extractor.extract(
        {
          kind: input.kind,
          catalog: input.catalog,
          text: sourceText,
          image: input.image as { data: Buffer; mimeType: ImageMime } | undefined,
          fromVoice: !!transcript,
          today,
          weekday: weekdayFmt.format(now),
        },
        signal,
      ),
      signal,
    );

    const { entries, issues } = buildEntries(input.kind, out, input.catalog, { today, now, sourceText });
    return {
      ok: true,
      entries,
      issues,
      language: out.language,
      summary: displayScript(out.summary.trim()) || null,
      summaryEn: out.summary_en?.trim() || null,
      sourceText,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    const err =
      e instanceof ExtractionError ? e : new ExtractionError("error", e instanceof Error ? e.message : String(e));
    return {
      ok: false,
      reason: err.reason,
      message: err.message,
      draft: emptyDraft(input.kind, today, sourceText),
      durationMs: Date.now() - started,
    };
  }
}
