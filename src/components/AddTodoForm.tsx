// 新增输入行（AD-19）。骨架由 FE-1 建，行为由 Story 2.4（FE-2）实现。
// 草稿是本地 UI 状态；裁剪 / 计长 / 校验只用 title.ts（AD-7）。
// 禁乐观更新（AD-13）：onSubmit 返回 true 之后才清空草稿并把焦点放回输入框；返回 false 什么都不改。
// 容量已满只看 disabled（由 useTodoList 计算），组件里不数条数。
import { useImperativeHandle, useRef, useState, type ChangeEvent, type FormEvent, type Ref } from 'react'
import { checkTitle, titleLength } from '@/api/title.ts'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { TitleCounter } from './TitleCounter.tsx'

export type AddTodoFormProps = {
  disabled: boolean
  pending: boolean
  describedById?: string
  inputRef: Ref<HTMLInputElement>
  onTooLongChange(tooLong: boolean): void
  onSubmit(title: string): Promise<boolean>
}

export function AddTodoForm({
  disabled,
  pending,
  describedById,
  inputRef,
  onTooLongChange,
  onSubmit,
}: AddTodoFormProps) {
  const [draft, setDraft] = useState('')
  const check = checkTitle(draft)
  const length = titleLength(draft)
  const invalid = check.kind === 'tooLong' || check.kind === 'invalid'

  // 上一次上报给容器的超长值：只在边沿变化时上报（在事件里上报，不用 effect）
  const reportedTooLong = useRef(false)

  // 本组件自己的 ref 挂在真实 <input> 上；外部 inputRef（容器 onEmptied 用它 focus）经 useImperativeHandle
  // 指向同一个元素（对象 ref / 回调 ref 都适用，且不改写 props，满足 react(immutability) lint）
  const localRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(inputRef, () => localRef.current as HTMLInputElement, [])

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    setDraft(next)
    const tooLong = checkTitle(next).kind === 'tooLong'
    if (tooLong !== reportedTooLong.current) {
      reportedTooLong.current = tooLong
      onTooLongChange(tooLong)
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // 双保险：满额或在途时不提交（hook 也会去重）
    if (disabled || pending) return
    // 空白仅无操作；超长 / 非法已显示超长态，拦在发请求前
    if (check.kind !== 'ok') return
    const ok = await onSubmit(check.title)
    if (!ok) return
    setDraft('')
    localRef.current?.focus()
  }

  return (
    <form className="flex gap-2" onSubmit={(e) => void handleSubmit(e)}>
      <div className="relative flex-1">
        <Input
          ref={localRef}
          className="pr-16"
          aria-label="新增待办标题"
          aria-describedby={describedById}
          aria-invalid={invalid ? true : undefined}
          disabled={disabled}
          placeholder={disabled ? '待办已满，先删掉一些吧' : '要做什么？按回车添加'}
          value={draft}
          onChange={handleChange}
        />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
          <TitleCounter length={length} />
        </span>
      </div>
      <Button type="submit" aria-label="添加待办" disabled={disabled || check.kind !== 'ok'}>
        添加
      </Button>
    </form>
  )
}
