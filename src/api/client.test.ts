// Story 1.2（FE-0）ATDD 红阶段：统一 api 客户端错误归一（FE-U2）与清单合并纯函数（FE-U3）。
//
// 本文件约定的接口（story Dev Notes「client.ts 规则」「todos.ts」的建议签名，落地后属共享修改、串行）：
//   client.ts  request<T>(path, { method?, body?, timeoutMs? }) → Promise<ApiResult<T>>，永不抛异常
//              type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode }
//   todos.ts   listTodos / createTodo / updateTodo / deleteTodo（只经 client.ts）+ 纯函数 upsertTodo / removeTodo
//
// 红阶段 client.ts / todos.ts 还不存在：经绝对路径动态 import，保证 `tsc -b` 现在就能通过。
// 特殊场景只用 server.use()，不改 handlers.ts（AD-17）。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { errorBody } from '../mocks/contractBackend.ts'
import { backend, scenarios } from '../mocks/handlers.ts'
import { server } from '../mocks/server.ts'
import type { ErrorCode, Todo, UpdateTodoRequest } from './types.ts'

const ROOT = resolve(import.meta.dirname, '../..')

type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode }

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  timeoutMs?: number
}

interface ClientModule {
  request<T = unknown>(path: string, options?: RequestOptions): Promise<ApiResult<T>>
}

interface TodosModule {
  listTodos(): Promise<ApiResult<Todo[]>>
  createTodo(title: string): Promise<ApiResult<Todo>>
  updateTodo(id: string, patch: UpdateTodoRequest): Promise<ApiResult<Todo>>
  deleteTodo(id: string): Promise<ApiResult<void>>
  upsertTodo(items: readonly Todo[], todo: Todo): Todo[]
  removeTodo(items: readonly Todo[], id: string): Todo[]
}

async function load<T>(rel: string): Promise<{ mod: T | undefined; error: string }> {
  try {
    return { mod: (await import(/* @vite-ignore */ join(ROOT, rel))) as T, error: '' }
  } catch (e) {
    return { mod: undefined, error: `${rel} 加载失败：${String(e)}` }
  }
}

function walk(dir: string): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [relative(ROOT, join(abs, e.name))] : [],
  )
}

const MISSING_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

/** 纯函数用例的数据工厂：时间格式固定（3 位毫秒、Z），字典序即时间序。 */
function todo(overrides: Partial<Todo> & Pick<Todo, 'id' | 'createdAt'>): Todo {
  return { title: `待办 ${overrides.id.slice(0, 4)}`, completed: false, updatedAt: overrides.createdAt, ...overrides }
}

interface Row {
  name: string
  arrange?: () => void
  path: string
  options?: RequestOptions
  expected: ApiResult<unknown>
}

const INTERNAL: ApiResult<unknown> = { ok: false, code: 'INTERNAL_ERROR' }

