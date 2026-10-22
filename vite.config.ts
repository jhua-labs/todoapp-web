import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // AD-12：MSW worker 脚本只在 mock 模式（npm run dev:mock）作为静态目录；其余模式不发布任何 public 目录，
  // 生产构建因此不含 mockServiceWorker.js。
  publicDir: mode === 'mock' ? 'mock-public' : false,
  resolve: {
    // AD-18：用 resolve.alias + import.meta.dirname（不用 CommonJS 的目录全局变量）
    alias: { '@': `${import.meta.dirname}/src` },
  },
  server: {
    // AD-14：只监听回环、端口固定、/api 代理到本地后端且不剥离前缀。
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080' },
    },
  },
  test: {
    environment: 'jsdom',
    // forks：每个 worker 是独立进程，test.env.TZ 才能可靠生效（threads 池里改 TZ 不改进程时区）
    pool: 'forks',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // AD-16：时区固定，相对时间断言另行注入参考时间。
    env: { TZ: 'Asia/Shanghai' },
    // 每个测试结束自动还原 vi.spyOn / vi.stubGlobal / vi.stubEnv，防止测试间串味。
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
}))
