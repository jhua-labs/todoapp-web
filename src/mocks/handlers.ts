// MSW handlers：把契约替身（contractBackend.ts）接到 MSW 上（AD-12）。
//
// 规则：
//   - 测试里的特殊场景一律用 server.use(scenarios.xxx()) 临时覆盖，不改本文件（AD-17 文件归属表）；
//   - 契约内的场景（容量 500、空 PATCH、只含未知字段的 PATCH、非法 id）由替身本身给出，
//     用 backend.fill(500) / 直接发对应请求即可；
//   - 契约外的故障（502 + text/html、网络错误、500）用 scenarios。

import { http, HttpResponse } from 'msw'
import { createContractBackend, errorBody, type ContractBackend, type FakeResponse } from './contractBackend.ts'

/** 组件测试共享的替身实例；src/test/setup.ts 在每个测试后 reset()。 */
export const backend: ContractBackend = createContractBackend()

async function toFakeRequest(request: Request) {
  return {
    method: request.method,
    path: new URL(request.url).pathname,
    contentType: request.headers.get('content-type'),
    bodyText: request.method === 'GET' || request.method === 'HEAD' ? null : await request.text(),
  }
}

function toHttpResponse(response: FakeResponse) {
  return response.body === undefined
    ? new HttpResponse(null, { status: response.status })
    : HttpResponse.json(response.body, { status: response.status })
}

export function createHandlers(target: ContractBackend) {
  const resolve = async ({ request }: { request: Request }) => toHttpResponse(target.handle(await toFakeRequest(request)))
  // '/api/*' 不匹配裸 '/api'，单独补上，与 E2E 侧 isApiPath 的范围一致
  return [http.all('/api', resolve), http.all('/api/*', resolve)]
}

export const handlers = createHandlers(backend)

type Method = 'get' | 'post' | 'patch' | 'delete' | 'all'

interface ScenarioTarget {
  /** 默认 'all' */
  method?: Method
  /** 默认 '/api/*' */
  path?: string
  /** true = 只生效一次 */
  once?: boolean
}

function override(target: ScenarioTarget, respond: () => Response) {
  const { method = 'all', path = '/api/*', once = false } = target
  return http[method](path, respond, { once })
}

/** 契约外的故障场景，配合 server.use() 使用。 */
export const scenarios = {
  /** 网关错误：502 + text/html（前端须归为 INTERNAL_ERROR，AD-13） */
  badGateway: (target: ScenarioTarget = {}) =>
    override(
      target,
      () =>
        new HttpResponse('<html><body><h1>502 Bad Gateway</h1></body></html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
    ),
  /** 网络错误：fetch 直接 reject */
  networkError: (target: ScenarioTarget = {}) => override(target, () => HttpResponse.error()),
  /** 契约内的 500 INTERNAL_ERROR（例如容量校验锁超时，AD-10） */
  internalError: (target: ScenarioTarget = {}) =>
    override(target, () => HttpResponse.json(errorBody('INTERNAL_ERROR'), { status: 500 })),
}
