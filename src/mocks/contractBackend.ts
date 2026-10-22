// 按 docs/contracts/todoapp-api.yaml 写的内存版后端替身（纯函数核心，不依赖 DOM / MSW / Playwright）。
//
// 两层测试共用同一份替身语义，避免「组件测试一套 mock、E2E 另一套 mock」各说各话：
//   - 组件测试：src/mocks/handlers.ts 把它接到 MSW 上；
//   - E2E：e2e/support/contractRoutes.ts 把它接到 page.route 上。
//
// 本文件的 normalizeTitle 与将来的 src/api/title.ts 是两份 AD-7 实现，这是有意的：
// 替身要独立于被测代码，两份都对照 title-cases.json 测试。不要把它们合并。
//
// 只实现契约写明的行为（含 AD-7/8/9/10/11 的细化）。契约之外的故障（502 + text/html、网络错误）
// 不在这里造，由各层的场景 helper 临时覆盖（MSW 用 server.use()，E2E 用 backend.failNext()）。
//
// 本文件同时被 tsconfig.app / tsconfig.test / tsconfig.e2e 检查：
// 只用 ES2023 内建 API，相对 import 带 .ts 扩展名。

import type { ErrorBody, ErrorCode, Todo } from '../api/types.ts'

/** 契约 TodoList.maxItems / FR-2 */
export const TODO_CAPACITY = 500
/** AD-7：裁剪后 1..200 个码点 */
export const MAX_TITLE_CODE_POINTS = 200
/** AD-8：只认小写规范 UUID，不匹配按「不存在」处理（404） */
export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** 契约 Timestamp.pattern */
export const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * title-cases.json 的 trimCodePoints。
 * 不在运行时读共享文件（mock 模式的浏览器包够不到 repo 外的路径），
 * 由 contractBackend.test.ts 与共享文件逐项比对，漂移即红。
 */
export const TRIM_CODE_POINTS: readonly number[] = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
  0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  0xfeff,
]

const TRIM_SET = new Set(TRIM_CODE_POINTS)

const MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: '请求不合法',
  NOT_FOUND: '待办不存在',
  LIMIT_EXCEEDED: '待办已满，请先清理',
  INTERNAL_ERROR: '服务器内部错误',
}

export interface FakeRequest {
  method: string
  /** URL 的 pathname，例如 /api/todos/3f2b8c1e-… */
  path: string
  contentType: string | null
  /** 原始请求体；没有请求体时为 null 或空串 */
  bodyText: string | null
}

export interface FakeResponse {
  status: number
  /** 有值时以 application/json 输出；204 没有 body */
  body?: unknown
}

export interface SeedInput {
  title?: string
  completed?: boolean
  id?: string
  createdAt?: string
  updatedAt?: string
}

export interface ContractBackend {
  handle(request: FakeRequest): FakeResponse
  /** 按给出顺序依次「新建」（后给出的更新，排在前面），返回写入的条目。 */
  seed(items: readonly SeedInput[]): Todo[]
  /** 补到 count 条（例如 fill(500) 造满额）。 */
  fill(count: number): Todo[]
  /** 契约顺序（createdAt 倒序）的副本。 */
  list(): Todo[]
  /** 注入时钟（AD-9 的 now()）；不传则恢复为真实时间。 */
  useClock(now?: () => Date): void
  /** 清空数据并恢复真实时钟。 */
  reset(): void
}

export function errorBody(code: ErrorCode): ErrorBody {
  return { error: { code, message: MESSAGES[code] } }
}

function error(status: number, code: ErrorCode): FakeResponse {
  return { status, body: errorBody(code) }
}

/** AD-7：只裁 trimCodePoints 列出的码点（全部在 BMP 内），不调用原生 trim()。 */
export function trimTitle(raw: string): string {
  let start = 0
  let end = raw.length
  while (start < end && TRIM_SET.has(raw.charCodeAt(start))) start++
  while (end > start && TRIM_SET.has(raw.charCodeAt(end - 1))) end--
  return raw.slice(start, end)
}

function hasForbiddenChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0) return true
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true
    }
  }
  return false
}

/** 返回裁剪后的合法标题；不合法返回 null。 */
export function normalizeTitle(raw: string): string | null {
  const trimmed = trimTitle(raw)
  if (hasForbiddenChar(trimmed)) return null
  const length = [...trimmed].length
  return length >= 1 && length <= MAX_TITLE_CODE_POINTS ? trimmed : null
}

function toTimestamp(ms: number): string {
  return new Date(ms).toISOString()
}

function isJsonContentType(contentType: string | null): boolean {
  return contentType !== null && /^application\/([\w.+-]+\+)?json\s*(;|$)/i.test(contentType.trim())
}

type JsonObject = Record<string, unknown>

/** POST/PATCH 的请求体：非 JSON Content-Type、缺体、畸形 JSON、非对象 → null（400）。 */
function parseObjectBody(request: FakeRequest): JsonObject | null {
  if (!isJsonContentType(request.contentType)) return null
  if (request.bodyText === null || request.bodyText === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(request.bodyText)
  } catch {
    return null
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as JsonObject)
    : null
}

function newId(): string {
  // crypto.randomUUID 输出即为小写规范 UUID（浏览器与 Node 都有全局 crypto）
  return globalThis.crypto.randomUUID()
}

