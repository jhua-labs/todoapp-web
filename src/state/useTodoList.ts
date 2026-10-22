// 清单状态的唯一所在（AD-13、AD-19）：只有本 hook 调用 api/todos，只有 TodoApp 调用本 hook。
//
// - 服务端是唯一真相源：任何写操作只在服务端成功响应后才改 items，禁乐观更新（SM-C1、FR-8）。
// - 同一条（含新增框）有请求在途时忽略重复提交；在途判定用 ref 同步完成，state 只用于渲染。
// - 写操作失败（含 404 陈旧页面）时该条保持操作前状态，显示操作失败提示，直到下一次 GET。
// - isFull = items.length >= 500 || last409；last409 只在成功 GET 或成功 DELETE 时清零。
// - 任一成功（含 reload）清除 notice；容量 409 走容量横幅，不设操作失败提示。
import { useCallback, useEffect, useRef, useState } from 'react'
import { FAILURE, noticeFor } from '@/api/messages.ts'
import { createTodo, deleteTodo, listTodos, removeTodo, updateTodo, upsertTodo } from '@/api/todos.ts'
import type { Todo, UpdateTodoRequest } from '@/api/types.ts'

/** 待办总数上限（FR-2）。 */
export const MAX_TODOS = 500

export type ListStatus = 'loading' | 'error' | 'ready'

export interface TodoListModel {
  status: ListStatus
  items: readonly Todo[]
  isFull: boolean
  /** 操作失败提示文案；null = 不显示 */
  notice: string | null
  adding: boolean
  pendingIds: ReadonlySet<string>
  reload(): Promise<void>
  /** true = 服务端已确认 */
  add(title: string): Promise<boolean>
  setCompleted(id: string, completed: boolean): Promise<boolean>
  rename(id: string, title: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  dismissNotice(): void
}

export function useTodoList(): TodoListModel {
  const [status, setStatus] = useState<ListStatus>('loading')
  const [items, setItems] = useState<readonly Todo[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [last409, setLast409] = useState(false)

  // 同步的在途判定（同一 tick 内的重复提交读不到新 state）
  const addingRef = useRef(false)
  const pendingRef = useRef(new Set<string>())
  // 卸载后返回的请求不再 setState
  const mountedRef = useRef(false)

  const markPending = useCallback((id: string, on: boolean) => {
    if (on) pendingRef.current.add(id)
    else pendingRef.current.delete(id)
    setPendingIds(new Set(pendingRef.current))
  }, [])

  // 按 GET 结果落状态。挂载时在 listTodos() 的回调里调用（初始 status 已是 'loading'）；
  // reload() 先切回 loading 再请求。
  const applyList = useCallback((result: Awaited<ReturnType<typeof listTodos>>) => {
    if (!mountedRef.current) return
    if (result.ok) {
      setItems(result.data)
      setStatus('ready')
      setNotice(null)
      setLast409(false)
    } else {
      setStatus('error')
      setNotice(FAILURE)
    }
  }, [])

  const reload = useCallback(async () => {
    setStatus('loading')
    applyList(await listTodos())
  }, [applyList])

  const add = useCallback(async (title: string) => {
    if (addingRef.current) return false
    addingRef.current = true
    setAdding(true)
    try {
      const result = await createTodo(title)
      if (!mountedRef.current) return result.ok
      if (result.ok) {
        setItems((prev) => upsertTodo(prev, result.data))
        setNotice(null)
        return true
      }
      if (noticeFor(result.code).kind === 'capacity') setLast409(true)
      else setNotice(FAILURE)
      return false
    } finally {
      addingRef.current = false
      if (mountedRef.current) setAdding(false)
    }
  }, [])

  const update = useCallback(
    async (id: string, patch: UpdateTodoRequest) => {
      if (pendingRef.current.has(id)) return false
      markPending(id, true)
      try {
        const result = await updateTodo(id, patch)
        if (!mountedRef.current) return result.ok
        if (result.ok) {
          setItems((prev) => upsertTodo(prev, result.data))
          setNotice(null)
          return true
        }
        setNotice(FAILURE)
        return false
      } finally {
        if (mountedRef.current) markPending(id, false)
        else pendingRef.current.delete(id)
      }
    },
    [markPending],
  )

  const setCompleted = useCallback((id: string, completed: boolean) => update(id, { completed }), [update])
  const rename = useCallback((id: string, title: string) => update(id, { title }), [update])

  const remove = useCallback(
    async (id: string) => {
      if (pendingRef.current.has(id)) return false
      markPending(id, true)
      try {
        const result = await deleteTodo(id)
        if (!mountedRef.current) return result.ok
        if (result.ok) {
          setItems((prev) => removeTodo(prev, id))
          setNotice(null)
          setLast409(false)
          return true
        }
        setNotice(FAILURE)
        return false
      } finally {
        if (mountedRef.current) markPending(id, false)
        else pendingRef.current.delete(id)
      }
    },
    [markPending],
  )

  const dismissNotice = useCallback(() => setNotice(null), [])

  useEffect(() => {
    mountedRef.current = true
    void listTodos().then(applyList)
    return () => {
      mountedRef.current = false
    }
  }, [applyList])

  return {
    status,
    items,
    isFull: items.length >= MAX_TODOS || last409,
    notice,
    adding,
    pendingIds,
    reload,
    add,
    setCompleted,
    rename,
    remove,
    dismissNotice,
  }
}
