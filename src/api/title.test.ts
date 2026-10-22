// Story 1.2（FE-0）ATDD 红阶段：标题规则 title.ts（FE-U1，AD-7）。
//
// 用例来自共享文件 ../docs/contracts/title-cases.json（经 src/test/sharedContracts.ts 读取，数量不写死）。
// 本文件约定的导出（story Dev Notes「title.ts」的建议签名）：
//   TRIM_CODE_POINTS（裁剪码点表；元素可以是码点数字、'U+XXXX' 字符串或单字符）
//   MAX_TITLE_LENGTH = 200、trimTitle(raw)、titleLength(raw)、
//   checkTitle(raw) → { kind: 'ok'; title } | { kind: 'empty' } | { kind: 'tooLong'; length } | { kind: 'invalid' }
//
// 红阶段 title.ts 还不存在：经绝对路径动态 import，保证 `tsc -b` 现在就能通过。
// FE-M1/FE-M2（MSW handlers 按契约、onUnhandledFrame:'error'、createdAt 严格递增）已由 4.2 的
// src/mocks/handlers.test.ts、contractBackend.test.ts 覆盖，本文件不重复（AD-17）。
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandTitleCase, loadTitleCases } from '../test/sharedContracts.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const TITLE_FILE = 'src/api/title.ts'

type TitleCheck = { kind: 'ok'; title: string } | { kind: 'empty' } | { kind: 'tooLong'; length: number } | { kind: 'invalid' }

interface TitleModule {
  TRIM_CODE_POINTS: readonly (number | string)[]
  MAX_TITLE_LENGTH: number
  trimTitle(raw: string): string
  titleLength(raw: string): number
  checkTitle(raw: string): TitleCheck
}

async function load<T>(rel: string): Promise<{ mod: T | undefined; error: string }> {
  try {
    return { mod: (await import(/* @vite-ignore */ join(ROOT, rel))) as T, error: '' }
  } catch (e) {
    return { mod: undefined, error: `${rel} 加载失败：${String(e)}` }
  }
}

/** 'U+3000' / 0x3000 / '\u3000' → 0x3000 */
function toCodePoint(value: number | string): number {
  if (typeof value === 'number') return value
  if (/^U\+[0-9A-F]{4,6}$/i.test(value)) return Number.parseInt(value.slice(2), 16)
  return value.codePointAt(0) ?? Number.NaN
}

/** 共享文件里 invalid 用例的具体失败种类（按用例名；文件新增的 invalid 用例只断言「不是 ok」）。 */
const INVALID_KIND: Record<string, TitleCheck['kind']> = {
  empty: 'empty',
  'only whitespace': 'empty',
  'contains NUL': 'invalid',
  'lone high surrogate': 'invalid',
  '201 han': 'tooLong',
  '201 emoji': 'tooLong',
}

describe('Story 1.2 标题规则（ATDD 红阶段）', () => {
  // 红阶段：T3.2（src/api/title.ts）完成后去掉 skip
  it('[P0] AC-6 FE-U1 title.ts 只裁共享码点表、按码点计长 1..200、拦 U+0000/孤立代理项，且通过 title-cases.json 全部用例', async () => {
    const shared = loadTitleCases()
    const { mod: title, error } = await load<TitleModule>(TITLE_FILE)

    // 本 AC 新承诺的值：title.ts 写死的裁剪码点表与共享文件逐项相同（漂移即红）
    expect(title?.TRIM_CODE_POINTS.map(toCodePoint), error).toEqual(shared.trimCodePoints.map(toCodePoint))

    expect(title?.MAX_TITLE_LENGTH).toBe(shared.maxLength)
    expect(shared.cases.length).toBeGreaterThan(0)
    for (const c of shared.cases) {
      const { input, trimmed } = expandTitleCase(c)
      const result = title?.checkTitle(input)
      if (c.valid) {
        expect(result, c.name).toEqual({ kind: 'ok', title: trimmed })
        expect(title?.trimTitle(input), c.name).toBe(trimmed)
        expect(title?.titleLength(input), c.name).toBe([...(trimmed ?? '')].length)
      } else {
        expect(result?.kind, c.name).not.toBe('ok')
        const kind = INVALID_KIND[c.name]
        if (kind) expect(result?.kind, c.name).toBe(kind)
      }
    }
    // 超长态要带码点长度，供 TitleCounter 显示（代理对计 1）
    expect(title?.checkTitle('😀'.repeat(201))).toEqual({ kind: 'tooLong', length: 201 })
    expect(title?.titleLength(' 😀a\u3000')).toBe(2)

    // 不调原生 trim、不做规范化；不 import 契约替身（两份 AD-7 实现必须独立），也不 import 请求层（AD-13）
    const source = existsSync(join(ROOT, TITLE_FILE)) ? readFileSync(join(ROOT, TITLE_FILE), 'utf8') : ''
    expect(source).not.toMatch(/\.trim(Start|End)?\(/)
    expect(source).not.toMatch(/\.normalize\(/)
    expect(source).not.toMatch(/from\s+['"][^'"]*mocks\//)
    expect(source).not.toMatch(/from\s+['"][^'"]*\/(client|todos)(\.ts)?['"]/)
  })
})