export function createContractBackend(options: { now?: () => Date } = {}): ContractBackend {
  const realNow = () => new Date()
  let now = options.now ?? realNow
  let rows: Todo[] = []

  const sorted = () => [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  const copy = (t: Todo): Todo => ({ ...t })
  const nowMs = () => Math.trunc(now().getTime())

  /** AD-9：created_at = max(now, 当前 max(created_at) + 1ms)，全表严格递增且唯一。 */
  function nextCreatedAtMs(): number {
    const maxMs = rows.reduce((m, t) => Math.max(m, Date.parse(t.createdAt)), Number.NEGATIVE_INFINITY)
    return Math.max(nowMs(), maxMs + 1)
  }

  function insert(title: string, extra: SeedInput = {}): Todo {
    const createdAt = extra.createdAt ?? toTimestamp(nextCreatedAtMs())
    if (!TIMESTAMP_PATTERN.test(createdAt)) throw new Error(`seed: createdAt 格式不符合契约：${createdAt}`)
    if (rows.some((t) => t.createdAt === createdAt)) {
      throw new Error(`seed: createdAt 必须全表唯一（AD-9），重复：${createdAt}`)
    }
    const id = extra.id ?? newId()
    if (!ID_PATTERN.test(id)) throw new Error(`seed: id 必须是小写规范 UUID：${id}`)
    if (rows.some((t) => t.id === id)) throw new Error(`seed: id 重复：${id}`)
    const updatedAt = extra.updatedAt ?? createdAt
    if (!TIMESTAMP_PATTERN.test(updatedAt)) throw new Error(`seed: updatedAt 格式不符合契约：${updatedAt}`)
    if (updatedAt < createdAt) throw new Error('seed: updatedAt 不得早于 createdAt（todo_updated_after_chk）')
    const todo: Todo = { id, title, completed: extra.completed ?? false, createdAt, updatedAt }
    rows.push(todo)
    return copy(todo)
  }

  function create(request: FakeRequest): FakeResponse {
    const body = parseObjectBody(request)
    if (body === null || typeof body.title !== 'string') return error(400, 'VALIDATION_ERROR')
    const title = normalizeTitle(body.title)
    if (title === null) return error(400, 'VALIDATION_ERROR')
    // AD-10：先校验输入，再在锁内数条数
    if (rows.length >= TODO_CAPACITY) return error(409, 'LIMIT_EXCEEDED')
    return { status: 201, body: insert(title) }
  }

  function update(request: FakeRequest, id: string): FakeResponse {
    const body = parseObjectBody(request)
    // 「非法 id」与「非法请求体」同时出现时先报哪个，契约没有规定；测试不要断言这种组合。
    if (body === null) return error(400, 'VALIDATION_ERROR')
    if (!ID_PATTERN.test(id)) return error(404, 'NOT_FOUND')

    const hasTitle = Object.hasOwn(body, 'title')
    const hasCompleted = Object.hasOwn(body, 'completed')
    if (!hasTitle && !hasCompleted) return error(400, 'VALIDATION_ERROR') // {} 或只含未知字段
    let title: string | undefined
    if (hasTitle) {
      if (typeof body.title !== 'string') return error(400, 'VALIDATION_ERROR') // null / 类型不符
      const normalized = normalizeTitle(body.title)
      if (normalized === null) return error(400, 'VALIDATION_ERROR') // 空标题也是 400，前端改调 DELETE
      title = normalized
    }
    if (hasCompleted && typeof body.completed !== 'boolean') return error(400, 'VALIDATION_ERROR')
    const completed = hasCompleted ? (body.completed as boolean) : undefined

    const row = rows.find((t) => t.id === id)
    if (!row) return error(404, 'NOT_FOUND')
    const nextTitle = title ?? row.title
    const nextCompleted = completed ?? row.completed
    // AD-11：值真的变了才更新 updatedAt，且不早于 createdAt（GREATEST）
    if (nextTitle !== row.title || nextCompleted !== row.completed) {
      row.title = nextTitle
      row.completed = nextCompleted
      row.updatedAt = toTimestamp(Math.max(nowMs(), Date.parse(row.createdAt)))
    }
    return { status: 200, body: copy(row) }
  }

  function remove(id: string): FakeResponse {
    if (!ID_PATTERN.test(id)) return error(404, 'NOT_FOUND')
    const before = rows.length
    rows = rows.filter((t) => t.id !== id)
    return rows.length === before ? error(404, 'NOT_FOUND') : { status: 204 }
  }

  function handle(request: FakeRequest): FakeResponse {
    // 方法名按原样比较，不做大小写归一：fetch 不会把 'patch' 规范成 'PATCH'，真实后端会按不支持的方法返回 400。
    const method = request.method
    if (request.path === '/api/todos') {
      if (method === 'GET') return { status: 200, body: { items: sorted().map(copy) } }
      if (method === 'HEAD') return { status: 200 } // 与 Spring 对 GET 映射的 HEAD 处理一致：无响应体
      if (method === 'POST') return create(request)
      return error(400, 'VALIDATION_ERROR') // AD-8：不支持的方法 → 400
    }
    const match = /^\/api\/todos\/([^/]+)$/.exec(request.path)
    if (match) {
      const id = match[1]
      if (method === 'PATCH') return update(request, id)
      if (method === 'DELETE') return remove(id)
      return error(400, 'VALIDATION_ERROR')
    }
    return error(404, 'NOT_FOUND') // /api 下的未知路由
  }

  return {
    handle,
    seed(items) {
      return items.map((item, i) => {
        const title = item.title ?? `待办 ${rows.length + 1}`
        if (normalizeTitle(title) !== title) throw new Error(`seed[${i}]: 标题不符合契约（需已裁剪、1..200 码点）`)
        if (rows.length >= TODO_CAPACITY) throw new Error(`seed: 超过容量 ${TODO_CAPACITY}`)
        return insert(title, item)
      })
    },
    fill(count) {
      if (count > TODO_CAPACITY) throw new Error(`fill: 超过容量 ${TODO_CAPACITY}`)
      const missing = Math.max(0, count - rows.length)
      return this.seed(Array.from({ length: missing }, () => ({})))
    },
    list: () => sorted().map(copy),
    useClock(next) {
      now = next ?? realNow
    },
    reset() {
      rows = []
      now = options.now ?? realNow
    },
  }
}
