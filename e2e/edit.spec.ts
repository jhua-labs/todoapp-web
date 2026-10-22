// Story 3.4（FE-4）：行内编辑标题的用户流程（真实浏览器的键盘 / 焦点路径以本层为准，test-design 层级裁决）。
// Test ID：E2E-3（P0，R-5）→ AC-2、AC-5、AC-7。AC-1 / AC-3 / AC-4 / AC-6 的主叶子在 src/components/TodoTitleEditor.test.tsx。
// 绿阶段补充旅程（失焦进入另一行、清空即删除只发 DELETE 且无对话框、E2E-5 编辑失败后重试）见
// atdd-checklist-3-4-…md「绿阶段要补的次要分支」，加进本文件。清空即删除后的焦点去向不在本 story 断言（归 FE-3）。
//
// 红绿约定：每个 test.skip 上方写明对应 task；5.3 实现 T1 后去掉 skip，story 完成时本文件不应再有 skip。
// 整段旅程包在一个 expect(...).resolves 里：任何一步失败都归到本 AC。
// /api 全部由契约替身应答（./support/fixtures.ts 的 auto fixture）；不用 request fixture；不写 @needs-staging。
import { expect, test } from './support/fixtures.ts'

/** 种数据时的服务端时间与保存时的服务端时间（T2 > T1，保证 updatedAt 变化可断言且不早于 createdAt）。 */
const T1 = new Date('2026-10-20T02:00:00.000Z')
const T2 = new Date('2026-10-20T03:00:00.000Z')

const patchBodies = (requests: readonly { method: string; body: string | null }[]) =>
  requests.filter((r) => r.method === 'PATCH').map((r) => r.body)

