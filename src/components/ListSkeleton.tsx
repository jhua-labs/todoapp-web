// 首次加载骨架（FR-3、AD-19；FE-1）：外层 aria-busy，占位行 aria-hidden，不含任何可被读屏当真实内容的角色。
import { Skeleton } from '@/components/ui/skeleton.tsx'

export type ListSkeletonProps = { rows?: number }

export function ListSkeleton({ rows = 3 }: ListSkeletonProps) {
  return (
    <div aria-busy="true" className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex items-center gap-3 border-b border-border py-3">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
}
