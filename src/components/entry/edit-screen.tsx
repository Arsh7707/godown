"use client";

import { useState } from "react";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import { useCatalog } from "@/client/catalog";
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
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 px-4 pb-3 pt-[max(.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Link href={backHref} className="-ml-2 rounded-lg px-2 py-1 text-3xl leading-none text-[#1f4e79]" aria-label={t.e.home}>
            ‹
          </Link>
          <h1 className="truncate text-xl font-bold text-[#1f4e79]">{title}</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-5">
        {done ? (
          <div className="space-y-4">
            <p className="text-center text-2xl font-bold text-[#2e7d4f]">✓ {t.e.saved}</p>
            {!("queued" in done) && (
              <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-lg">{done.text}</p>
                <a href={done.url} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center rounded-xl bg-[#25d366] py-4 text-lg font-semibold text-white">
                  {t.e.share}
                </a>
              </div>
            )}
            <Link href={backHref} className="block rounded-xl bg-[#1f4e79] py-4 text-center text-lg font-semibold text-white">
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
