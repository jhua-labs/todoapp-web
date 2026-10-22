// Story 2.4（FE-2）：新增输入行与容量已满提示。
// Test ID：FE-A2（P0，R-2）、FE-A3（P0，R-2）、FE-A4 / FE-S4 UI 部分（P1，R-1）、FE-A5（P1，R-2）（test-design-qa.md）。
// AC-1（FE-A1 / E2E-1）与 AC-6（可读名 + 全键盘）的主叶子在 e2e/add.spec.ts（真实浏览器焦点 / 键盘以 E2E 为准）；
// 本文件末尾的「绿阶段补充」describe 补组件级 / 集成级的次要分支（ATDD checklist「绿阶段要补的次要分支」）。
//
// ATDD 红阶段的跳过标记已在 Story 2.4 实现后全部去掉（每个叶子上方注释保留其对应的 task）。
// 被测模块静态 import（FE-1 的占位实现已存在，编译不受影响）；不吞掉 waitFor 失败（Story 1.1 / 2.3 教训）。
// 所有 /api 由契约替身应答；特殊场景只用 server.use()，不改 handlers.ts（AD-17）。
// 注意：本文件位于 src/components/，会被 scaffold.test.ts 的 hex 扫描覆盖，文件里不要写 # 开头的串。
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CAPACITY, FAILURE } from '../api/messages.ts'
import { TodoApp } from '../containers/TodoApp.tsx'
import { errorBody } from '../mocks/contractBackend.ts'
import { backend, scenarios } from '../mocks/handlers.ts'
import { server } from '../mocks/server.ts'
import { AddTodoForm } from './AddTodoForm.tsx'

const HELP_ADD = '回车添加 · 双击标题可修改'
const HELP_TOO_LONG = '标题最多 200 个字'
const PLACEHOLDER_ADD = '要做什么？按回车添加'
const PLACEHOLDER_FULL = '待办已满，先删掉一些吧'

/** 把请求交给契约替身应答（与 handlers.ts 同一份语义）。 */
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

/** 记录到达的 POST /api/todos 请求体，再交给契约替身应答。 */
function countPosts() {
  const bodies: string[] = []
  const handler = http.post('/api/todos', async ({ request }) => {
    bodies.push(await request.clone().text())
    return viaBackend(request)
  })
  return { handler, bodies }
}

function listTitles(): string[] {
  return screen.queryAllByRole('listitem').map((li) => li.textContent ?? '')
}

