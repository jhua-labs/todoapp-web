// Story 3.3（FE-3）：勾选 / 删除的用户流程与删除后真实焦点（真实浏览器焦点 / 键盘以本层为准，test-design 层级裁决）。
// Test ID：E2E-2（P0，R-2）→ AC-1；E2E-4（P0，R-5）+ FE-R2 → AC-4。
// E2E-4 的「无确认 + 确认前不移除」→ AC-3、E2E-5 的勾选 / 删除失败路径 → AC-2 / AC-5 是绿阶段补充旅程（文件末尾）；
// 陈旧页面 404 只在组件层证明（backend fixture 没有「后台删除」入口）。
// 清空即删除的真实浏览器焦点去向：Epic 3 检查点 ④A 已补（文件末尾）。
//
// 整段旅程包在一个 expect(...).resolves 里：任何一步失败都归到本 AC。
// /api 全部由契约替身应答（./support/fixtures.ts 的 auto fixture）；不用 request fixture；不写 @needs-staging。
import { expect, test } from './support/fixtures.ts'

/** 参考时间：上海 2026-10-20 10:00。浏览器与替身用同一个时钟，「已完成 · 刚刚」不依赖真实时间。 */
const T = new Date('2026-10-20T02:00:00.000Z')

const patchBodies = (requests: readonly { method: string; path: string; body: string | null }[]) =>
  requests.filter((r) => r.method === 'PATCH').map((r) => r.body)

test.describe('Story 3.3 勾选 / 删除（ATDD 主叶子，E2E）', () => {
  // 对应 task：T3.1（E2E-2）。行为已由 FE-1（TodoRow 受控复选框 + useTodoList.setCompleted）实现。
  test('[P0] AC-1 E2E-2 勾选完成 / 取消：等 PATCH 200 确认后才划掉 / 恢复、留在原位，鼠标与键盘 Space 两条路径', async ({
    page,
    backend,
  }) => {
    await expect(
      (async () => {
        await page.clock.setFixedTime(T)
        backend.useClock(() => T)
        backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
        const held = backend.holdNext({ method: 'PATCH' })
        await page.goto('/')
        const items = page.getByRole('listitem')
        await expect(items).toHaveCount(3)
        const order = await page.getByRole('button', { name: /^编辑：/ }).allTextContents()

        const checkbox = page.getByRole('checkbox', { name: '标记完成：交水电费' })
        const title = page.getByRole('button', { name: '编辑：交水电费' })
        const row = items.filter({ has: checkbox })
        await checkbox.click()

        // 本 AC 新承诺的标量：点击后发出 PATCH {completed:true}
        await expect.poll(() => patchBodies(backend.requests), { message: '点击复选框应发出 PATCH {completed:true}' }).toEqual([
          JSON.stringify({ completed: true }),
        ])

        // 服务端确认前：不先划掉（禁乐观更新，SM-C1）
        await held.arrived
        await expect(checkbox).toHaveAttribute('aria-checked', 'false')
        await expect(title).not.toHaveClass(/line-through/)
        await expect(row).not.toContainText('已完成')

        // 200 后：勾上、近黑填充、删除线 + 灰化、绿色「已完成 · 刚刚」；留在原位不沉底
        held.release()
        await expect(checkbox).toHaveAttribute('aria-checked', 'true')
        await expect(checkbox).toHaveCSS('background-color', 'rgb(24, 24, 27)')
        await expect(title).toHaveClass(/line-through/)
        await expect(title).toHaveClass(/text-muted-foreground/)
        await expect(row).toContainText('已完成 · 刚刚')
        await expect(page.getByRole('button', { name: /^编辑：/ })).toHaveText(order)

        // 再点一下：同样等确认后才恢复
        const heldAgain = backend.holdNext({ method: 'PATCH' })
        await checkbox.click()
        await heldAgain.arrived
        await expect(checkbox).toHaveAttribute('aria-checked', 'true')
        heldAgain.release()
        await expect(checkbox).toHaveAttribute('aria-checked', 'false')
        await expect(title).not.toHaveClass(/line-through/)
        await expect(row).not.toContainText('已完成')

        // 键盘：聚焦复选框后按 Space 切换（Enter 不断言，见 story「已识别的规范空白」1）
        await checkbox.focus()
        await page.keyboard.press('Space')
        await expect(checkbox).toHaveAttribute('aria-checked', 'true')
        await expect(page.getByRole('button', { name: /^编辑：/ })).toHaveText(order)

        expect(patchBodies(backend.requests)).toEqual([
          JSON.stringify({ completed: true }),
          JSON.stringify({ completed: false }),
          JSON.stringify({ completed: true }),
        ])
      })(),
    ).resolves.toBeUndefined()
  })

  // 对应 task：T1（TodoList.handleDelete 焦点接管）+ T3.2。
  test('[P0] AC-4 E2E-4/FE-R2 删除后焦点接管（全键盘）：中间行 → 下一行删除控件；末行 → 上一行删除控件；删光 → 新增输入框，从不落回 body', async ({
    page,
    backend,
  }) => {
    await expect(
      (async () => {
        backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
        await page.goto('/')
        const items = page.getByRole('listitem')
        await expect(items).toHaveCount(3)
        // 屏幕顺序（createdAt 倒序）：买牛奶 → 交水电费 → 写周报

        // 键盘 Tab 到中间行的删除控件（标题按钮 → Tab → 删除控件），按 Enter 删除
        await page.getByRole('button', { name: '编辑：交水电费' }).focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Enter')

        // 本 AC 新承诺的标量：删中间行后，焦点落到下一行的删除控件
        const deleteWeek = page.getByRole('button', { name: '删除：写周报' })
        await expect(deleteWeek, '删中间行后焦点应在下一行的删除控件').toBeFocused()

        await expect(items).toHaveCount(2)
        await expect(page.getByRole('button', { name: '删除：交水电费' })).toHaveCount(0)
        await expect(page.locator('body')).not.toBeFocused()
        // 焦点显露：删除控件获焦时不透明（始终在 Tab 序里，只用透明度显露）
        await expect(deleteWeek).toHaveCSS('opacity', '1')

        // 现在「写周报」是末行：按 Space 删除 → 焦点到上一行的删除控件
        await page.keyboard.press('Space')
        const deleteMilk = page.getByRole('button', { name: '删除：买牛奶' })
        await expect(deleteMilk).toBeFocused()
        await expect(items).toHaveCount(1)

        // 删光 → onEmptied() 把焦点交给顶部新增输入框；空态出现
        await page.keyboard.press('Enter')
        await expect(page.getByRole('textbox', { name: '新增待办标题' })).toBeFocused()
        await expect(items).toHaveCount(0)
        await expect(page.getByText('还没有待办')).toBeVisible()

        expect(backend.requests.filter((r) => r.method === 'DELETE')).toHaveLength(3)
        expect(backend.list()).toEqual([])
      })(),
    ).resolves.toBeUndefined()
  })
})

