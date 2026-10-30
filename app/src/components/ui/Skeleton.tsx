export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton rounded-md ${className}`} style={style} />;
}

/** A generic card-grid placeholder shown while a page's data loads. */
export function PageSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      <Skeleton className="h-16 md:col-span-2 lg:col-span-3" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-40" />
      ))}
    </div>
  );
}
