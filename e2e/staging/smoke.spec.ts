// @needs-staging 示例：经 SSM 端口转发（本地 18080，AD-15）打已部署的 staging。
// 本地回归（--grep-invert @needs-staging）不跑；本地只检查能列出：npm run test:e2e:staging:list
// 建好隧道后：npm run test:e2e:staging（地址可用 STAGING_BASE_URL 覆盖）
import { expect, test } from '../support/staging.ts'

test.describe('@needs-staging staging 冒烟', () => {
  test('nginx 托管前端页面，同源 /api/todos 返回 {items: [...]}', async ({ page }) => {
    const apiPromise = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/todos')
    await page.goto('/')
    const status = await page.evaluate(() => fetch('/api/todos').then((r) => r.status))
    expect(status).toBe(200)

    const response = await apiPromise
    expect(response.headers()['content-type']).toMatch(/^application\/json/)
    const body = (await response.json()) as { items?: unknown }
    expect(Array.isArray(body.items)).toBe(true)
  })
})
