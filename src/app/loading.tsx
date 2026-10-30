import { ListSkeleton, Skeleton } from "@/components/ui/feedback";

/**
 * Shown the instant a link is tapped, while the server prepares the next
 * screen (it is prefetched, so there is no wait before it appears).
 */
export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-line/70 bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-lg items-center gap-3 px-4">
          <Skeleton className="size-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-2/5" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        </div>
      </div>
      <main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 pt-4" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <ListSkeleton rows={4} />
      </main>
    </>
  );
}
