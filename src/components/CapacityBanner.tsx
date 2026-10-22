// 容量已满横幅（AD-19；骨架 FE-1，样式 Story 2.4 / FE-2）。文案只来自 messages.ts；琥珀色只用于这里（DESIGN）。
// 出现 / 消失由容器的 isFull 控制，本组件无定时器、无关闭按钮。
import { CAPACITY } from '@/api/messages.ts'

export type CapacityBannerProps = { id: string }

export function CapacityBanner({ id }: CapacityBannerProps) {
  return (
    <div
      id={id}
      role="status"
      className="rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning"
    >
      {CAPACITY}
    </div>
  )
}
