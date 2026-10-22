// Story 2.3（FE-1）：容器 TodoApp 的加载 / 空态 / 失败态与编辑态接线。
// Test ID：FE-L1（P0，R-10）、FE-L4（P1）、FE-L5（P0，R-2）、UX-DR13 容器职责（按 R-5 P1）（test-design-qa.md）。
//
// 被测模块静态 import；加载失败直接让本文件报错，不吞掉（Story 1.1 教训）。
// 所有 /api 由契约替身应答；特殊场景只用 server.use()，不改 handlers.ts（AD-17）。
// 注意：本文件位于 src/containers/，会被 scaffold.test.ts 的 hex 扫描覆盖，文件里不要写 # 开头的色值样式串。
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FAILURE } from '../api/messages.ts'
import { backend, scenarios } from '../mocks/handlers.ts'
import { server } from '../mocks/server.ts'
// story：TodoApp 无 props，具名导出（AD-19「具名导出」）
import { TodoApp } from './TodoApp.tsx'

const ROOT = resolve(import.meta.dirname, '../..')

function readSource(rel: string): string {
  return existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : ''
}

/** 扣住 GET /api/todos 直到 release()；放行后按契约返回替身当前数据。 */
function holdList() {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const handler = http.get('/api/todos', async () => {
    await gate
    return HttpResponse.json({ items: backend.list() })
  })
  return { handler, release }
}

const EMPTY_TITLE = '还没有待办'
const EMPTY_CAPTION = '在上面输入一件事，按回车就记下了'
const HELP_ADD = '回车添加 · 双击标题可修改'
const HELP_EDIT = '回车保存 · Esc 取消 · 清空后回车会删除这一条'