test.describe('Story 3.4 行内编辑（ATDD 主叶子，E2E）', () => {
  // 对应 task：T1.3（Enter / blur 共用 commit；ok 且变了 → onSave(裁剪后)；未改 → onCancel）+ T3.1。
  // 红：占位编辑器回车 / 失焦都不调 onSave，不发 PATCH。
  test('[P0] AC-2 E2E-3 保存：双击进入、改标题回车 → 发 PATCH {title} 且等 200 才改显；标题与 updatedAt 更新、createdAt 与顺序不变；失焦同样保存，未改失焦只退出不发请求', async ({
    page,
    backend,
  }) => {
    await expect(
      (async () => {
        backend.useClock(() => T1)
        const [, bills] = backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
        await page.goto('/')
        await expect(page.getByRole('listitem')).toHaveCount(3)
        backend.useClock(() => T2)
        const titles = page.getByRole('button', { name: /^编辑：/ })
        await expect(titles).toHaveText(['买牛奶', '交水电费', '写周报'])

        await page.getByRole('button', { name: '编辑：交水电费' }).dblclick()
        const editor = page.getByRole('textbox', { name: '编辑待办标题：交水电费' })
        await expect(editor).toBeFocused()
        await editor.fill('  交水电燃气费  ')
        const held = backend.holdNext({ method: 'PATCH' })
        await page.keyboard.press('Enter')

        // 本 AC 新承诺的标量：回车发出恰好一个 PATCH，请求体是裁剪后的 {title}
        await expect
          .poll(() => patchBodies(backend.requests), { message: '回车应发出 PATCH {"title":"交水电燃气费"}' })
          .toEqual([JSON.stringify({ title: '交水电燃气费' })])

        // 服务端确认前：编辑框仍在，列表里还没有新标题（禁乐观更新，SM-C1）
        await held.arrived
        await expect(editor).toBeVisible()
        await expect(page.getByRole('button', { name: '编辑：交水电燃气费' })).toHaveCount(0)

        // 200 后：容器退出编辑态，焦点回到该行标题按钮；标题更新、顺序不变
        held.release()
        await expect(editor).toHaveCount(0)
        await expect(page.getByRole('button', { name: '编辑：交水电燃气费' })).toBeFocused()
        await expect(titles).toHaveText(['买牛奶', '交水电燃气费', '写周报'])
        const saved = backend.list().find((t) => t.id === bills.id)
        expect(saved?.title).toBe('交水电燃气费')
        expect(saved?.createdAt).toBe(bills.createdAt)
        expect(saved?.updatedAt).toBe(T2.toISOString())

        // 失焦保存：改「写周报」后点新增输入框（焦点离开编辑框）→ 同样发 PATCH、确认后显示新标题
        await page.getByRole('button', { name: '编辑：写周报' }).dblclick()
        await page.getByRole('textbox', { name: '编辑待办标题：写周报' }).fill('写周报（第 42 周）')
        await page.getByRole('textbox', { name: '新增待办标题' }).click()
        await expect(page.getByRole('textbox', { name: '编辑待办标题：写周报' })).toHaveCount(0)
        await expect(titles).toHaveText(['买牛奶', '交水电燃气费', '写周报（第 42 周）'])

        // 未改动失焦：只退出编辑态，不发请求
        await page.getByRole('button', { name: '编辑：买牛奶' }).dblclick()
        await expect(page.getByRole('textbox', { name: '编辑待办标题：买牛奶' })).toBeFocused()
        await page.getByRole('textbox', { name: '新增待办标题' }).click()
        await expect(page.getByRole('textbox', { name: '编辑待办标题：买牛奶' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: '编辑：买牛奶' })).toBeVisible()

        expect(patchBodies(backend.requests)).toEqual([
          JSON.stringify({ title: '交水电燃气费' }),
          JSON.stringify({ title: '写周报（第 42 周）' }),
        ])
      })(),
    ).resolves.toBeUndefined()
  })

  // 对应 task：T1.4（Esc：preventDefault → onCancel，此后忽略 blur / Enter）+ T3.1。
  // 红：占位编辑器不处理 Esc，按下后仍停在编辑态。
  test('[P0] AC-5 E2E-3 Esc 取消：改了内容后按 Esc → 退出编辑态、标题恢复为原内容、焦点回标题按钮，不发 PATCH、updatedAt 不变', async ({
    page,
    backend,
  }) => {
    await expect(
      (async () => {
        backend.useClock(() => T1)
        const [, bills] = backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
        await page.goto('/')
        await expect(page.getByRole('listitem')).toHaveCount(3)
        backend.useClock(() => T2)

        await page.getByRole('button', { name: '编辑：交水电费' }).dblclick()
        const editor = page.getByRole('textbox', { name: '编辑待办标题：交水电费' })
        await expect(editor).toBeFocused()
        await editor.fill('改了但不想要')
        await page.keyboard.press('Escape')

        // 本 AC 新承诺的标量：按 Esc 后编辑框消失（退出编辑态）
        await expect(editor, '按 Esc 后应退出编辑态').toHaveCount(0)

        // 标题恢复为编辑前原内容，焦点回到标题按钮
        const title = page.getByRole('button', { name: '编辑：交水电费' })
        await expect(title).toHaveText('交水电费')
        await expect(title).toBeFocused()
        await expect(page.getByRole('button', { name: /^编辑：/ })).toHaveText(['买牛奶', '交水电费', '写周报'])

        // Esc 之后卸载 / 失焦都不能触发保存：做一次无关交互后仍然没有任何 PATCH
        await page.getByRole('textbox', { name: '新增待办标题' }).click()
        await expect(page.getByRole('textbox', { name: '新增待办标题' })).toBeFocused()
        expect(patchBodies(backend.requests)).toEqual([])
        const row = backend.list().find((t) => t.id === bills.id)
        expect(row?.title).toBe('交水电费')
        expect(row?.updatedAt).toBe(bills.updatedAt)
      })(),
    ).resolves.toBeUndefined()
  })

  // 对应 task：T1.3 + T1.4（键盘 Enter 保存 / Esc 取消）+ T3.1。进入编辑（F2 / Enter）与退出后焦点回位已由 FE-1 实现。
  // 红：占位编辑器回车不保存，Esc 不取消。
  test('[P0] AC-7 E2E-3 全键盘：Tab 到标题按钮、F2 进入、End 后键入、Enter 保存；Tab 到下一行标题、Enter 进入、Esc 取消——全程不用鼠标', async ({
    page,
    backend,
  }) => {
    await expect(
      (async () => {
        backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
        await page.goto('/')
        await expect(page.getByRole('listitem')).toHaveCount(3)

        // 从第一行复选框出发，Tab 到它的标题按钮（行内 Tab 序：复选框 → 标题按钮 → 删除控件，AD-19）
        await page.getByRole('checkbox', { name: '标记完成：买牛奶' }).focus()
        await page.keyboard.press('Tab')
        await expect(page.getByRole('button', { name: '编辑：买牛奶' })).toBeFocused()

        // F2 进入编辑 → 光标移到末尾键入 → Enter 保存
        await page.keyboard.press('F2')
        const milkEditor = page.getByRole('textbox', { name: '编辑待办标题：买牛奶' })
        await expect(milkEditor).toBeFocused()
        await page.keyboard.press('End')
        await page.keyboard.type('两盒')
        await page.keyboard.press('Enter')

        // 本 AC 新承诺的标量：只用键盘也能保存——Enter 发出 PATCH {"title":"买牛奶两盒"}
        await expect
          .poll(() => patchBodies(backend.requests), { message: '键盘 Enter 应发出 PATCH {"title":"买牛奶两盒"}' })
          .toEqual([JSON.stringify({ title: '买牛奶两盒' })])

        await expect(milkEditor).toHaveCount(0)
        const milkTitle = page.getByRole('button', { name: '编辑：买牛奶两盒' })
        await expect(milkTitle).toBeFocused()

        // 继续只用键盘：标题按钮 → 删除控件 → 下一行复选框 → 下一行标题按钮
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        await expect(page.getByRole('button', { name: '编辑：交水电费' })).toBeFocused()

        // Enter 进入编辑 → 键入 → Esc 取消：恢复原标题、焦点回标题按钮、不发请求
        await page.keyboard.press('Enter')
        const billsEditor = page.getByRole('textbox', { name: '编辑待办标题：交水电费' })
        await expect(billsEditor).toBeFocused()
        await page.keyboard.press('End')
        await page.keyboard.type('（加急）')
        await page.keyboard.press('Escape')
        await expect(billsEditor).toHaveCount(0)
        await expect(page.getByRole('button', { name: '编辑：交水电费' })).toBeFocused()
        await expect(page.getByRole('button', { name: /^编辑：/ })).toHaveText(['买牛奶两盒', '交水电费', '写周报'])

        expect(patchBodies(backend.requests)).toEqual([JSON.stringify({ title: '买牛奶两盒' })])
        expect(backend.list().map((t) => t.title)).toEqual(['买牛奶两盒', '交水电费', '写周报'])
      })(),
    ).resolves.toBeUndefined()
  })
})

