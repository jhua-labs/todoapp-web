// 浏览器端 MSW worker（AD-12）：只在 `npm run dev:mock`（vite --mode mock）下由 main.tsx 动态加载。
// handlers 与组件测试共用 ./handlers.ts（契约替身），不复制、不改。
// worker 脚本在 mock-public/mockServiceWorker.js（`npx msw@3.0.3 init mock-public --no-save` 生成；升级 MSW 时重新生成）。
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers.ts'

export const worker = setupWorker(...handlers)
