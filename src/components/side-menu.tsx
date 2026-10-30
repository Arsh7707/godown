"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { messages, type Lang } from "@/i18n/messages";
import { ReminderSettings } from "./reminder-settings";
import { switchFirm } from "@/client/firm";
import { Icon, type IconName } from "./ui/icons";

export interface MenuInfo {
  role: "owner" | "staff" | "viewer";
  stockKeeper: boolean;
  /** Items low or below zero, shown as a badge on Stock. */
  lowCount: number;
  /** Dispatch lines no order covers (not marked OK), shown as a badge. */
  unmatchedCount: number;
  /** Every firm this person is in (current one included). */
  firms: { companyId: string; name: string; current: boolean }[];
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
  const [firmsOpen, setFirmsOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const otherFirms = info.firms.filter((f) => !f.current);
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
      icon: IconName;
      label: string;
      badge?: number;
      show?: boolean;
    }[];
  }[] = [
    {
      title: t.menu.work,
      links: [
        { href: "/", icon: "home", label: t.menu.home },
        { href: "/order/new", icon: "orders", label: t.newOrder, show: canEnter },
        {
          href: "/dispatch/new",
          icon: "truck",
          label: t.dispatch,
          show: canEnter,
        },
        { href: "/pending", icon: "pending", label: t.pending },
        { href: "/stock/in", icon: "box", label: t.s.goodsIn, show: canEnter },
        { href: "/inbox", icon: "inbox", label: t.inbox.title, show: canEnter },
      ],
    },
    {
      title: t.menu.records,
      links: [
        { href: "/dispatches", icon: "truck", label: t.d.title },
        { href: "/stock", icon: "stock", label: t.s.title, badge: info.lowCount },
        { href: "/history", icon: "history", label: t.h.title },
        { href: "/unmatched", icon: "question", label: t.u.menu, badge: info.unmatchedCount },
        { href: "/reports", icon: "chart", label: t.r.menu, show: info.role !== "staff" },
      ],
    },
    {
      title: t.m.title,
      links: [
        { href: "/manage/clients", icon: "users", label: t.m.clients },
        { href: "/manage/items", icon: "tag", label: t.m.items },
        { href: "/manage/team", icon: "user", label: t.m.team },
        { href: "/manage/company", icon: "building", label: t.m.company },
        { href: "/manage/import", icon: "download", label: t.imp.menu },
        { href: "/activity", icon: "history", label: t.a.menu },
      ].map((l) => ({ ...l, icon: l.icon as IconName, show: info.role === "owner" })),
    },
    {
      title: t.f.title,
      links: [{ href: "/firms", icon: "swap", label: otherFirms.length ? t.f.allFirms : t.f.title }],
    },
  ];
  const roleLabel = {
    owner: t.m.roleOwner,
    staff: t.m.roleStaff,
    viewer: t.m.roleViewer,
  }[info.role];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t.menu.open} aria-expanded={open} className="flex size-12 shrink-0 items-center justify-center rounded-control text-brand active:bg-brand-soft">
        <Icon name="menu" size={26} strokeWidth={2.2} />
      </button>

      {mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
            aria-hidden={!open}
            // Closed: its links can't be reached by keyboard or screen reader either.
            inert={!open}
          >
            <div
              onClick={() => setOpen(false)}
              className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
            />
            <nav
              role="dialog"
              aria-modal="true"
              aria-label={t.menu.open}
              className={`absolute inset-y-0 left-0 flex w-[84%] max-w-80 flex-col bg-canvas shadow-xl transition-transform duration-200 ease-out ${open ? "translate-x-0" : "-translate-x-full"}`}
            >
              <div className="flex items-start justify-between gap-3 bg-brand px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
                <div className="min-w-0">
                  {otherFirms.length ? (
                    <button type="button" onClick={() => setFirmsOpen((v) => !v)} aria-expanded={firmsOpen} className="flex max-w-full items-center gap-2 text-left">
                      <span className="break-words text-lg font-bold">{companyName}</span>
                      <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">⇄ {t.f.switch}</span>
                    </button>
                  ) : (
                    <p className="break-words text-lg font-bold">{companyName}</p>
                  )}
                  <p className="text-sm opacity-90">
                    {userName} · {roleLabel}
                    {info.stockKeeper ? ` · ${t.m.stockKeeper}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t.menu.close}
                  className="-mr-2 flex size-12 shrink-0 items-center justify-center rounded-control"
                >
                  <Icon name="close" size={26} />
                </button>
              </div>

              {firmsOpen && otherFirms.length > 0 && (
                <div className="space-y-1 border-b border-line bg-white px-3 py-3">
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{t.f.switchTo}</p>
                  {otherFirms.map((f) => (
                    <button
                      key={f.companyId}
                      type="button"
                      disabled={!!switching}
                      onClick={async () => {
                        setSwitching(f.companyId);
                        const r = await switchFirm(f.companyId, "/").catch(() => null);
                        if (!r?.ok) setSwitching(null);
                      }}
                      className="flex min-h-12 w-full items-center gap-3 rounded-control px-3 py-3 text-left text-lg active:bg-sunken disabled:opacity-50"
                    >
                      <Icon name="building" size={22} className="text-ink-muted" />
                      <span className="flex-1 break-words">{f.name}</span>
                      {switching === f.companyId && <span className="text-sm text-ink-subtle">…</span>}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
                {sections.map((sec) => {
                  const links = sec.links.filter((l) => l.show !== false);
                  if (!links.length) return null;
                  return (
                    <div key={sec.title}>
                      <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
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
                            className={`flex min-h-12 items-center gap-3 rounded-control px-3 py-2.5 text-lg ${active ? "bg-brand-soft font-semibold text-brand" : "text-ink active:bg-sunken"}`}
                          >
                            <Icon name={l.icon} size={22} className={active ? "text-brand" : "text-ink-muted"} />
                            <span className="flex-1">{l.label}</span>
                            {!!l.badge && (
                              <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-ink-inverse">
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
                    <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
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
                className="flex min-h-14 items-center gap-3 border-t border-line px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-left text-lg text-ink-muted"
              >
                <Icon name="logout" size={22} /> {t.logout}
              </button>
            </nav>
          </div>,
          document.body,
        )}
    </>
  );
}
