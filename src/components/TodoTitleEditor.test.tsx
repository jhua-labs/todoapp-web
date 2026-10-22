// Story 3.4（FE-4）：行内编辑标题（含清空即删除）——组件层 ATDD 红阶段主叶子。
// Test ID：FE-E1（P0，R-5）→ AC-1；FE-E2（P0，R-5）→ AC-3；FE-E3（P1，R-2）→ AC-4、AC-6（test-design-qa.md）。
// AC-2 / AC-5 / AC-7（E2E-3，P0，真实浏览器键盘路径为准）的主叶子在 e2e/edit.spec.ts。
// 次要分支（未改 Enter/blur → onCancel、去重、Esc 后忽略 blur、陈旧页面 404、失焦进入另一行、200 emoji 等）
// 是绿阶段补充，见 atdd-checklist-3-4-…md「绿阶段要补的次要分支」，加进本文件，不另起一套。
//
// 红绿约定（project-context「skip 和 tag 是两件事」）：每个 it.skip 上方写明对应 task；
// 5.3 实现 T1 后去掉 skip，story 完成时本文件不应再有 skip。本 story 不写 @needs-staging。
//
// 被测模块静态 import；不吞 waitFor 失败（Story 1.1 / 2.3 教训）。
// /api 由契约替身应答；特殊场景只用 server.use()，不改 handlers.ts（AD-17）。不 mock TodoTitleEditor（被测对象就是它）。
// 注意：本文件位于 src/components/，会被 scaffold.test.ts 的 hex 扫描覆盖，文件里不要写 # 开头的色值样式串。
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { FAILURE } from '../api/messages.ts'
import { TodoApp } from '../containers/TodoApp.tsx'
import { backend, scenarios } from '../mocks/handlers.ts'
import { server } from '../mocks/server.ts'
import { expandTitleCase, loadTitleCases } from '../test/sharedContracts.ts'
import { TodoTitleEditor, type TodoTitleEditorProps } from './TodoTitleEditor.tsx'

const HELP_EDIT = '回车保存 · Esc 取消 · 清空后回车会删除这一条'
const HELP_ADD = '回车添加 · 双击标题可修改'
const HELP_TOO_LONG = '标题最多 200 个字'

/** 共享标题用例表（docs/contracts/title-cases.json）里按名字取一条，展开 repeat / pad。 */
function titleCase(name: string): string {
  const found = loadTitleCases().cases.find((c) => c.name === name)
  if (!found) throw new Error(`title-cases.json 里没有用例「${name}」`)
  return expandTitleCase(found).input
}

/** 组件级默认 props：回调全部是 vi.fn()，onSave / onDelete 默认 resolve true。 */
function editorProps() {
  return {
    initialTitle: '买牛奶',
    describedById: 'todo-help',
    pending: false,
    onTooLongChange: vi.fn<TodoTitleEditorProps['onTooLongChange']>(),
    onSave: vi.fn<TodoTitleEditorProps['onSave']>(async () => true),
    onCancel: vi.fn<TodoTitleEditorProps['onCancel']>(),
    onDelete: vi.fn<TodoTitleEditorProps['onDelete']>(async () => true),
  }
}

/** 直接渲染编辑器（组件级），可覆盖任一默认 prop（保持 Mock 类型，便于断言调用）。 */
function renderEditor(overrides: Partial<ReturnType<typeof editorProps>> = {}) {
  const props = { ...editorProps(), ...overrides }
  const user = userEvent.setup()
  const view = render(<TodoTitleEditor {...props} />)
  const editor = () => screen.getByRole('textbox', { name: `编辑待办标题：${props.initialTitle}` })
  return { props, user, view, editor }
}

/** 渲染容器并等首个 GET 落地（前置，不断言未实现的结果）。 */
async function renderReady(rows: number) {
  const user = userEvent.setup()
  render(<TodoApp />)
  await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(rows))
  return user
}