// 每一行：契约状态表（GET 500；POST 400/409/500；PATCH 400/404/500；DELETE 404/500）内且 ErrorBody 合法、
// code 属于 4 个已知值 → 采用 code；其余一律 INTERNAL_ERROR。
const ERROR_ROWS: Row[] = [
  {
    name: '契约内 409：容量满 POST → LIMIT_EXCEEDED',
    arrange: () => backend.fill(500),
    path: '/api/todos',
    options: { method: 'POST', body: { title: '第 501 条' } },
    expected: { ok: false, code: 'LIMIT_EXCEEDED' },
  },
  {
    name: '契约内 400：POST 空白标题 → VALIDATION_ERROR',
    path: '/api/todos',
    options: { method: 'POST', body: { title: '   ' } },
    expected: { ok: false, code: 'VALIDATION_ERROR' },
  },
  {
    name: '契约内 404：PATCH 不存在的 id → NOT_FOUND',
    path: `/api/todos/${MISSING_ID}`,
    options: { method: 'PATCH', body: { completed: true } },
    expected: { ok: false, code: 'NOT_FOUND' },
  },
  {
    name: '契约内 404：DELETE 不存在的 id → NOT_FOUND',
    path: `/api/todos/${MISSING_ID}`,
    options: { method: 'DELETE' },
    expected: { ok: false, code: 'NOT_FOUND' },
  },
  {
    name: '契约内 500：GET → INTERNAL_ERROR',
    arrange: () => server.use(scenarios.internalError({ method: 'get', once: true })),
    path: '/api/todos',
    expected: INTERNAL,
  },
  {
    name: '契约外状态：PATCH 409（体合法）→ INTERNAL_ERROR',
    arrange: () =>
      server.use(http.patch('/api/todos/:id', () => HttpResponse.json(errorBody('LIMIT_EXCEEDED'), { status: 409 }), { once: true })),
    path: `/api/todos/${MISSING_ID}`,
    options: { method: 'PATCH', body: { completed: true } },
    expected: INTERNAL,
  },
  {
    name: '契约外状态：GET 404（体合法）→ INTERNAL_ERROR',
    arrange: () => server.use(http.get('/api/todos', () => HttpResponse.json(errorBody('NOT_FOUND'), { status: 404 }), { once: true })),
    path: '/api/todos',
    expected: INTERNAL,
  },
  {
    name: '契约外状态：POST 404（体合法）→ INTERNAL_ERROR',
    arrange: () => server.use(http.post('/api/todos', () => HttpResponse.json(errorBody('NOT_FOUND'), { status: 404 }), { once: true })),
    path: '/api/todos',
    options: { method: 'POST', body: { title: '买牛奶' } },
    expected: INTERNAL,
  },
  {
    name: '502 + text/html → INTERNAL_ERROR',
    arrange: () => server.use(scenarios.badGateway({ method: 'get', once: true })),
    path: '/api/todos',
    expected: INTERNAL,
  },
  {
    name: '503（即使体是合法 ErrorBody）→ INTERNAL_ERROR',
    arrange: () => server.use(http.post('/api/todos', () => HttpResponse.json(errorBody('VALIDATION_ERROR'), { status: 503 }), { once: true })),
    path: '/api/todos',
    options: { method: 'POST', body: { title: '买牛奶' } },
    expected: INTERNAL,
  },
  {
    name: '504（即使体是合法 ErrorBody）→ INTERNAL_ERROR',
    arrange: () => server.use(http.delete('/api/todos/:id', () => HttpResponse.json(errorBody('NOT_FOUND'), { status: 504 }), { once: true })),
    path: `/api/todos/${MISSING_ID}`,
    options: { method: 'DELETE' },
    expected: INTERNAL,
  },
  {
    name: '网络错误（fetch reject）→ INTERNAL_ERROR',
    arrange: () => server.use(scenarios.networkError({ method: 'post', once: true })),
    path: '/api/todos',
    options: { method: 'POST', body: { title: '买牛奶' } },
    expected: INTERNAL,
  },
  {
    name: '200 但响应体不是 JSON → INTERNAL_ERROR',
    arrange: () =>
      server.use(
        http.get('/api/todos', () => new HttpResponse('<html>ok</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), {
          once: true,
        }),
      ),
    path: '/api/todos',
    expected: INTERNAL,
  },
  {
    name: '400 但 code 不在 4 个之内 → INTERNAL_ERROR',
    arrange: () =>
      server.use(http.post('/api/todos', () => HttpResponse.json({ error: { code: 'TEAPOT', message: '茶壶' } }, { status: 400 }), { once: true })),
    path: '/api/todos',
    options: { method: 'POST', body: { title: '买牛奶' } },
    expected: INTERNAL,
  },
  {
    name: '400 但响应体不是 ErrorBody → INTERNAL_ERROR',
    arrange: () => server.use(http.post('/api/todos', () => HttpResponse.json({ message: 'bad' }, { status: 400 }), { once: true })),
    path: '/api/todos',
    options: { method: 'POST', body: { title: '买牛奶' } },
    expected: INTERNAL,
  },
  {
    name: '409 但响应体不是 JSON → INTERNAL_ERROR',
    arrange: () =>
      server.use(
        http.post('/api/todos', () => new HttpResponse('conflict', { status: 409, headers: { 'Content-Type': 'text/plain' } }), {
          once: true,
        }),
      ),
    path: '/api/todos',
    options: { method: 'POST', body: { title: '买牛奶' } },
    expected: INTERNAL,
  },
]