test.describe('Story 3.4 行内编辑（绿阶段补充旅程，E2E）', () => {
  test('[P0] AC-3 E2E-3 清空即删除：清空后回车只发 DELETE、不发 PATCH、无任何对话框（含原生 confirm），该行消失', async ({
    page,
    backend,
  }) => {
    const [, bills] = backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.type())
      void d.dismiss()
    })
    await page.goto('/')
    await expect(page.getByRole('listitem')).toHaveCount(3)

    await page.getByRole('button', { name: '编辑：交水电费' }).dblclick()
    const editor = page.getByRole('textbox', { name: '编辑待办标题：交水电费' })
    await expect(editor).toBeFocused()
    await editor.fill('')
    await page.keyboard.press('Enter')

    await expect(page.getByRole('button', { name: '删除：交水电费' })).toHaveCount(0)
    await expect(page.getByRole('listitem')).toHaveCount(2)
    await expect(page.getByRole('button', { name: /^编辑：/ })).toHaveText(['买牛奶', '写周报'])
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(dialogs).toEqual([])
    const writes = backend.requests.filter((r) => r.method !== 'GET')
    expect(writes.map((r) => [r.method, r.path])).toEqual([['DELETE', `/api/todos/${bills.id}`]])
    expect(backend.list().some((t) => t.id === bills.id)).toBe(false)
  })

  test('[P1] AC-2 E2E-3 失焦进入另一行：失焦保存在途时双击进入另一行编辑，200 后那一行的编辑框仍打开且保有焦点', async ({
    page,
    backend,
  }) => {
    const [, bills] = backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
    await page.goto('/')
    await expect(page.getByRole('listitem')).toHaveCount(3)

    await page.getByRole('button', { name: '编辑：交水电费' }).dblclick()
    await page.getByRole('textbox', { name: '编辑待办标题：交水电费' }).fill('交水电燃气费')
    const held = backend.holdNext({ method: 'PATCH' })
    await page.getByRole('button', { name: '编辑：写周报' }).dblclick()
    await held.arrived

    const reportEditor = page.getByRole('textbox', { name: '编辑待办标题：写周报' })
    await expect(reportEditor).toBeFocused()
    held.release()
    await expect(page.getByRole('button', { name: '编辑：交水电燃气费' })).toBeVisible()
    await expect(reportEditor).toBeVisible()
    await expect(reportEditor).toBeFocused()
    expect(patchBodies(backend.requests)).toEqual([JSON.stringify({ title: '交水电燃气费' })])
    expect(backend.list().find((t) => t.id === bills.id)?.title).toBe('交水电燃气费')
  })

  test('[P1] AC-6 E2E-5 编辑保存失败：PATCH 网络错误 → 失败提示常驻、停留编辑态且草稿保留、标题未变；再按回车重试成功', async ({
    page,
    backend,
  }) => {
    const [, bills] = backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
    await page.goto('/')
    await expect(page.getByRole('listitem')).toHaveCount(3)

    await page.getByRole('button', { name: '编辑：交水电费' }).dblclick()
    const editor = page.getByRole('textbox', { name: '编辑待办标题：交水电费' })
    await editor.fill('交水电燃气费')
    backend.failNext('networkError', { method: 'PATCH' })
    await page.keyboard.press('Enter')

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue('交水电燃气费')
    await expect(editor).toBeFocused()
    await expect(page.getByRole('button', { name: '编辑：交水电燃气费' })).toHaveCount(0)
    expect(backend.list().find((t) => t.id === bills.id)?.title).toBe('交水电费')
    // 提示常驻：做一次无关等待后仍在（web-first 断言，不用固定时长）
    await expect(alert).toBeVisible()

    await page.keyboard.press('Enter')
    await expect(editor).toHaveCount(0)
    await expect(page.getByRole('button', { name: '编辑：交水电燃气费' })).toBeFocused()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(backend.list().find((t) => t.id === bills.id)?.title).toBe('交水电燃气费')
  })
})