describe('Story 2.4 AddTodoForm / CapacityBanner（ATDD 主叶子）', () => {
  // 对应 task：T1.1–T1.3（草稿 + checkTitle / titleLength 派生、内嵌 TitleCounter、aria-invalid、按钮禁用、onChange 边沿上报）
  it('[P0] AC-2 FE-A2 空白仅无操作不发请求；超长进入超长态（201/200 转红、红框、添加置灰、HelpLine 切 tooLong）、请求不发，删字后恢复；计长按码点', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => true)
    const onTooLongChange = vi.fn()
    const view = render(
      <AddTodoForm
        disabled={false}
        pending={false}
        inputRef={createRef<HTMLInputElement>()}
        onTooLongChange={onTooLongChange}
        onSubmit={onSubmit}
      />,
    )
    const input = screen.getByRole('textbox', { name: '新增待办标题' })
    const button = screen.getByRole('button', { name: '添加待办' })

    await user.type(input, '字'.repeat(201))
    // 本 AC 新承诺的标量：超长时内嵌 TitleCounter 显示「201/200」（占位实现没有计数器）
    expect(screen.queryByText('201/200'), '超长态应内嵌 TitleCounter 显示 201/200').not.toBeNull()
    expect(screen.getByText('201/200')).toHaveClass('text-destructive')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(button).toBeDisabled()
    // 只按边沿上报：从不超长到超长恰好一次
    expect(onTooLongChange.mock.calls).toEqual([[true]])

    // 请求根本不发：回车、点按钮都不调 onSubmit
    await user.keyboard('{Enter}')
    await user.click(button)
    expect(onSubmit).not.toHaveBeenCalled()

    // 删一个字 → 恢复
    await user.type(input, '{Backspace}')
    expect(screen.getByText('200/200')).not.toHaveClass('text-destructive')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(button).toBeEnabled()
    expect(onTooLongChange.mock.calls).toEqual([[true], [false]])

    // 计长按码点（AD-7）：200 个 emoji（UTF-16 长度 400）不超长
    await user.clear(input)
    await user.click(input)
    await user.paste('😀'.repeat(200))
    expect(screen.getByText('200/200')).not.toHaveClass('text-destructive')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(button).toBeEnabled()

    // 空白（含全角空格 U+3000）：按钮禁用、回车无操作、草稿不变、不弹错误
    await user.clear(input)
    await user.type(input, '  \u3000 ')
    expect(screen.getByText('0/200')).toBeInTheDocument()
    expect(button).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input).toHaveValue('  \u3000 ')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onTooLongChange.mock.calls).toEqual([[true], [false]])
    view.unmount()

    // 集成：容器按上报切 HelpLine；超长 / 空白都不发 POST
    backend.seed([{ title: '已有' }])
    const posts = countPosts()
    server.use(posts.handler)
    render(<TodoApp />)
    await screen.findByRole('button', { name: '编辑：已有' })
    const appInput = screen.getByRole('textbox', { name: '新增待办标题' })
    await user.click(appInput)
    await user.paste('字'.repeat(201))
    const help = document.getElementById('todo-help')
    expect(help?.textContent).toBe(HELP_TOO_LONG)
    expect(help).toHaveClass('text-destructive')
    await user.keyboard('{Enter}')
    await user.type(appInput, '{Backspace}')
    expect(document.getElementById('todo-help')?.textContent).toBe(HELP_ADD)
    await user.clear(appInput)
    await user.type(appInput, '   {Enter}')
    expect(posts.bodies).toEqual([])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(listTitles()).toHaveLength(1)
  })

  // 对应 task：T1.2（提交：校验通过才 await onSubmit(裁剪后标题)，false 保留草稿）
  it('[P0] AC-3 FE-A3 新增请求失败（网络错误 / 502）→ 不显示新待办、FailureNotice 常驻可关闭、输入内容保留以便重试', async () => {
    const user = userEvent.setup()
    backend.seed([{ title: '已有' }])
    render(<TodoApp />)
    await screen.findByRole('button', { name: '编辑：已有' })
    const input = screen.getByRole('textbox', { name: '新增待办标题' })

    server.use(scenarios.networkError({ method: 'post', path: '/api/todos', once: true }))
    await user.type(input, '订周四会议室{Enter}')
    // 本 AC 新承诺的标量：POST 失败后头部出现操作失败提示（占位实现不提交，提示不会出现）
    await waitFor(() => expect(screen.queryByRole('alert')?.textContent ?? '', '新增失败应显示操作失败提示').toContain(FAILURE))
    expect(listTitles()).toHaveLength(1)
    expect(backend.list().map((t) => t.title)).toEqual(['已有'])
    expect(input).toHaveValue('订周四会议室')

    // 不瞬时消失：一次无关交互后仍在；点「关闭提示」才消失
    await user.tab()
    expect(screen.getByRole('alert')).toHaveTextContent(FAILURE)
    await user.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByRole('alert')).toBeNull()

    // 502 + text/html 同样走操作失败提示
    server.use(scenarios.badGateway({ method: 'post', path: '/api/todos', once: true }))
    await user.click(input)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('alert')?.textContent ?? '').toContain(FAILURE))
    expect(listTitles()).toHaveLength(1)
    expect(input).toHaveValue('订周四会议室')

    // 恢复后重试成功：置顶、提示消失、输入清空
    await user.click(input)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(listTitles()[0]).toContain('订周四会议室'))
    expect(listTitles()).toHaveLength(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(input).toHaveValue('')
  })

  // 对应 task：T1.2 + T1.4（提交、满额禁用 / 占位 / aria-describedby 透传）+ T2（CapacityBanner 琥珀样式）
  it('[P1] AC-4 FE-A4/FE-S4 POST 返回 409 → 容量横幅（role=status、CAPACITY、琥珀样式）、输入禁用 + 占位转文案 + aria-describedby，不显示操作失败；删除一条后恢复', async () => {
    const user = userEvent.setup()
    // 陈旧页面：本页只看到 2 条，服务端已满（另一处填满），POST 返回 409（只生效一次）
    backend.seed([{ title: '旧的' }, { title: '新的' }])
    render(<TodoApp />)
    await screen.findByRole('button', { name: '编辑：新的' })
    server.use(
      http.post('/api/todos', () => HttpResponse.json(errorBody('LIMIT_EXCEEDED'), { status: 409 }), { once: true }),
    )
    const input = screen.getByRole('textbox', { name: '新增待办标题' })
    await user.type(input, '第五百零一条{Enter}')

    // 本 AC 新承诺的标量：409 后出现容量横幅，文案为 CAPACITY（占位实现不提交，横幅不会出现）
    await waitFor(() => expect(document.getElementById('capacity-notice')?.textContent, '409 后应显示容量横幅').toBe(CAPACITY))
    const banner = screen.getByRole('status')
    expect(banner).toHaveAttribute('id', 'capacity-notice')
    expect(banner).toHaveClass('rounded-md', 'border-warning-border', 'bg-warning-surface', 'text-warning')
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('placeholder', PLACEHOLDER_FULL)
    expect(input).toHaveAttribute('aria-describedby', 'capacity-notice')
    expect(input).toHaveAccessibleDescription(CAPACITY)
    expect(screen.getByRole('button', { name: '添加待办' })).toBeDisabled()
    // 容量已满 ≠ 操作失败；草稿保留（add 返回 false）
    expect(screen.queryByRole('alert')).toBeNull()
    expect(input).toHaveValue('第五百零一条')
    expect(listTitles()).toHaveLength(2)

    // 删除一条（成功 DELETE 清 last409）→ 横幅消失、输入恢复
    await user.click(screen.getByRole('button', { name: '删除：旧的' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(input).toBeEnabled()
    expect(input).toHaveAttribute('placeholder', PLACEHOLDER_ADD)
    expect(input).not.toHaveAttribute('aria-describedby')
  })

  // 对应 task：T1.2（提交）
  it('[P1] AC-5 FE-A5 新增时后端返回 500（非 409）→ 显示操作失败提示而非容量横幅，输入仍可用、内容保留', async () => {
    const user = userEvent.setup()
    backend.seed([{ title: '已有' }])
    render(<TodoApp />)
    await screen.findByRole('button', { name: '编辑：已有' })
    server.use(scenarios.internalError({ method: 'post', path: '/api/todos', once: true }))
    const input = screen.getByRole('textbox', { name: '新增待办标题' })
    await user.type(input, '订周四会议室{Enter}')

    // 本 AC 新承诺的标量：500 走操作失败提示（占位实现不提交，提示不会出现）
    await waitFor(() => expect(screen.queryByRole('alert')?.textContent ?? '', '500 应显示操作失败提示').toContain(FAILURE))
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.getElementById('capacity-notice')).toBeNull()
    expect(input).toBeEnabled()
    expect(input).toHaveAttribute('placeholder', PLACEHOLDER_ADD)
    expect(input).toHaveValue('订周四会议室')
    expect(listTitles()).toHaveLength(1)
  })
})

