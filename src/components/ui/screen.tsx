import type { ReactNode } from "react";

/**
 * Page body: the phone-width column every screen uses, with room at the
 * bottom for the tab bar (and the sticky action bar when there is one).
 */
export function Page({ children, className = "", wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <main className={`mx-auto w-full ${wide ? "max-w-2xl" : "max-w-lg"} flex-1 space-y-4 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)] ${className}`}>{children}</main>;
}

/**
 * The screen's one main action, pinned at the bottom within thumb reach
 * (above the tab bar when it shows). It sits in the page flow (sticky), so
 * it can never cover the last field: the page ends above it.
 */
export function ActionBar({ children, above, keepWithKeyboard = false }: { children: ReactNode; above?: ReactNode; /** Forms keep Save visible while typing; list screens hide their button. */ keepWithKeyboard?: boolean }) {
  return (
    <div data-hide-with-keyboard={keepWithKeyboard ? undefined : ""} className="sticky z-30 -mx-4 mt-6 border-t border-line bg-canvas/95 px-4 pt-3 pb-3 backdrop-blur-md" style={{ bottom: "var(--tabbar-space)" }}>
      {above && <div className="mb-2">{above}</div>}
      <div className="flex gap-3">{children}</div>
      {/* Without a tab bar below, keep clear of the home indicator. */}
      <div className="h-[env(safe-area-inset-bottom)] [body:has([data-tabbar])_&]:hidden" />
    </div>
  );
}

/** A quantity with its unit, always with a space between, never split across lines. */
export function Qty({ n, unit, className = "" }: { n: string; unit?: string | null; className?: string }) {
  return (
    <span className={`num whitespace-nowrap ${className}`}>
      {n}
      {unit ? <span className="font-normal text-ink-subtle">{` ${unit}`}</span> : null}
    </span>
  );
}
