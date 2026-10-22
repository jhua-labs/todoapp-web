// 替身诚实性（FE-M1 / FE-M2 的基座部分）：替身的行为必须和契约一致，否则组件测试和 E2E 绿了也不算数。
import { beforeEach, describe, expect, it } from 'vitest'
import type { Todo } from '../api/types.ts'
import { expandTitleCase, loadTitleCases } from '../test/sharedContracts.ts'
import {
  createContractBackend,
  ID_PATTERN,
  TIMESTAMP_PATTERN,
  TODO_CAPACITY,
  TRIM_CODE_POINTS,
  type ContractBackend,
  type FakeRequest,
} from './contractBackend.ts'

const JSON_TYPE = 'application/json'
const MISSING_ID = '00000000-0000-4000-8000-000000000000'
const UPPERCASE_ID = '3F2B8C1E-6A4D-4E7B-9C1A-2D5E8F0A1B2C'
const T0 = '2026-10-20T00:00:00.000Z'

function req(method: string, path: string, body?: unknown, contentType: string | null = JSON_TYPE): FakeRequest {
  return { method, path, contentType, bodyText: body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body) }
}

function errorCode(response: { body?: unknown }): string | undefined {
  return (response.body as { error?: { code?: string } } | undefined)?.error?.code
}

let api: ContractBackend
beforeEach(() => {
  api = createContractBackend({ now: () => new Date(T0) })
})

describe('标题规则与 title-cases.json 一致（AD-7）', () => {
  const shared = loadTitleCases()

  it('裁剪码点表与共享文件逐项相同', () => {
    const expected = shared.trimCodePoints.map((u) => Number.parseInt(u.slice(2), 16))
    expect([...TRIM_CODE_POINTS]).toEqual(expected)
  })

  it.each(shared.cases.map((c) => [c.name, c] as const))('PATCH 用例：%s', (_name, c) => {
    const [row] = api.seed([{ title: '原标题' }])
    const { input, trimmed } = expandTitleCase(c)
    const response = api.handle(req('PATCH', `/api/todos/${row.id}`, { title: input }))
    if (c.valid) {
      expect(response.status).toBe(200)
      expect((response.body as Todo).title).toBe(trimmed)
    } else {
      expect(response.status).toBe(400)
      expect(api.list()[0].title).toBe('原标题')
    }
  })

  it.each(shared.cases.map((c) => [c.name, c] as const))('POST 用例：%s', (_name, c) => {
    const { input, trimmed } = expandTitleCase(c)
    const response = api.handle(req('POST', '/api/todos', { title: input }))
    if (c.valid) {
      expect(response.status).toBe(201)
      expect((response.body as Todo).title).toBe(trimmed)
    } else {
      expect(response.status).toBe(400)
      expect(errorCode(response)).toBe('VALIDATION_ERROR')
    }
  })
})

describe('GET / POST', () => {
  it('新建条目符合契约：小写 UUID、completed=false、createdAt=updatedAt、3 位毫秒 UTC', () => {
    const response = api.handle(req('POST', '/api/todos', { title: '买牛奶' }))
    const todo = response.body as Todo
    expect(response.status).toBe(201)
    expect(todo.id).toMatch(ID_PATTERN)
    expect(todo).toMatchObject({ title: '买牛奶', completed: false, createdAt: T0, updatedAt: T0 })
    expect(todo.createdAt).toMatch(TIMESTAMP_PATTERN)
  })

  it('同一毫秒连续新建，createdAt 仍严格递增（AD-9），GET 按 createdAt 倒序', () => {
    for (const title of ['一', '二', '三']) api.handle(req('POST', '/api/todos', { title }))
    const response = api.handle(req('GET', '/api/todos'))
    const items = (response.body as { items: Todo[] }).items
    expect(response.status).toBe(200)
    expect(items.map((t) => t.title)).toEqual(['三', '二', '一'])
    expect(items.map((t) => t.createdAt)).toEqual([
      '2026-10-20T00:00:00.002Z',
      '2026-10-20T00:00:00.001Z',
      '2026-10-20T00:00:00.000Z',
    ])
  })

  it('满 500 条后 POST → 409 LIMIT_EXCEEDED，且不新增；非法标题仍先报 400', () => {
    api.fill(TODO_CAPACITY)
    const full = api.handle(req('POST', '/api/todos', { title: '再来一条' }))
    expect(full.status).toBe(409)
    expect(errorCode(full)).toBe('LIMIT_EXCEEDED')
    expect(api.list()).toHaveLength(TODO_CAPACITY)
    expect(api.handle(req('POST', '/api/todos', { title: '   ' })).status).toBe(400)
  })

  it.each([
    ['非 JSON Content-Type', req('POST', '/api/todos', { title: 'x' }, 'text/plain')],
    ['缺请求体', req('POST', '/api/todos')],
    ['畸形 JSON', req('POST', '/api/todos', '{"title":')],
    ['title 类型不符', req('POST', '/api/todos', { title: 123 })],
    ['缺 title', req('POST', '/api/todos', { name: 'x' })],
    ['不支持的方法', req('PUT', '/api/todos', { title: 'x' })],
    ['方法名小写（fetch 不会规范 patch）', req('patch', '/api/todos/00000000-0000-4000-8000-000000000000', { completed: true })],
  ])('%s → 400 VALIDATION_ERROR', (_name, request) => {
    const response = api.handle(request)
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
  })

  it('/api 下的未知路由 → 404 NOT_FOUND', () => {
    const response = api.handle(req('GET', '/api/nope'))
    expect(response.status).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
  })
})

