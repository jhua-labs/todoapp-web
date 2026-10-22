// Story 2.4（FE-2）：新增的用户流程（真实浏览器焦点 / 键盘以本层为准，test-design 层级裁决）。
// Test ID：E2E-1（P0，R-2）+ FE-A1（P0，R-2/R-5）→ AC-1；AC-6 可读名与全键盘（按 R-5 P1）。
// E2E-6（容量已满 → 删除回落 → 可新增）是 AC-4 的次要旅程，绿阶段加到本文件末尾（见 ATDD checklist）。
//
// ATDD 红阶段的跳过标记已在 Story 2.4 实现后全部去掉（每个叶子上方注释保留其对应的 task）。
// 整段旅程包在一个 expect(...).resolves 里：任何一步失败都归到本 AC。
// /api 全部由契约替身应答（./support/fixtures.ts 的 auto fixture）；不用 request fixture；不写 @needs-staging。
import { expect, test } from './support/fixtures.ts'

const postBodies = (requests: readonly { method: string; path: string; body: string | null }[]) =>
  requests.filter((r) => r.method === 'POST' && r.path === '/api/todos').map((r) => r.body)

test.describe('Story 2.4 新增输入行（ATDD 主叶子）', () => {
  // 对应 task：T1.1 + T1.2 + T1.5（草稿、提交裁剪后标题、true 清空并 focus、ref 合并）
  test('[P0] AC-1 E2E-1/FE-A1 回车新增：先裁剪再 POST、确认前不插入、201 后置顶 + 清空 + 焦点保留，可连续记（回车与点「添加」两条路径）', async ({
    page,
    backend,
  }) => {
    await expect(
      (async () => {
        backend.seed([{ title: '已有' }])
        const held = backend.holdNext({ method: 'POST', path: '/api/todos' })
        await page.goto('/')
        const input = page.getByRole('textbox', { name: '新增待办标题' })
        const items = page.getByRole('listitem')
        await expect(items).toHaveCount(1)

        await input.click()
        await input.pressSequentially('  订周四会议室  ')
        await input.press('Enter')

        // 本 AC 新承诺的标量：回车后发出恰好一个 POST，请求体是裁剪后的标题（占位实现不提交）
        await expect.poll(() => postBodies(backend.requests), { message: '回车应发出 POST，标题已裁剪' }).toEqual([
          JSON.stringify({ title: '订周四会议室' }),
        ])

        // 服务端确认前：界面不先插入，输入内容不清空（禁乐观更新，SM-C1）
        await held.arrived
        await expect(items).toHaveCount(1)
        await expect(input).toHaveValue('  订周四会议室  ')

        // 201 后：新条置顶、输入清空、焦点保留在输入框
        held.release()
        await expect(items).toHaveCount(2)
        await expect(items.first()).toContainText('订周四会议室')
        await expect(input).toHaveValue('')
        await expect(input).toBeFocused()

        // 连续记：直接再键入回车
        await page.keyboard.type('第二条')
        await page.keyboard.press('Enter')
        await expect(items).toHaveCount(3)
        await expect(items.first()).toContainText('第二条')
        await expect(input).toHaveValue('')
        await expect(input).toBeFocused()

        // 点「添加」提交：焦点从按钮回到输入框
        await input.fill('第三条')
        await page.getByRole('button', { name: '添加待办' }).click()
        await expect(items).toHaveCount(4)
        await expect(items.first()).toContainText('第三条')
        await expect(input).toHaveValue('')
        await expect(input).toBeFocused()

        expect(postBodies(backend.requests)).toEqual([
          JSON.stringify({ title: '订周四会议室' }),
          JSON.stringify({ title: '第二条' }),
          JSON.stringify({ title: '第三条' }),
        ])
      })(),
    ).resolves.toBeUndefined()
  })

  // 对应 task：T1.2（提交）+ T1.5（ref 合并后焦点保留）
  test('[P1] AC-6 全键盘完成新增（Tab 聚焦 + 键入 + 回车），输入框可读名「新增待办标题」、按钮可读名「添加待办」，占位符不充当可访问名', async ({
    page,
    backend,
  }) => {
    await expect(
      (async () => {
        backend.seed([{ title: '已有' }])
        await page.goto('/')
        const items = page.getByRole('listitem')
        await expect(items).toHaveCount(1)

        // 全程只用键盘：页面第一个可聚焦控件就是新增输入框
        await page.keyboard.press('Tab')
        await page.keyboard.type('全键盘新增')
        await page.keyboard.press('Enter')

        // 本 AC 新承诺的标量：只用键盘就新增成功、置顶（占位实现不提交）
        await expect(items.first(), '只用键盘应能完成新增').toContainText('全键盘新增')
        await expect(items).toHaveCount(2)

        const input = page.getByRole('textbox', { name: '新增待办标题' })
        await expect(input).toBeFocused()
        await expect(input).toHaveValue('')
        // 可读名来自 aria-label，不来自占位符
        await expect(input).toHaveAttribute('aria-label', '新增待办标题')
        await expect(input).toHaveAttribute('placeholder', '要做什么？按回车添加')

        // Tab 顺序：输入框 → 「添加」按钮（可读名「添加待办」，可见文字「添加」）。
        // 空草稿时按钮禁用、不在 Tab 序里，所以先键入再 Tab；在按钮上按 Enter 同样完成新增，焦点回到输入框。
        await page.keyboard.type('再来一条')
        await page.keyboard.press('Tab')
        const button = page.getByRole('button', { name: '添加待办' })
        await expect(button).toBeFocused()
        await expect(button).toHaveText('添加')
        await page.keyboard.press('Enter')
        await expect(items).toHaveCount(3)
        await expect(items.first()).toContainText('再来一条')
        await expect(input).toBeFocused()
      })(),
    ).resolves.toBeUndefined()
  })
})

