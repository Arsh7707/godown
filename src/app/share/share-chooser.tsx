"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { messages, type Lang } from "@/i18n/messages";
import { readShared, type SharedItem } from "@/client/shared";

export function ShareChooser({ lang, id, canCreate }: { lang: Lang; id: string; canCreate: boolean }) {
  const t = messages(lang);
  const [item, setItem] = useState<SharedItem | null | undefined>(undefined);
  useEffect(() => {
    readShared(id).then(setItem, () => setItem(null));
  }, [id]);

  if (item === undefined) return <main className="flex-1" />;
  if (!item || (!item.files.length && !item.text.trim()) || !canCreate) {
    return <main className="mx-auto w-full max-w-lg flex-1 px-4 py-16 text-center text-ink-muted">{t.e.sharedNothing}</main>;
  }
  const f = item.files[0];
  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
      <div className="rounded-card bg-surface p-4 shadow-card">
        {f ? (
          <p className="text-lg">
            {f.type.startsWith("image/") ? "📷" : "🎤"} {f.name}
          </p>
        ) : null}
        {item.text && <p className="mt-1 whitespace-pre-wrap text-ink-muted">{item.text}</p>}
      </div>
      <p className="text-lg font-semibold">{t.e.sharedAsk}</p>
      <Link href={`/order/new?shared=${id}`} className="block rounded-card bg-brand px-6 py-6 text-2xl font-bold text-ink-inverse">
        📝 {t.newOrder}
      </Link>
      <Link href={`/dispatch/new?shared=${id}`} className="block rounded-card bg-go px-6 py-6 text-2xl font-bold text-ink-inverse">
        🚚 {t.dispatch}
      </Link>
    </main>
  );
}
