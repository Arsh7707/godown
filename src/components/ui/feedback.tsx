"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** Nothing to show yet: an icon, one line that says why, and maybe the next step. */
export function EmptyState({ icon, title, hint, action }: { icon: IconName; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-12 text-center shadow-card">
      <span className="flex size-16 items-center justify-center rounded-full bg-sunken text-ink-subtle">
        <Icon name={icon} size={32} />
      </span>
      <p className="text-lg font-semibold">{title}</p>
      {hint && <p className="max-w-xs text-sm text-ink-subtle">{hint}</p>}
      {action && <div className="w-full pt-2">{action}</div>}
    </div>
  );
}

/** Grey placeholder blocks while a screen loads, shaped like what is coming. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`rounded-control bg-[linear-gradient(90deg,var(--color-sunken)_25%,var(--color-line)_50%,var(--color-sunken)_75%)] bg-[length:200%_100%] [animation:shimmer_1.4s_linear_infinite] ${className}`} />;
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-3 rounded-card bg-surface p-4 shadow-card">
          <div className="flex justify-between gap-4">
            <Skeleton className="h-6 w-2/5" />
            <Skeleton className="h-6 w-16" />
          </div>
          <Skeleton className="h-4 w-3/5" />
        </div>
      ))}
    </div>
  );
}

/** Coloured note inside a screen: info, warning or error. Always with an icon. */
export function Notice({ tone = "info", children, role, icon }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode; role?: "alert" | "status"; icon?: IconName }) {
  const look = {
    info: { cls: "bg-brand-soft text-brand-strong", icon: "question" as IconName },
    warn: { cls: "bg-status-pending-bg text-status-pending", icon: "alert" as IconName },
    error: { cls: "bg-danger-soft text-danger-strong", icon: "alert" as IconName },
    ok: { cls: "bg-status-fulfilled-bg text-status-fulfilled", icon: "checkCircle" as IconName },
  }[tone];
  return (
    <div role={role} className={`flex items-start gap-3 rounded-card p-4 text-base ${look.cls}`}>
      <Icon name={icon ?? look.icon} size={22} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- toasts

type Toast = { id: number; text: string; tone: "ok" | "error" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

/** Short message that floats above the tab bar for a few seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4" style={{ bottom: "calc(var(--tabbar-space) + 1rem)" }}>
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`flex max-w-md items-center gap-2 rounded-full px-5 py-3 text-base font-semibold text-ink-inverse shadow-raised [animation:toast-in_.2s_ease-out] ${t.tone === "ok" ? "bg-ink" : "bg-danger"}`}>
            <Icon name={t.tone === "ok" ? "checkCircle" : "alert"} size={20} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
