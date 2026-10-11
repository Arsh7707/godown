"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Lang } from "@/i18n/messages";
import { LangToggle } from "./lang-toggle";

export function AppHeader({ companyName, userName, lang, back, title }: { companyName: string; userName: string; lang: Lang; back?: string; title?: string }) {
  const router = useRouter();
  async function setLang(l: Lang) {
    await fetch("/api/me/language", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: l }) });
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 px-4 pb-3 pt-[max(.75rem,env(safe-area-inset-top))] backdrop-blur">
      <div className="mx-auto flex max-w-md items-center gap-3">
        {back && (
          <Link href={back} className="-ml-2 rounded-lg p-2 text-2xl leading-none text-[#1f4e79]" aria-label="Back">
            ‹
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-[#1f4e79]">{title ?? companyName}</p>
          {!title && <p className="truncate text-xs text-stone-500">{userName}</p>}
        </div>
        <LangToggle lang={lang} onChange={setLang} />
      </div>
    </header>
  );
}
