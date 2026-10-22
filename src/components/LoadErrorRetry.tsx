// 加载失败时清单区的重试入口（FR-3、AD-19；FE-1）。失败文案由 FailureNotice 显示，这里不重复。
import { Button } from '@/components/ui/button.tsx'

export type LoadErrorRetryProps = { pending: boolean; onRetry: () => void }

export function LoadErrorRetry({ pending, onRetry }: LoadErrorRetryProps) {
  return (
    <div className="flex justify-center py-8">
      <Button type="button" variant="outline" disabled={pending} onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}
