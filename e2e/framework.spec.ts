// E2E 基座自检（FE-0E）：webServer 只起前端；/api 全部由契约替身经 Playwright 路由应答；
// 故障注入、扣住请求、越界拦截可用。也是 E2E-1..E2E-7 的写法示例。
// 选择器：按可读名称（getByRole + name，AD-16），不用 CSS / data-testid。
// 除第一个用例外都在同源空白页（BLANK_PATH）上跑：App 以后会在挂载时发 GET，不能让它干扰管线断言。
import { BLANK_PATH, expect, test } from './support/fixtures.ts'

test.describe('E2E 基座', () => {
  test('页面由 webServer 起的 Vite 前端提供', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: '待办' })).toBeVisible()
  })

  test('/api 请求由契约替身应答，数据来自 backend.seed()', async ({ page, backend }) => {
    // Given 替身里有两条
    backend.seed([{ title: '旧的' }, { title: '新的' }])
    await page.goto(BLANK_PATH)

    // When 页面发出同源相对 /api 请求（network-first：先挂等待，再触发）
    const responsePromise = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/todos')
    await page.evaluate(() => fetch('/api/todos'))
    const response = await responsePromise

    // Then 按契约返回，按 createdAt 倒序
    expect(response.status()).toBe(200)
    const { items } = (await response.json()) as { items: Array<{ title: string }> }
    expect(items.map((t) => t.title)).toEqual(['新的', '旧的'])
    expect(backend.requests).toEqual([{ method: 'GET', path: '/api/todos', body: null }])
  })

  test('failNext：502 + text/html、网络错误各生效一次，之后回到契约响应', async ({ page, backend }) => {
    await page.goto(BLANK_PATH)
    backend.failNext('badGateway', { method: 'GET', path: '/api/todos' })
    backend.failNext('networkError', { method: 'POST' })

    const gateway = await page.evaluate(async () => {
      const r = await fetch('/api/todos')
      return { status: r.status, type: r.headers.get('content-type') }
    })
    expect(gateway).toEqual({ status: 502, type: 'text/html' })

    const network = await page.evaluate(() =>
      fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"title":"x"}' }).then(
        () => 'resolved',
        (e: unknown) => (e instanceof TypeError ? 'TypeError' : String(e)),
      ),
    )
    expect(network).toBe('TypeError')

    expect(await page.evaluate(() => fetch('/api/todos').then((r) => r.status))).toBe(200)
  })

  test('holdNext：服务端确认前可检查中间状态（禁乐观更新的断言方式）', async ({ page, backend }) => {
    await page.goto(BLANK_PATH)
    const held = backend.holdNext({ method: 'POST', path: '/api/todos' })

    // When 发出新增请求但替身还没响应
    await page.evaluate(() => {
      ;(window as unknown as { pending: Promise<number> }).pending = fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '  买牛奶  ' }),
      }).then((r) => r.status)
    })
    await held.arrived

    // Then 确认前替身里还没有这条（真实用例在这里断言界面没有提前插入）
    expect(backend.list()).toEqual([])

    // When 放行
    held.release()
    const status = await page.evaluate(() => (window as unknown as { pending: Promise<number> }).pending)

    // Then 按契约写入（已裁剪）
    expect(status).toBe(201)
    expect(backend.list().map((t) => t.title)).toEqual(['买牛奶'])
  })

  test('发往其他 origin 的 /api 请求被拦下，不会打到本机真实后端', async ({ page, backend }) => {
    await page.goto(BLANK_PATH)
    const outcome = await page.evaluate(() =>
      fetch('http://127.0.0.1:8080/api/todos').then(
        () => 'resolved',
        () => 'blocked',
      ),
    )
    expect(outcome).toBe('blocked')
    // 取走记录，否则 fixture 收尾会判这个用例失败
    expect(backend.takeViolations()).toEqual(['GET http://127.0.0.1:8080/api/todos'])
  })
})
