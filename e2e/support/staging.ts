// staging E2E 的唯一入口（project-context「staging 测试的唯一入口」）：
//   - 只有标题（test 或所在 describe）带 @needs-staging 的用例能从这里引入 test，否则直接报错；
//   - 不装契约替身，请求打到已部署的 staging（经 SSM 端口转发，本地 18080，AD-15）；
//   - 其他测试不得读取 STAGING_BASE_URL，也不得引入本文件（src/test/stagingBoundary.test.ts 守住）。
// 本地回归用 --grep-invert @needs-staging 排除；本地只检查能列出：npm run test:e2e:staging:list
import { test as base, expect } from '@playwright/test'

export const STAGING_TAG = '@needs-staging'
const DEFAULT_STAGING_BASE_URL = 'http://127.0.0.1:18080'

export const test = base.extend<{ stagingGuard: void }>({
  baseURL: async ({}, use) => {
    await use(process.env.STAGING_BASE_URL || DEFAULT_STAGING_BASE_URL)
  },
  stagingGuard: [
    async ({}, use, testInfo) => {
      // 约定是「标题带 @needs-staging」：只看 describe / test 标题（titlePath[0] 是文件路径，不算）
      const titles = testInfo.titlePath.slice(1)
      if (!titles.some((t) => t.includes(STAGING_TAG))) {
        throw new Error(`从 e2e/support/staging.ts 引入的用例，标题必须带 ${STAGING_TAG}，否则本地回归会误跑它：${titles.join(' > ')}`)
      }
      await use()
    },
    { auto: true },
  ],
})

export { expect }