test.describe('Story 3.3 勾选 / 删除（绿阶段补充旅程，E2E）', () => {
  // 对应 task：T3.2（E2E-4 无确认 + 禁乐观更新）。
  test('[P0] AC-3 E2E-4 删除无确认：hover 显露删除控件，点击即发 DELETE；204 确认前该行仍在、没有对话框，确认后移除、其余顺位不变', async ({
    page,
    backend,
  }) => {
    await expect(
      (async () => {
        backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
        const held = backend.holdNext({ method: 'DELETE' })
        let dialogs = 0
        page.on('dialog', (d) => {
          dialogs += 1
          void d.dismiss()
        })
        await page.goto('/')
        const items = page.getByRole('listitem')
        await expect(items).toHaveCount(3)

        const del = page.getByRole('button', { name: '删除：交水电费' })
        await items.filter({ has: del }).hover()
        await expect(del).toHaveCSS('opacity', '1')
        await del.click()

        // 服务端确认前：行仍在、页面上没有确认框（含原生 confirm）
        await held.arrived
        await expect(del).toBeVisible()
        await expect(items).toHaveCount(3)
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(page.getByRole('alertdialog')).toHaveCount(0)
        expect(dialogs).toBe(0)

        held.release()
        await expect(items).toHaveCount(2)
        await expect(page.getByRole('button', { name: /^编辑：/ })).toHaveText(['买牛奶', '写周报'])
        expect(backend.list().map((t) => t.title)).toEqual(['买牛奶', '写周报'])
        expect(backend.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1)
        expect(dialogs).toBe(0)
      })(),
    ).resolves.toBeUndefined()
  })

  // 对应 task：T3.3（E2E-5 勾选路径）。
  test('[P0] AC-2 E2E-5 勾选失败：PATCH 网络错误 → 复选框保持未勾、无删除线，失败提示常驻直到关闭', async ({ page, backend }) => {
    await expect(
      (async () => {
        backend.seed([{ title: '写周报' }, { title: '交水电费' }])
        backend.failNext('networkError', { method: 'PATCH' })
        await page.goto('/')
        await expect(page.getByRole('listitem')).toHaveCount(2)

        const checkbox = page.getByRole('checkbox', { name: '标记完成：交水电费' })
        await checkbox.click()

        const alert = page.getByRole('alert')
        await expect(alert).toBeVisible()
        await expect(alert).toContainText('操作失败')
        await expect(checkbox).toHaveAttribute('aria-checked', 'false')
        await expect(page.getByRole('button', { name: '编辑：交水电费' })).not.toHaveClass(/line-through/)

        // 常驻：做一次无关交互后仍在
        await page.getByRole('textbox', { name: '新增待办标题' }).click()
        await expect(alert).toBeVisible()

        await page.getByRole('button', { name: '关闭提示' }).click()
        await expect(page.getByRole('alert')).toHaveCount(0)
        expect(backend.list().every((t) => !t.completed)).toBe(true)
      })(),
    ).resolves.toBeUndefined()
  })

  // 对应 task：T3.3（E2E-5 删除路径）。
  test('[P0] AC-5 E2E-5 删除失败：DELETE 502 → 该行保留、显示失败提示，焦点仍在它的删除控件（不落回 body）', async ({ page, backend }) => {
    await expect(
      (async () => {
        backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
        backend.failNext('badGateway', { method: 'DELETE' })
        await page.goto('/')
        const items = page.getByRole('listitem')
        await expect(items).toHaveCount(3)

        const del = page.getByRole('button', { name: '删除：交水电费' })
        await page.getByRole('button', { name: '编辑：交水电费' }).focus()
        await page.keyboard.press('Tab')
        await expect(del).toBeFocused()
        await page.keyboard.press('Enter')

        await expect(page.getByRole('alert')).toContainText('操作失败')
        await expect(items).toHaveCount(3)
        await expect(del).toBeFocused()
        await expect(page.locator('body')).not.toBeFocused()
        expect(backend.list()).toHaveLength(3)
      })(),
    ).resolves.toBeUndefined()
  })
})