/** 扣住 POST /api/todos：记录到达的请求体，等 release() 后再交给契约替身应答（照 useTodoList.test.tsx 的 gated 写法）。 */
function gatedPost() {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const bodies: string[] = []
  const handler = http.post('/api/todos', async ({ request }) => {
    bodies.push(await request.clone().text())
    await gate
    return viaBackend(request)
  })
  return { handler, release, bodies }
}

function renderForm(overrides: Partial<Parameters<typeof AddTodoForm>[0]> = {}) {
  const props = {
    disabled: false,
    pending: false,
    inputRef: createRef<HTMLInputElement>(),
    onTooLongChange: vi.fn(),
    onSubmit: vi.fn(async (_title: string) => true),
    ...overrides,
  }
  render(<AddTodoForm {...props} />)
  return {
    props,
    input: screen.getByRole('textbox', { name: '新增待办标题' }),
    button: screen.getByRole('button', { name: '添加待办' }),
  }
}

describe('Story 2.4 AddTodoForm / CapacityBanner（绿阶段补充分支）', () => {
  it('[P0] FE-A1 组件级：传裁剪后的标题；true 清空并把焦点放回输入框（回车与点按钮两条路径）；resolve 前不清空；false 保留草稿', async () => {
    const user = userEvent.setup()
    let resolveSubmit!: (ok: boolean) => void
    const onSubmit = vi.fn(
      (_title: string) =>
        new Promise<boolean>((r) => {
          resolveSubmit = r
        }),
    )
    const { input, button } = renderForm({ onSubmit })

    await user.type(input, '  订周四会议室  {Enter}')
    expect(onSubmit.mock.calls).toEqual([['订周四会议室']])
    // 服务端确认前不清空（禁乐观更新）
    expect(input).toHaveValue('  订周四会议室  ')
    resolveSubmit(true)
    await waitFor(() => expect(input).toHaveValue(''))
    expect(input).toHaveFocus()

    // 点「添加」提交：焦点从按钮回到输入框
    await user.type(input, '第二条')
    await user.click(button)
    expect(button).toHaveFocus()
    expect(onSubmit.mock.calls[1]).toEqual(['第二条'])
    resolveSubmit(true)
    await waitFor(() => expect(input).toHaveValue(''))
    expect(input).toHaveFocus()

    // 返回 false：草稿保留
    await user.type(input, '失败的一条{Enter}')
    expect(onSubmit.mock.calls[2]).toEqual(['失败的一条'])
    await act(async () => {
      resolveSubmit(false)
    })
    expect(input).toHaveValue('失败的一条')
    expect(input).toHaveFocus()
  })

  it('[P0] FE-A2 码点边界与非法字符：两端空白裁剪后 200 字可提交且收到裁剪值；U+0000 非法、按钮禁用、红框、不上报超长', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async (_title: string) => true)
    const onTooLongChange = vi.fn()
    const { input, button } = renderForm({ onSubmit, onTooLongChange })

    await user.click(input)
    await user.paste('  ' + 'a'.repeat(200) + '  ')
    expect(screen.getByText('200/200')).not.toHaveClass('text-destructive')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(button).toBeEnabled()
    await user.keyboard('{Enter}')
    expect(onSubmit.mock.calls).toEqual([['a'.repeat(200)]])
    await waitFor(() => expect(input).toHaveValue(''))

    await user.click(input)
    await user.paste('a\u0000b')
    expect(button).toBeDisabled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await user.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onTooLongChange).not.toHaveBeenCalled()
  })

  it('[P1] pending 时回车不提交但输入框与按钮不禁用（焦点不丢）；inputRef 对象 ref 与回调 ref 都指向真实 input', async () => {
    const user = userEvent.setup()
    const objectRef = createRef<HTMLInputElement>()
    const onSubmit = vi.fn(async (_title: string) => true)
    const { input, button } = renderForm({ pending: true, inputRef: objectRef, onSubmit })
    expect(objectRef.current).toBe(input)
    await user.type(input, '在途中{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input).toBeEnabled()
    expect(button).toBeEnabled()
    expect(input).toHaveFocus()
    expect(input).toHaveValue('在途中')
    cleanup()

    const callbackRef = vi.fn()
    const { input: input2 } = renderForm({ inputRef: callbackRef })
    expect(callbackRef).toHaveBeenCalledWith(input2)
  })

  it('[P1] AC-4 组件级满额 + AC-6 可读名：disabled 时输入 / 按钮禁用、占位转文案；describedById 原样透传，不传时无属性；可读名不来自占位符', () => {
    const { input, button } = renderForm()
    expect(input).toHaveAttribute('aria-label', '新增待办标题')
    expect(input).toHaveAttribute('placeholder', PLACEHOLDER_ADD)
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(button).toHaveTextContent('添加')
    // 空草稿：计数 0/200、按钮禁用
    expect(screen.getByText('0/200')).toBeInTheDocument()
    expect(button).toBeDisabled()
    cleanup()

    const full = renderForm({ disabled: true, describedById: 'x' })
    expect(full.input).toBeDisabled()
    expect(full.input).toHaveAttribute('placeholder', PLACEHOLDER_FULL)
    expect(full.input).toHaveAttribute('aria-describedby', 'x')
    expect(full.button).toBeDisabled()
  })

  it('[P0] FE-A1 集成：POST 扣住时列表不插入、输入不清空；放行后置顶 + 清空 + 焦点保留，可连续记；只发 1 个 POST 且标题已裁剪', async () => {
    const user = userEvent.setup()
    backend.seed([{ title: '已有' }])
    const held = gatedPost()
    server.use(held.handler)
    render(<TodoApp />)
    await screen.findByRole('button', { name: '编辑：已有' })
    const input = screen.getByRole('textbox', { name: '新增待办标题' })

    await user.type(input, '  订周四会议室  {Enter}')
    await waitFor(() => expect(held.bodies).toEqual([JSON.stringify({ title: '订周四会议室' })]))
    expect(listTitles()).toHaveLength(1)
    expect(input).toHaveValue('  订周四会议室  ')

    held.release()
    await waitFor(() => expect(listTitles()).toHaveLength(2))
    expect(listTitles()[0]).toContain('订周四会议室')
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()

    await user.keyboard('第二条{Enter}')
    await waitFor(() => expect(listTitles()).toHaveLength(3))
    expect(listTitles()[0]).toContain('第二条')
    expect(held.bodies).toHaveLength(2)
  })

  it('[P1] FE-A4/FE-S4 满 500 条：首个 GET 后显示容量横幅、新增框禁用并关联横幅描述、无操作失败提示；删除一条后恢复可新增', async () => {
    const user = userEvent.setup()
    backend.fill(500)
    render(<TodoApp />)
    const banner = await screen.findByRole('status')
    expect(banner).toHaveTextContent(CAPACITY)
    expect(banner).toHaveAttribute('id', 'capacity-notice')
    const input = screen.getByRole('textbox', { name: '新增待办标题' })
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('placeholder', PLACEHOLDER_FULL)
    expect(input).toHaveAttribute('aria-describedby', 'capacity-notice')
    expect(input).toHaveAccessibleDescription(CAPACITY)
    expect(screen.getByRole('button', { name: '添加待办' })).toBeDisabled()
    expect(screen.queryByRole('alert')).toBeNull()

    await user.click(screen.getAllByRole('button', { name: /^删除：/ })[0])
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(input).toBeEnabled()
    expect(input).toHaveAttribute('placeholder', PLACEHOLDER_ADD)
    expect(input).not.toHaveAttribute('aria-describedby')
  })
})
