import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/**
 * Buttons: one look for every action in the app.
 * primary = the screen's main action, go = dispatch/confirm, secondary = outlined,
 * destructive = cancel/delete, ghost = low-emphasis text button.
 * Every size is at least 48px tall.
 */
export type ButtonVariant = "primary" | "go" | "secondary" | "destructive" | "destructiveSoft" | "ghost" | "whatsapp";
export type ButtonSize = "md" | "lg" | "xl";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand text-ink-inverse active:bg-brand-strong shadow-card",
  go: "bg-go text-ink-inverse active:bg-go-strong shadow-card",
  secondary: "border-2 border-line-strong bg-surface text-ink active:bg-sunken",
  destructive: "bg-danger text-ink-inverse active:bg-danger-strong",
  destructiveSoft: "border-2 border-danger/30 bg-surface text-danger active:bg-danger-soft",
  ghost: "text-brand active:bg-brand-soft",
  whatsapp: "bg-whatsapp text-ink-inverse active:brightness-95 shadow-card",
};
const SIZE: Record<ButtonSize, string> = {
  md: "min-h-12 px-4 text-base gap-2",
  lg: "min-h-14 px-5 text-lg gap-2.5",
  xl: "min-h-16 px-6 text-xl gap-3",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "lg", block = false, extra = "") {
  return `inline-flex items-center justify-center rounded-control font-semibold text-center leading-snug transition-[transform,background-color] duration-100 active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${block ? "w-full" : ""} ${extra}`;
}

type Common = { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; icon?: IconName; trailingIcon?: IconName; children?: ReactNode };

export function Button({ variant, size, block, icon, trailingIcon, className = "", children, type = "button", ...rest }: Common & ComponentProps<"button">) {
  return (
    <button type={type} className={buttonClass(variant, size, block, className)} {...rest}>
      {icon && <Icon name={icon} size={size === "md" ? 20 : 22} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={20} />}
    </button>
  );
}

export function ButtonLink({ variant, size, block, icon, trailingIcon, className = "", children, ...rest }: Common & ComponentProps<typeof Link>) {
  return (
    <Link className={buttonClass(variant, size, block, className)} {...rest}>
      {icon && <Icon name={icon} size={size === "md" ? 20 : 22} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={20} />}
    </Link>
  );
}

/** A square icon-only button: needs a label for screen readers. */
export function IconButton({ icon, label, className = "", ...rest }: { icon: IconName; label: string } & Omit<ComponentProps<"button">, "children">) {
  return (
    <button type="button" aria-label={label} title={label} className={`inline-flex size-12 shrink-0 items-center justify-center rounded-control text-brand active:bg-brand-soft ${className}`} {...rest}>
      <Icon name={icon} size={24} />
    </button>
  );
}