describe('Story 2.3 TodoApp 加载 / 空态 / 失败态与容器职责', () => {
  it('[P0] AC-1 FE-L1 GET 未返回时显示 aria-busy 骨架、不先渲染空清单，新增输入框不等 GET 即可输入', async () => {
    backend.seed([{ title: '买牛奶' }])
    const list = holdList()
    server.use(list.handler)
    try {
      const { container } = render(<TodoApp />)

      // 本 AC 新承诺的标量：status='loading' 时清单区是 aria-busy 的骨架
      const skeleton = container.querySelector('[aria-busy="true"]')
      expect(skeleton).not.toBeNull()

      // 占位行 aria-hidden，不含任何可被读屏当真实内容的元素
      const rows = Array.from((skeleton as HTMLElement).children)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.filter((r) => r.getAttribute('aria-hidden') !== 'true')).toEqual([])
      expect((skeleton as HTMLElement).querySelectorAll('li, input, [role="checkbox"], [role="listitem"]')).toHaveLength(0)

      // 不先渲染空清单 / 空态 / 失败态（FR-3、F8）
      expect(screen.queryByRole('list')).toBeNull()
      expect(screen.queryByText(EMPTY_TITLE)).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()

      // AD-13：输入框不等 GET 返回即可输入
      const input = screen.getByRole('textbox', { name: '新增待办标题' })
      expect(input).toBeEnabled()
      await userEvent.setup().type(input, '买')
      expect(input).toHaveValue('买')

      // 放行后骨架消失、清单出现
      list.release()
      await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull())
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
      expect(screen.getByRole('button', { name: '编辑：买牛奶' })).toBeInTheDocument()
    } finally {
      list.release()
    }
  })

  it('[P1] AC-3 FE-L4 GET 返回空清单时显示 EmptyState 引导文案、输入行可用、不渲染任何待办项', async () => {
    render(<TodoApp />)

    // 本 AC 新承诺的标量：status='ready' 且 0 条 → 空态引导文案
    await waitFor(() => expect(screen.queryByText(EMPTY_TITLE)).not.toBeNull())

    expect(screen.getByText(EMPTY_CAPTION)).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByRole('textbox', { name: '新增待办标题' })).toBeEnabled()
    // 空态与失败态互斥
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
    // 回归：AppHeader 的 level-1 heading「待办」（E2E 自检依赖）与 AppFooter 文案
    expect(screen.getByRole('heading', { level: 1, name: '待办' })).toBeInTheDocument()
    expect(screen.getByText('数据保存在服务器，换浏览器也不会丢')).toBeInTheDocument()
  })

  it('[P0] AC-4 FE-L5 GET 失败显示「重试」+ role=alert 的失败提示（不自动消失、可关闭），不渲染空态；重试成功后恢复清单', async () => {
    backend.seed([{ title: '买牛奶' }])
    server.use(scenarios.badGateway({ method: 'get', once: true }))
    const user = userEvent.setup()
    const view = render(<TodoApp />)

    // 本 AC 新承诺的标量：status='error' → LoadErrorRetry 的可见「重试」入口
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试' })).not.toBeNull())

    // FailureNotice：role=alert、文案 FAILURE；失败态与空态互斥、不同屏
    expect(screen.getByRole('alert')).toHaveTextContent(FAILURE)
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)

    // 不自动消失：组件里没有定时器，且一次无关交互后仍在
    const noticeSource = readSource('src/components/FailureNotice.tsx')
    expect(noticeSource).not.toBe('')
    expect(noticeSource).not.toMatch(/setTimeout|setInterval/)
    await user.tab()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    // ✕ 可读名「关闭提示」：关闭后 alert 消失、「重试」仍在
    await user.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()

    // 重试（handler 已恢复为契约替身）→ 清单出现、失败提示与「重试」消失
    await user.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
    view.unmount()

    // 其余两种 GET 失败（网络错误、契约 500）同样进入失败态而非空态
    for (const failure of [scenarios.networkError, scenarios.internalError]) {
      server.use(failure({ method: 'get', once: true }))
      const again = render(<TodoApp />)
      await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument())
      expect(screen.getByRole('alert')).toHaveTextContent(FAILURE)
      expect(screen.queryByText(EMPTY_TITLE)).toBeNull()
      again.unmount()
    }
  })

  it('[P1] AC-7 UX-DR13 编辑态由容器持有：点别的行的删除会先让未改动的编辑框失焦关闭（Story 3.4 失焦即退出，PM 1a），删除照常、焦点按 FE-3 接管；容器不做格式化/校验/文案映射', async () => {
    const [, , report] = backend.seed([{ title: '买牛奶' }, { title: '交水电费' }, { title: '写周报' }])
    const user = userEvent.setup()
    render(<TodoApp />)
    // 前置：等清单落地，依次进入「买牛奶」「写周报」的编辑态（同一时间最多一行），再成功删除「买牛奶」
    await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(3))
    await user.dblClick(screen.getByRole('button', { name: '编辑：买牛奶' }))
    await user.dblClick(screen.getByRole('button', { name: '编辑：写周报' }))
    expect(screen.queryByRole('textbox', { name: '编辑待办标题：买牛奶' })).toBeNull()
    expect(screen.getByRole('textbox', { name: '编辑待办标题：写周报' })).toHaveAttribute('aria-describedby', 'todo-help')
    expect(document.getElementById('todo-help')).toHaveTextContent(HELP_EDIT)
    await user.click(screen.getByRole('button', { name: '删除：买牛奶' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '删除：买牛奶' })).toBeNull())

    // 【1a】点删除前的失焦（内容未改）→ onCancel：「写周报」的编辑框已关闭，HelpLine 回到 add 文案
    expect(screen.queryByRole('textbox', { name: /^编辑待办标题：/ })).toBeNull()
    expect(screen.getByRole('button', { name: '编辑：写周报' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑：交水电费' })).toBeInTheDocument()
    expect(document.getElementById('todo-help')).toHaveTextContent(HELP_ADD)
    // 「买牛奶」被删除；「写周报」只是退出编辑，没有被 PATCH（标题与 updatedAt 不变）
    expect(backend.list().map((t) => t.title).sort()).toEqual(['交水电费', '写周报'].sort())
    const reportAfter = backend.list().find((t) => t.id === report.id)
    expect(reportAfter?.title).toBe('写周报')
    expect(reportAfter?.updatedAt).toBe(report.updatedAt)
    // 焦点按 FE-3 规则接管（被删的是最后一行 → 上一行的删除控件），TodoRow 不把焦点抢回「写周报」
    expect(screen.getByRole('button', { name: '删除：交水电费' })).toHaveFocus()

    // 删除正在编辑的行成功 → 容器退出编辑态，HelpLine 回到 add 文案
    await user.click(screen.getByRole('button', { name: '删除：写周报' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '删除：写周报' })).toBeNull())
    expect(screen.queryByRole('textbox', { name: /^编辑待办标题：/ })).toBeNull()
    expect(document.getElementById('todo-help')).toHaveTextContent(HELP_ADD)
    expect(backend.list().map((t) => t.title)).toEqual(['交水电费'])

    // 静态：退出编辑态只由容器以函数式更新执行（onRename、onDelete 两处）；
    // 容器不做裁剪 / 校验 / 时间格式化 / 文案映射，不直接查 DOM（focus 经 ref，除外）
    const source = readSource('src/containers/TodoApp.tsx')
    expect(source).not.toBe('')
    const functionalExit = /setEditingId\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\s*===\s*id\s*\?\s*null\s*:\s*\1\s*\)/g
    expect(source.match(functionalExit)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(source).not.toMatch(/formatRelative|lib\/formatTime/)
    expect(source).not.toMatch(/\b(trimTitle|checkTitle|titleLength)\b|api\/title/)
    expect(source).not.toMatch(/\b(FAILURE|CAPACITY|noticeFor)\b|api\/messages/)
    expect(source).not.toMatch(/\bdocument\.|querySelector|getElementById/)
    // App.tsx 只渲染 TodoApp（<h1>待办</h1> 改由 AppHeader 提供）
    const app = readSource('src/App.tsx')
    expect(app).toMatch(/<TodoApp\s*\/>/)
    expect(app).not.toMatch(/<h1/)
  })
})
