/**
 * Sarvam AI speech-to-text (https://docs.sarvam.ai), built for Indian
 * languages and code-mixed (Hinglish) speech. Configure with SARVAM_API_KEY;
 * optionally SARVAM_STT_MODEL (default saaras:v4) and SARVAM_LANGUAGE
 * (default "unknown" = auto-detect; or fix it to hi-IN / pa-IN / en-IN).
 */
import { ExtractionError, type Transcriber, type TranscriptResult } from "./types";

const ENDPOINT = "https://api.sarvam.ai/speech-to-text";
const MAX_KEYTERMS = 50;
const MAX_KEYTERM_LENGTH = 64;

export class SarvamTranscriber implements Transcriber {
  constructor(
    private apiKey = process.env.SARVAM_API_KEY,
    private model = process.env.SARVAM_STT_MODEL ?? "saaras:v4",
    private languageCode = process.env.SARVAM_LANGUAGE || "unknown",
  ) {}

  async transcribe(audio: { data: Buffer; mimeType: string }, opts: { keyterms?: string[]; signal: AbortSignal }): Promise<TranscriptResult> {
    if (!this.apiKey) throw new ExtractionError("not_configured", "SARVAM_API_KEY is not set");

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio.data)], { type: audio.mimeType }), `voice.${extFor(audio.mimeType)}`);
    form.append("model", this.model);
    // Users speak Hindi, Punjabi, English or a mix; "unknown" auto-detects per note.
    form.append("language_code", this.languageCode);
    const terms = (opts.keyterms ?? []).filter((t) => t.length <= MAX_KEYTERM_LENGTH).slice(0, MAX_KEYTERMS);
    // keyterms biases recognition toward the company's party and item names (saaras:v4).
    if (terms.length && this.model.startsWith("saaras:v4")) {
      form.append("keyterms", JSON.stringify(terms)); // the API wants one JSON array, not repeated fields
    }

    let res: Response;
    try {
      res = await fetch(ENDPOINT, { method: "POST", headers: { "api-subscription-key": this.apiKey }, body: form, signal: opts.signal });
    } catch (e) {
      if (opts.signal.aborted) throw new ExtractionError("timeout", "Transcription timed out");
      throw new ExtractionError("transcription_failed", e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ExtractionError(res.status === 401 || res.status === 403 ? "not_configured" : "transcription_failed", `Sarvam ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { transcript?: string; language_code?: string | null };
    return { text: (json.transcript ?? "").trim(), languageCode: json.language_code ?? null };
  }
}

function extFor(mime: string): string {
  const sub = mime.split("/")[1]?.split(";")[0] ?? "webm";
  return sub === "mpeg" ? "mp3" : sub === "x-m4a" || sub === "mp4" ? "m4a" : sub;
}
