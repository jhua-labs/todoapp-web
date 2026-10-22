import { defineConfig, devices, type Project } from '@playwright/test'

// E2E 用独立端口起前端，不和 `npm run dev`（5173，AD-14）抢端口，也不会误连一个开着的 dev:mock。
const E2E_PORT = 5180
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`
const isCI = !!process.env.CI
// staging 用例不需要本地前端（npm run test:e2e:staging 会设 E2E_TARGET=staging）
const targetsStaging = process.env.E2E_TARGET === 'staging'

// 开发期只跑 chromium（测试设计 FE-0E）。全浏览器矩阵（Chrome/Edge/Safari/Firefox）留到
// @needs-staging 阶段的全量回归，用 E2E_BROWSERS=all 打开；打开前需另装对应浏览器：
//   npx playwright install firefox webkit && npx playwright install chrome msedge
const fullMatrix: Project[] = [
  { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  { name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
]

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/playwright',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/playwright-junit.xml' }],
  ],

  use: {
    // 本地 spec 的 baseURL；staging spec 由 e2e/support/staging.ts 改成 STAGING_BASE_URL
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure-and-retries',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    // 屏蔽 Service Worker：MSW 的浏览器 worker 若被注册，会让 Playwright 路由看不到请求。
    serviceWorkers: 'block',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.E2E_BROWSERS === 'all' ? fullMatrix : []),
  ],

  // 只起前端（Vite 开发服务器，永不启用 MSW，AD-12）；后端由 e2e/support/contractRoutes.ts 按契约替身应答。
  webServer: targetsStaging
    ? undefined
    : {
        command: `npm run dev -- --port ${E2E_PORT}`,
        url: BASE_URL,
        // 不复用已有进程：端口上若有别的服务，直接报错，而不是悄悄拿它来跑。
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
