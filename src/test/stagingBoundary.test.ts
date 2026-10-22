// 守住 project-context「staging 测试的唯一入口」（前端部分），静态扫源码：
//   - e2e/staging/ 下的 spec 只从 e2e/support/staging.ts 引入 test；其他 spec 只从 e2e/support/fixtures.ts 引入；
//   - 只有 e2e/support/staging.ts 读取 STAGING_BASE_URL；
//   - 其他文件不得引入 support/staging。
// 「标题带 @needs-staging」在运行时由 staging.ts / fixtures.ts 的 auto fixture 检查。
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SELF = 'src/test/stagingBoundary.test.ts'
const STAGING_ENTRY = 'e2e/support/staging.ts'

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  )
}

const files = [...walk('src'), ...walk('e2e'), 'playwright.config.ts', 'vite.config.ts'].filter((f) => f !== SELF)
const source = (f: string) => readFileSync(join(ROOT, f), 'utf8')
const specs = files.filter((f) => f.startsWith('e2e/') && f.endsWith('.spec.ts'))
const isStagingSpec = (f: string) => f.startsWith('e2e/staging/')

const READS_STAGING_URL = /env\s*(\.\s*STAGING_BASE_URL\b|\[\s*['"`]STAGING_BASE_URL['"`]\s*\])/
const IMPORTS_STAGING = /from\s+['"][^'"]*support\/staging(\.ts)?['"]/
const IMPORTS_FIXTURES = /from\s+['"][^'"]*support\/fixtures(\.ts)?['"]/
const IMPORTS_PLAYWRIGHT_TEST = /from\s+['"]@playwright\/test['"]/

describe('staging 测试的唯一入口', () => {
  it('至少有一个 staging spec 和一个本地 spec 被扫描到', () => {
    expect(specs.some(isStagingSpec)).toBe(true)
    expect(specs.some((f) => !isStagingSpec(f))).toBe(true)
  })

  it('e2e/staging/ 下的 spec 只从 support/staging.ts 引入', () => {
    const bad = specs
      .filter(isStagingSpec)
      .filter((f) => !IMPORTS_STAGING.test(source(f)) || IMPORTS_FIXTURES.test(source(f)) || IMPORTS_PLAYWRIGHT_TEST.test(source(f)))
    expect(bad).toEqual([])
  })

  it('本地 spec 只从 support/fixtures.ts 引入，不直接用 @playwright/test', () => {
    const bad = specs
      .filter((f) => !isStagingSpec(f))
      .filter((f) => !IMPORTS_FIXTURES.test(source(f)) || IMPORTS_PLAYWRIGHT_TEST.test(source(f)))
    expect(bad).toEqual([])
  })

  it('只有 e2e/support/staging.ts 读取 STAGING_BASE_URL', () => {
    expect(files.filter((f) => f !== STAGING_ENTRY && READS_STAGING_URL.test(source(f)))).toEqual([])
    expect(READS_STAGING_URL.test(source(STAGING_ENTRY))).toBe(true)
  })

  it('e2e/staging/ 以外的文件不得引入 support/staging', () => {
    expect(files.filter((f) => !isStagingSpec(f) && IMPORTS_STAGING.test(source(f)))).toEqual([])
  })
})