describe('PATCH / DELETE（AD-8、AD-11）', () => {
  let todo: Todo
  beforeEach(() => {
    ;[todo] = api.seed([{ title: '写周报', createdAt: T0 }])
    api.useClock(() => new Date('2026-10-20T01:00:00.000Z'))
  })

  it.each([
    ['空 PATCH {}', {}],
    ['只含未知字段', { foo: 1 }],
    ['completed 为 null', { completed: null }],
    ['title 为 null', { title: null }],
    ['completed 类型不符（"true"）', { completed: 'true' }],
    ['空标题（前端应改调 DELETE）', { title: '  ' }],
  ])('%s → 400，数据不变', (_name, body) => {
    const response = api.handle(req('PATCH', `/api/todos/${todo.id}`, body))
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(api.list()).toEqual([todo])
  })

  it.each([
    ['非法格式 id', 'not-a-uuid'],
    ['大写 UUID', UPPERCASE_ID],
    ['合法格式但不存在', MISSING_ID],
  ])('PATCH %s → 404 NOT_FOUND', (_name, id) => {
    const response = api.handle(req('PATCH', `/api/todos/${id}`, { completed: true }))
    expect(response.status).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
  })

  it('值变了才更新 updatedAt；值没变 updatedAt 保持不动', () => {
    const changed = api.handle(req('PATCH', `/api/todos/${todo.id}`, { completed: true, extra: 'ignored' }))
    expect(changed.status).toBe(200)
    expect(changed.body).toMatchObject({ completed: true, title: '写周报', updatedAt: '2026-10-20T01:00:00.000Z' })

    api.useClock(() => new Date('2026-10-20T02:00:00.000Z'))
    const same = api.handle(req('PATCH', `/api/todos/${todo.id}`, { completed: true }))
    expect(same.body).toMatchObject({ updatedAt: '2026-10-20T01:00:00.000Z' })
  })

  it('时钟回拨到 createdAt 之前，updatedAt 取 createdAt（GREATEST，不触发 CHECK）', () => {
    api.useClock(() => new Date('2026-10-19T00:00:00.000Z'))
    const response = api.handle(req('PATCH', `/api/todos/${todo.id}`, { title: ' 改过的标题 ' }))
    expect(response.body).toMatchObject({ title: '改过的标题', updatedAt: T0 })
  })

  it('DELETE 存在 → 204 无响应体；再删 → 404', () => {
    const first = api.handle(req('DELETE', `/api/todos/${todo.id}`))
    expect(first).toEqual({ status: 204 })
    expect(api.list()).toEqual([])
    expect(api.handle(req('DELETE', `/api/todos/${todo.id}`)).status).toBe(404)
    expect(api.handle(req('DELETE', '/api/todos/not-a-uuid')).status).toBe(404)
  })
})

describe('seed 守住契约，防止测试数据本身违约', () => {
  it.each([
    ['重复 createdAt', [{ createdAt: T0 }, { createdAt: T0 }]],
    ['未裁剪的标题', [{ title: ' x ' }]],
    ['大写 id', [{ id: UPPERCASE_ID }]],
    ['updatedAt 格式不符', [{ createdAt: T0, updatedAt: '2026-10-20T01:00:00Z' }]],
    ['updatedAt 早于 createdAt', [{ createdAt: T0, updatedAt: '2026-10-19T00:00:00.000Z' }]],
  ])('%s → 抛错', (_name, items) => {
    expect(() => api.seed(items)).toThrow()
  })
})
