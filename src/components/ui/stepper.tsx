"use client";

import { Icon } from "./icons";

/**
 * Big − [ 12 ] + quantity control. The number stays typeable (decimals allowed);
 * the buttons step by whole units and never go below zero. `max` (e.g. what is
 * still pending) is shown as a hint, not enforced: sending more is the form's call.
 */
export function QtyStepper({
  id,
  value,
  onChange,
  label,
  unit,
  decLabel,
  incLabel,
  invalid,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  /** Accessible name of the number box (e.g. "Qty"). */
  label: string;
  unit?: string;
  decLabel: string;
  incLabel: string;
  invalid?: boolean;
  placeholder?: string;
}) {
  const n = Number(value);
  const step = (d: number) => {
    const base = Number.isFinite(n) && value.trim() ? n : 0;
    const next = Math.max(0, Math.round((base + d) * 100) / 100);
    onChange(String(next));
  };
  const btn = "flex size-14 shrink-0 items-center justify-center rounded-control bg-sunken text-ink active:bg-line disabled:opacity-40";
  return (
    <div className={`flex items-center gap-2 rounded-control border-2 bg-surface p-1 ${invalid ? "border-danger bg-danger-soft" : "border-line focus-within:border-brand"}`}>
      <button type="button" className={btn} onClick={() => step(-1)} aria-label={decLabel} disabled={!value.trim() || n <= 0}>
        <Icon name="minus" size={26} strokeWidth={2.6} />
      </button>
      <label className="flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1.5 self-stretch">
        <input
          id={id}
          aria-label={label}
          inputMode="decimal"
          enterKeyHint="done"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          onFocus={(e) => e.target.select()}
          className="num h-12 w-full min-w-0 bg-transparent text-center text-2xl font-bold outline-none placeholder:text-base placeholder:font-normal placeholder:text-ink-subtle"
        />
        {unit && <span className="shrink-0 text-base text-ink-subtle">{unit}</span>}
      </label>
      <button type="button" className={btn} onClick={() => step(1)} aria-label={incLabel}>
        <Icon name="plus" size={26} strokeWidth={2.6} />
      </button>
    </div>
  );
}
