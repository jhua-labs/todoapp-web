// 清单中的一行（AD-13、AD-19、UX-DR10/11；FE-1）。
// - 标题只作为文本子节点渲染（NFR-XSS）。
// - 复选框受控：服务端确认前勾选状态不变（禁乐观更新）；重复提交由 useTodoList 拦，这里不禁用控件以免失焦。
// - 标题是可获焦按钮：双击、Enter、F2 进入编辑；单击不进入。
// - 删除控件始终在 DOM 与 Tab 序中，只用透明度在 hover / focus-within 时显露；无确认。
// - 编辑态退出后焦点回到标题按钮（首次渲染不抢焦点；焦点已移到本行之外的元素时不抢）。
import { Trash2Icon } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent, type Ref } from 'react'
import type { Todo } from '@/api/types.ts'
import { Button } from '@/components/ui/button.tsx'
import { Checkbox } from '@/components/ui/checkbox.tsx'
import { cn } from '@/lib/utils.ts'
import { TodoTimestamp } from './TodoTimestamp.tsx'
import { TodoTitleEditor } from './TodoTitleEditor.tsx'

export type TodoRowProps = {
  todo: Todo
  now: Date
  editing: boolean
  pending: boolean
  helpId: string
  deleteRef: Ref<HTMLButtonElement>
  onToggle(completed: boolean): Promise<boolean>
  onStartEdit(): void
  onCancelEdit(): void
  onEditTooLongChange(tooLong: boolean): void
  onRename(title: string): Promise<boolean>
  onDelete(): Promise<boolean>
}

export function TodoRow({
  todo,
  now,
  editing,
  pending,
  helpId,
  deleteRef,
  onToggle,
  onStartEdit,
  onCancelEdit,
  onEditTooLongChange,
  onRename,
  onDelete,
}: TodoRowProps) {
  const rowRef = useRef<HTMLLIElement>(null)
  const titleRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(editing)

  useEffect(() => {
    if (wasEditing.current && !editing) {
      // 只在焦点仍在本行内或已丢失（落到 body）时归还；焦点已去别处（如另一行的编辑框）就不抢（Story 3.4，PM 2a）
      const active = document.activeElement
      if (!active || active === document.body || rowRef.current?.contains(active)) titleRef.current?.focus()
    }
    wasEditing.current = editing
  }, [editing])

  function handleTitleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      onStartEdit()
    }
  }

  return (
    <li ref={rowRef} className="group flex items-center gap-3 border-b border-border py-3">
      <Checkbox
        checked={todo.completed}
        onCheckedChange={(value) => void onToggle(value === true)}
        aria-label={`标记完成：${todo.title}`}
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <TodoTitleEditor
            initialTitle={todo.title}
            describedById={helpId}
            pending={pending}
            onTooLongChange={onEditTooLongChange}
            onSave={onRename}
            onCancel={onCancelEdit}
            onDelete={onDelete}
          />
        ) : (
          <button
            ref={titleRef}
            type="button"
            aria-label={`编辑：${todo.title}`}
            className={cn(
              'w-full rounded-sm text-left break-words outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              todo.completed && 'line-through text-muted-foreground',
            )}
            onDoubleClick={onStartEdit}
            onKeyDown={handleTitleKeyDown}
          >
            {todo.title}
          </button>
        )}
      </div>
      <TodoTimestamp createdAt={todo.createdAt} updatedAt={todo.updatedAt} completed={todo.completed} now={now} />
      <Button
        ref={deleteRef}
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`删除：${todo.title}`}
        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        onClick={() => void onDelete()}
      >
        <Trash2Icon aria-hidden="true" />
        <span className="text-foreground">删除</span>
      </Button>
    </li>
  )
}
