import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** White rounded surface: the building block of every list and detail screen. */
export function Card({ className = "", children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={`overflow-hidden rounded-card bg-surface shadow-card ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** Small heading above a group of cards or rows. */
export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 px-1 pt-2">
      <h2 id={id} className="text-sm font-semibold text-ink-subtle">
        {children}
      </h2>
      {action}
    </div>
  );
}

/**
 * One tappable row: optional leading icon, title + subtitle on the left,
 * a value on the right, then a chevron. At least 64px tall.
 */
export function ListRow({
  href,
  icon,
  title,
  subtitle,
  value,
  badge,
  chevron = true,
  className = "",
  ...rest
}: {
  href: string;
  icon?: IconName;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  badge?: ReactNode;
  chevron?: boolean;
} & Omit<ComponentProps<typeof Link>, "href" | "title">) {
  return (
    <Link href={href} className={`flex min-h-16 items-center gap-3 px-4 py-3 active:bg-sunken ${className}`} {...rest}>
      {icon && (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon name={icon} size={22} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold break-words">{title}</span>
        {subtitle && <span className="block text-sm text-ink-subtle">{subtitle}</span>}
      </span>
      {badge}
      {value !== undefined && <span className="shrink-0 text-right">{value}</span>}
      {chevron && <Icon name="chevron" size={20} className="text-ink-subtle" />}
    </Link>
  );
}

/** Rows inside one card, separated by hairlines. */
export function RowGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Card className={`divide-y divide-line ${className}`}>{children}</Card>;
}
