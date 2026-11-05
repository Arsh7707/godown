"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./button";

/**
 * Bottom sheet for actions and confirmations: slides up from the bottom,
 * within thumb reach. Escape or a tap on the dimmed background closes it.
 * Focus moves into the sheet and back to what opened it.
 */
export function BottomSheet({ open, onClose, title, closeLabel, children, footer }: { open: boolean; onClose: () => void; title: string; closeLabel: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !ref.current) return;
      // Keep Tab inside the sheet.
      const els = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/45 [animation:fade-in_.15s_ease-out]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-sheet bg-surface shadow-sheet outline-none [animation:sheet-up_.22s_cubic-bezier(.2,.8,.2,1)]"
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line-strong" aria-hidden />
        <div className="flex items-center gap-2 py-1 pr-2 pl-5">
          <h2 id={titleId} className="min-w-0 flex-1 text-lg font-bold">
            {title}
          </h2>
          <IconButton icon="close" label={closeLabel} onClick={onClose} className="text-ink-muted" />
        </div>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-line px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
        {!footer && <div className="pb-[env(safe-area-inset-bottom)]" />}
      </div>
    </div>,
    document.body,
  );
}
