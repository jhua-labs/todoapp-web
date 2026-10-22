// 行内时间（AD-20、UX-DR10；FE-1）：相对时间只由 formatRelative 生成，绝对时间用 aria-label 暴露 ISO 原串。
import { formatRelative } from '@/lib/formatTime.ts'

export type TodoTimestampProps = { createdAt: string; updatedAt: string; completed: boolean; now: Date }

export function TodoTimestamp({ createdAt, updatedAt, completed, now }: TodoTimestampProps) {
  return (
    <div className="flex flex-col items-end text-xs text-muted-foreground">
      <time dateTime={createdAt} aria-label={createdAt} title={createdAt}>
        {formatRelative(createdAt, now)}
      </time>
      {completed && (
        <span className="text-success">
          已完成 ·{' '}
          <time dateTime={updatedAt} aria-label={updatedAt} title={updatedAt}>
            {formatRelative(updatedAt, now)}
          </time>
        </span>
      )}
    </div>
  )
}
