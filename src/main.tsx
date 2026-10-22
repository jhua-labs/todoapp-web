import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// AD-12：MSW 只在 `npm run dev:mock`（vite --mode mock）启用；`npm run dev` 与生产构建永不启用。
// 生产构建 MODE 为 production，这个分支被静态替换后整段消除，browser.ts 与 msw/browser 不进 dist。
async function enableMocking(): Promise<void> {
  if (import.meta.env.MODE === 'mock') {
    const { worker } = await import('./mocks/browser.ts')
    // bypass：Vite 自身的模块 / HMR 请求要放行
    await worker.start({ onUnhandledFrame: 'bypass', serviceWorker: { url: '/mockServiceWorker.js' } })
  }
}

function render(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void enableMocking().then(render)
