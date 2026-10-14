"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Lang } from "@/i18n/messages";
import { LangToggle } from "./lang-toggle";
import { SideMenu, type MenuInfo } from "./side-menu";

/** Top bar: back arrow on inner screens, or the ☰ menu on Home (pass `menu`). */
export function AppHeader({ companyName, userName, lang, back, title, menu }: { companyName: string; userName: string; lang: Lang; back?: string; title?: string; menu?: MenuInfo }) {
  const router = useRouter();
  async function setLang(l: Lang) {
    await fetch("/api/me/language", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: l }) });
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 px-4 pb-3 pt-[max(.75rem,env(safe-area-inset-top))] backdrop-blur">
      <div className="mx-auto flex max-w-md items-center gap-3">
        {menu && !back && <SideMenu lang={lang} companyName={companyName} userName={userName} info={menu} />}
        {back && (
          <Link href={back} className="-ml-2 rounded-lg p-2 text-2xl leading-none text-[#1f4e79]" aria-label="Back">
            ‹
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-[#1f4e79]">{title ?? companyName}</p>
          {/* Inner screens name the firm too, so an entry never goes into the wrong one unnoticed. */}
          <p className="truncate text-xs text-stone-500">{title ? `🏢 ${companyName}` : userName}</p>
        </div>
        <LangToggle lang={lang} onChange={setLang} />
      </div>
    </header>
  );
}
