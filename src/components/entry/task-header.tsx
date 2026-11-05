import Link from "next/link";
import { Icon } from "../ui/icons";

/** Top bar for full-screen tasks (new order, dispatch, edits): back arrow and the task's name. */
export function TaskHeader({ title, back, backLabel }: { title: string; back: string; backLabel: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-lg items-center gap-1 px-2">
        <Link href={back} aria-label={backLabel} className="flex size-12 shrink-0 items-center justify-center rounded-control text-brand active:bg-brand-soft">
          <Icon name="back" size={28} strokeWidth={2.4} />
        </Link>
        <h1 className="min-w-0 flex-1 py-2 text-xl leading-snug font-bold break-words">{title}</h1>
      </div>
    </header>
  );
}
