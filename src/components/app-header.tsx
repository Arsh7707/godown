"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import { LangToggle } from "./lang-toggle";
import { SideMenu, type MenuInfo } from "./side-menu";
import { Icon } from "./ui/icons";

/**
 * Top bar. Tab screens (no `back`) show a large title with the firm under it;
 * inner screens show a back arrow and the title. The firm is always named,
 * so an entry never goes into the wrong one unnoticed.
 */
export function AppHeader({ companyName, userName, lang, back, title, menu }: { companyName: string; userName: string; lang: Lang; back?: string; title?: string; menu?: MenuInfo }) {
  const router = useRouter();
  const t = messages(lang);
  async function setLang(l: Lang) {
    await fetch("/api/me/language", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: l }) });
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-lg items-center gap-1 px-2">
        {back ? (
          <Link href={back} aria-label={t.ui.back} className="flex size-12 shrink-0 items-center justify-center rounded-control text-brand active:bg-brand-soft">
            <Icon name="back" size={28} strokeWidth={2.4} />
          </Link>
        ) : (
          <span className="w-2" aria-hidden />
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1 className={`font-bold break-words text-ink ${back ? "text-lg leading-snug" : "text-2xl leading-tight"}`}>{title ?? companyName}</h1>
          <p className="flex items-center gap-1 text-sm text-ink-subtle">
            <Icon name="building" size={14} />
            <span className="break-words">{title ? companyName : userName}</span>
          </p>
        </div>
        <LangToggle lang={lang} onChange={setLang} />
        {menu && <SideMenu lang={lang} companyName={companyName} userName={userName} info={menu} />}
      </div>
    </header>
  );
}
