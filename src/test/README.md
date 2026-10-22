# todoapp-web 测试说明

两层测试，都只依赖契约 `../docs/contracts/todoapp-api.yaml`，不需要后端在跑（AD-12、AD-16）。

| 层 | 工具（版本写死） | 位置 | 命令（工作区根） |
| --- | --- | --- | --- |
| 组件 / 单元 | Vitest 5.0.5 + jsdom 30.1.3 + Testing Library（react 16.3.3、dom 10.4.2、user-event 14.6.8、jest-dom 7.0.1）+ MSW 3.0.3 | `src/**/*.test.ts(x)` | `npm --prefix todoapp-web test`（`tsc -b && vitest run`） |
| E2E | @playwright/test 1.64.0，开发期只跑 chromium | `e2e/**/*.spec.ts` | `cd todoapp-web && npx playwright test --grep-invert @needs-staging` |

## 准备

```bash
nvm use                                   # .nvmrc = 24；engines.node = >=24 <25
npm --prefix todoapp-web ci
cd todoapp-web && npx playwright install chromium   # 只装 chromium
```

## 常用命令（在 todoapp-web 下）

- `npm test`：类型检查（app / test / node / e2e 四份 tsconfig）+ 组件测试。
- `npm run test:watch`：Vitest 监听模式。
- `npm run test:e2e`：等同 `npx playwright test --grep-invert @needs-staging`。
- `npx playwright test --headed` / `--debug` / `--ui`：有界面运行、逐步调试。
- `npx playwright show-report`：看 HTML 报告；失败用例的 trace / 截图 / 视频在 `test-results/playwright/`。
- `npm run test:e2e:staging:list`：本地只确认 staging 用例能被识别。
- `npm run test:e2e:staging`：建好 SSM 隧道（本地 18080）后跑 staging 用例，地址可用 `STAGING_BASE_URL` 覆盖。
- `E2E_BROWSERS=all npx playwright test`：全浏览器矩阵（Chrome/Edge/Firefox/Safari），留到 `@needs-staging` 阶段的全量回归；先装对应浏览器。

## 结构

```text
src/mocks/contractBackend.ts   契约替身（内存版后端，纯函数）：两层测试共用同一份语义
src/mocks/handlers.ts          把替身接到 MSW；导出 backend（数据）与 scenarios（契约外故障）
src/mocks/server.ts            Node 侧 MSW server
src/test/setup.ts              Vitest 全局：jest-dom、onUnhandledFrame:'error'、相对 /api 解析、每测后清理
src/test/sharedContracts.ts    读 ../docs/contracts/ 下的共享文件（title-cases.json 等）
src/mocks/browser.ts           浏览器侧 MSW worker（setupWorker + handlers.ts），只在 npm run dev:mock 下由 main.tsx 动态加载
mock-public/                   MSW worker 脚本 mockServiceWorker.js（npx msw@3.0.3 init mock-public --no-save 生成，不手改）；只在 mock 模式作 publicDir
e2e/support/contractRoutes.ts  把替身接到 Playwright 路由（只拦 pathname 为 /api 的请求）
e2e/support/fixtures.ts        本地 E2E 的唯一入口：test / expect + 自动装上的 backend fixture
e2e/support/staging.ts         staging E2E 的唯一入口：只允许 @needs-staging 用例引入
```

## mock 联调（浏览器里用契约替身，不需要后端）

- `npm --prefix todoapp-web run dev:mock`（= `vite --mode mock`）：先启动 MSW worker（`onUnhandledFrame: 'bypass'`，放行 Vite 自身请求），再渲染应用；所有 `/api` 由 `handlers.ts` 的契约替身应答，数据只在当前页面内存里。
- `npm run dev` 永不启用 MSW：判据只有 `import.meta.env.MODE === 'mock'`；`mock-public/` 只在 mock 模式作 `publicDir`，其余模式（含生产构建）不发布 worker 脚本，`dist/` 里也没有启动它的代码。
- 升级 MSW 时重新执行 `npx msw@<版本> init mock-public --no-save` 生成 worker（AD-17）。

## 写法

**组件测试**

```tsx
import { backend, scenarios } from '@/mocks/handlers.ts'
import { server } from '@/mocks/server.ts'

backend.seed([{ title: '旧的' }, { title: '新的' }])        // 契约内数据
backend.fill(500)                                          // 满额 → POST 返回 409
server.use(scenarios.badGateway({ method: 'get', once: true }))  // 502 + text/html
server.use(scenarios.networkError({ method: 'post' }))           // fetch reject
server.use(scenarios.internalError({ method: 'post' }))          // 500 INTERNAL_ERROR
```

