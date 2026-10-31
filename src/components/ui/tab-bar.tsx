"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";

export type TabLabels = { home: string; orders: string; pending: string; stock: string; nav: string };

const TABS: { key: keyof Omit<TabLabels, "nav">; href: string; icon: IconName; match: (p: string) => boolean }[] = [
  { key: "home", href: "/", icon: "home", match: (p) => p === "/" },
  { key: "orders", href: "/orders", icon: "orders", match: (p) => p.startsWith("/orders") },
  { key: "pending", href: "/pending", icon: "pending", match: (p) => p.startsWith("/pending") },
  { key: "stock", href: "/stock", icon: "stock", match: (p) => p === "/stock" || p.startsWith("/stock/item") },
];

/** Full-screen tasks (entering, editing, logging in) hide the tab bar and show their own Save bar. */
const HIDDEN = [/^\/login/, /^\/order\/new/, /^\/dispatch\/new/, /^\/stock\/in/, /^\/stock\/new-product/, /\/edit$/, /\/update$/, /^\/share/];

/** Bottom tab bar: the app's main navigation, within thumb reach. */
export function TabBar({ labels }: { labels: TabLabels }) {
  const pathname = usePathname();
  // The tapped tab lights up at once, before the next screen has arrived.
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);
  const pendingHref = tapped && tapped.from === pathname ? tapped.href : null;
  useKeyboardFlag();
  if (HIDDEN.some((r) => r.test(pathname))) return null;
  return (
    <nav data-tabbar aria-label={labels.nav} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-bar backdrop-blur-md">
      <ul className="mx-auto flex h-[var(--tabbar-height)] max-w-lg">
        {TABS.map((tab) => {
          const active = pendingHref ? tab.href === pendingHref : tab.match(pathname);
          return (
            <li key={tab.key} className="flex-1">
              <Link
                href={tab.href}
                onClick={() => setTapped({ href: tab.href, from: pathname })}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-xs font-semibold ${active ? "text-brand" : "text-ink-subtle"}`}
              >
                <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${active ? "bg-brand-soft" : ""}`}>
                  <Icon name={tab.icon} size={24} strokeWidth={active ? 2.4 : 2} />
                </span>
                <span className="px-1 text-center leading-tight">{labels[tab.key]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * While typing (a text box has focus, so the phone keyboard is up), mark the
 * page so the tab bar and bottom action bars step aside and the keyboard
 * doesn't push them up over the content.
 */
function useKeyboardFlag() {
  useEffect(() => {
    const typing = (el: Element | null) =>
      !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "file", "range", "color"].includes((el as HTMLInputElement).type)));
    const update = () => {
      if (typing(document.activeElement)) document.documentElement.dataset.keyboard = "";
      else delete document.documentElement.dataset.keyboard;
    };
    const onOut = () => setTimeout(update, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", onOut);
      delete document.documentElement.dataset.keyboard;
    };
  }, []);
}
