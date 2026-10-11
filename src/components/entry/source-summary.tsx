import type { Messages } from "@/i18n/messages";

/**
 * What the AI understood, in plain English, with the exact transcript or
 * message one tap away. Without a summary (reading failed) the text is shown
 * open, since the user fills the form from it.
 */
export function SourceSummary({ t, summary, text }: { t: Messages; summary: string | null | undefined; text: string | null | undefined }) {
  if (!summary && !text) return null;
  return (
    <div className="space-y-2 rounded-xl bg-stone-100 p-3 text-sm text-stone-700">
      {summary && (
        <p>
          <b>{t.e.summaryLabel}:</b> {summary}
        </p>
      )}
      {text && (
        <details open={!summary}>
          <summary className="cursor-pointer text-stone-500">{t.e.whatWasHeard}</summary>
          <p className="mt-1 whitespace-pre-wrap text-stone-600">{text}</p>
        </details>
      )}
    </div>
  );
}