test.describe('Story 3.3 × 3.4 清空即删除的焦点接管（Epic 3 检查点 ④A，E2E）', () => {
  // Epic 3 检查点 ④A（PM 2026-10-20）：行内编辑清空后回车 → 只发 DELETE，焦点按 FE-3 规则接管。
  test('[P0] AC-4 E2E-4/FE-R2 清空即删除后焦点接管：只发 DELETE、无 PATCH、无对话框；中间行 → 下一行删除控件；末行 → 上一行删除控件；删光 → 新增输入框，从不落回 body', async ({
    page,
    backend,
  }) => {
    await expect(
      (async () => {
        const [week, bills, milk] = backend.seed([{ title: '写周报' }, { title: '交水电费' }, { title: '买牛奶' }])
        let dialogs = 0
        page.on('dialog', (d) => {
          dialogs += 1
          void d.dismiss()
        })
        await page.goto('/')
        const items = page.getByRole('listitem')
        await expect(items).toHaveCount(3)
        // 屏幕顺序（createdAt 倒序）：买牛奶 → 交水电费 → 写周报

        // 中间行：双击进入编辑、清空、回车
        await page.getByRole('button', { name: '编辑：交水电费' }).dblclick()
        const billsEditor = page.getByRole('textbox', { name: '编辑待办标题：交水电费' })
        await expect(billsEditor).toBeFocused()
        await billsEditor.fill('')
        await page.keyboard.press('Enter')

        // 本 AC 新承诺的标量：清空即删除中间行后，焦点落到下一行的删除控件
        await expect(page.getByRole('button', { name: '删除：写周报' }), '删中间行后焦点应在下一行的删除控件').toBeFocused()
        await expect(items).toHaveCount(2)
        await expect(page.getByRole('button', { name: '删除：交水电费' })).toHaveCount(0)
        await expect(page.locator('body')).not.toBeFocused()

        // 末行：「写周报」清空即删除 → 焦点到上一行的删除控件
        await page.getByRole('button', { name: '编辑：写周报' }).dblclick()
        await page.getByRole('textbox', { name: '编辑待办标题：写周报' }).fill('')
        await page.keyboard.press('Enter')
        await expect(page.getByRole('button', { name: '删除：买牛奶' })).toBeFocused()
        await expect(items).toHaveCount(1)
        await expect(page.locator('body')).not.toBeFocused()

        // 删光 → 焦点交给顶部新增输入框；空态出现
        await page.getByRole('button', { name: '编辑：买牛奶' }).dblclick()
        await page.getByRole('textbox', { name: '编辑待办标题：买牛奶' }).fill('')
        await page.keyboard.press('Enter')
        await expect(page.getByRole('textbox', { name: '新增待办标题' })).toBeFocused()
        await expect(items).toHaveCount(0)
        await expect(page.getByText('还没有待办')).toBeVisible()

        // 只发了 DELETE、没有 PATCH、没有任何对话框
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(page.getByRole('alertdialog')).toHaveCount(0)
        expect(dialogs).toBe(0)
        const writes = backend.requests.filter((r) => r.method !== 'GET')
        expect(writes.map((r) => [r.method, r.path])).toEqual([
          ['DELETE', `/api/todos/${bills.id}`],
          ['DELETE', `/api/todos/${week.id}`],
          ['DELETE', `/api/todos/${milk.id}`],
        ])
        expect(backend.list()).toEqual([])
      })(),
    ).resolves.toBeUndefined()
  })
})
