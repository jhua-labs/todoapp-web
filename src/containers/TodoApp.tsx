// 唯一容器（AD-19、UX-DR13）：只做装配。调用 useTodoList 与 useNow，持有编辑态与两个超长上报，
// 把状态与回调接到展示组件。容器内不做裁剪 / 校验 / 时间格式化 / 文案映射，不直接操作 DOM（focus 除外）。
// FE-2 / FE-3 / FE-4 只实现各自组件，不再改本文件，所以全部回调在这里一次接全。
import { useRef, useState } from 'react'
import { AddTodoForm } from '@/components/AddTodoForm.tsx'
import { AppFooter } from '@/components/AppFooter.tsx'
import { AppHeader } from '@/components/AppHeader.tsx'
import { CapacityBanner } from '@/components/CapacityBanner.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { FailureNotice } from '@/components/FailureNotice.tsx'
import { HelpLine } from '@/components/HelpLine.tsx'
import { ListSkeleton } from '@/components/ListSkeleton.tsx'
import { LoadErrorRetry } from '@/components/LoadErrorRetry.tsx'
import { TodoList } from '@/components/TodoList.tsx'
import { useNow } from '@/lib/useNow.ts'
import { useTodoList } from '@/state/useTodoList.ts'

const HELP_ID = 'todo-help'
const CAPACITY_ID = 'capacity-notice'

export function TodoApp() {
  const {
    status,
    items,
    isFull,
    notice,
    adding,
    pendingIds,
    reload,
    add,
    setCompleted,
    rename,
    remove,
    dismissNotice,
  } = useTodoList()
  const now = useNow()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [addTooLong, setAddTooLong] = useState(false)
  const [editTooLong, setEditTooLong] = useState(false)
  const addInputRef = useRef<HTMLInputElement>(null)

  const helpMode = editingId ? (editTooLong ? 'tooLong' : 'edit') : addTooLong ? 'tooLong' : 'add'

  async function handleRename(id: string, title: string) {
    const ok = await rename(id, title)
    if (ok) setEditingId((cur) => cur === id ? null : cur)
    return ok
  }

  async function handleDelete(id: string) {
    const ok = await remove(id)
    if (ok) setEditingId((cur) => cur === id ? null : cur)
    return ok
  }

  function renderList() {
    if (status === 'loading') return <ListSkeleton />
    if (status === 'error') return <LoadErrorRetry pending={false} onRetry={() => void reload()} />
    if (items.length === 0) return <EmptyState />
    return (
      <TodoList
        items={items}
        now={now}
        editingId={editingId}
        pendingIds={pendingIds}
        helpId={HELP_ID}
        onToggle={(id, completed) => setCompleted(id, completed)}
        onStartEdit={(id) => {
          // 每次进入编辑复位超长标记（非编辑态时 helpMode 不看它），避免残留红色帮助行
          setEditTooLong(false)
          setEditingId(id)
        }}
        onCancelEdit={() => setEditingId(null)}
        onEditTooLongChange={setEditTooLong}
        onRename={handleRename}
        onDelete={handleDelete}
        onEmptied={() => addInputRef.current?.focus()}
      />
    )
  }

  return (
    <main className="mx-auto my-8 flex max-w-card flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <AppHeader />
      {notice !== null && <FailureNotice message={notice} onDismiss={dismissNotice} />}
      {isFull && <CapacityBanner id={CAPACITY_ID} />}
      <div className="flex flex-col gap-1">
        <AddTodoForm
          disabled={isFull}
          pending={adding}
          describedById={isFull ? CAPACITY_ID : undefined}
          inputRef={addInputRef}
          onTooLongChange={setAddTooLong}
          onSubmit={add}
        />
        <HelpLine id={HELP_ID} mode={helpMode} />
      </div>
      <hr className="border-border" />
      <section aria-label="待办清单">{renderList()}</section>
      <AppFooter />
    </main>
  )
}
