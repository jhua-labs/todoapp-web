// 统一 api 客户端（AD-13）：应用代码里唯一调用 fetch 的地方。
//
// - 基础路径为相对 /api，同源，不设 mode / credentials，不配 CORS（AD-14）。
// - 每个请求都带 AbortSignal.timeout(timeoutMs)，默认 5000，可注入。
// - 204 不读响应体。
// - 错误归一：只有「状态码属于契约状态表 + 响应体能解析为 ErrorBody + code 是 4 个已知值之一」才采用该 code；
//   网络错误、超时、非 JSON、502/503/504、契约外状态一律 INTERNAL_ERROR。
// - 永不向调用方抛异常；不做重试、缓存、乐观合并。
import { ERROR_CODES, type ErrorCode } from './types.ts'

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode }

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  method?: HttpMethod
  body?: unknown
  /** 超时毫秒数，默认 DEFAULT_TIMEOUT_MS。 */
  timeoutMs?: number
}

export const DEFAULT_TIMEOUT_MS = 5000

interface RouteContract {
  success: number
  errors: readonly number[]
}

// docs/contracts/todoapp-api.yaml 的状态表
const COLLECTION: Partial<Record<HttpMethod, RouteContract>> = {
  GET: { success: 200, errors: [500] },
  POST: { success: 201, errors: [400, 409, 500] },
}
const ITEM: Partial<Record<HttpMethod, RouteContract>> = {
  PATCH: { success: 200, errors: [400, 404, 500] },
  DELETE: { success: 204, errors: [404, 500] },
}

function contractFor(method: HttpMethod, path: string): RouteContract | undefined {
  const pathname = path.split('?')[0]
  if (pathname === '/api/todos') return COLLECTION[method]
  if (/^\/api\/todos\/[^/]+$/.test(pathname)) return ITEM[method]
  return undefined
}

const INTERNAL: { ok: false; code: ErrorCode } = { ok: false, code: 'INTERNAL_ERROR' }

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}

/** 响应体是合法 ErrorBody 时返回其 code，否则 undefined。 */
function errorCodeOf(text: string): ErrorCode | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const error = (parsed as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return undefined
  const { code, message } = error as { code?: unknown; message?: unknown }
  return isErrorCode(code) && typeof message === 'string' ? code : undefined
}

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET'
  const contract = contractFor(method, path)
  const init: RequestInit = { method, signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) }
  if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(options.body)
  }

  try {
    // 传字符串相对路径：浏览器按页面地址解析（同源）
    const res = await fetch(path, init)
    if (!contract) return INTERNAL

    if (res.status === contract.success) {
      if (res.status === 204) return { ok: true, data: undefined as T }
      try {
        return { ok: true, data: JSON.parse(await res.text()) as T }
      } catch {
        return INTERNAL
      }
    }

    if (contract.errors.includes(res.status)) {
      const code = errorCodeOf(await res.text())
      return code ? { ok: false, code } : INTERNAL
    }

    // 502/503/504 与任何契约外状态
    return INTERNAL
  } catch {
    // 网络错误、TimeoutError、AbortError、读体失败
    return INTERNAL
  }
}
