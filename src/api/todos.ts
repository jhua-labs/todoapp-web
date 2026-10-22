// 待办接口的请求函数（只经 client.ts）与清单合并纯函数（AD-13）。
// 请求函数与纯函数只由 FE-1 的 useTodoList 调用；组件不得 import 本文件（AD-19，oxlint 落实）。
import { request, type ApiResult } from './client.ts'
import type { Todo, TodoList, UpdateTodoRequest } from './types.ts'

const itemPath = (id: string) => `/api/todos/${encodeURIComponent(id)}`

export async function listTodos(): Promise<ApiResult<Todo[]>> {
  const result = await request<TodoList>('/api/todos')
  return result.ok ? { ok: true, data: result.data.items } : result
}

/** 标题原样发送：裁剪由调用方用 title.ts 做，这里不裁剪。 */
export function createTodo(title: string): Promise<ApiResult<Todo>> {
  return request<Todo>('/api/todos', { method: 'POST', body: { title } })
}

export function updateTodo(id: string, patch: UpdateTodoRequest): Promise<ApiResult<Todo>> {
  return request<Todo>(itemPath(id), { method: 'PATCH', body: patch })
}

export function deleteTodo(id: string): Promise<ApiResult<void>> {
  return request<void>(itemPath(id), { method: 'DELETE' })
}

/** createdAt 字符串倒序（时间格式固定 3 位毫秒 + Z，字典序即时间序）。 */
function byCreatedAtDesc(a: Todo, b: Todo): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
}

/** POST/PATCH 成功：按 id 写入或替换，再按 createdAt 倒序。不修改入参。 */
export function upsertTodo(items: readonly Todo[], todo: Todo): Todo[] {
  const next = items.filter((t) => t.id !== todo.id)
  next.push(todo)
  return next.sort(byCreatedAtDesc)
}

/** DELETE 成功：按 id 移除。不修改入参。 */
export function removeTodo(items: readonly Todo[], id: string): Todo[] {
  return items.filter((t) => t.id !== id)
}
