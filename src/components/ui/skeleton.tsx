import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

function SkeletonLine({
  className,
  delay = 0,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { delay?: number }) {
  return (
    <div
      className={cn("skeleton-line", className)}
      style={{ ...style, animationDelay: `${delay}ms` }}
      {...props}
    />
  );
}

function TableSkeleton({
  columns = 5,
  rows = 8,
  compact = false,
  className,
}: {
  columns?: number;
  rows?: number;
  compact?: boolean;
  className?: string;
}) {
  const widths = ["72%", "58%", "82%", "48%", "66%", "54%", "76%"];

  return (
    <div className={cn("skeleton-table", className)} aria-label="Loading rows">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className={cn("skeleton-table-row", compact ? "py-2" : "py-3")}
          style={{ "--skeleton-cols": String(columns), animationDelay: `${rowIndex * 80}ms` } as React.CSSProperties}
        >
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <SkeletonLine
              key={columnIndex}
              delay={rowIndex * 90 + columnIndex * 20}
              className="h-3.5"
              style={{ width: widths[(rowIndex + columnIndex) % widths.length] }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-5 page-enter", className)} aria-label="Loading page">
      <div className="module-page rounded-[1.6rem] border border-white/60 bg-white/50 px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_24px_60px_-36px_rgba(42,6,8,0.3)] backdrop-blur-2xl">
        <SkeletonLine className="h-8 max-w-[18rem]" />
      </div>
      <div className="module-page overflow-hidden rounded-[1.4rem] border border-white/60 bg-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_22px_56px_-30px_rgba(42,6,8,0.24)] backdrop-blur-2xl">
        <div className="border-b border-[#e4e4e7] bg-[#f4f4f5]/90 px-4 py-3">
          <SkeletonLine className="h-8 max-w-xs" />
        </div>
        <TableSkeleton columns={5} rows={8} />
      </div>
    </div>
  );
}

function ModalFormSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-label="Loading form">
      <SkeletonLine className="h-14 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SkeletonLine delay={80} className="h-16 rounded-xl" />
        <SkeletonLine delay={120} className="h-16 rounded-xl" />
      </div>
      <SkeletonLine delay={160} className="h-16 w-full rounded-xl" />
      <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
        <div className="space-y-3">
          <SkeletonLine delay={220} className="h-14 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SkeletonLine delay={280} className="h-14 rounded-xl" />
            <SkeletonLine delay={340} className="h-14 rounded-xl" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SkeletonLine delay={400} className="h-14 rounded-xl" />
        <SkeletonLine delay={460} className="h-14 rounded-xl" />
      </div>
      <SkeletonLine delay={520} className="h-12 w-full rounded-xl" />
    </div>
  );
}

export { Skeleton, SkeletonLine, TableSkeleton, PageSkeleton, ModalFormSkeleton }
