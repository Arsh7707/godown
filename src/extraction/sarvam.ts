/**
 * Sarvam AI speech-to-text (https://docs.sarvam.ai), built for Indian
 * languages and code-mixed (Hinglish) speech. Configure with SARVAM_API_KEY;
 * optionally SARVAM_STT_MODEL (default saaras:v4) and SARVAM_LANGUAGE
 * (default "unknown" = auto-detect; or fix it to hi-IN / pa-IN / en-IN).
 */
import { splitWav } from "@/lib/wav";
import { ExtractionError, type Transcriber, type TranscriptResult } from "./types";

const ENDPOINT = "https://api.sarvam.ai/speech-to-text";
/** Sarvam refuses over 30 seconds per request; the phone sends long notes as WAV so they can be cut. */
const MAX_PIECE_SECONDS = 28;
const PARALLEL = 3;
const MAX_KEYTERMS = 50;
const MAX_KEYTERM_LENGTH = 64;

export class SarvamTranscriber implements Transcriber {
  constructor(
    private apiKey = process.env.SARVAM_API_KEY,
    private model = process.env.SARVAM_STT_MODEL ?? "saaras:v4",
    private languageCode = process.env.SARVAM_LANGUAGE || "unknown",
  ) {}

  async transcribe(audio: { data: Buffer; mimeType: string }, opts: { keyterms?: string[]; signal: AbortSignal }): Promise<TranscriptResult> {
    const key = this.apiKey;
    if (!key) throw new ExtractionError("not_configured", "SARVAM_API_KEY is not set");
    const terms = cleanKeyterms(opts.keyterms ?? []);
    const pieces = splitWav(audio.data, MAX_PIECE_SECONDS);
    if (pieces.length === 1) return this.once(key, audio.data, audio.mimeType, terms, opts.signal);

    // A long note: read the pieces a few at a time, then join them in order.
    const results: TranscriptResult[] = new Array(pieces.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < pieces.length; i = next++) results[i] = await this.once(key, pieces[i], "audio/wav", terms, opts.signal);
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, pieces.length) }, worker));
    return {
      text: results.map((r) => r.text).filter(Boolean).join(" "),
      languageCode: results.find((r) => r.languageCode)?.languageCode ?? null,
    };
  }

  private async once(key: string, data: Uint8Array, mimeType: string, terms: string[], signal: AbortSignal): Promise<TranscriptResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), `voice.${extFor(mimeType)}`);
    form.append("model", this.model);
    // Users speak Hindi, Punjabi, English or a mix; "unknown" auto-detects per note.
    form.append("language_code", this.languageCode);
    // keyterms biases recognition toward the company's party and item names (saaras:v4).
    if (terms.length && this.model.startsWith("saaras:v4")) {
      form.append("keyterms", JSON.stringify(terms)); // the API wants one JSON array, not repeated fields
    }

    let res: Response;
    try {
      res = await fetch(ENDPOINT, { method: "POST", headers: { "api-subscription-key": key }, body: form, signal });
    } catch (e) {
      if (signal.aborted) throw new ExtractionError("timeout", "Transcription timed out");
      throw new ExtractionError("transcription_failed", e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Sarvam has its own idea of a "duplicate" name. Rather than lose the note, read it without the names.
      if (res.status === 400 && terms.length && /keyterm/i.test(body)) {
        console.warn(`[voice] Sarvam refused the name list, reading without it: ${body.slice(0, 200)}`);
        return this.once(key, data, mimeType, [], signal);
      }
      throw new ExtractionError(res.status === 401 || res.status === 403 ? "not_configured" : "transcription_failed", `Sarvam ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { transcript?: string; language_code?: string | null };
    return { text: (json.transcript ?? "").trim(), languageCode: json.language_code ?? null };
  }
}

/** Sarvam refuses the whole voice note if a name repeats (a party and an item can share one), so keep each once. */
function cleanKeyterms(keyterms: string[]): string[] {
  const seen = new Set<string>();
  return keyterms
    .map((t) => t.trim())
    .filter((t) => {
      // "D-4012", "d 4012" and "D4012" are one name.
      const key = t.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (!key || t.length > MAX_KEYTERM_LENGTH || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_KEYTERMS);
}

function extFor(mime: string): string {
  const sub = mime.split("/")[1]?.split(";")[0] ?? "webm";
  return sub === "mpeg" ? "mp3" : sub === "x-m4a" || sub === "mp4" ? "m4a" : sub;
}
