// 空清单引导（FR-3、AD-19；FE-1）。
import { FileTextIcon } from 'lucide-react'

export type EmptyStateProps = Record<string, never>

export function EmptyState(_props: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <FileTextIcon aria-hidden="true" className="size-8 text-muted-foreground" />
      <p className="text-base font-semibold">还没有待办</p>
      <p className="text-xs text-muted-foreground">在上面输入一件事，按回车就记下了</p>
    </div>
  )
}