describe('Story 1.2 统一 api 客户端与清单合并（ATDD 红阶段）', () => {
  // 红阶段：T3.3（client.ts）+ T3.4（todos.ts）完成后去掉 skip
  it('[P0] AC-5 FE-U2/FE-U3 仅契约状态 + ErrorBody + 已知 code 才采用 code，其余 INTERNAL_ERROR；超时可注入；204 不读体；只有 client.ts 调 fetch；upsert/remove 按 id 合并并按 createdAt 倒序', async () => {
    const { mod: client, error: clientError } = await load<ClientModule>('src/api/client.ts')

    // 本 AC 新承诺的标量：契约错误状态采用 body 的 code（红阶段 client.ts 不存在）
    for (const row of ERROR_ROWS) {
      row.arrange?.()
      const result = await client?.request(row.path, row.options)
      expect(result, `${row.name}${clientError ? `（${clientError}）` : ''}`).toEqual(row.expected)
      server.resetHandlers()
      backend.reset()
    }

    // 超时：AbortSignal.timeout(timeoutMs) 可注入；fake timers 控制不了它，所以注入小值
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    server.use(
      http.get(
        '/api/todos',
        async () => {
          await delay('infinite')
          return HttpResponse.json({ items: [] })
        },
        { once: true },
      ),
    )
    expect(await client?.request('/api/todos', { timeoutMs: 50 }), '超时 → INTERNAL_ERROR').toEqual(INTERNAL)
    expect(timeoutSpy).toHaveBeenCalledWith(50)
    timeoutSpy.mockClear()
    await client?.request('/api/todos')
    expect(timeoutSpy, '默认超时 5000ms').toHaveBeenCalledWith(5000)

    // 同源相对 /api：fetch 收到字符串相对路径；写请求带 JSON 头
    const seen: Request[] = []
    server.use(
      http.post(
        '/api/todos',
        async ({ request }) => {
          seen.push(request.clone())
          return HttpResponse.json(errorBody('VALIDATION_ERROR'), { status: 400 })
        },
        { once: true },
      ),
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await client?.request('/api/todos', { method: 'POST', body: { title: '买牛奶' } })
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/todos')
    expect(new URL(seen[0]?.url ?? 'about:blank').origin).toBe(globalThis.location.origin)
    expect(seen[0]?.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await seen[0]?.json()).toEqual({ title: '买牛奶' })
    fetchSpy.mockRestore()

    // 成功：GET 200 原样给 data；DELETE 204 不读体（读 json 会抛 → 被错当 INTERNAL_ERROR）
    const [seeded] = backend.seed([{ title: '一' }])
    expect(await client?.request('/api/todos')).toEqual({ ok: true, data: { items: [seeded] } })
    expect(await client?.request(`/api/todos/${seeded.id}`, { method: 'DELETE' })).toEqual({ ok: true })
    backend.reset()

    // 只有 client.ts 调 fetch（应用代码范围：测试、src/test/、src/mocks/ 不受此限）
    const callers = walk('src')
      .filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith('src/test/') && !f.startsWith('src/mocks/'))
      .filter((f) => /\bfetch\s*\(/.test(readFileSync(join(ROOT, f), 'utf8')))
    expect(callers).toEqual(['src/api/client.ts'])

    // todos.ts：请求函数只经 client.ts；listTodos 解包 {items}；id 用 encodeURIComponent 拼进路径
    const { mod: todos, error: todosError } = await load<TodosModule>('src/api/todos.ts')
    backend.seed([{ title: '旧的' }, { title: '新的' }])
    const listed = await todos?.listTodos()
    expect(listed?.ok, todosError).toBe(true)
    expect(listed?.ok ? listed.data.map((t) => t.title) : listed).toEqual(['新的', '旧的'])
    const created = await todos?.createTodo('买牛奶')
    expect(created?.ok ? created.data.title : created).toBe('买牛奶')
    const encodeSpy = vi.spyOn(globalThis, 'fetch')
    expect(await todos?.updateTodo('a/b', { completed: true })).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(encodeSpy.mock.calls[0]?.[0]).toBe('/api/todos/a%2Fb')
    encodeSpy.mockRestore()
    expect(await todos?.deleteTodo(MISSING_ID)).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(readFileSync(join(ROOT, 'src/api/todos.ts'), 'utf8')).toMatch(/from\s+['"]\.\/client(\.ts)?['"]/)

    // 纯函数：按 id 写入或替换，再按 createdAt 字符串倒序；不修改入参
    const a = todo({ id: '00000000-0000-4000-8000-00000000000a', createdAt: '2026-10-20T01:00:00.000Z' })
    const b = todo({ id: '00000000-0000-4000-8000-00000000000b', createdAt: '2026-10-20T02:00:00.000Z' })
    const c = todo({ id: '00000000-0000-4000-8000-00000000000c', createdAt: '2026-10-20T03:00:00.000Z' })
    const items = Object.freeze([b, a])
    expect(todos?.upsertTodo(items, c)).toEqual([c, b, a])
    const renamedB = { ...b, title: '改过的', updatedAt: '2026-10-20T04:00:00.000Z' }
    expect(todos?.upsertTodo(Object.freeze([c, b, a]), renamedB)).toEqual([c, renamedB, a])
    expect(todos?.upsertTodo(Object.freeze([a]), b), '新条按 createdAt 置顶，不是追加到末尾').toEqual([b, a])
    expect(items).toEqual([b, a])
    expect(todos?.removeTodo(Object.freeze([c, b, a]), b.id)).toEqual([c, a])
    expect(todos?.removeTodo(items, MISSING_ID)).toEqual([b, a])
  })
})

// 绿阶段补充的次要分支（ATDD checklist「绿阶段要补的次要分支」AC-4 / AC-5），与上面同一套接口。
describe('Story 1.2 api 共享层次要分支', () => {
  it('[P0] FE-U2 PATCH/DELETE 的契约内 500 归 INTERNAL_ERROR；失败不重试；fetch 不设 mode/credentials；204 不读响应体', async () => {
    const { mod: client, error } = await load<ClientModule>('src/api/client.ts')

    server.use(scenarios.internalError({ method: 'patch', once: true }))
    expect(await client?.request(`/api/todos/${MISSING_ID}`, { method: 'PATCH', body: { completed: true } }), error).toEqual(INTERNAL)
    server.use(scenarios.internalError({ method: 'delete', once: true }))
    expect(await client?.request(`/api/todos/${MISSING_ID}`, { method: 'DELETE' })).toEqual(INTERNAL)

    // 失败不重试：502 只打一次上游
    let hits = 0
    server.use(
      http.get('/api/todos', () => {
        hits++
        return new HttpResponse('<html>502</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })
      }),
    )
    expect(await client?.request('/api/todos')).toEqual(INTERNAL)
    expect(hits).toBe(1)
    server.resetHandlers()

    // 同源默认行为：不设 mode / credentials；读请求不带 Content-Type
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await client?.request('/api/todos')
    const init = fetchSpy.mock.calls[0]?.[1]
    expect(init?.mode).toBeUndefined()
    expect(init?.credentials).toBeUndefined()
    expect(init?.headers).toBeUndefined()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    fetchSpy.mockRestore()

    // 204 不读体：成功删除时 Response 的 json()/text() 都不被调用
    const [seeded] = backend.seed([{ title: '要删的' }])
    const jsonSpy = vi.spyOn(Response.prototype, 'json')
    const textSpy = vi.spyOn(Response.prototype, 'text')
    expect(await client?.request(`/api/todos/${seeded.id}`, { method: 'DELETE' })).toEqual({ ok: true })
    expect(jsonSpy).not.toHaveBeenCalled()
    expect(textSpy).not.toHaveBeenCalled()
  })

  it('[P0] FE-U2 createTodo 原样发送标题（裁剪由调用方用 title.ts 做）；listTodos 失败原样透传 code', async () => {
    const { mod: todos, error } = await load<TodosModule>('src/api/todos.ts')
    const bodies: unknown[] = []
    server.use(
      http.post(
        '/api/todos',
        async ({ request }) => {
          bodies.push(await request.json())
          return HttpResponse.json(errorBody('VALIDATION_ERROR'), { status: 400 })
        },
        { once: true },
      ),
    )
    expect(await todos?.createTodo('  hi  '), error).toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(bodies).toEqual([{ title: '  hi  ' }])

    server.use(scenarios.badGateway({ method: 'get', once: true }))
    expect(await todos?.listTodos()).toEqual(INTERNAL)
  })

  it('[P1] FE-ST1 组件可 import 的 api/types、api/title、api/messages 不依赖请求层或 React 状态（AD-13）', () => {
    const files = ['src/api/types.ts', 'src/api/title.ts', 'src/api/messages.ts']
    for (const f of files) {
      const source = readFileSync(join(ROOT, f), 'utf8')
      const imports = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
      expect(
        imports.filter((p) => /(^|\/)(client|todos)(\.ts)?$|(^|\/)state\/|^react/.test(p)),
        `${f} 的 import`,
      ).toEqual([])
    }
  })
})
