"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { messages, type Lang } from "@/i18n/messages";
import { ReminderSettings } from "./reminder-settings";

export interface MenuInfo {
  role: "owner" | "staff" | "viewer";
  stockKeeper: boolean;
  /** Items low or below zero, shown as a badge on Stock. */
  lowCount: number;
}

/** ☰ button and the panel that slides in from the left with every section of the app. */
export function SideMenu({
  lang,
  companyName,
  userName,
  info,
}: {
  lang: Lang;
  companyName: string;
  userName: string;
  info: MenuInfo;
}) {
  const t = messages(lang);
  const [open, setOpen] = useState(false);
  // The panel is rendered on <body>: the header's blur would otherwise clip a fixed panel to the header.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const pathname = usePathname();
  const router = useRouter();

  // Close on Escape; keep the page behind from scrolling while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const canEnter = info.role !== "viewer";
  const sections: {
    title: string;
    links: {
      href: string;
      icon: string;
      label: string;
      badge?: number;
      show?: boolean;
    }[];
  }[] = [
    {
      title: t.menu.work,
      links: [
        { href: "/", icon: "🏠", label: t.menu.home },
        { href: "/order/new", icon: "📝", label: t.newOrder, show: canEnter },
        {
          href: "/dispatch/new",
          icon: "🚚",
          label: t.dispatch,
          show: canEnter,
        },
        { href: "/pending", icon: "📋", label: t.pending },
        { href: "/stock/in", icon: "📦", label: t.s.goodsIn, show: canEnter },
        { href: "/inbox", icon: "📥", label: t.inbox.title, show: canEnter },
      ],
    },
    {
      title: t.menu.records,
      links: [
        { href: "/dispatches", icon: "🚛", label: t.d.title },
        { href: "/stock", icon: "📦", label: t.s.title, badge: info.lowCount },
        { href: "/history", icon: "📅", label: t.h.title },
      ],
    },
    {
      title: t.m.title,
      links: [
        { href: "/manage/clients", icon: "👥", label: t.m.clients },
        { href: "/manage/items", icon: "🏷️", label: t.m.items },
        { href: "/manage/team", icon: "🧑‍🤝‍🧑", label: t.m.team },
        { href: "/manage/company", icon: "🏢", label: t.m.company },
      ].map((l) => ({ ...l, show: info.role === "owner" })),
    },
  ];
  const roleLabel = {
    owner: t.m.roleOwner,
    staff: t.m.roleStaff,
    viewer: t.m.roleViewer,
  }[info.role];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.menu.open}
        aria-expanded={open}
        className="-ml-2 rounded-lg p-2 text-[#1f4e79] active:bg-stone-100"
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
            aria-hidden={!open}
          >
            <div
              onClick={() => setOpen(false)}
              className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
            />
            <nav
              role="dialog"
              aria-modal="true"
              aria-label={t.menu.open}
              className={`absolute inset-y-0 left-0 flex w-[84%] max-w-80 flex-col bg-stone-50 shadow-xl transition-transform duration-200 ease-out ${open ? "translate-x-0" : "-translate-x-full"}`}
            >
              <div className="flex items-start justify-between gap-3 bg-[#1f4e79] px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold">{companyName}</p>
                  <p className="truncate text-sm opacity-80">
                    {userName} · {roleLabel}
                    {info.stockKeeper ? ` · 📦 ${t.m.stockKeeper}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t.menu.close}
                  className="-mr-2 rounded-lg px-3 py-1 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
                {sections.map((sec) => {
                  const links = sec.links.filter((l) => l.show !== false);
                  if (!links.length) return null;
                  return (
                    <div key={sec.title}>
                      <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
                        {sec.title}
                      </p>
                      {links.map((l) => {
                        const active =
                          l.href === "/"
                            ? pathname === "/"
                            : pathname === l.href;
                        return (
                          <Link
                            key={l.href}
                            href={l.href}
                            onClick={() => setOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={`flex items-center gap-3 rounded-xl px-3 py-3 text-lg ${active ? "bg-[#1f4e79]/10 font-semibold text-[#1f4e79]" : "text-stone-800 active:bg-stone-200"}`}
                          >
                            <span
                              className="w-7 text-center text-xl"
                              aria-hidden
                            >
                              {l.icon}
                            </span>
                            <span className="flex-1">{l.label}</span>
                            {!!l.badge && (
                              <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                                {l.badge}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
                {(info.role === "owner" || info.stockKeeper) && (
                  <div>
                    <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      {t.menu.settings}
                    </p>
                    <ReminderSettings t={t} owner={info.role === "owner"} />
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.replace("/login");
                  router.refresh();
                }}
                className="border-t border-stone-200 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-left text-lg text-stone-600"
              >
                ↪ {t.logout}
              </button>
            </nav>
          </div>,
          document.body,
        )}
    </>
  );
}
