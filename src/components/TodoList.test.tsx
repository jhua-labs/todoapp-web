// Story 2.3（FE-1）：清单渲染、相对时间、XSS 与可访问性。
// Test ID：FE-L2（P0）、FE-L3（P1）、FE-U4（P1）、FE-X1（P0，R-8）、FE-K1（P0，R-5）（test-design-qa.md）。
//
// 被测模块静态 import；加载失败直接让本文件报错，不吞掉（Story 1.1 教训）。
// 本文件直接渲染 TodoList、注入固定 now，回调用 vi.fn()；不发网络请求。
// 注意：本文件位于 src/components/，会被 scaffold.test.ts 的 hex 扫描覆盖，文件里不要写 # 开头的色值样式串。
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Todo } from '../api/types.ts'
import { formatRelative } from '../lib/formatTime.ts'
import { useNow } from '../lib/useNow.ts'
import { TodoList } from './TodoList.tsx'

const ROOT = resolve(import.meta.dirname, '../..')

/** AD-19 文件归属表的 TodoList props（逐字照 story Dev Notes「props 契约」）。 */
interface TodoListProps {
  items: readonly Todo[]
  now: Date
  editingId: string | null
  pendingIds: ReadonlySet<string>
  helpId: string
  onToggle(id: string, completed: boolean): Promise<boolean>
  onStartEdit(id: string): void
  onCancelEdit(): void
  onEditTooLongChange(tooLong: boolean): void
  onRename(id: string, title: string): Promise<boolean>
  onDelete(id: string): Promise<boolean>
  onEmptied(): void
}

/** 递归列出 dir 下的非测试 .ts/.tsx（相对 todoapp-web 根）；目录不存在返回 []。 */
function sources(dir: string): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
        ? [relative(ROOT, join(abs, e.name))]
        : [],
  )
}

/** 参考时间：上海 2026-10-20 10:00（vitest 已设 TZ=Asia/Shanghai）。 */
const NOW = new Date('2026-10-20T02:00:00.000Z')

/** 确定性数据工厂：固定 id 与时间（3 位毫秒 + Z），overrides 覆盖任意字段。 */
function todo(overrides: Partial<Todo> & Pick<Todo, 'id' | 'title' | 'createdAt'>): Todo {
  return { completed: false, updatedAt: overrides.createdAt, ...overrides }
}

const MILK = todo({ id: '0b6f2c9e-1a3d-4c5e-9f70-1d2e3f4a5b61', title: '买牛奶', createdAt: '2026-10-20T01:59:30.000Z' })
const BILLS = todo({
  id: '0b6f2c9e-1a3d-4c5e-9f70-1d2e3f4a5b62',
  title: '交水电费',
  createdAt: '2026-10-20T01:15:00.000Z',
  completed: true,
  updatedAt: '2026-10-20T01:58:00.000Z',
})
const REPORT = todo({ id: '0b6f2c9e-1a3d-4c5e-9f70-1d2e3f4a5b63', title: '写周报', createdAt: '2026-10-19T10:40:00.000Z' })

function props(items: readonly Todo[], overrides: Partial<TodoListProps> = {}): TodoListProps {
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

/** 每行标题按钮（可读名「编辑：<标题>」）的文本，按 DOM 顺序。 */
function rowTitles(): string[] {
  return screen
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('button[aria-label^="编辑："]')?.textContent ?? '')
}

/** FE-U4 六档 + 边界（now = 上海 2026-10-20 10:00，除非另给 now）。 */
const RELATIVE_CASES: ReadonlyArray<{ name: string; iso: string; now?: string; expected: string }> = [
  { name: '59.999 秒前', iso: '2026-10-20T01:59:00.001Z', expected: '刚刚' },
  { name: '负 diff（服务端时钟略快）', iso: '2026-10-20T02:00:05.000Z', expected: '刚刚' },
  { name: '恰 60 秒', iso: '2026-10-20T01:59:00.000Z', expected: '1 分钟前' },
  { name: '45 分钟', iso: '2026-10-20T01:15:00.000Z', expected: '45 分钟前' },
  { name: '59 分钟', iso: '2026-10-20T01:01:00.000Z', expected: '59 分钟前' },
  { name: '恰 60 分钟（今天）', iso: '2026-10-20T01:00:00.000Z', expected: '今天 09:00' },
  { name: '今天补零', iso: '2026-10-20T00:05:00.000Z', expected: '今天 08:05' },
  { name: '昨天', iso: '2026-10-19T10:40:00.000Z', expected: '昨天 18:40' },
  { name: '昨天 00:00', iso: '2026-10-18T16:00:00.000Z', expected: '昨天 00:00' },
  { name: '前天 23:59（今年）', iso: '2026-10-18T15:59:00.000Z', expected: '10月18日' },
  { name: '今年', iso: '2026-10-17T02:00:00.000Z', expected: '10月17日' },
  { name: '今年 1 月 1 日', iso: '2025-12-31T16:00:00.000Z', expected: '1月1日' },
  { name: '去年', iso: '2025-12-31T15:59:59.000Z', expected: '2025年12月31日' },
  // 先比分钟档再比日历日：昨天 23:50 创建、今天 00:10 查看
  { name: '跨日但不足 60 分钟', iso: '2026-10-19T15:50:00.000Z', now: '2026-10-19T16:10:00.000Z', expected: '20 分钟前' },
]

