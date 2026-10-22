// Story 3.3（FE-3）：勾选 / 删除的行为验收与删除后焦点接管（组件层）。
// Test ID：FE-T1（P0，R-2）→ AC-2；FE-R1（P0，R-2）→ AC-3、AC-5；FE-S3 前端面（R-6）→ AC-5 的陈旧页面 404（test-design-qa.md）。
// AC-1（E2E-2）与 AC-4（FE-R2 / E2E-4，真实焦点以 E2E 为准）的主叶子在 e2e/toggle-delete.spec.ts；
// 本文件的 FE-R2 焦点接管分支（AC-4，组件级，jsdom 焦点只作逻辑断言）、FE-T1 勾选成功分支（AC-1）是绿阶段补充。
// 注意：AC-2 / AC-3 / AC-5 描述的行为已由 FE-1（TodoRow + useTodoList + TodoApp 接线）实现，
// 这些叶子是行为验收，不是红阶段证据（checklist「激活即绿」一节）。
//
// TodoTitleEditor 归 Story 3.4，当前是占位（不调任何回调）。为证明「清空即删除」走同一条焦点规则（AC-4 第二句），
// 本文件把它换成一个桩：点击桩按钮即调 onDelete（只影响本文件；其他叶子都不进入编辑态）。
//
// 被测模块静态 import；加载失败直接让本文件报错，不吞掉（Story 1.1 / 2.3 教训）。
// 所有 /api 由契约替身应答；特殊场景只用 server.use()，不改 handlers.ts（AD-17）。
// 注意：本文件位于 src/components/，会被 scaffold.test.ts 的 hex 扫描覆盖，文件里不要写 # 开头的色值样式串。
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { FAILURE } from '../api/messages.ts'
import type { Todo } from '../api/types.ts'
import { TodoApp } from '../containers/TodoApp.tsx'
import { backend, scenarios } from '../mocks/handlers.ts'
import { server } from '../mocks/server.ts'
import { TodoList, type TodoListProps } from './TodoList.tsx'
import type { TodoTitleEditorProps } from './TodoTitleEditor.tsx'

vi.mock('./TodoTitleEditor.tsx', async () => {
  const { createElement } = await import('react')
  return {
    TodoTitleEditor: (p: TodoTitleEditorProps) =>
      createElement('button', { type: 'button', onClick: () => void p.onDelete() }, '桩：清空提交'),
  }
})

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

/** 扣住某类请求直到 release()；hits 记录到达的请求路径、bodies 记录请求体，放行后由契约替身应答。 */
function gated(method: 'patch' | 'delete', path: string) {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const hits: string[] = []
  const bodies: Array<string | null> = []
  const handler = http[method](path, async ({ request }) => {
    hits.push(new URL(request.url).pathname)
    bodies.push(method === 'delete' ? null : await request.clone().text())
    await gate
    return viaBackend(request)
  })
  return { handler, release, hits, bodies }
}

/** 在替身里直接删掉一条（模拟另一个标签页已删除），不经 MSW、不触发前端刷新。 */
function deleteBehindTheScenes(id: string) {
  const res = backend.handle({ method: 'DELETE', path: `/api/todos/${id}`, contentType: null, bodyText: null })
  expect(res.status).toBe(204)
}

/** 屏幕上各行的标题（按 DOM 顺序，取自「编辑：<标题>」按钮的文本）。 */
function screenTitles(): string[] {
  return screen.getAllByRole('listitem').map((li) => within(li).getByRole('button', { name: /^编辑：/ }).textContent ?? '')
}

/** 渲染容器并等首个 GET 落地（前置，不断言未实现的结果）。 */
async function renderReady(rows: number) {
  const user = userEvent.setup()
  render(<TodoApp />)
  await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(rows))
  return user
}