test.describe('Story 2.4 新增输入行（绿阶段补充旅程）', () => {
  test('[P0] AC-4 E2E-6 满 500 条：容量横幅 + 新增禁用；删除一条（无确认）后横幅消失、可再新增并置顶，补满后再次禁用', async ({
    page,
    backend,
  }) => {
    backend.fill(500)
    await page.goto('/')
    const banner = page.getByRole('status')
    await expect(banner).toHaveText('待办已满（500 条），请先清理')
    const input = page.getByRole('textbox', { name: '新增待办标题' })
    const button = page.getByRole('button', { name: '添加待办' })
    await expect(input).toBeDisabled()
    await expect(input).toHaveAttribute('placeholder', '待办已满，先删掉一些吧')
    await expect(input).toHaveAttribute('aria-describedby', 'capacity-notice')
    await expect(button).toBeDisabled()

    await page.getByRole('button', { name: /^删除：/ }).first().click()
    await expect(banner).toHaveCount(0)
    await expect(input).toBeEnabled()
    await expect(input).toHaveAttribute('placeholder', '要做什么？按回车添加')

    await input.click()
    await input.pressSequentially('腾出位置后新增')
    await input.press('Enter')
    await expect(page.getByRole('listitem').first()).toContainText('腾出位置后新增')
    await expect(page.getByRole('listitem')).toHaveCount(500)
    await expect(input).toHaveValue('')
    // 499 + 1 = 500：重新满额，横幅回来、新增框再次禁用（FR-2）
    await expect(banner).toHaveText('待办已满（500 条），请先清理')
    await expect(input).toBeDisabled()
    await expect(button).toBeDisabled()
  })

  test('[P0] AC-3 E2E-5（新增路径）网络错误 → 操作失败提示常驻、无新条、输入保留；关闭后消失', async ({ page, backend }) => {
    backend.seed([{ title: '已有' }])
    backend.failNext('networkError', { method: 'POST', path: '/api/todos' })
    await page.goto('/')
    const items = page.getByRole('listitem')
    await expect(items).toHaveCount(1)
    const input = page.getByRole('textbox', { name: '新增待办标题' })
    await input.click()
    await input.pressSequentially('订周四会议室')
    await input.press('Enter')

    const alert = page.getByRole('alert')
    await expect(alert).toContainText('操作失败，请重试')
    await expect(items).toHaveCount(1)
    await expect(input).toHaveValue('订周四会议室')

    await page.getByRole('button', { name: '关闭提示' }).click()
    await expect(alert).toHaveCount(0)
  })
})
