// E2E 的后端替身：用 Playwright 路由把浏览器发出的 /api 请求交给契约替身（src/mocks/contractBackend.ts）。
// 和组件测试的 MSW 共用同一份替身语义；webServer 只起前端，E2E 不依赖、也碰不到真实后端。
//
// 只拦截 pathname 为 /api 或 /api/... 的请求。不能用 '**/api/**' 这类 glob：
// Vite 开发服务器把源码按 /src/api/client.ts 这样的路径发给浏览器，glob 会把源码请求也拦掉。

import type { BrowserContext, Route } from '@playwright/test'
import {
  createContractBackend,
  errorBody,
  type ContractBackend,
} from '../../src/mocks/contractBackend.ts'

export type Fault = 'badGateway' | 'networkError' | 'internalError'

export interface RequestMatcher {
  /** 例如 'POST'（按原样比较，大小写敏感）；不写则匹配任意方法 */
  method?: string
  /** 精确 pathname（如 '/api/todos'）或正则；不写则匹配任意 /api 路径 */
  path?: string | RegExp
}

export interface RecordedRequest {
  method: string
  path: string
  /** 请求体原文（GET/DELETE 为 null） */
  body: string | null
}

export interface HeldRequest {
  /** 请求到达替身时 resolve（此时还没有响应） */
  arrived: Promise<void>
  /** 放行：按契约替身处理并响应 */
  release(): void
}

export interface ContractRoutes extends Pick<ContractBackend, 'seed' | 'fill' | 'list' | 'useClock'> {
  /** 浏览器发到替身的全部 /api 请求（按到达顺序） */
  readonly requests: readonly RecordedRequest[]
  /** 下一个（或接下来 times 个）匹配的请求返回故障，而不是契约响应 */
  failNext(fault: Fault, matcher?: RequestMatcher, times?: number): void
  /** 扣住下一个匹配的请求，直到 release()；用来断言「服务端确认前界面不变」（禁乐观更新） */
  holdNext(matcher?: RequestMatcher): HeldRequest
  /** 取出并清空「越界请求」记录（发往非本站 origin 的 /api 请求） */
  takeViolations(): string[]
  /** fixture 收尾：放行所有被扣住的请求、卸载路由，并返回仍未取走的越界请求 */
  dispose(): Promise<string[]>
}

const BAD_GATEWAY_HTML = '<html><body><h1>502 Bad Gateway</h1></body></html>'

function matches(matcher: RequestMatcher, method: string, path: string): boolean {
  if (matcher.method && matcher.method !== method) return false
  if (matcher.path === undefined) return true
  return typeof matcher.path === 'string' ? matcher.path === path : matcher.path.test(path)
}

const isApiPath = (url: URL) => url.pathname === '/api' || url.pathname.startsWith('/api/')

export async function installContractRoutes(context: BrowserContext, appOrigin: string): Promise<ContractRoutes> {
  const backend = createContractBackend()
  const requests: RecordedRequest[] = []
  const faults: Array<{ matcher: RequestMatcher; fault: Fault; remaining: number }> = []
  const holds: Array<{ matcher: RequestMatcher; arrive: () => void; released: Promise<void>; release: () => void }> = []
  const pendingReleases = new Set<() => void>()
  let violations: string[] = []

  async function handle(route: Route) {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()

    if (url.origin !== appOrigin) {
      // 前端只能同源相对 /api（AD-13）。发往其他 origin 的 /api 请求一律拦下，绝不放行到真实服务。
      violations.push(`${method} ${url.href}`)
      await route.abort('blockedbyclient')
      return
    }

    const bodyText = request.postData()
    requests.push({ method, path: url.pathname, body: bodyText })

    const faultIndex = faults.findIndex((f) => matches(f.matcher, method, url.pathname))
    if (faultIndex >= 0) {
      const rule = faults[faultIndex]
      if (--rule.remaining <= 0) faults.splice(faultIndex, 1)
      if (rule.fault === 'networkError') return route.abort('failed')
      if (rule.fault === 'badGateway') return route.fulfill({ status: 502, contentType: 'text/html', body: BAD_GATEWAY_HTML })
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify(errorBody('INTERNAL_ERROR')) })
    }

    const holdIndex = holds.findIndex((h) => matches(h.matcher, method, url.pathname))
    if (holdIndex >= 0) {
      const [hold] = holds.splice(holdIndex, 1)
      hold.arrive()
      await hold.released
    }

    const response = backend.handle({
      method,
      path: url.pathname,
      contentType: request.headers()['content-type'] ?? null,
      bodyText,
    })
    if (response.body === undefined) {
      await route.fulfill({ status: response.status })
    } else {
      await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) })
    }
  }

  await context.route(isApiPath, handle)

  return {
    seed: (items) => backend.seed(items),
    fill: (count) => backend.fill(count),
    list: () => backend.list(),
    useClock: (now) => backend.useClock(now),
    requests,
    failNext(fault, matcher = {}, times = 1) {
      faults.push({ matcher, fault, remaining: times })
    },
    holdNext(matcher = {}) {
      let arrive!: () => void
      let release!: () => void
      const arrived = new Promise<void>((resolve) => (arrive = resolve))
      const released = new Promise<void>((resolve) => (release = resolve))
      pendingReleases.add(release)
      holds.push({ matcher, arrive, released, release })
      return {
        arrived,
        release: () => {
          pendingReleases.delete(release)
          release()
        },
      }
    },
    takeViolations() {
      const taken = violations
      violations = []
      return taken
    },
    async dispose() {
      for (const release of pendingReleases) release()
      pendingReleases.clear()
      await context.unrouteAll({ behavior: 'ignoreErrors' })
      return violations
    },
  }
}
