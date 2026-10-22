// Story 2.3（FE-1）：useTodoList 状态契约。
// Test ID：FE-S1（P0）、FE-S3（P0）、FE-S2（P1）、FE-S5（按 R-2 提到 P1）、FE-S4 的 hook 级 isFull 公式（test-design-qa.md）。
//
// 被测模块静态 import；加载失败直接让本文件报错，不吞掉（Story 1.1 教训）。
// 特殊场景只用 server.use()，不改 handlers.ts（AD-17）。
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { FAILURE } from '../api/messages.ts'
import type { Todo } from '../api/types.ts'
import { errorBody } from '../mocks/contractBackend.ts'
import { backend, scenarios } from '../mocks/handlers.ts'
import { server } from '../mocks/server.ts'
import { useTodoList } from './useTodoList.ts'

/** AD-19 固定接口（逐字照 story Dev Notes「useTodoList 行为」）。 */
interface TodoListModel {
  status: 'loading' | 'error' | 'ready'
  items: readonly Todo[]
  isFull: boolean
  notice: string | null
  adding: boolean
  pendingIds: ReadonlySet<string>
  reload(): Promise<void>
  add(title: string): Promise<boolean>
  setCompleted(id: string, completed: boolean): Promise<boolean>
  rename(id: string, title: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  dismissNotice(): void
}

/** 把请求交给契约替身应答（与 handlers.ts 同一份语义），用于「扣住再放行」的 handler。 */
async function viaBackend(request: Request): Promise<Response> {
  const res = backend.handle({
    method: request.method,
    path: new URL(request.url).pathname,
    contentType: request.headers.get('content-type'),
    bodyText: request.method === 'GET' || request.method === 'HEAD' ? null : await request.text(),
  })
  return res.body === undefined
    ? new HttpResponse(null, { status: res.status })
    : HttpResponse.json(res.body, { status: res.status })
}

/** 扣住某类请求直到 release()；hits 记录到达的请求，放行后由契约替身应答。 */
function gated(method: 'post' | 'patch', path: string) {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const hits: string[] = []
  const handler = http[method](path, async ({ request }) => {
    hits.push(new URL(request.url).pathname)
    await gate
    return viaBackend(request)
  })
  return { handler, release, hits }
}

const ACTIONS = ['reload', 'add', 'setCompleted', 'rename', 'remove', 'dismissNotice'] as const

describe('Story 2.3 useTodoList 状态契约', () => {
  it('[P0] AC-5 FE-S1/FE-S3/FE-S2/FE-S5 禁乐观更新、失败与 404 保留原状、在途去重、成功清 notice、isFull 公式', async () => {
    const [milk, bills] = backend.seed([{ title: '买牛奶' }, { title: '交水电费' }])
    const { result } = renderHook(() => useTodoList())
    // 挂载即 reload()，等首个 GET 落地
    await waitFor(() => expect(result.current.status).toBe('ready'))
    // 以本文件的 AD-19 固定接口取用，实际返回类型须结构兼容
    const model = (): TodoListModel => result.current

    const patch = gated('patch', '/api/todos/:id')
    server.use(patch.handler)
    try {
      let pending: Promise<boolean> | undefined
      act(() => {
        pending = model().setCompleted(milk.id, true)
      })

      // 本 AC 新承诺的标量：PATCH 在途（服务端未确认）时该条仍是操作前状态——禁乐观更新（FE-S1、R-2）
      expect(model().items.find((t) => t.id === milk.id)?.completed).toBe(false)

      await waitFor(() => expect(patch.hits).toHaveLength(1))
      expect(model().pendingIds.has(milk.id)).toBe(true)

      // FE-S2：同一条在途时忽略重复提交，不发第二个请求
      let duplicate: boolean | undefined
      await act(async () => {
        duplicate = await model().setCompleted(milk.id, true)
      })
      expect(duplicate).toBe(false)
      expect(patch.hits).toHaveLength(1)

      // 放行：服务端确认后才更新；切换完成不改变行位置（FR-4）
      patch.release()
      let confirmed: boolean | undefined
      await act(async () => {
        confirmed = await pending
      })
      expect(confirmed).toBe(true)
      expect(model().items.find((t) => t.id === milk.id)?.completed).toBe(true)
      expect(model().items.map((t) => t.id)).toEqual([bills.id, milk.id])
      expect(model().pendingIds.size).toBe(0)
      expect(model().notice).toBeNull()

      // FE-S1 失败路径：500 → items 与操作前深相等、notice=FAILURE、返回 false
      server.use(scenarios.internalError({ method: 'patch', once: true }))
      const beforeFailure = structuredClone([...model().items])
      let failed: boolean | undefined
      await act(async () => {
        failed = await model().setCompleted(bills.id, true)
      })
      expect(failed).toBe(false)
      expect(model().items).toEqual(beforeFailure)
      expect(model().notice).toBe(FAILURE)

      // FE-S5：dismissNotice 只清 notice，不改 status / items
      act(() => model().dismissNotice())
      expect(model().notice).toBeNull()
      expect(model().status).toBe('ready')
      expect(model().items).toEqual(beforeFailure)

      // FE-S3：陈旧页面 404（PATCH 改名、DELETE）→ 该条保留、字段不变、notice=FAILURE
      server.use(
        http.patch('/api/todos/:id', () => HttpResponse.json(errorBody('NOT_FOUND'), { status: 404 }), { once: true }),
        http.delete('/api/todos/:id', () => HttpResponse.json(errorBody('NOT_FOUND'), { status: 404 }), { once: true }),
      )
      const milkBefore = model().items.find((t) => t.id === milk.id)
      let renamed: boolean | undefined
      let removed: boolean | undefined
      await act(async () => {
        renamed = await model().rename(milk.id, '买豆浆')
      })
      await act(async () => {
        removed = await model().remove(milk.id)
      })
      expect(renamed).toBe(false)
      expect(removed).toBe(false)
      expect(model().items.find((t) => t.id === milk.id)).toEqual(milkBefore)
      expect(model().notice).toBe(FAILURE)

      // FE-S5：任一成功（含 reload）清 notice；reload 后以服务端数据为准
      await act(async () => {
        await model().reload()
      })
      expect(model().status).toBe('ready')
      expect(model().notice).toBeNull()
      expect(model().items).toEqual(backend.list())
    } finally {
      patch.release()
    }

    // add：在途时不插入（禁乐观更新）、第二次 add 返回 false 且只发 1 个 POST（FE-S2）
    const post = gated('post', '/api/todos')
    server.use(post.handler)
    try {
      let adding: Promise<boolean> | undefined
      act(() => {
        adding = model().add('写周报')
      })
      expect(model().items).toHaveLength(2)
      await waitFor(() => expect(post.hits).toHaveLength(1))
      expect(model().adding).toBe(true)
      let duplicateAdd: boolean | undefined
      await act(async () => {
        duplicateAdd = await model().add('写周报')
      })
      expect(duplicateAdd).toBe(false)
      expect(post.hits).toHaveLength(1)
      post.release()
      let added: boolean | undefined
      await act(async () => {
        added = await adding
      })
      expect(added).toBe(true)
      expect(model().items[0]?.title).toBe('写周报')
      expect(model().adding).toBe(false)
    } finally {
      post.release()
    }

    // isFull（FE-S4 的 hook 级部分）：items.length >= 500 || (last409 且之后无成功 DELETE/GET)
    backend.fill(500)
    await act(async () => {
      await model().reload()
    })
    expect(model().items).toHaveLength(500)
    expect(model().isFull).toBe(true)
    const oldest = model().items[499] as Todo
    await act(async () => {
      await model().remove(oldest.id)
    })
    expect(model().isFull).toBe(false)

    // 409 LIMIT_EXCEEDED → isFull=true 且不设操作失败提示（走容量横幅，不走 FailureNotice）
    server.use(
      http.post('/api/todos', () => HttpResponse.json(errorBody('LIMIT_EXCEEDED'), { status: 409 }), { once: true }),
    )
    let rejected: boolean | undefined
    await act(async () => {
      rejected = await model().add('超额的一条')
    })
    expect(rejected).toBe(false)
    expect(model().isFull).toBe(true)
    expect(model().notice).toBeNull()

    // 成功 DELETE 清零 last409
    const another = model().items[0] as Todo
    await act(async () => {
      await model().remove(another.id)
    })
    expect(model().items).toHaveLength(498)
    expect(model().isFull).toBe(false)

    // POST 500（容量校验失败）→ 操作失败提示，isFull 不因此变 true（FR-2）
    server.use(scenarios.internalError({ method: 'post', once: true }))
    await act(async () => {
      await model().add('又一条')
    })
    expect(model().notice).toBe(FAILURE)
    expect(model().isFull).toBe(false)

    // reload 失败 → status='error' 且 notice=FAILURE；再次成功 → ready
    server.use(scenarios.badGateway({ method: 'get', once: true }))
    await act(async () => {
      await model().reload()
    })
    expect(model().status).toBe('error')
    expect(model().notice).toBe(FAILURE)
    await act(async () => {
      await model().reload()
    })
    expect(model().status).toBe('ready')
    expect(model().notice).toBeNull()

    // 固定接口：六个动作都是函数
    expect(ACTIONS.filter((name) => typeof model()[name] !== 'function')).toEqual([])
  })

  it('[P1] AC-5 FE-S1 绿阶段补充：两个不同 id 的请求先后返回互不覆盖；add 网络错误设 FAILURE 且不置满', async () => {
    const [milk, bills] = backend.seed([{ title: '买牛奶' }, { title: '交水电费' }])
    const { result } = renderHook(() => useTodoList())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    const patch = gated('patch', '/api/todos/:id')
    server.use(patch.handler)
    try {
      let first: Promise<boolean> | undefined
      let second: Promise<boolean> | undefined
      act(() => {
        first = result.current.setCompleted(milk.id, true)
        second = result.current.rename(bills.id, '交电费')
      })
      await waitFor(() => expect(patch.hits).toHaveLength(2))
      expect(result.current.pendingIds).toEqual(new Set([milk.id, bills.id]))
      patch.release()
      await act(async () => {
        await Promise.all([first, second])
      })
      const byId = new Map(result.current.items.map((t) => [t.id, t]))
      expect(byId.get(milk.id)?.completed).toBe(true)
      expect(byId.get(bills.id)?.title).toBe('交电费')
      expect(result.current.pendingIds.size).toBe(0)
    } finally {
      patch.release()
    }

    server.use(scenarios.networkError({ method: 'post', once: true }))
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.add('写周报')
    })
    expect(ok).toBe(false)
    expect(result.current.items).toHaveLength(2)
    expect(result.current.notice).toBe(FAILURE)
    expect(result.current.isFull).toBe(false)
    expect(result.current.adding).toBe(false)
  })
})
