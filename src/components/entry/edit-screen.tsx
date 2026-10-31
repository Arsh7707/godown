"use client";

import { useState } from "react";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import { useCatalog } from "@/client/catalog";
import { TaskHeader } from "./task-header";
import { EntryForm, type FormMode, type SaveOutcome } from "./entry-form";
import type { EntrySource, FormState } from "./form-state";

/** Correcting an existing order or dispatch with the same form used to enter it. */
export function EditScreen({
  kind,
  lang,
  today,
  title,
  initial,
  mode,
  backHref,
  banner,
}: {
  kind: "order" | "dispatch";
  lang: Lang;
  today: string;
  title: string;
  initial: FormState;
  mode: FormMode;
  backHref: string;
  /** Shown above the form, e.g. what a voice update changed. */
  banner?: React.ReactNode;
}) {
  const t = messages(lang);
  const { catalog, addParty, addItem } = useCatalog();
  const [done, setDone] = useState<SaveOutcome | null>(null);
  const source: EntrySource = { entryCaptureId: "edit", captureId: null, inputMethod: "form", sourceAttachmentId: null, sourceText: null };
  return (
    <>
      <TaskHeader title={title} back={backHref} backLabel={t.ui.back} />
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-5">
        {done ? (
          <div className="space-y-4">
            <p className="text-center text-2xl font-bold text-go">✓ {t.e.saved}</p>
            {!("queued" in done) && (
              <div className="space-y-3 rounded-card bg-surface p-4 shadow-card">
                <p className="text-lg">{done.text}</p>
                <a href={done.url} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center rounded-control bg-whatsapp py-4 text-lg font-semibold text-ink-inverse">
                  {t.e.share}
                </a>
              </div>
            )}
            <Link href={backHref} className="block rounded-control bg-brand py-4 text-center text-lg font-semibold text-ink-inverse">
              {t.e.back}
            </Link>
          </div>
        ) : (
          <>
            {banner}
            <EntryForm kind={kind} t={t} today={today} catalog={catalog} addParty={addParty} addItem={addItem} initial={initial} source={source} mode={mode} onSaved={setDone} onCancel={() => history.back()} />
          </>
        )}
      </main>
    </>
  );
}
