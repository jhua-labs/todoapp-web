// 行内标题编辑器（AD-19）。骨架由 FE-1 建，行为由 Story 3.4（FE-4）实现。
// - 草稿是本地 UI 状态；裁剪 / 计长 / 校验只用 title.ts（AD-7）。
// - Enter 与失焦共用一次提交：裁剪后为空 → onDelete（绝不提交空标题，删除无确认）；
//   未改动（按裁剪后比较）→ onCancel；改了且合法 → onSave(裁剪后的值)；超长 / 非法不提交。
// - 禁乐观更新（AD-13）：成功后什么也不调，由容器退出编辑态；返回 false 时保留草稿、停留编辑态以便重试。
// - Esc → onCancel，此后本实例忽略 blur / Enter（卸载时可能派发的 blur 不得触发保存）。
// - 在途去重：有提交在途或 pending 时忽略后续提交；不禁用输入框（禁用会失焦，触发失焦保存）。
// - 超长只在边沿变化时于 onChange 里上报（不用 effect）。焦点回位 / 删除后焦点由 TodoRow / TodoList 负责。
import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { checkTitle, titleLength } from '@/api/title.ts'
import { Input } from '@/components/ui/input.tsx'
import { TitleCounter } from './TitleCounter.tsx'

export type TodoTitleEditorProps = {
  initialTitle: string
  describedById: string
  pending: boolean
  onTooLongChange(tooLong: boolean): void
  onSave(title: string): Promise<boolean>
  onCancel(): void
  onDelete(): Promise<boolean>
}

export function TodoTitleEditor({
  initialTitle,
  describedById,
  pending,
  onTooLongChange,
  onSave,
  onCancel,
  onDelete,
}: TodoTitleEditorProps) {
  const [draft, setDraft] = useState(initialTitle)
  const check = checkTitle(draft)
  const invalid = check.kind === 'tooLong' || check.kind === 'invalid'

  // 上一次上报给容器的超长值（边沿上报）
  const reportedTooLong = useRef(false)
  // 本实例已结束（Esc / 未改动取消 / 提交成功）：之后的 blur / Enter 一律忽略
  const finished = useRef(false)
  // 本实例有提交在途
  const inFlight = useRef(false)

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    setDraft(next)
    const tooLong = checkTitle(next).kind === 'tooLong'
    if (tooLong !== reportedTooLong.current) {
      reportedTooLong.current = tooLong
      onTooLongChange(tooLong)
    }
  }

  async function commit() {
    if (finished.current || inFlight.current || pending) return
    if (check.kind === 'tooLong' || check.kind === 'invalid') return
    if (check.kind === 'ok' && check.title === initialTitle) {
      finished.current = true
      onCancel()
      return
    }
    inFlight.current = true
    const ok = check.kind === 'empty' ? await onDelete() : await onSave(check.title)
    inFlight.current = false
    if (ok) finished.current = true
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (finished.current) return
      finished.current = true
      onCancel()
      return
    }
    // 输入法组字中的回车只用于选词，不提交
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void commit()
    }
  }

  return (
    <div className="relative">
      <Input
        className="pr-16"
        aria-label={`编辑待办标题：${initialTitle}`}
        aria-describedby={describedById}
        aria-invalid={invalid ? true : undefined}
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => void commit()}
        autoFocus
      />
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
        <TitleCounter length={titleLength(draft)} />
      </span>
    </div>
  )
}
