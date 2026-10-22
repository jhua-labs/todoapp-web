// 待办清单（AD-19；FE-1）：按 props 给定顺序渲染 <ul>（排序由 useTodoList / 服务端保证，这里不再排序），
// 把按 id 绑定的回调接到每一行，并为每行维护删除控件 ref（供 FE-3 做删除后的焦点接管）。
import { useRef } from 'react'
import type { Todo } from '@/api/types.ts'
import { TodoRow } from './TodoRow.tsx'

export type TodoListProps = {
  items: readonly Todo[]
  now: Date
  editingId: string | null
  pendingIds: ReadonlySet<string>
  helpId: string
  onToggle(id: string, completed: boolean): Promise<boolean>
  onStartEdit(id: string): void
  onCancelEdit(): void
  onEditTooLongChange(tooLong: boolean): void
  onRename(id: string, title: string): Promise<boolean>
  onDelete(id: string): Promise<boolean>
  onEmptied(): void
}

export function TodoList({
  items,
  now,
  editingId,
  pendingIds,
  helpId,
  onToggle,
  onStartEdit,
  onCancelEdit,
  onEditTooLongChange,
  onRename,
  onDelete,
  onEmptied,
}: TodoListProps) {
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>())

  const deleteRefFor = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) deleteRefs.current.set(id, el)
    else deleteRefs.current.delete(id)
  }

  // FE-3 删除后的焦点接管（AD-19）：只在 onDelete 返回 true 后执行；
  // 依次尝试下一行的删除控件 → 上一行的删除控件 → 都没有时 onEmptied()（容器把焦点交给新增输入框）。
  // 「下一行 / 上一行」按调用 onDelete 之前的 items 顺序定（await 之后闭包里的 items 已过时）；
  // 按 id 排除被删行，并跳过删除控件已不在 deleteRefs 里的行（例如另一条并发删除已先完成）。
  const handleDelete = async (id: string): Promise<boolean> => {
    const order = items.map((t) => t.id)
    const index = order.indexOf(id)
    const ok = await onDelete(id)
    if (!ok) return ok
    const target = (ids: readonly string[]) =>
      ids.map((other) => (other === id ? undefined : deleteRefs.current.get(other))).find((el) => el !== undefined)
    const next = index < 0 ? undefined : target(order.slice(index + 1))
    const prev = index < 0 ? undefined : target(order.slice(0, index).reverse())
    const el = next ?? prev
    if (el) el.focus()
    else onEmptied()
    return ok
  }

  return (
    <ul className="flex flex-col">
      {items.map((todo) => (
        <TodoRow
          key={todo.id}
          todo={todo}
          now={now}
          editing={editingId === todo.id}
          pending={pendingIds.has(todo.id)}
          helpId={helpId}
          deleteRef={deleteRefFor(todo.id)}
          onToggle={(completed) => onToggle(todo.id, completed)}
          onStartEdit={() => onStartEdit(todo.id)}
          onCancelEdit={onCancelEdit}
          onEditTooLongChange={onEditTooLongChange}
          onRename={(title) => onRename(todo.id, title)}
          onDelete={() => handleDelete(todo.id)}
        />
      ))}
    </ul>
  )
}