describe('Story 2.3 TodoList 渲染与可访问性', () => {
  it('[P0] AC-2 FE-L2/FE-L3/FE-U4 按给入顺序（createdAt 倒序）逐行渲染，已完成样式与「已完成 · 相对时间」，formatRelative 六档，useNow 每 60 秒刷新', async () => {
    const { rerender } = render(<TodoList {...props([MILK, BILLS, REPORT])} />)

    // 本 AC 新承诺的标量：<ul> 里逐行渲染，顺序与 props（createdAt 倒序）一致
    expect(rowTitles()).toEqual(['买牛奶', '交水电费', '写周报'])

    expect(screen.getByRole('list').tagName).toBe('UL')
    const [milkRow, billsRow, reportRow] = screen.getAllByRole('listitem') as [HTMLElement, HTMLElement, HTMLElement]

    // 完成状态：已完成删除线 + 灰化，复选框受控
    expect(screen.getByRole('button', { name: '编辑：交水电费' })).toHaveClass('line-through', 'text-muted-foreground')
    expect(screen.getByRole('button', { name: '编辑：买牛奶' })).not.toHaveClass('line-through')
    expect(screen.getByRole('checkbox', { name: '标记完成：交水电费' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: '标记完成：买牛奶' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('checkbox', { name: '标记完成：写周报' })).toHaveAttribute('aria-checked', 'false')

    // 相对创建时间（AD-20：<time dateTime aria-label=ISO 原串>）
    const createdTime = (row: HTMLElement, iso: string) => row.querySelector(`time[datetime="${iso}"]`)
    expect(createdTime(milkRow, MILK.createdAt)).toHaveTextContent('刚刚')
    expect(createdTime(milkRow, MILK.createdAt)).toHaveAttribute('aria-label', MILK.createdAt)
    expect(createdTime(billsRow, BILLS.createdAt)).toHaveTextContent('45 分钟前')
    expect(createdTime(reportRow, REPORT.createdAt)).toHaveTextContent('昨天 18:40')

    // FE-L3：已完成行多一行绿色「已完成 · <updatedAt 相对时间>」；未完成行没有
    const doneLine = billsRow.querySelector('.text-success')
    expect(doneLine?.textContent).toBe('已完成 · 2 分钟前')
    expect(doneLine?.querySelector(`time[datetime="${BILLS.updatedAt}"]`)).toHaveAttribute('aria-label', BILLS.updatedAt)
    expect(milkRow.querySelector('.text-success')).toBeNull()
    expect(milkRow).not.toHaveTextContent('已完成')
    expect(reportRow).not.toHaveTextContent('已完成')

    // 切换完成（服务端确认后的新 items）不改变行位置（FR-4）
    rerender(<TodoList {...props([MILK, { ...BILLS, completed: false }, { ...REPORT, completed: true }])} />)
    expect(rowTitles()).toEqual(['买牛奶', '交水电费', '写周报'])

    // FE-U4：formatRelative 是唯一实现，纯函数、只看注入的 now
    expect(formatRelative).toBeTypeOf('function')
    const mismatches = RELATIVE_CASES.map(({ name, iso, now, expected }) => ({
      name,
      expected,
      actual: formatRelative(iso, now === undefined ? NOW : new Date(now)),
    })).filter((r) => r.actual !== r.expected)
    expect(mismatches).toEqual([])

    // useNow：每 60 秒刷新、卸载清定时器（只假定时器，不发网络请求）
    expect(useNow).toBeTypeOf('function')
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const hook = renderHook(() => useNow())
    expect(hook.result.current.getTime()).toBe(NOW.getTime())
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(hook.result.current.getTime()).toBe(NOW.getTime() + 60_000)
    hook.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('[P0] AC-6 FE-X1/FE-K1 标题只作文本节点，复选框/标题按钮/删除控件可读名与键盘路径，组件不越层 import', async () => {
    const IMG = '<img src=x onerror="window.__xss=1">'
    const SCRIPT = '<script>window.__xss=1</script>'
    const xss = [
      todo({ id: '7c1e4b2a-9d3f-4e6a-8b5c-2f1a0e9d8c71', title: IMG, createdAt: '2026-10-20T01:50:00.000Z' }),
      todo({ id: '7c1e4b2a-9d3f-4e6a-8b5c-2f1a0e9d8c72', title: SCRIPT, createdAt: '2026-10-20T01:40:00.000Z' }),
    ]
    const view = render(<TodoList {...props(xss)} />)

    // 本 AC 新承诺的标量：含 HTML 的标题原样作为文本渲染（FE-X1、NFR-XSS）
    expect(screen.getByRole('button', { name: `编辑：${IMG}` }).textContent).toBe(IMG)

    expect(screen.getByRole('button', { name: `编辑：${SCRIPT}` }).textContent).toBe(SCRIPT)
    expect(view.container.querySelector('img, script')).toBeNull()
    expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined()
    view.unmount()

    // 静态：src 下非测试源码不含 dangerouslySetInnerHTML（扫描集合不能为空，否则是假绿）
    const appSources = sources('src')
    expect(appSources.length).toBeGreaterThan(0)
    expect(appSources.filter((f) => readFileSync(join(ROOT, f), 'utf8').includes('dangerouslySetInnerHTML'))).toEqual([])

    // FE-K1：可读名、可见「删除」小标签、始终在 Tab 序中
    const props1 = props([MILK])
    render(<TodoList {...props1} />)
    const checkbox = screen.getByRole('checkbox', { name: '标记完成：买牛奶' })
    const title = screen.getByRole('button', { name: '编辑：买牛奶' })
    const del = screen.getByRole('button', { name: '删除：买牛奶' })
    expect(del).toHaveTextContent('删除')
    const delClasses = del.className.split(/\s+/)
    expect(delClasses.filter((c) => ['hidden', 'invisible', 'sr-only'].includes(c))).toEqual([])
    expect(getComputedStyle(del).display).not.toBe('none')
    expect(getComputedStyle(del).visibility).not.toBe('hidden')

    const user = userEvent.setup()
    await user.tab()
    expect(checkbox).toHaveFocus()
    await user.tab()
    expect(title).toHaveFocus()
    await user.tab()
    expect(del).toHaveFocus()

    // 单击标题不进入编辑；Enter、F2、双击各触发一次 onStartEdit(id)
    await user.click(title)
    expect(props1.onStartEdit).not.toHaveBeenCalled()
    title.focus()
    await user.keyboard('{Enter}')
    expect(props1.onStartEdit).toHaveBeenCalledTimes(1)
    await user.keyboard('{F2}')
    expect(props1.onStartEdit).toHaveBeenCalledTimes(2)
    await user.dblClick(title)
    expect(props1.onStartEdit).toHaveBeenCalledTimes(3)
    expect(props1.onStartEdit).toHaveBeenLastCalledWith(MILK.id)

    // 勾选只上报 onToggle(id, true)，未确认前勾选状态不变（受控，禁乐观更新）
    await user.click(checkbox)
    expect(props1.onToggle).toHaveBeenCalledWith(MILK.id, true)
    expect(checkbox).toHaveAttribute('aria-checked', 'false')

    // 删除无确认：直接 onDelete(id)，页面上没有任何对话框（AD-19、UX-DR16）
    await user.click(del)
    expect(props1.onDelete).toHaveBeenCalledWith(MILK.id)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()

    // AD-19 骨架：14 个组件文件都在；组件不得 import state/、api/client、api/todos（oxlint 规则的静态镜像）
    const expected = [
      'AppHeader', 'AppFooter', 'FailureNotice', 'ListSkeleton', 'EmptyState', 'LoadErrorRetry', 'HelpLine',
      'TitleCounter', 'TodoTimestamp', 'TodoList', 'TodoRow', 'TodoTitleEditor', 'AddTodoForm', 'CapacityBanner',
    ].map((name) => `src/components/${name}.tsx`)
    expect(expected.filter((f) => !existsSync(join(ROOT, f)))).toEqual([])
    const FORBIDDEN = /from\s+['"](?:@\/state\/|[./]+state\/|@\/api\/(?:client|todos)|[./]+api\/(?:client|todos))/
    const components = sources('src/components').filter((f) => !f.startsWith('src/components/ui/'))
    expect(components.length).toBeGreaterThanOrEqual(expected.length)
    expect(components.filter((f) => FORBIDDEN.test(readFileSync(join(ROOT, f), 'utf8')))).toEqual([])
  })
})
