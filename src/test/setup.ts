// Vitest 全局 setup（vite.config.ts → test.setupFiles）。
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { backend } from '../mocks/handlers.ts'
import { server } from '../mocks/server.ts'

let fetchBeforeShim: typeof fetch | undefined

beforeAll(() => {
  // AD-12：任何没有 handler 的请求都直接报错，不放行到真实网络。
  server.listen({ onUnhandledFrame: 'error' })

  // 浏览器里 fetch('/api/todos') 按当前页面地址解析相对路径；Node 的 fetch 不会，会直接抛 Invalid URL。
  // 这里按 jsdom 的 location 补上这一步，让 client.ts 的相对 /api 在测试里和浏览器里行为一致。
  // 必须在 server.listen() 之后包，这样 MSW 拿到的已经是绝对地址。
  fetchBeforeShim = globalThis.fetch
  const inner = fetchBeforeShim
  globalThis.fetch = (input, init) =>
    inner(typeof input === 'string' || input instanceof URL ? new URL(input, globalThis.location.href) : input, init)
})

afterEach(() => {
  cleanup() // 未开启 Vitest globals，Testing Library 不会自动 cleanup
  vi.useRealTimers() // 防止某个测试开的 fake timers 漏到下一个测试（会卡住 MSW delay 和 user-event）
  server.resetHandlers() // 撤掉本测试的 server.use()
  backend.reset() // 清空替身数据、恢复真实时钟
})

afterAll(() => {
  if (fetchBeforeShim) globalThis.fetch = fetchBeforeShim
  server.close()
})
