"use client";

import type { Lang } from "@/i18n/messages";

/** हिं / EN switch: two 48px-tall halves. */
export function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  const btn = (l: Lang, label: string, name: string) => (
    <button
      type="button"
      onClick={() => onChange(l)}
      aria-pressed={lang === l}
      aria-label={name}
      lang={l}
      className={`min-h-12 min-w-12 rounded-[0.6rem] px-2 text-sm font-bold ${lang === l ? "bg-brand text-ink-inverse" : "text-ink-muted"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex shrink-0 rounded-control border border-line bg-surface p-0.5">
      {btn("hi", "हिं", "हिंदी")}
      {btn("en", "EN", "EN")}
    </div>
  );
}
