// 本地 E2E 的唯一入口：所有本地 spec 都从这里引入 test / expect，而不是直接从 @playwright/test。
// staging 用例改从 ./staging.ts 引入（project-context「staging 测试的唯一入口」）。
import { test as base, expect } from '@playwright/test'
import { installContractRoutes, type ContractRoutes } from './contractRoutes.ts'

/** 框架自检用的同源空白页：不加载 App，避免 App 自己发的请求干扰对替身管线的断言。 */
export const BLANK_PATH = '/__e2e-blank'

export const test = base.extend<{ backend: ContractRoutes }>({
  // auto：浏览器（page / context）发出的 /api 一定被契约替身接管，不会漏到 Vite 代理再打到本机 8080。
  backend: [
    async ({ context, baseURL }, use, testInfo) => {
      if (testInfo.titlePath.slice(1).some((t) => t.includes('@needs-staging'))) {
        throw new Error('@needs-staging 用例必须从 e2e/support/staging.ts 引入 test，不能用本地契约替身跑')
      }
      if (!baseURL) throw new Error('playwright.config.ts 必须配置 use.baseURL')
      const backend = await installContractRoutes(context, new URL(baseURL).origin)
      await context.route(
        (url) => url.pathname === BLANK_PATH,
        (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }),
      )
      await use(backend)
      const violations = await backend.dispose()
      expect(violations, '前端只能请求同源相对 /api（AD-13），以下请求被拦下').toEqual([])
    },
    { auto: true },
  ],
  // Playwright 的 request（APIRequestContext）不经过 context.route，会经 Vite 代理打到真实本地后端。
  // 本地 E2E 禁用它；page.request 同理，不要用。
  request: async ({}, use) => {
    void use
    throw new Error('本地 E2E 不允许直接发 API 请求（会绕过契约替身打到真实后端）；数据用 backend.seed()')
  },
})

export { expect }
