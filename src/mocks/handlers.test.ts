// MSW 接线自检（FE-M1 基座部分）：经真实 fetch 走到替身；AD-12 要求的故障场景可用；未处理请求直接报错。
// 也是后续 story 写组件测试时的用法示例：特殊场景用 server.use()，不改 handlers.ts。
import { describe, expect, it, vi } from 'vitest'
import type { TodoList } from '../api/types.ts'
import { backend, scenarios } from './handlers.ts'
import { server } from './server.ts'

const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

describe('MSW handlers 按契约运行', () => {
  it('相对路径 /api 经 fetch 打到替身，数据来自 backend.seed()', async () => {
    // Given 替身里已有两条
    backend.seed([{ title: '旧的' }, { title: '新的' }])

    // When 前端用相对路径请求
    const response = await fetch('/api/todos')

    // Then 拿到契约形状、按 createdAt 倒序
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    const { items } = (await response.json()) as TodoList
    expect(items.map((t) => t.title)).toEqual(['新的', '旧的'])
  })

  it('POST 写入后 GET 可见；204 没有响应体', async () => {
    const created = await fetch('/api/todos', { method: 'POST', ...json({ title: '  hi  ' }) })
    expect(created.status).toBe(201)
    const { id, title } = (await created.json()) as { id: string; title: string }
    expect(title).toBe('hi')

    const deleted = await fetch(`/api/todos/${id}`, { method: 'DELETE' })
    expect(deleted.status).toBe(204)
    expect(await deleted.text()).toBe('')
    expect(backend.list()).toEqual([])
  })

  it('容量 500：backend.fill(500) 后 POST → 409 LIMIT_EXCEEDED', async () => {
    backend.fill(500)
    const response = await fetch('/api/todos', { method: 'POST', ...json({ title: '满了' }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'LIMIT_EXCEEDED' } })
  })

  it('空 PATCH / 只含未知字段 → 400；非法 id → 404', async () => {
    const [todo] = backend.seed([{ title: '写周报' }])
    const patch = (id: string, body: unknown) => fetch(`/api/todos/${id}`, { method: 'PATCH', ...json(body) })

    expect((await patch(todo.id, {})).status).toBe(400)
    expect((await patch(todo.id, { foo: 1 })).status).toBe(400)
    expect((await patch('not-a-uuid', { completed: true })).status).toBe(404)
  })

  it('裸 /api 也由替身应答（404 NOT_FOUND），与 E2E 侧拦截范围一致', async () => {
    const response = await fetch('/api')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('scenarios.badGateway：502 + text/html（前端须归为 INTERNAL_ERROR）', async () => {
    server.use(scenarios.badGateway({ method: 'get', path: '/api/todos', once: true }))

    const failed = await fetch('/api/todos')
    expect(failed.status).toBe(502)
    expect(failed.headers.get('content-type')).toMatch(/^text\/html/)

    // once: true 只生效一次，之后回到契约替身
    expect((await fetch('/api/todos')).status).toBe(200)
  })

  it('scenarios.networkError：fetch 直接 reject', async () => {
    server.use(scenarios.networkError({ method: 'post' }))
    await expect(fetch('/api/todos', { method: 'POST', ...json({ title: 'x' }) })).rejects.toThrow(TypeError)
  })

  it('scenarios.internalError：契约内的 500 INTERNAL_ERROR', async () => {
    server.use(scenarios.internalError({ method: 'post', path: '/api/todos' }))
    const response = await fetch('/api/todos', { method: 'POST', ...json({ title: 'x' }) })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } })
  })

  it('AbortSignal.timeout 可用（client.ts 的超时靠它，fake timers 控制不了，测试里注入小值）', async () => {
    const { http, delay } = await import('msw')
    server.use(http.get('/api/todos', async () => { await delay(200); return Response.json({ items: [] }) }, { once: true }))
    await expect(fetch('/api/todos', { signal: AbortSignal.timeout(20) })).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it("onUnhandledFrame: 'error'：没有 handler 的请求直接失败，不会放行到真实网络", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(fetch('http://127.0.0.1:8080/api/todos')).rejects.toThrow(TypeError)
    expect(consoleError).toHaveBeenCalled()
  })
})
