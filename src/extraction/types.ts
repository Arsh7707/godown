import type { CatalogEntry, MatchResult } from "./matcher";
import type { EntryKind, ModelOutput } from "./schema";

export type ImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export interface Catalog {
  parties: CatalogEntry[];
  items: CatalogEntry[];
}

export interface ExtractorRequest {
  kind: EntryKind;
  catalog: Catalog;
  text?: string | null;
  image?: { data: Buffer; mimeType: ImageMime };
  fromVoice: boolean;
  today: string;
  weekday: string;
}

export interface Extractor {
  extract(req: ExtractorRequest, signal: AbortSignal): Promise<ModelOutput>;
}

export interface TranscriptResult {
  text: string;
  /** BCP-47, e.g. hi-IN, when the provider reports it. */
  languageCode: string | null;
}

/** Speech-to-text provider. Swap implementations without touching the pipeline. */
export interface Transcriber {
  transcribe(audio: { data: Buffer; mimeType: string }, opts: { keyterms?: string[]; signal: AbortSignal }): Promise<TranscriptResult>;
}

export type FailureReason = "timeout" | "error" | "refused" | "not_configured" | "transcription_failed" | "empty_input";

export class ExtractionError extends Error {
  constructor(
    public reason: FailureReason,
    message: string,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

export type IssueCode =
  | "NOT_RELEVANT"
  | "PARTY_MISSING"
  | "PARTY_UNCERTAIN"
  | "NO_LINES"
  | "ITEM_UNCERTAIN"
  | "QTY_MISSING"
  | "QTY_INVALID"
  | "UNIT_MISMATCH"
  | "ENTRY_DATE_FUTURE"
  | "DATE_INVALID"
  | "UNREADABLE";

export interface Issue {
  code: IssueCode;
  /** Blocking issues must be resolved in the form before Confirm is enabled. */
  blocking: boolean;
  /** Which line, for line-level issues. */
  line?: number;
  detail?: string;
}

export interface DraftLine {
  item: MatchResult;
  /** Decimal string ready for the form, e.g. "12.5". */
  quantity: string | null;
  quantityAsWritten: string | null;
  unitSaid: string | null;
  unitExpected: string | null;
  /** Unit to save, as said: null = the item's own unit, or a packing unit ("dabba"). */
  unit: string | null;
}

/** Pre-fill for the manual form. Nothing here is saved until the user confirms. */
export interface Draft {
  kind: EntryKind;
  party: MatchResult;
  lines: DraftLine[];
  /** Defaults to today when not stated. */
  entryDate: string;
  entryDateStated: boolean;
  promisedDate: string | null;
  takenBy: string | null;
  transport: string | null;
  lrNumber: string | null;
  /** Extra details with no field of their own (rate, destination, "transport later"). Saved as the entry's notes. */
  notes: string | null;
  /** Typed text or voice transcript, kept with the entry. */
  sourceText: string | null;
  language: ModelOutput["language"] | null;
  /** Short line about this entry, in the user's language. */
  summary: string | null;
}

/** One party's entry from the input, ready to pre-fill the form. */
export interface DraftEntry {
  draft: Draft;
  /** Issues for this entry; blocking ones must be fixed before it can be confirmed. */
  issues: Issue[];
  readyToConfirm: boolean;
}

export type ExtractionResult =
  | {
      ok: true;
      /** One per party, in the order they appeared. Empty when nothing relevant was found. */
      entries: DraftEntry[];
      /** About the input as a whole (NOT_RELEVANT, UNREADABLE). */
      issues: Issue[];
      language: Draft["language"];
      /** One line for the whole input, in the user's language. */
      summary: string | null;
      /** Plain-English summary of the whole input, shown instead of the raw transcript. */
      summaryEn: string | null;
      sourceText: string | null;
      durationMs: number;
    }
  | {
      ok: false;
      reason: FailureReason;
      message: string;
      /** Empty form with whatever was captured, so the user is never at a dead end. */
      draft: Draft;
      durationMs: number;
    };
