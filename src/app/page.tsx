import Link from "next/link";
import { ctxFor, requireUser } from "@/auth/session";
import { db } from "@/db/client";
import { stockOverview } from "@/stock/service";
import { LiveRefresh } from "@/components/live-refresh";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { InstallPrompt } from "@/components/install-prompt";
import { OutboxStatus } from "@/components/outbox-status";
import { myFirms } from "@/masters/firms";

export default async function Home() {
  const user = await requireUser();
  const t = messages(user.language);
  const [overview, firms] = await Promise.all([stockOverview(db, ctxFor(user)), myFirms(db, user)]);
  const lowItems = overview.filter((r) => r.low || r.inStock < 0);
  const tiles = [
    { href: "/order/new", label: t.newOrder, hint: t.newOrderHint, icon: "📝", cls: "bg-[#1f4e79] text-white" },
    { href: "/dispatch/new", label: t.dispatch, hint: t.dispatchHint, icon: "🚚", cls: "bg-[#2e7d4f] text-white" },
    { href: "/pending", label: t.pending, hint: t.pendingHint, icon: "📋", cls: "bg-white text-stone-900 border-2 border-stone-300" },
  ];
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} menu={{ role: user.role, stockKeeper: user.stockKeeper, lowCount: lowItems.length, firms: firms.map((f) => ({ companyId: f.companyId, name: f.name, current: f.current })) }} />
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
        <InstallPrompt t={t} />
      </main>
    </>
  );
}
