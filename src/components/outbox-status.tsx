"use client";

import Link from "next/link";
import type { Messages } from "@/i18n/messages";
import { useAutoSync, useOutbox } from "@/client/outbox";
import { currentFirm } from "@/client/api";

/** Home screen: offline banner and what is waiting on this phone. */
export function OutboxStatus({ t }: { t: Messages }) {
  const online = useAutoSync();
  const all = useOutbox();
  const here = currentFirm();
  // Entries made in another firm wait for that firm; counted apart.
  const items = all.filter((i) => !i.firm || !here || i.firm === here);
  const elsewhere = all.filter((i) => i.firm && here && i.firm !== here && i.state !== "done").length;
  const waiting = items.filter((i) => i.state === "queued").length;
  const review = items.filter((i) => i.type === "capture" && i.state === "read").length;
  const failed = items.filter((i) => i.state === "failed").length;
  return (
    <>
      {!online && <p className="rounded-xl bg-stone-800 p-3 text-sm text-white">{t.offline}</p>}
      {(waiting > 0 || review > 0 || failed > 0 || elsewhere > 0) && (
        <Link href="/inbox" className="flex items-center justify-between rounded-2xl bg-amber-100 p-4 text-amber-950">
          <span className="text-lg font-semibold">📥 {t.inbox.title}</span>
          <span className="text-right text-sm">
            {[review && `${review} ${t.inbox.toReview}`, failed && `${failed} ${t.inbox.needFix}`, waiting && `${waiting} ${t.inbox.waiting}`, elsewhere && `${elsewhere} ${t.f.otherFirms}`].filter(Boolean).join(" · ")}
          </span>
        </Link>
      )}
    </>
  );
}
