import type { ComponentProps, ReactNode } from "react";

/** Shared look for text boxes, date boxes and selects: 56px tall, 18px text. */
export const inputClass = (invalid = false, extra = "") =>
  `w-full min-h-14 rounded-control border-2 bg-surface px-4 py-3 text-lg text-ink outline-none placeholder:text-ink-subtle focus:border-brand disabled:bg-sunken disabled:text-ink-subtle ${invalid ? "border-danger bg-danger-soft" : "border-line"} ${extra}`;

/** A label above its control, with an optional hint below. */
export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink-muted">
        {label}
      </label>
      {children}
      {hint && <p className="text-sm text-ink-subtle">{hint}</p>}
    </div>
  );
}

export function TextInput({ invalid, className = "", ...rest }: { invalid?: boolean } & ComponentProps<"input">) {
  return <input className={inputClass(invalid, className)} {...rest} />;
}

export function TextArea({ invalid, className = "", ...rest }: { invalid?: boolean } & ComponentProps<"textarea">) {
  return <textarea className={inputClass(invalid, `min-h-24 ${className}`)} {...rest} />;
}

/** Search box with a magnifier, for the top of lists. */
export function SearchInput({ className = "", ...rest }: ComponentProps<"input">) {
  return (
    <div className={`relative ${className}`}>
      <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-subtle">
        <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 3-4-4" />
      </svg>
      <input type="search" className={inputClass(false, "pl-11")} {...rest} />
    </div>
  );
}

/** Segmented control: two to four mutually exclusive choices (tabs within a screen). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-control bg-sunken p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`min-h-12 flex-1 rounded-[0.6rem] px-2 text-base font-semibold ${value === o.value ? "bg-surface text-brand shadow-card" : "text-ink-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Filter chips that scroll sideways if they don't fit. */
export function Chips<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`min-h-12 shrink-0 rounded-full border-2 px-4 text-base font-semibold whitespace-nowrap ${value === o.value ? "border-brand bg-brand text-ink-inverse" : "border-line bg-surface text-ink-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