- 特殊场景只用 `server.use()`，不改 `handlers.ts`（AD-17）。每个测试结束会自动 `resetHandlers()`、`backend.reset()`、`cleanup()`。
- 查询优先 `getByRole(…, { name })`（AD-16）。
- 时区固定 `Asia/Shanghai`；相对时间给 `formatRelative` 注入参考时间，或用 `backend.useClock()` 固定服务端时间。
- `AbortSignal.timeout` 不受 fake timers 控制：测试 `client.ts` 超时时注入一个小的 `timeoutMs`。
- 没有 handler 的请求会直接失败（`onUnhandledFrame: 'error'`），不会放行到网络。

**E2E**

```ts
import { expect, test } from './support/fixtures.ts'   // 不要直接从 @playwright/test 引入

test('新增后置顶', async ({ page, backend }) => {
  backend.seed([{ title: '已有' }])
  const held = backend.holdNext({ method: 'POST', path: '/api/todos' })
  await page.goto('/')
  // …输入并回车…
  await held.arrived
  // 断言：服务端确认前界面没有插入（禁乐观更新）
  held.release()
  // 断言：确认后置顶、输入清空、焦点保留
})
```

- `backend` fixture 是 auto 的：所有 `/api` 都由契约替身应答，用例不写它也一样。
- 故障：`backend.failNext('badGateway' | 'networkError' | 'internalError', { method, path }, times)`。
- `backend.requests` 记录了浏览器发出的全部 `/api` 请求，可以断言「没有发请求」或请求体。
- 前端只能请求同源相对 `/api`（AD-13）。发往其他 origin 的 `/api` 请求会被拦下，用例收尾时判失败。
- webServer 用 5180 端口起 `npm run dev`（永不启用 MSW），不会和日常开发的 5173 冲突；端口被占时直接报错。
- 等待用 web-first 断言（`expect(locator).toBeVisible()`）或 `page.waitForResponse`（先挂等待，再触发），不用 `waitForTimeout`。
- 不要用 `request` fixture 或 `page.request`：它们不经过 `context.route`，会经 Vite 代理打到真实本地后端（fixture 里已把 `request` 设成直接报错）。
- 方法名大小写敏感：替身和真实后端一样，`'patch'` 会得到 400。
- 相对时间（AD-20）：替身时钟和浏览器时钟要对齐，例如
  `const T = new Date('2026-10-20T02:00:00.000Z'); await page.clock.setFixedTime(T); backend.useClock(() => T); backend.seed([{ createdAt: '2026-10-20T01:59:30.000Z' }])`。
- `BLANK_PATH`（同源空白页）只给框架自检用；业务用例照常 `page.goto('/')`。

**staging 用例**：从 `e2e/support/staging.ts` 引入 `test`，标题带 `@needs-staging`（没带会直接报错）。其他用例不得读取 `STAGING_BASE_URL`，也不得引入它。tag 永远不去掉；红阶段的 `test.skip()` 在实现完成后去掉。

## 纪律（test-quality）

- 确定性：不用 `waitForTimeout`、不依赖真实时间；不提交 `.only`（CI 下 `forbidOnly`）。
- 隔离：每个测试自建数据，不依赖其他测试的执行顺序。
- 断言具体值，不断「类型对就行」；单个测试 ≤1.5 分钟、单文件 ≤1000 行。
- 替身改动必须同步更新 `src/mocks/contractBackend.test.ts`：它把替身和契约、`title-cases.json` 逐项对照。

## 写时拦截 hook

没有安装 TEA 的 `tea-enforce.cjs`：它面向 Claude Code 的 `.claude/settings.json`，要装在工作区根，而本次的框架文件只放在 `todoapp-web/`。测试质量规则由 `bmad-testarch-test-review` 事后检查。

## CI

暂无 CI（架构 Deferred）。接入时：`npm ci` → `npx playwright install --with-deps chromium` → `npm test` → `npx playwright test --grep-invert @needs-staging`；上传 `playwright-report/` 和 `test-results/`（含 `playwright-junit.xml`）。设 `CI=1` 后会启用 retries=2、workers=2、forbidOnly。

## 知识库参考

TEA：`fixture-architecture.md`、`network-first.md`、`playwright-config.md`、`data-factories.md`、`test-quality.md`。
