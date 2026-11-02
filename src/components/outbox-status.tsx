"use client";

import Link from "next/link";
import type { Messages } from "@/i18n/messages";
import { useAutoSync, useOutbox } from "@/client/outbox";
import { currentFirm } from "@/client/api";
import { Icon } from "./ui/icons";

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
      {!online && (
        <p role="status" className="flex items-start gap-3 rounded-card bg-ink p-4 text-base text-ink-inverse">
          <Icon name="wifiOff" size={22} className="mt-0.5" />
          {t.offline}
        </p>
      )}
      {(waiting > 0 || review > 0 || failed > 0 || elsewhere > 0) && (
        <Link href="/inbox" className="flex min-h-16 items-center gap-3 rounded-card bg-status-pending-bg p-4 text-status-pending">
          <Icon name="inbox" size={24} />
          <span className="text-lg font-semibold">{t.inbox.title}</span>
          <span className="min-w-0 flex-1 text-right text-sm">
            {[review && `${review} ${t.inbox.toReview}`, failed && `${failed} ${t.inbox.needFix}`, waiting && `${waiting} ${t.inbox.waiting}`, elsewhere && `${elsewhere} ${t.f.otherFirms}`].filter(Boolean).join(" · ")}
          </span>
          <Icon name="chevron" size={20} />
        </Link>
      )}
    </>
  );
}
