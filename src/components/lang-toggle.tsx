"use client";

import type { Lang } from "@/i18n/messages";

/** हिं / EN switch. */
export function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  const btn = (l: Lang, label: string) => (
    <button
      type="button"
      onClick={() => onChange(l)}
      aria-pressed={lang === l}
      className={`min-w-12 rounded-lg px-3 py-2 text-sm font-semibold ${lang === l ? "bg-[#1f4e79] text-white" : "text-stone-600"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex rounded-xl border border-stone-300 bg-white p-0.5">
      {btn("hi", "हिं")}
      {btn("en", "EN")}
    </div>
  );
}
