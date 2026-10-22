// 契约类型：docs/contracts/todoapp-api.yaml（OpenAPI 3.1）的 TypeScript 形式。
// 契约是交接物（AD-12），这里只做机械翻译；契约变更按 PRD §11 → 契约 → 本文件 的顺序走。

export type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'LIMIT_EXCEEDED' | 'INTERNAL_ERROR'

export const ERROR_CODES: readonly ErrorCode[] = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'LIMIT_EXCEEDED',
  'INTERNAL_ERROR',
]

/** ISO 8601 UTC，固定 3 位毫秒，以 Z 结尾，例如 2026-09-29T07:00:00.000Z。 */
export type Timestamp = string

export interface Todo {
  /** 小写规范 UUID */
  id: string
  /** 已裁剪，1..200 个 Unicode 码点，只按纯文本渲染 */
  title: string
  completed: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface TodoList {
  items: Todo[]
}

export interface CreateTodoRequest {
  title: string
}

/** title、completed 至少出现一项；出现的字段不得为 null。 */
export interface UpdateTodoRequest {
  title?: string
  completed?: boolean
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string }
}
