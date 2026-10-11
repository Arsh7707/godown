"use client";

import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import { remove, useAutoSync, useOutbox, type OutboxItem } from "@/client/outbox";

/** Entries kept on this phone: captures to review, entries waiting to send, and ones the server refused. */
export function InboxView({ lang }: { lang: Lang }) {
  const t = messages(lang);
  const online = useAutoSync();
  const items = useOutbox();
  const when = (ms: number) => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const kindLabel = (k: OutboxItem["kind"]) => ({ order: t.inbox.orderLabel, dispatch: t.inbox.dispatchLabel, receipt: t.s.goodsIn, count: t.s.count })[k];
  const what = (i: OutboxItem) =>
    i.type === "save" ? i.label : { photo: `📷 ${t.inbox.capturePhoto}`, voice: `🎤 ${t.inbox.captureVoice}`, text: `⌨️ ${t.inbox.captureText}` }[i.inputMethod] + (i.text ? `: ${i.text.slice(0, 60)}` : "");

  const row = (i: OutboxItem) => {
    const base = { order: "/order/new", dispatch: "/dispatch/new", receipt: "/stock/in?mode=receipt", count: "/stock/in?mode=count" }[i.kind];
    const link = (param: string) => `${base}${base.includes("?") ? "&" : "?"}${param}=${i.id}`;
    let action: React.ReactNode = null;
    let status = "";
    if (i.state === "queued") status = t.inbox.sending;
    if (i.type === "capture" && i.state === "read")
      action = (
        <Link href={link("resume")} className="rounded-xl bg-[#1f4e79] px-4 py-2.5 font-semibold text-white">
          {t.inbox.review}
        </Link>
      );
    if (i.state === "failed") {
      status = t.err[i.error ?? ""] ?? i.error ?? t.err.UNKNOWN;
      action =
        i.type === "save" ? (
          <Link href={link("fix")} className="rounded-xl bg-amber-500 px-4 py-2.5 font-semibold text-white">
            {t.inbox.fix}
          </Link>
        ) : null;
    }
    if (i.type === "save" && i.state === "done") status = `✓ ${t.inbox.sent}`;
    return (
      <div key={i.id} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex justify-between text-xs uppercase tracking-wide text-stone-400">
          <span>{kindLabel(i.kind)}</span>
          <span>{when(i.createdAt)}</span>
        </div>
        <p className="text-lg">{what(i)}</p>
        <div className="flex items-center justify-between gap-3">
          <span className={`text-sm ${i.state === "failed" ? "text-red-700" : "text-stone-500"}`}>{status}</span>
          <div className="flex items-center gap-2">
            {(i.state === "failed" || (i.type === "save" && i.state === "done")) && (
              <button onClick={() => remove(i.id)} className="px-2 py-2 text-sm text-stone-500">
                {t.inbox.discard}
              </button>
            )}
            {action}
          </div>
        </div>
        {i.type === "save" && i.state === "done" && i.share && (
          <a href={i.share.url} target="_blank" rel="noreferrer" className="block rounded-xl bg-[#25d366] py-3 text-center font-semibold text-white">
            {t.e.share}
          </a>
        )}
      </div>
    );
  };

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-3 px-4 py-4">
      {!online && <p className="rounded-xl bg-stone-800 p-3 text-sm text-white">{t.offline}</p>}
      {items.length ? [...items].reverse().map(row) : <p className="py-16 text-center text-stone-500">{t.inbox.empty}</p>}
    </main>
  );
}