describe('Story 3.4 行内编辑（ATDD 主叶子，组件层）', () => {
  // 对应 task：T1.1–1.2（内嵌 TitleCounter；可读名 / aria-describedby / autoFocus 保留）+ T2.2 进入。
  // 红：占位编辑器只渲染 Input，没有内嵌计数器。
  it('[P0] AC-1 FE-E1 双击标题进入编辑：就地出现「编辑待办标题：<原标题>」输入框，内嵌计数器「4/200」，帮助行经 aria-describedby 关联为编辑文案', async () => {
    backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
    const user = await renderReady(3)

    await user.dblClick(screen.getByRole('button', { name: '编辑：交水电费' }))
    const editor = screen.getByRole('textbox', { name: '编辑待办标题：交水电费' })
    const row = editor.closest('li') as HTMLElement

    // 本 AC 新承诺的标量：编辑框内嵌 TitleCounter，显示裁剪后码点数「4/200」
    expect(within(row).getByText('4/200')).toBeInTheDocument()

    // 就地编辑：同一行里不再有标题按钮；初值 = 原标题；挂载即获焦
    expect(within(row).queryByRole('button', { name: '编辑：交水电费' })).toBeNull()
    expect(editor).toHaveValue('交水电费')
    expect(editor).toHaveFocus()
    // 帮助行：经 aria-describedby 关联到固定 id「todo-help」，文案为编辑态
    expect(editor).toHaveAttribute('aria-describedby', 'todo-help')
    expect(document.getElementById('todo-help')).toHaveTextContent(HELP_EDIT)
    // 计数器不是红色（未超长）
    expect(within(row).getByText('4/200')).not.toHaveClass('text-destructive')
  })

  // 对应 task：T1.3（commit：checkTitle → empty → onDelete）。
  // 红：占位编辑器不调任何回调。
  it('[P0] AC-3 FE-E2 清空即删除：裁剪后为空时回车 / 失焦只调 onDelete，绝不 onSave("")；onDelete 返回 false 时停留编辑态', async () => {
    const { props, user, view, editor } = renderEditor()

    await user.clear(editor())
    await user.keyboard('{Enter}')

    // 本 AC 新承诺的标量：清空后回车恰好调一次 onDelete
    expect(props.onDelete).toHaveBeenCalledTimes(1)
    // 不提交空标题、不当成取消
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onCancel).not.toHaveBeenCalled()
    view.unmount()

    // 失焦同样删除；只剩契约空白码点（全角空格 / NBSP / 制表符）也算空
    const blur = renderEditor()
    await blur.user.clear(blur.editor())
    await blur.user.paste(titleCase('only whitespace'))
    await blur.user.tab()
    expect(blur.props.onDelete).toHaveBeenCalledTimes(1)
    expect(blur.props.onSave).not.toHaveBeenCalled()
    blur.view.unmount()

    // onDelete 返回 false（删除失败）→ 编辑框仍在、值仍为空，可再试
    const failing = renderEditor({ onDelete: vi.fn<TodoTitleEditorProps['onDelete']>(async () => false) })
    await failing.user.clear(failing.editor())
    await failing.user.keyboard('{Enter}')
    await waitFor(() => expect(failing.props.onDelete).toHaveBeenCalledTimes(1))
    expect(failing.editor()).toHaveValue('')
    expect(failing.props.onCancel).not.toHaveBeenCalled()
  })

  // 对应 task：T1.1（aria-invalid）、T1.2（计数器）、T1.3（tooLong 不提交）、T1.6（onTooLongChange 边沿上报）。
  // 红：占位编辑器不上报 onTooLongChange、没有计数器、没有 aria-invalid。
  it('[P1] AC-4 FE-E3 超长：裁剪后 201 字 → 上报 onTooLongChange(true) 一次、计数器「201/200」转红、aria-invalid，回车 / 失焦都不提交；删回 200 字上报 false', async () => {
    const { props, user, editor } = renderEditor()

    await user.clear(editor())
    await user.paste(titleCase('201 han'))

    // 本 AC 新承诺的标量：超长边沿只上报一次 true
    expect(props.onTooLongChange.mock.calls).toEqual([[true]])

    expect(screen.getByText('201/200')).toHaveClass('text-destructive')
    expect(editor()).toHaveAttribute('aria-invalid', 'true')

    // 回车：不提交（不保存、不删除、不取消）
    await user.keyboard('{Enter}')
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
    expect(props.onCancel).not.toHaveBeenCalled()

    // 删 1 个字回到 200：上报 false 一次，计数器恢复
    await user.keyboard('{Backspace}')
    expect(props.onTooLongChange.mock.calls).toEqual([[true], [false]])
    expect(screen.getByText('200/200')).not.toHaveClass('text-destructive')
    expect(editor()).not.toHaveAttribute('aria-invalid', 'true')

    // 再超长后失焦：同样不提交
    await user.paste('字')
    expect(props.onTooLongChange.mock.calls).toEqual([[true], [false], [true]])
    await user.tab()
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  // 对应 task：T1.3（onSave 返回 false 时保留草稿、停留编辑态）+ T2.2 保存失败。
  // 红：占位编辑器回车不调 onSave，不发 PATCH，也就没有失败提示。
  it('[P1] AC-6 FE-E3 保存失败（PATCH 网络错误）→ 显示操作失败提示、停留编辑态且草稿保留、列表标题不变；再按回车重试成功后退出编辑态', async () => {
    const [, bills] = backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
    const user = await renderReady(3)
    await user.dblClick(screen.getByRole('button', { name: '编辑：交水电费' }))
    const editor = () => screen.getByRole('textbox', { name: '编辑待办标题：交水电费' })
    await user.clear(editor())
    await user.type(editor(), '交水电燃气费')

    server.use(scenarios.networkError({ method: 'patch', once: true }))
    await user.keyboard('{Enter}')

    // 本 AC 新承诺的标量：保存失败后显示操作失败提示
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE)

    // 停留在编辑态、草稿保留；服务端标题未变；列表里没有新标题
    expect(editor()).toHaveValue('交水电燃气费')
    expect(screen.queryByRole('button', { name: '编辑：交水电燃气费' })).toBeNull()
    expect(backend.list().find((t) => t.id === bills.id)?.title).toBe('交水电费')

    // 再按回车重试（替身恢复正常）→ 200 后退出编辑态、显示新标题、提示被清掉
    await user.type(editor(), '{Enter}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '编辑待办标题：交水电费' })).toBeNull())
    expect(screen.getByRole('button', { name: '编辑：交水电燃气费' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(backend.list().find((t) => t.id === bills.id)?.title).toBe('交水电燃气费')
  })
})

// ---------------------------------------------------------------------------------------------
// 绿阶段补充：组件级次要分支（atdd-checklist「绿阶段要补的次要分支」）
// ---------------------------------------------------------------------------------------------

/** 可控 Promise：测试决定何时 resolve（模拟请求在途）。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('Story 3.4 行内编辑（绿阶段补充，组件级）', () => {
  it('[P0] AC-2 FE-E1 保存：改后回车 / 失焦只调一次 onSave(裁剪后)，成功后什么也不调；未改（含只加两端空白）回车 / 失焦调 onCancel', async () => {
    const save = renderEditor()
    await save.user.clear(save.editor())
    await save.user.type(save.editor(), '买牛奶和面包{Enter}')
    expect(save.props.onSave.mock.calls).toEqual([['买牛奶和面包']])
    await save.user.tab() // 成功后失焦：本实例已结束，不再提交
    expect(save.props.onSave).toHaveBeenCalledTimes(1)
    expect(save.props.onCancel).not.toHaveBeenCalled()
    expect(save.props.onDelete).not.toHaveBeenCalled()
    save.view.unmount()

    const trimmed = renderEditor()
    await trimmed.user.clear(trimmed.editor())
    await trimmed.user.type(trimmed.editor(), '  买豆浆  {Enter}')
    expect(trimmed.props.onSave.mock.calls).toEqual([['买豆浆']])
    trimmed.view.unmount()

    const blur = renderEditor()
    await blur.user.type(blur.editor(), '两盒')
    await blur.user.tab()
    expect(blur.props.onSave.mock.calls).toEqual([['买牛奶两盒']])
    blur.view.unmount()

    const unchangedEnter = renderEditor()
    await unchangedEnter.user.keyboard('{Enter}')
    await unchangedEnter.user.tab()
    expect(unchangedEnter.props.onCancel).toHaveBeenCalledTimes(1)
    expect(unchangedEnter.props.onSave).not.toHaveBeenCalled()
    unchangedEnter.view.unmount()

    const unchangedBlur = renderEditor()
    await unchangedBlur.user.tab()
    expect(unchangedBlur.props.onCancel).toHaveBeenCalledTimes(1)
    expect(unchangedBlur.props.onSave).not.toHaveBeenCalled()
    unchangedBlur.view.unmount()

    const padded = renderEditor()
    await padded.user.clear(padded.editor())
    await padded.user.paste('\u3000买牛奶  ')
    await padded.user.keyboard('{Enter}')
    expect(padded.props.onCancel).toHaveBeenCalledTimes(1)
    expect(padded.props.onSave).not.toHaveBeenCalled()
  })

  it('[P0] AC-2 R-2 去重：保存在途时再按回车、再失焦都不重复提交；pending 时回车不提交；输入框始终可用', async () => {
    const gate = deferred<boolean>()
    const inflight = renderEditor({ onSave: vi.fn<TodoTitleEditorProps['onSave']>(() => gate.promise) })
    await inflight.user.type(inflight.editor(), '两盒{Enter}')
    await inflight.user.keyboard('{Enter}')
    await inflight.user.tab()
    expect(inflight.props.onSave).toHaveBeenCalledTimes(1)
    expect(inflight.editor()).toBeEnabled()
    gate.resolve(true)
    await waitFor(() => expect(inflight.props.onSave).toHaveBeenCalledTimes(1))
    inflight.view.unmount()

    const busy = renderEditor({ pending: true })
    await busy.user.type(busy.editor(), '两盒{Enter}')
    expect(busy.props.onSave).not.toHaveBeenCalled()
    expect(busy.editor()).toBeEnabled()
  })

  it('[P0] AC-5 FE-E1 Esc：改后按 Esc 只调一次 onCancel，之后失焦 / 回车 / 卸载都不再提交', async () => {
    const { props, user, view, editor } = renderEditor()
    await user.type(editor(), '不要了{Escape}')
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    await user.keyboard('{Enter}')
    await user.tab()
    view.unmount()
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  // Epic 3 检查点 ②B（PM 2026-10-20）：固定 handleKeyDown 的输入法守卫（!e.nativeEvent.isComposing）。
  it('[P2] FE-E1 输入法组字中的 Enter 不提交：isComposing 时不调 onSave / onCancel / onDelete、编辑框保持打开；组字结束后 Enter 照常提交', async () => {
    const { props, user, editor } = renderEditor()
    await user.type(editor(), '两盒')

    fireEvent.compositionStart(editor())
    fireEvent.keyDown(editor(), { key: 'Enter', isComposing: true })
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
    expect(editor()).toHaveValue('买牛奶两盒')
    expect(editor()).toHaveFocus()

    fireEvent.compositionEnd(editor())
    fireEvent.keyDown(editor(), { key: 'Enter', isComposing: false })
    expect(props.onSave.mock.calls).toEqual([['买牛奶两盒']])
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  it('[P1] AC-4 FE-E3 码点计数与非法码点：「200 emoji」合法可保存；含 U+0000 时 aria-invalid、回车 / 失焦不提交', async () => {
    const emoji = renderEditor()
    await emoji.user.clear(emoji.editor())
    await emoji.user.paste(titleCase('200 emoji'))
    expect(screen.getByText('200/200')).not.toHaveClass('text-destructive')
    expect(emoji.props.onTooLongChange).not.toHaveBeenCalled()
    await emoji.user.keyboard('{Enter}')
    expect(emoji.props.onSave.mock.calls).toEqual([[titleCase('200 emoji')]])
    emoji.view.unmount()

    const nul = renderEditor()
    fireEvent.change(nul.editor(), { target: { value: titleCase('contains NUL') } })
    expect(nul.editor()).toHaveAttribute('aria-invalid', 'true')
    await nul.user.click(nul.editor())
    await nul.user.keyboard('{Enter}')
    await nul.user.tab()
    expect(nul.props.onSave).not.toHaveBeenCalled()
    expect(nul.props.onDelete).not.toHaveBeenCalled()
    expect(nul.props.onCancel).not.toHaveBeenCalled()
  })

  it('[P1] AC-6 FE-E3 onSave 返回 false：停留编辑态、草稿保留、不取消；再按回车可重试', async () => {
    const onSave = vi.fn<TodoTitleEditorProps['onSave']>().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { props, user, editor } = renderEditor({ onSave })
    await user.type(editor(), '两盒{Enter}')
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(editor()).toHaveValue('买牛奶两盒')
    expect(props.onCancel).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(onSave.mock.calls).toEqual([['买牛奶两盒'], ['买牛奶两盒']])
  })
})

// ---------------------------------------------------------------------------------------------
// 绿阶段补充：集成（TodoApp + MSW 契约替身）
// ---------------------------------------------------------------------------------------------

/** 把请求交给契约替身应答（与 handlers.ts 同一份语义），用于「扣住再放行 / 记录再放行」的 handler。 */
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

/** 扣住（或只记录）某类请求：hits 记录路径、bodies 记录请求体；held=false 时直接交给替身应答。 */
function gated(method: 'patch' | 'delete', held = true) {
  let release!: () => void
  const gate = held ? new Promise<void>((r) => (release = r)) : Promise.resolve()
  if (!held) release = () => {}
  const hits: string[] = []
  const bodies: Array<string | null> = []
  const handler = http[method]('/api/todos/:id', async ({ request }) => {
    hits.push(new URL(request.url).pathname)
    bodies.push(method === 'delete' ? null : await request.clone().text())
    await gate
    return viaBackend(request)
  })
  return { handler, release, hits, bodies }
}

/** 屏幕上各行的标题（按 DOM 顺序；编辑中的行取编辑框可读名）。 */
function screenTitles(): string[] {
  return screen.getAllByRole('listitem').map((li) => {
    const button = within(li).queryByRole('button', { name: /^编辑：/ })
    return button ? (button.textContent ?? '') : (within(li).getByRole('textbox').getAttribute('aria-label') ?? '')
  })
}

const SEED = [{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }] as const

describe('Story 3.4 行内编辑集成补充（TodoApp + 契约替身）', () => {
  it('[P0] AC-1/AC-7 FE-E1 键盘进入：标题按钮获焦后 F2 / Enter 都进入编辑，编辑框获焦并关联帮助行', async () => {
    backend.seed([...SEED])
    const user = await renderReady(3)

    screen.getByRole('button', { name: '编辑：买牛奶' }).focus()
    await user.keyboard('{F2}')
    const milk = screen.getByRole('textbox', { name: '编辑待办标题：买牛奶' })
    expect(milk).toHaveFocus()
    expect(milk).toHaveAttribute('aria-describedby', 'todo-help')
    expect(document.getElementById('todo-help')).toHaveTextContent(HELP_EDIT)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: '编辑待办标题：买牛奶' })).toBeNull()

    screen.getByRole('button', { name: '编辑：写周报' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: '编辑待办标题：写周报' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: '编辑待办标题：写周报' })).toHaveValue('写周报')
  })

  it('[P0] AC-2 FE-E1/R-2 保存等 200：确认前不改显、只发一个 PATCH {title:裁剪后}；确认后退出编辑、焦点回标题、顺序与 createdAt 不变、updatedAt 更新', async () => {
    const T = new Date('2026-10-20T02:00:00.000Z')
    const T2 = new Date('2026-10-20T03:00:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T)
    backend.useClock(() => T)
    const [, bills] = backend.seed([...SEED])
    const user = await renderReady(3)
    backend.useClock(() => T2)
    const order = screenTitles()

    await user.dblClick(screen.getByRole('button', { name: '编辑：交水电费' }))
    const editor = () => screen.queryByRole('textbox', { name: '编辑待办标题：交水电费' })
    const patch = gated('patch')
    server.use(patch.handler)
    try {
      await user.clear(editor() as HTMLElement)
      await user.type(editor() as HTMLElement, '  交水电燃气费  {Enter}')
      await waitFor(() => expect(patch.hits).toEqual([`/api/todos/${bills.id}`]))
      expect(patch.bodies).toEqual([JSON.stringify({ title: '交水电燃气费' })])
      // 确认前：编辑框仍在，列表里没有新标题（禁乐观更新）
      expect(editor()).not.toBeNull()
      expect(screen.queryByRole('button', { name: '编辑：交水电燃气费' })).toBeNull()
    } finally {
      patch.release()
    }
    await waitFor(() => expect(editor()).toBeNull())
    expect(screen.getByRole('button', { name: '编辑：交水电燃气费' })).toHaveFocus()
    expect(screenTitles()).toEqual(order.map((t) => (t === '交水电费' ? '交水电燃气费' : t)))
    const saved = backend.list().find((t) => t.id === bills.id)
    expect(saved?.createdAt).toBe(bills.createdAt)
    expect(saved?.updatedAt).toBe(T2.toISOString())
    expect(patch.hits).toHaveLength(1)
  })

  it('[P0] AC-2/AC-5 FE-E1 未改回车、改后 Esc：不发 PATCH、退出编辑态、标题为原文、updatedAt 不变', async () => {
    const [, bills] = backend.seed([...SEED])
    const user = await renderReady(3)
    const patch = gated('patch', false)
    server.use(patch.handler)

    await user.dblClick(screen.getByRole('button', { name: '编辑：交水电费' }))
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('textbox', { name: '编辑待办标题：交水电费' })).toBeNull()

    await user.dblClick(screen.getByRole('button', { name: '编辑：交水电费' }))
    await user.type(screen.getByRole('textbox', { name: '编辑待办标题：交水电费' }), '（加急）{Escape}')
    expect(screen.queryByRole('textbox', { name: '编辑待办标题：交水电费' })).toBeNull()
    expect(screen.getByRole('button', { name: '编辑：交水电费' })).toHaveTextContent('交水电费')

    expect(patch.hits).toEqual([])
    const row = backend.list().find((t) => t.id === bills.id)
    expect(row?.title).toBe('交水电费')
    expect(row?.updatedAt).toBe(bills.updatedAt)
  })

  it('[P0] AC-3 FE-E2 清空即删除：只发 DELETE、不发 PATCH、无确认框；确认前行仍在，204 后行消失、帮助行回到新增文案', async () => {
    const [, bills] = backend.seed([...SEED])
    const user = await renderReady(3)
    const confirmSpy = vi.spyOn(window, 'confirm')
    const patch = gated('patch', false)
    const del = gated('delete')
    server.use(patch.handler, del.handler)
    try {
      await user.dblClick(screen.getByRole('button', { name: '编辑：交水电费' }))
      await user.clear(screen.getByRole('textbox', { name: '编辑待办标题：交水电费' }))
      await user.keyboard('{Enter}')
      await waitFor(() => expect(del.hits).toEqual([`/api/todos/${bills.id}`]))
      expect(screen.getByRole('button', { name: '删除：交水电费' })).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(confirmSpy).not.toHaveBeenCalled()
    } finally {
      del.release()
      confirmSpy.mockRestore()
    }
    await waitFor(() => expect(screen.queryByRole('button', { name: '删除：交水电费' })).toBeNull())
    expect(patch.hits).toEqual([])
    expect(backend.list().some((t) => t.id === bills.id)).toBe(false)
    expect(document.getElementById('todo-help')).toHaveTextContent(HELP_ADD)
  })

  it('[P1] AC-6 FE-E3 保存失败（500 / 502）与陈旧页面 404：显示操作失败提示、停留编辑态且草稿保留、不静默成功', async () => {
    const [, bills] = backend.seed([...SEED])
    for (const fault of [scenarios.internalError, scenarios.badGateway]) {
      server.use(fault({ method: 'patch', once: true }))
      const user = userEvent.setup()
      const view = render(<TodoApp />)
      await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(3))
      await user.dblClick(screen.getByRole('button', { name: '编辑：交水电费' }))
      const editor = screen.getByRole('textbox', { name: '编辑待办标题：交水电费' })
      await user.type(editor, '（已交）{Enter}')
      expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE)
      expect(editor).toHaveValue('交水电费（已交）')
      expect(backend.list().find((t) => t.id === bills.id)?.title).toBe('交水电费')
      view.unmount()
    }

    // 陈旧页面：替身里已被删掉（不经 MSW、不触发前端刷新），再保存 → 404 → 失败提示、仍在编辑态
    const user = await renderReady(3)
    const res = backend.handle({ method: 'DELETE', path: `/api/todos/${bills.id}`, contentType: null, bodyText: null })
    expect(res.status).toBe(204)
    await user.dblClick(screen.getByRole('button', { name: '编辑：交水电费' }))
    await user.type(screen.getByRole('textbox', { name: '编辑待办标题：交水电费' }), '（已交）{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE)
    expect(screen.getByRole('textbox', { name: '编辑待办标题：交水电费' })).toHaveValue('交水电费（已交）')
    expect(screen.queryByRole('button', { name: '编辑：交水电费（已交）' })).toBeNull()
  })

  it('[P1] AC-3/AC-6 FE-E2 清空即删除失败：提示、行与编辑框仍在；恢复后再回车删除成功并清掉提示', async () => {
    const [, bills] = backend.seed([...SEED])
    const user = await renderReady(3)
    server.use(scenarios.networkError({ method: 'delete', once: true }))
    await user.dblClick(screen.getByRole('button', { name: '编辑：交水电费' }))
    const editor = () => screen.getByRole('textbox', { name: '编辑待办标题：交水电费' })
    await user.clear(editor())
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE)
    expect(screen.getByRole('button', { name: '删除：交水电费' })).toBeInTheDocument()
    expect(editor()).toHaveValue('')

    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('button', { name: '删除：交水电费' })).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(backend.list().some((t) => t.id === bills.id)).toBe(false)
  })

  it('[P1] AC-4 FE-E3 超长：帮助行切为红色「标题最多 200 个字」、不发请求；删回 200 字恢复编辑文案', async () => {
    backend.seed([...SEED])
    const user = await renderReady(3)
    const patch = gated('patch', false)
    server.use(patch.handler)
    await user.dblClick(screen.getByRole('button', { name: '编辑：交水电费' }))
    const editor = screen.getByRole('textbox', { name: '编辑待办标题：交水电费' })
    await user.clear(editor)
    await user.paste(titleCase('201 han'))
    const help = document.getElementById('todo-help')
    expect(help).toHaveTextContent(HELP_TOO_LONG)
    expect(help).toHaveClass('text-destructive')
    await user.keyboard('{Enter}')
    expect(patch.hits).toEqual([])
    await user.keyboard('{Backspace}')
    expect(help).toHaveTextContent(HELP_EDIT)
    expect(help).not.toHaveClass('text-destructive')
  })

  it('[P1] AC-2 失焦进入另一行：失焦触发的保存在途时双击进入另一行编辑，200 后不关掉那一行且它保有焦点（TodoRow 不抢焦点，PM 2a）', async () => {
    const [, bills] = backend.seed([...SEED])
    const user = await renderReady(3)
    await user.dblClick(screen.getByRole('button', { name: '编辑：交水电费' }))
    const billsEditor = screen.getByRole('textbox', { name: '编辑待办标题：交水电费' })
    await user.clear(billsEditor)
    await user.type(billsEditor, '交水电燃气费')
    const patch = gated('patch')
    server.use(patch.handler)
    try {
      await user.dblClick(screen.getByRole('button', { name: '编辑：写周报' }))
      await waitFor(() => expect(patch.hits).toEqual([`/api/todos/${bills.id}`]))
      expect(screen.getByRole('textbox', { name: '编辑待办标题：写周报' })).toHaveFocus()
    } finally {
      patch.release()
    }
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑：交水电燃气费' })).toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: '编辑待办标题：写周报' })).toHaveFocus()
    expect(patch.hits).toHaveLength(1)
  })
})
