import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the staff allow-list loads. Super admin only. */
export default function StaffLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading the staff accounts…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="border-border bg-surface/50 flex items-center gap-4 rounded-2xl border p-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
            <Skeleton className="hidden h-6 w-24 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
