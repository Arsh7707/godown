import Link from "next/link";
import { ctxFor, requireUser } from "@/auth/session";
import { db } from "@/db/client";
import { stockOverview } from "@/stock/service";
import { LiveRefresh } from "@/components/live-refresh";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { LogoutButton } from "@/components/logout-button";
import { InstallPrompt } from "@/components/install-prompt";
import { OutboxStatus } from "@/components/outbox-status";

export default async function Home() {
  const user = await requireUser();
  const t = messages(user.language);
  const lowItems = (await stockOverview(db, ctxFor(user))).filter((r) => r.low || r.inStock < 0);
  const tiles = [
    { href: "/order/new", label: t.newOrder, hint: t.newOrderHint, icon: "📝", cls: "bg-[#1f4e79] text-white" },
    { href: "/dispatch/new", label: t.dispatch, hint: t.dispatchHint, icon: "🚚", cls: "bg-[#2e7d4f] text-white" },
    { href: "/pending", label: t.pending, hint: t.pendingHint, icon: "📋", cls: "bg-white text-stone-900 border-2 border-stone-300" },
  ];
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} />
      <LiveRefresh seconds={30} />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-5">
        <OutboxStatus t={t} />
        {lowItems.length > 0 && (
          <Link href="/stock" className="flex items-center justify-between rounded-2xl bg-red-50 p-4 text-red-900">
            <span className="font-semibold">⚠ {lowItems.length} {t.s.lowCount}</span>
            <span className="truncate pl-3 text-sm">{lowItems.slice(0, 3).map((r) => r.name).join(", ")}</span>
          </Link>
        )}
        {tiles.filter((tile) => user.role !== "viewer" || tile.href === "/pending").map((tile) => (
          <Link key={tile.href} href={tile.href} className={`flex min-h-32 items-center gap-5 rounded-2xl px-6 py-6 shadow-sm active:scale-[.99] ${tile.cls}`}>
            <span className="text-5xl" aria-hidden>
              {tile.icon}
            </span>
            <span>
              <span className="block text-3xl font-bold">{tile.label}</span>
              <span className="block text-base opacity-80">{tile.hint}</span>
            </span>
          </Link>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/dispatches" className="rounded-2xl border-2 border-stone-300 bg-white px-4 py-4 shadow-sm active:scale-[.99]">
            <span className="block text-xl font-bold">🚚 {t.d.title}</span>
            <span className="block text-sm text-stone-500">{t.d.hint}</span>
          </Link>
          <Link href="/stock" className="rounded-2xl border-2 border-stone-300 bg-white px-4 py-4 shadow-sm active:scale-[.99]">
            <span className="block text-xl font-bold">📦 {t.s.title}</span>
            <span className="block text-sm text-stone-500">{t.s.hint}</span>
          </Link>
          {user.role === "owner" && (
            <Link href="/manage" className="col-span-2 rounded-2xl border-2 border-stone-300 bg-white px-4 py-4 shadow-sm active:scale-[.99]">
              <span className="block text-xl font-bold">⚙️ {t.m.title}</span>
              <span className="block text-sm text-stone-500">{t.m.hint}</span>
            </Link>
          )}
        </div>
        <InstallPrompt t={t} />
        <div className="mt-auto">
          <LogoutButton label={t.logout} />
        </div>
      </main>
    </>
  );
}
