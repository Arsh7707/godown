"use client";
import { formatDateTimeIST } from "@/lib/dates";

import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import { remove, useAutoSync, useOutbox, type OutboxItem } from "@/client/outbox";
import { currentFirm } from "@/client/api";
import { switchFirm } from "@/client/firm";

/** Entries kept on this phone: captures to review, entries waiting to send, and ones the server refused. */
export function InboxView({ lang }: { lang: Lang }) {
  const t = messages(lang);
  const online = useAutoSync();
  const items = useOutbox();
  const when = (ms: number) => formatDateTimeIST(ms);
  const kindLabel = (k: OutboxItem["kind"]) => ({ order: t.inbox.orderLabel, dispatch: t.inbox.dispatchLabel, receipt: t.s.goodsIn, count: t.s.count })[k];
  const what = (i: OutboxItem) =>
    i.type === "save" ? i.label : { photo: `📷 ${t.inbox.capturePhoto}`, voice: `🎤 ${t.inbox.captureVoice}`, text: `⌨️ ${t.inbox.captureText}` }[i.inputMethod] + (i.text ? `: ${i.text.slice(0, 60)}` : "");

  const row = (i: OutboxItem) => {
    const base = { order: "/order/new", dispatch: "/dispatch/new", receipt: "/stock/in?mode=receipt", count: "/stock/in?mode=count" }[i.kind];
    const link = (param: string) => `${base}${base.includes("?") ? "&" : "?"}${param}=${i.id}`;
    let action: React.ReactNode = null;
    let status = "";
    const here = currentFirm();
    // Made while the app was in another firm: it is sent / reviewed there, never here.
    const elsewhere = !!i.firm && !!here && i.firm !== here;
    if (i.state === "queued") status = t.inbox.sending;
    if (i.type === "capture" && i.state === "read")
      action = (
        <Link href={link("resume")} className="rounded-control bg-brand px-4 py-2.5 font-semibold text-ink-inverse">
          {t.inbox.review}
        </Link>
      );
    if (i.state === "failed") {
      status = t.err[i.error ?? ""] ?? i.error ?? t.err.UNKNOWN;
      action =
        i.type === "save" ? (
          <Link href={link("fix")} className="rounded-control bg-status-pending px-4 py-2.5 font-semibold text-ink-inverse">
            {t.inbox.fix}
          </Link>
        ) : null;
    }
    if (i.type === "save" && i.state === "done") status = `✓ ${t.inbox.sent}`;
    if (elsewhere && i.state !== "done") {
      status = `🏢 ${i.firmName ?? "?"}: ${t.f.otherFirmEntry}`;
      action = (
        <button onClick={() => switchFirm(i.firm!, "/inbox")} className="rounded-control bg-brand px-4 py-2.5 font-semibold text-ink-inverse">
          {t.f.switchTo}
        </button>
      );
    }
    return (
      <div key={i.id} className="space-y-2 rounded-card bg-surface p-4 shadow-card">
        <div className="flex justify-between text-xs uppercase tracking-wide text-ink-subtle">
          <span>
            {kindLabel(i.kind)}
            {elsewhere && ` · 🏢 ${i.firmName ?? ""}`}
          </span>
          <span>{when(i.createdAt)}</span>
        </div>
        <p className="text-lg">{what(i)}</p>
        <div className="flex items-center justify-between gap-3">
          <span className={`text-sm ${i.state === "failed" ? "text-danger" : "text-ink-subtle"}`}>{status}</span>
          <div className="flex items-center gap-2">
            {(i.state === "failed" || (i.type === "save" && i.state === "done")) && (
              <button onClick={() => remove(i.id)} className="px-2 py-2 text-sm text-ink-subtle">
                {t.inbox.discard}
              </button>
            )}
            {action}
          </div>
        </div>
        {i.type === "save" && i.state === "done" && i.share && (
          <a href={i.share.url} target="_blank" rel="noreferrer" className="block rounded-control bg-whatsapp py-3 text-center font-semibold text-ink-inverse">
            {t.e.share}
          </a>
        )}
      </div>
    );
  };

  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-3 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
      {!online && <p className="rounded-control bg-ink p-3 text-sm text-ink-inverse">{t.offline}</p>}
      {items.length ? [...items].reverse().map(row) : <p className="py-16 text-center text-ink-subtle">{t.inbox.empty}</p>}
    </main>
  );
}
