import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the gate page loads — the camera is the slow part, not the data. */
export default function ScannerLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading the scanner…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="border-border bg-surface/50 flex flex-col items-center gap-4 rounded-2xl border p-6">
        <Skeleton className="aspect-square w-full max-w-sm rounded-2xl" />
        <Skeleton className="h-11 w-full max-w-sm rounded-full" />
      </div>
    </div>
  );
}