describe('Story 3.3 勾选 / 删除行为验收（ATDD 主叶子，组件层）', () => {
  // 对应 task：T2.2（FE-T1 失败）。行为已由 FE-1 实现。
  it('[P0] AC-2 FE-T1 切换失败（网络错误 / 500 / 502 / 陈旧页面 404）→ 该条保持未勾选、无删除线，显示操作失败提示', async () => {
    const [, bills] = backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
    const user = await renderReady(3)
    const checkbox = () => screen.getByRole('checkbox', { name: '标记完成：交水电费' })
    const title = () => screen.getByRole('button', { name: '编辑：交水电费' })

    // 网络错误
    server.use(scenarios.networkError({ method: 'patch', once: true }))
    await user.click(checkbox())

    // 本 AC 新承诺的标量：PATCH 失败后显示操作失败提示（不静默）
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE)
    // 该条保持操作前状态（不呈现为已切换）
    expect(checkbox()).toHaveAttribute('aria-checked', 'false')
    expect(title()).not.toHaveClass('line-through')
    expect(within(checkbox().closest('li') as HTMLElement).queryByText(/已完成/)).toBeNull()
    expect(backend.list().find((t) => t.id === bills.id)?.completed).toBe(false)

    // 契约内 500 与网关 502：同样保持原状 + 提示
    for (const fault of [scenarios.internalError, scenarios.badGateway]) {
      await user.click(screen.getByRole('button', { name: '关闭提示' }))
      expect(screen.queryByRole('alert')).toBeNull()
      server.use(fault({ method: 'patch', once: true }))
      await user.click(checkbox())
      expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE)
      expect(checkbox()).toHaveAttribute('aria-checked', 'false')
      expect(title()).not.toHaveClass('line-through')
    }

    // 陈旧页面：另一个标签页已删除该条 → 替身返回 404 → 保留 + 提示，不呈现为已切换
    await user.click(screen.getByRole('button', { name: '关闭提示' }))
    deleteBehindTheScenes(bills.id)
    await user.click(checkbox())
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE)
    expect(checkbox()).toHaveAttribute('aria-checked', 'false')
    expect(title()).not.toHaveClass('line-through')
    expect(screenTitles()).toEqual(['买牛奶', '交水电费', '写周报'])
  })

  // 对应 task：T2.2（FE-R1 删除）。行为已由 FE-1 实现。
  it('[P0] AC-3 FE-R1 删除无确认、等 204：点击即发 DELETE，确认前该行仍在且没有确认框，确认后移除、其余顺位不变', async () => {
    const [week, bills, milk] = backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
    const user = await renderReady(3)
    // 屏幕顺序 = 契约顺序（createdAt 倒序）：后 seed 的排在前面
    expect(backend.list().map((t) => t.title)).toEqual(['买牛奶', '交水电费', '写周报'])
    const confirmSpy = vi.spyOn(window, 'confirm')

    const del = gated('delete', '/api/todos/:id')
    server.use(del.handler)
    try {
      await user.click(screen.getByRole('button', { name: '删除：交水电费' }))

      // 本 AC 新承诺的标量：一次点击就发出恰好一个 DELETE（无确认步骤）
      await waitFor(() => expect(del.hits).toEqual([`/api/todos/${bills.id}`]))

      // 服务端确认前：该行仍在（禁乐观更新），页面上没有确认框，也没有调 window.confirm
      expect(screen.getByRole('button', { name: '删除：交水电费' })).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(confirmSpy).not.toHaveBeenCalled()
    } finally {
      del.release()
      confirmSpy.mockRestore()
    }

    // 204 后：该条消失，其余两行顺位补上、顺序不变；替身里也没有它了
    await waitFor(() => expect(screen.queryByRole('button', { name: '删除：交水电费' })).toBeNull())
    expect(screenTitles()).toEqual(['买牛奶', '写周报'])
    expect(backend.list().map((t) => t.id)).toEqual([milk.id, week.id])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // 对应 task：T2.2（FE-R1 失败 / 404）。行为已由 FE-1 实现。
  it('[P0] AC-5 FE-R1/FE-S3 删除失败（网络错误 / 500 / 502）或陈旧页面 404 → 该条保留、显示操作失败提示、不静默成功；之后成功删除清掉提示', async () => {
    const [week, bills] = backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
    const user = await renderReady(3)
    const deleteBills = () => screen.getByRole('button', { name: '删除：交水电费' })

    server.use(scenarios.networkError({ method: 'delete', once: true }))
    await user.click(deleteBills())

    // 本 AC 新承诺的标量：DELETE 失败后显示操作失败提示（不静默成功）
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE)
    // 该条保留在清单中，替身里也还在
    expect(screenTitles()).toEqual(['买牛奶', '交水电费', '写周报'])
    expect(backend.list().some((t) => t.id === bills.id)).toBe(true)

    for (const fault of [scenarios.internalError, scenarios.badGateway]) {
      await user.click(screen.getByRole('button', { name: '关闭提示' }))
      server.use(fault({ method: 'delete', once: true }))
      await user.click(deleteBills())
      expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE)
      expect(screenTitles()).toEqual(['买牛奶', '交水电费', '写周报'])
    }

    // 陈旧页面：另一个标签页已删除 → 替身返回 404 → 该条仍显示、提示失败（FR-8：不静默成功）
    await user.click(screen.getByRole('button', { name: '关闭提示' }))
    deleteBehindTheScenes(bills.id)
    await user.click(deleteBills())
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE)
    expect(screenTitles()).toEqual(['买牛奶', '交水电费', '写周报'])

    // 恢复正常后成功删除另一条 → 任一成功清掉 notice
    await user.click(screen.getByRole('button', { name: '删除：写周报' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '删除：写周报' })).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(backend.list().some((t) => t.id === week.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// 绿阶段补充：FE-R2 焦点接管（组件级，直接渲染 TodoList；真实浏览器焦点以 E2E 为准）
// ---------------------------------------------------------------------------------------------

/** 参考时间：上海 2026-10-20 10:00。 */
const NOW = new Date('2026-10-20T02:00:00.000Z')

/** 确定性数据工厂：固定 id 与时间（3 位毫秒 + Z）。 */
function todo(overrides: Partial<Todo> & Pick<Todo, 'id' | 'title' | 'createdAt'>): Todo {
  return { completed: false, updatedAt: overrides.createdAt, ...overrides }
}

const A = todo({ id: '3d7a1f20-5b6c-4d8e-9f01-2a3b4c5d6e71', title: '买牛奶', createdAt: '2026-10-20T01:59:00.000Z' })
const B = todo({ id: '3d7a1f20-5b6c-4d8e-9f01-2a3b4c5d6e72', title: '交水电费', createdAt: '2026-10-20T01:30:00.000Z' })
const C = todo({ id: '3d7a1f20-5b6c-4d8e-9f01-2a3b4c5d6e73', title: '写周报', createdAt: '2026-10-20T01:00:00.000Z' })

/** 可控的 Promise：测试决定 onDelete 何时、以什么结果返回。 */
function deferred() {
  let resolve!: (ok: boolean) => void
  const promise = new Promise<boolean>((r) => (resolve = r))
  return { promise, resolve }
}

function listProps(items: readonly Todo[], overrides: Partial<TodoListProps> = {}): TodoListProps {
  return {
    items,
    now: NOW,
    editingId: null,
    pendingIds: new Set<string>(),
    helpId: 'todo-help',
    onToggle: vi.fn(async () => true),
    onStartEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onEditTooLongChange: vi.fn(),
    onRename: vi.fn(async () => true),
    onDelete: vi.fn(async () => true),
    onEmptied: vi.fn(),
    ...overrides,
  }
}

const deleteButton = (title: string) => screen.getByRole('button', { name: `删除：${title}` })

/**
 * 渲染三行（或给定行），用键盘在 target 行的删除控件上按 Enter 发起删除；
 * onDelete 返回可控 Promise，resolve(true) 后父组件以去掉该行的 items rerender（模拟容器）。
 */
async function renderAndDelete(items: readonly Todo[], target: Todo, how: 'keyboard' | 'click' = 'keyboard') {
  const user = userEvent.setup()
  const d = deferred()
  const onDelete = vi.fn(() => d.promise)
  const onEmptied = vi.fn()
  const p = listProps(items, { onDelete, onEmptied })
  const view = render(<TodoList {...p} />)
  if (how === 'keyboard') {
    deleteButton(target.title).focus()
    await user.keyboard('{Enter}')
  } else {
    await user.click(deleteButton(target.title))
  }
  expect(onDelete).toHaveBeenCalledWith(target.id)
  const succeed = async (rerenderFirst = true) => {
    await act(async () => {
      if (rerenderFirst) view.rerender(<TodoList {...p} items={items.filter((t) => t.id !== target.id)} />)
      d.resolve(true)
      await d.promise
    })
  }
  const fail = async () => {
    await act(async () => {
      d.resolve(false)
      await d.promise
    })
  }
  return { onDelete, onEmptied, succeed, fail, view, p }
}

describe('Story 3.3 删除后焦点接管（FE-R2，组件级）', () => {
  it('[P0] AC-4 FE-R2 删中间行 → 下一行删除控件；确认前焦点不动', async () => {
    const r = await renderAndDelete([A, B, C], B)
    // 确认前：焦点仍在被删行的删除控件，未调 onEmptied（只在 true 之后接管）
    expect(deleteButton('交水电费')).toHaveFocus()
    expect(r.onEmptied).not.toHaveBeenCalled()
    await r.succeed()
    expect(deleteButton('写周报')).toHaveFocus()
    expect(r.onEmptied).not.toHaveBeenCalled()
  })

  it('[P0] AC-4 FE-R2 删末行 → 上一行删除控件；删首行 → 下一行优先于上一行', async () => {
    const last = await renderAndDelete([A, B, C], C)
    await last.succeed()
    expect(deleteButton('交水电费')).toHaveFocus()
    expect(last.onEmptied).not.toHaveBeenCalled()
    last.view.unmount()

    const first = await renderAndDelete([A, B, C], A)
    await first.succeed()
    expect(deleteButton('交水电费')).toHaveFocus()
    expect(first.onEmptied).not.toHaveBeenCalled()
  })

  it('[P0] AC-4 FE-R2 删光（父组件改渲染空列表或直接卸载 TodoList）→ onEmptied 恰 1 次，焦点不落在任何行控件上', async () => {
    // rerender 成空 items
    const emptied = await renderAndDelete([B], B)
    await emptied.succeed()
    expect(emptied.onEmptied).toHaveBeenCalledTimes(1)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    emptied.view.unmount()

    // 容器改渲染 EmptyState、TodoList 被卸载后 onDelete 才返回 true
    const user = userEvent.setup()
    const onEmptied = vi.fn()
    let unmount = () => {}
    const onDelete = vi.fn(async () => {
      unmount()
      return true
    })
    const view = render(<TodoList {...listProps([B], { onDelete, onEmptied })} />)
    unmount = () => view.unmount()
    await act(async () => {
      await user.click(deleteButton('交水电费'))
    })
    await waitFor(() => expect(onEmptied).toHaveBeenCalledTimes(1))
    expect(onDelete).toHaveBeenCalledWith(B.id)
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true)
  })

  it('[P0] AC-4 FE-R2 删除失败（onDelete 返回 false）→ 焦点不动、行仍在、不调 onEmptied', async () => {
    const r = await renderAndDelete([A, B, C], B)
    await r.fail()
    expect(deleteButton('交水电费')).toHaveFocus()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(r.onEmptied).not.toHaveBeenCalled()
    r.view.unmount()

    const only = await renderAndDelete([C], C)
    await only.fail()
    expect(only.onEmptied).not.toHaveBeenCalled()
  })

  it('[P0] AC-4 FE-R2 鼠标点击发起（焦点原本不在行内）也接管；父组件尚未 rerender（被删行仍在 DOM）也不把焦点放回被删行', async () => {
    const clicked = await renderAndDelete([A, B, C], B, 'click')
    await clicked.succeed()
    expect(deleteButton('写周报')).toHaveFocus()
    clicked.view.unmount()

    const stale = await renderAndDelete([A, B, C], B)
    await stale.succeed(false)
    // 此刻 B 仍在 DOM（父组件没有 rerender），焦点必须已在下一行
    expect(deleteButton('交水电费')).toBeInTheDocument()
    expect(deleteButton('写周报')).toHaveFocus()
    expect(stale.onEmptied).not.toHaveBeenCalled()

    // 唯一一行、父组件未 rerender：也不能把焦点留给被删行自己，而是 onEmptied
    stale.view.unmount()
    const lone = await renderAndDelete([A], A)
    await lone.succeed(false)
    expect(lone.onEmptied).toHaveBeenCalledTimes(1)
  })

  it('[P0] AC-4 FE-R2 编辑态清空后删除（经 TodoTitleEditor.onDelete）走同一条规则：下一行删除控件 / 唯一一条时 onEmptied', async () => {
    const user = userEvent.setup()
    const d = deferred()
    const onDelete = vi.fn(() => d.promise)
    const onEmptied = vi.fn()
    const p = listProps([A, B, C], { editingId: B.id, onDelete, onEmptied })
    const view = render(<TodoList {...p} />)

    await user.click(screen.getByRole('button', { name: '桩：清空提交' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith(B.id)
    await act(async () => {
      view.rerender(<TodoList {...p} editingId={null} items={[A, C]} />)
      d.resolve(true)
      await d.promise
    })
    expect(deleteButton('写周报')).toHaveFocus()
    expect(onEmptied).not.toHaveBeenCalled()
    view.unmount()

    const d2 = deferred()
    const onDelete2 = vi.fn(() => d2.promise)
    const onEmptied2 = vi.fn()
    const p2 = listProps([B], { editingId: B.id, onDelete: onDelete2, onEmptied: onEmptied2 })
    const view2 = render(<TodoList {...p2} />)
    await user.click(screen.getByRole('button', { name: '桩：清空提交' }))
    expect(onDelete2).toHaveBeenCalledWith(B.id)
    await act(async () => {
      view2.rerender(<TodoList {...p2} editingId={null} items={[]} />)
      d2.resolve(true)
      await d2.promise
    })
    expect(onEmptied2).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------------------------
// 绿阶段补充：集成（TodoApp + MSW 契约替身）
// ---------------------------------------------------------------------------------------------

describe('Story 3.3 勾选 / 删除集成补充（TodoApp + 契约替身）', () => {
  it('[P0] AC-1 FE-T1 勾选 / 取消：等 PATCH 200 确认后才划掉 / 恢复、「已完成 · 刚刚」、留在原位；键盘 Space 同样触发', async () => {
    const T = new Date('2026-10-20T02:00:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T)
    backend.useClock(() => T)
    const [, milk] = backend.seed([{ title: '写周报' }, { title: '买牛奶' }, { title: '交水电费' }])
    const user = await renderReady(3)
    const order = backend.list().map((t) => t.title)
    expect(screenTitles()).toEqual(order)
    const checkbox = () => screen.getByRole('checkbox', { name: '标记完成：买牛奶' })
    const title = () => screen.getByRole('button', { name: '编辑：买牛奶' })
    const row = () => checkbox().closest('li') as HTMLElement

    const on = gated('patch', '/api/todos/:id')
    server.use(on.handler)
    try {
      await user.click(checkbox())
      await waitFor(() => expect(on.hits).toEqual([`/api/todos/${milk.id}`]))
      expect(on.bodies).toEqual([JSON.stringify({ completed: true })])
      // 确认前：不先划掉（禁乐观更新）
      expect(checkbox()).toHaveAttribute('aria-checked', 'false')
      expect(title()).not.toHaveClass('line-through')
      expect(within(row()).queryByText(/已完成/)).toBeNull()
    } finally {
      on.release()
    }
    await waitFor(() => expect(checkbox()).toHaveAttribute('aria-checked', 'true'))
    expect(checkbox()).toHaveAttribute('data-state', 'checked')
    expect(title()).toHaveClass('line-through', 'text-muted-foreground')
    expect(row().querySelector('.text-success')?.textContent).toBe('已完成 · 刚刚')
    expect(screenTitles()).toEqual(order)
    server.resetHandlers()

    const off = gated('patch', '/api/todos/:id')
    server.use(off.handler)
    try {
      await user.click(checkbox())
      await waitFor(() => expect(off.hits).toHaveLength(1))
      expect(off.bodies).toEqual([JSON.stringify({ completed: false })])
      expect(checkbox()).toHaveAttribute('aria-checked', 'true')
    } finally {
      off.release()
    }
    await waitFor(() => expect(checkbox()).toHaveAttribute('aria-checked', 'false'))
    expect(title()).not.toHaveClass('line-through')
    expect(within(row()).queryByText(/已完成/)).toBeNull()
    expect(screenTitles()).toEqual(order)
    server.resetHandlers()

    // 键盘：聚焦复选框后按 Space
    checkbox().focus()
    await user.keyboard(' ')
    await waitFor(() => expect(checkbox()).toHaveAttribute('aria-checked', 'true'))
    expect(backend.list().find((t) => t.id === milk.id)?.completed).toBe(true)
    expect(screenTitles()).toEqual(order)
  })

  it('[P0] AC-4 FE-R2/FE-R1 删除后焦点（集成）：中间行 → 屏幕上紧挨其下那行的删除控件；失败时焦点不动；删光 → 新增输入框', async () => {
    backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
    const user = await renderReady(3)
    const order = backend.list().map((t) => t.title)
    expect(screenTitles()).toEqual(order)
    const [top, middle, bottom] = order as [string, string, string]

    // 失败：焦点留在原删除控件
    server.use(scenarios.internalError({ method: 'delete', once: true }))
    await user.click(deleteButton(middle))
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE)
    expect(deleteButton(middle)).toHaveFocus()

    // 成功：焦点到屏幕上紧挨其下那一行
    await user.click(deleteButton(middle))
    await waitFor(() => expect(screen.queryByRole('button', { name: `删除：${middle}` })).toBeNull())
    expect(deleteButton(bottom)).toHaveFocus()
    expect(screen.queryByRole('alert')).toBeNull()

    // 末行 → 上一行
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('button', { name: `删除：${bottom}` })).toBeNull())
    expect(deleteButton(top)).toHaveFocus()

    // 删光 → EmptyState + 新增输入框获焦
    await user.keyboard('{Enter}')
    expect(await screen.findByText('还没有待办')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '新增待办标题' })).toHaveFocus()
    expect(backend.list()).toEqual([])
  })
})
