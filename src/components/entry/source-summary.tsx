import type { Messages } from "@/i18n/messages";

/**
 * What the AI understood, in plain English, with the exact transcript or
 * message one tap away. Without a summary (reading failed) the text is shown
 * open, since the user fills the form from it.
 */
export function SourceSummary({ t, summary, text }: { t: Messages; summary: string | null | undefined; text: string | null | undefined }) {
  if (!summary && !text) return null;
  return (
    <div className="space-y-2 rounded-card bg-sunken p-4 text-sm text-ink-muted">
      {summary && (
        <p>
          <b>{t.e.summaryLabel}:</b> {summary}
        </p>
      )}
      {text && (
        <details open={!summary}>
          <summary className="flex min-h-12 cursor-pointer items-center font-semibold text-brand">{t.e.whatWasHeard}</summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-ink">{text}</p>
        </details>
      )}
    </div>
  );
}
