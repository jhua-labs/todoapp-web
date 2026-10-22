// @vitest-environment node
// Story 1.2（FE-0）ATDD 红阶段：工程骨架、shadcn、主题 token / 固定文案、mock 开关与 nginx 的静态断言。
// Test ID：INF-F1、INF-F2、FE-ST1、INF-F3、INF-F4、FE-ST2、INF-M1、OPS-3（test-design-qa.md）。
//
// 红绿约定（src/test/README.md、project-context「skip 和 tag 是两件事」）：
//   每个用例上方写明「完成哪个 task 后去掉 skip」；story 完成时本文件不应再有 skip。
//
// 被测文件（messages.ts、vite.config.ts 的函数形式等）在红阶段还不存在或形状不同，
// 一律经绝对路径动态 import 加载，保证 `tsc -b` 现在就能通过、原有 82 个测试不受影响。
// 实现落地后可以改成静态 import。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ErrorCode } from '../api/types.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const at = (rel: string) => join(ROOT, rel)

function readText(rel: string): string | undefined {
  return existsSync(at(rel)) ? readFileSync(at(rel), 'utf8') : undefined
}

/** 去掉 JSONC 注释与尾逗号（识别字符串，`"@/*"` 里的 `/*` 不会被当成注释）。 */
function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      out += c
      if (c === '\\') {
        out += text[++i] ?? ''
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      out += c
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else {
      out += c
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

function readJson<T>(rel: string): T | undefined {
  const text = readText(rel)
  return text === undefined ? undefined : (JSON.parse(stripJsonComments(text)) as T)
}

/** 递归列出 dir 下匹配 pattern 的文件（相对 todoapp-web 根）；目录不存在返回 []。 */
function walk(dir: string, pattern: RegExp): string[] {
  if (!existsSync(at(dir))) return []
  return readdirSync(at(dir), { withFileTypes: true }).flatMap((e) => {
    const rel = join(dir, e.name)
    if (e.isDirectory()) return walk(rel, pattern)
    return pattern.test(e.name) ? [relative(ROOT, at(rel))] : []
  })
}

async function load<T>(rel: string): Promise<{ mod: T | undefined; error: string }> {
  try {
    return { mod: (await import(/* @vite-ignore */ at(rel))) as T, error: '' }
  } catch (e) {
    return { mod: undefined, error: `${rel} 加载失败：${String(e)}` }
  }
}

interface PackageJson {
  scripts?: Record<string, string>
  engines?: { node?: string }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface TsConfig {
  compilerOptions?: Record<string, unknown>
}

const EXACT_VERSION = /^\d+\.\d+\.\d+$/

function allDeps(pkg: PackageJson | undefined): Record<string, string> {
  return { ...pkg?.dependencies, ...pkg?.devDependencies }
}

/** 取第一个匹配 selector 的块体（花括号配对）。 */
function blockBody(css: string, selector: RegExp): string | undefined {
  const m = selector.exec(css)
  if (!m) return undefined
  const open = css.indexOf('{', m.index)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  return undefined
}

/** 自定义属性声明：名字 → 小写去空白的值；后出现的覆盖先出现的。 */
function customProperties(body: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of (body ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim().toLowerCase()
  return out
}

describe('Story 1.2 工程骨架与共享层（ATDD 红阶段）', () => {
  // 红阶段：T1.1（装 tailwindcss / @tailwindcss/vite 4.3.3、vite.config 加 tailwindcss()）完成后去掉 skip
  it('[P0] AC-1 INF-F1 依赖全精确版本且含 Tailwind 4.3.3；.nvmrc/engines 固定 Node 24；tsconfig 只写 paths；vite.config 用 import.meta.dirname', () => {
    const pkg = readJson<PackageJson>('package.json')
    const deps = allDeps(pkg)

    // 本 AC 新承诺的标量：Tailwind 精确版本（红阶段 package.json 里还没有）
    expect(deps.tailwindcss).toBe('4.3.3')
    expect(deps['@tailwindcss/vite']).toBe('4.3.3')

    // Stack 表关键版本
    expect({
      react: deps.react,
      'react-dom': deps['react-dom'],
      vite: deps.vite,
      typescript: deps.typescript,
    }).toEqual({ react: '19.3.1', 'react-dom': '19.3.1', vite: '8.3.4', typescript: '7.0.2' })

    // 所有依赖都是精确版本（含 shadcn init/add 引入的包）
    const loose = Object.entries(deps)
      .filter(([, v]) => !EXACT_VERSION.test(v))
      .map(([k, v]) => `${k}@${v}`)
    expect(loose).toEqual([])

    expect(readText('.nvmrc')?.trim()).toBe('24')
    expect(pkg?.engines?.node).toBe('>=24 <25')

    for (const file of ['tsconfig.json', 'tsconfig.app.json']) {
      const options = readJson<TsConfig>(file)?.compilerOptions ?? {}
      expect(options.paths, `${file} 的 paths`).toEqual({ '@/*': ['./src/*'] })
      expect(Object.keys(options), `${file} 不得写 baseUrl（TS 7 报 TS5102）`).not.toContain('baseUrl')
    }

    const viteConfig = readText('vite.config.ts') ?? ''
    expect(viteConfig).toMatch(/from\s+['"]@tailwindcss\/vite['"]/)
    expect(viteConfig).toMatch(/\btailwindcss\(\)/)
    expect(viteConfig).toMatch(/alias:\s*\{\s*['"]@['"]\s*:\s*`\$\{import\.meta\.dirname\}\/src`/)
    expect(viteConfig).not.toMatch(/__dirname/)
  })

  // 红阶段：回归守卫——4.2 已交付，激活即绿（不是先红测试）。T8.1/T8.3 验证时去掉 skip
  it('[P0] AC-2 INF-F2/FE-ST1 test 脚本与测试栈版本固定、TZ=Asia/Shanghai、oxlint 禁止组件 import state/client/todos', () => {
    const pkg = readJson<PackageJson>('package.json')
    const deps = allDeps(pkg)

    expect(pkg?.scripts?.test).toBe('tsc -b && vitest run')
    expect({
      vitest: deps.vitest,
      '@testing-library/react': deps['@testing-library/react'],
      msw: deps.msw,
      jsdom: deps.jsdom,
      oxlint: deps.oxlint,
    }).toEqual({ vitest: '5.0.5', '@testing-library/react': '16.3.3', msw: '3.0.3', jsdom: '30.1.3', oxlint: '1.88.0' })

    // AD-16：测试进程时区固定；2026-10-20T00:00Z 在上海是 08 点
    expect(process.env.TZ).toBe('Asia/Shanghai')
    expect(new Date('2026-10-20T00:00:00.000Z').getHours()).toBe(8)

    // AD-13/AD-19/UX-DR15：组件 import 限制（规则语义见 .oxlintrc.json，不得削弱）
    interface OxlintConfig {
      overrides?: { files: string[]; rules?: Record<string, unknown> }[]
    }
    const oxlint = readJson<OxlintConfig>('.oxlintrc.json')
    const componentOverride = oxlint?.overrides?.find((o) => o.files.includes('src/components/**/*.tsx'))
    const rule = componentOverride?.rules?.['no-restricted-imports'] as
      | [string, { patterns: { group: string[] }[] }]
      | undefined
    expect(rule?.[0]).toBe('error')
    expect(rule?.[1].patterns.flatMap((p) => p.group)).toEqual(
      expect.arrayContaining(['@/state/*', '@/api/client*', '@/api/todos*']),
    )
  })

  // 红阶段：T1.3–T1.6（shadcn init + add 五个组件）完成后去掉 skip
  it('[P1] AC-3 INF-F3 components.json 为 radix 风格、图标库与依赖一致，ui 下有五个出厂组件', () => {
    interface ComponentsJson {
      style?: string
      iconLibrary?: string
      aliases?: Record<string, string>
    }
    const components = readJson<ComponentsJson>('components.json')

    // 本 AC 新承诺的标量：style 以 radix- 开头（红阶段 components.json 不存在）
    expect(components?.style ?? '').toMatch(/^radix-/)

    const ICON_PACKAGES: Record<string, string> = {
      lucide: 'lucide-react',
      tabler: '@tabler/icons-react',
      hugeicons: '@hugeicons/react',
      phosphor: '@phosphor-icons/react',
      remixicon: '@remixicon/react',
    }
    const iconPackage = ICON_PACKAGES[components?.iconLibrary ?? '']
    expect(iconPackage, `未知 iconLibrary：${components?.iconLibrary}`).toBeDefined()
    expect(allDeps(readJson<PackageJson>('package.json'))[iconPackage]).toMatch(EXACT_VERSION)

    expect(components?.aliases).toMatchObject({
      components: '@/components',
      utils: '@/lib/utils',
      ui: '@/components/ui',
    })

    const missing = ['button', 'input', 'checkbox', 'alert', 'skeleton']
      .map((name) => `src/components/ui/${name}.tsx`)
      .filter((f) => !existsSync(at(f)))
    expect(missing).toEqual([])
    expect(readText('src/lib/utils.ts')).toMatch(/export function cn\(/)
  })

  // 红阶段：T1.2 + T2（index.css 主题 token）+ T3.1（messages.ts）完成后去掉 skip
  it('[P1] AC-4 INF-F4/FE-ST2 品牌 token 只在 index.css、仅浅色；固定文案只在 messages.ts 且为全角标点', async () => {
    const css = readText('src/index.css') ?? ''
    const root = customProperties(blockBody(css, /(^|[\s}]):root\s*\{/))

    // 本 AC 新承诺的值：DESIGN.md frontmatter 的品牌 token（红阶段 index.css 不存在）
    expect(root).toMatchObject({
      '--background': '#f4f4f5',
      '--foreground': '#18181b',
      '--card': '#ffffff',
      '--card-foreground': '#18181b',
      '--border': '#e4e4e7',
      '--muted-foreground': '#71717a',
      '--primary': '#18181b',
      '--primary-foreground': '#ffffff',
      '--destructive': '#dc2626',
      '--destructive-foreground': '#ffffff',
      '--success': '#16a34a',
      '--success-foreground': '#ffffff',
      '--warning': '#ca8a04',
      '--warning-surface': '#fefce8',
      '--warning-border': '#fde68a',
    })

    expect(css).toMatch(/@import\s+["']tailwindcss["']/)
    const theme = customProperties(blockBody(css, /@theme\s+inline\s*\{/))
    expect(theme).toMatchObject({
      '--color-success': 'var(--success)',
      '--color-success-foreground': 'var(--success-foreground)',
      '--color-warning': 'var(--warning)',
      '--color-warning-surface': 'var(--warning-surface)',
      '--color-warning-border': 'var(--warning-border)',
    })
    const all = customProperties(css)
    expect({ sm: all['--radius-sm'], md: all['--radius-md'], lg: all['--radius-lg'] }).toEqual({
      sm: '6px',
      md: '8px',
      lg: '14px',
    })
    expect(Object.values(all), '卡片最大宽 640px 需定义为 token').toContain('640px')
    expect(css).not.toMatch(/\.dark\b/)
    expect(css).not.toMatch(/@custom-variant\s+dark/)
    expect(readText('src/main.tsx')).toMatch(/import\s+['"]\.\/index\.css['"]/)

    // AD-21：组件里不得出现 hex 色值（扫描集合不能为空，否则是假绿）
    const componentFiles = [...walk('src/components', /\.tsx?$/), ...walk('src/containers', /\.tsx?$/)]
    expect(componentFiles.length).toBeGreaterThan(0)
    const withHex = componentFiles.filter((f) => /#[0-9a-fA-F]{3,8}\b/.test(readText(f) ?? ''))
    expect(withHex).toEqual([])

    // 固定文案（UX-DR2、AD-21）
    interface MessagesModule {
      FAILURE: string
      CAPACITY: string
      noticeFor(code: ErrorCode): { kind: 'capacity' | 'failure'; text: string }
    }
    const { mod: messages, error } = await load<MessagesModule>('src/api/messages.ts')
    expect(messages?.FAILURE, error).toBe('操作失败，请重试')
    expect(messages?.CAPACITY).toBe('待办已满（500 条），请先清理')
    expect(messages?.noticeFor('LIMIT_EXCEEDED')).toEqual({ kind: 'capacity', text: '待办已满（500 条），请先清理' })
    for (const code of ['VALIDATION_ERROR', 'NOT_FOUND', 'INTERNAL_ERROR'] as const) {
      expect(messages?.noticeFor(code), code).toEqual({ kind: 'failure', text: '操作失败，请重试' })
    }

    // 文案只在 messages.ts 一处（扫描 src/ 下除 messages.ts 与测试外的源码）
    const sources = walk('src', /\.tsx?$/).filter((f) => f !== 'src/api/messages.ts' && !/\.test\.tsx?$/.test(f))
    expect(sources.length).toBeGreaterThan(0)
    const duplicated = sources.filter((f) => {
      const text = readText(f) ?? ''
      return text.includes('操作失败，请重试') || text.includes('待办已满（500 条），请先清理')
    })
    expect(duplicated).toEqual([])
  })

  // 红阶段：T4（dev:mock、mock-public/、browser.ts、vite.config 函数形式、main.tsx）+ T5.1（nginx.conf）完成后去掉 skip
  it('[P1] AC-7 INF-M1/OPS-3 MSW 只在 dev:mock 启用、worker 只在 mock 模式作 publicDir；nginx.conf 按 AD-15', async () => {
    const pkg = readJson<PackageJson>('package.json')

    // 本 AC 新承诺的标量：mock 模式脚本（红阶段不存在）
    expect(pkg?.scripts?.['dev:mock']).toBe('vite --mode mock')
    expect(pkg?.scripts?.dev).toBe('vite')

    // vite.config.ts 改成函数形式：publicDir 只在 mode=mock 时指向 mock-public
    interface ViteLikeConfig {
      publicDir?: string | false
      server?: { host?: string; port?: number; strictPort?: boolean; proxy?: Record<string, { target?: string }> }
      test?: { env?: Record<string, string> }
    }
    type ConfigFn = (env: {
      command: 'serve' | 'build'
      mode: string
      isSsrBuild: boolean
      isPreview: boolean
    }) => ViteLikeConfig | Promise<ViteLikeConfig>
    const { mod: viteModule, error } = await load<{ default: unknown }>('vite.config.ts')
    expect(typeof viteModule?.default, error || 'vite.config.ts 默认导出应是 ({ mode }) => config').toBe('function')
    // 上一条断言已保证 default 是函数
    const configFn = viteModule?.default as ConfigFn
    const configFor = (command: 'serve' | 'build', mode: string) =>
      configFn({ command, mode, isSsrBuild: false, isPreview: false })
    const mock = await configFor('serve', 'mock')
    const dev = await configFor('serve', 'development')
    const prod = await configFor('build', 'production')
    expect([mock.publicDir, dev.publicDir, prod.publicDir]).toEqual(['mock-public', false, false])
    for (const config of [mock, dev, prod]) {
      // AD-14 的 server 块与 AD-16 的 TZ 原样保留
      expect(config.server).toMatchObject({ host: '127.0.0.1', port: 5173, strictPort: true })
      expect(config.server?.proxy?.['/api']).toEqual({ target: 'http://127.0.0.1:8080' })
      expect(config.test?.env).toEqual({ TZ: 'Asia/Shanghai' })
    }

    expect(existsSync(at('mock-public/mockServiceWorker.js'))).toBe(true)
    expect(existsSync(at('public/mockServiceWorker.js'))).toBe(false)
    expect(existsSync(at('.env.mock'))).toBe(true)

    const browser = readText('src/mocks/browser.ts') ?? ''
    expect(browser).toMatch(/import\s*\{[^}]*\bsetupWorker\b[^}]*\}\s*from\s*['"]msw\/browser['"]/)
    expect(browser).toMatch(/from\s*['"]\.\/handlers(\.ts)?['"]/)

    // main.tsx：worker 只在 MODE === 'mock' 分支里动态加载；不用 DEV 作判据；不得静态 import browser
    const main = readText('src/main.tsx') ?? ''
    expect(main).toMatch(/import\.meta\.env\.MODE\s*===\s*['"]mock['"]/)
    expect(main).toMatch(/import\(\s*['"]\.\/mocks\/browser(\.ts)?['"]\s*\)/)
    expect(main).not.toMatch(/from\s*['"]\.\/mocks\/browser/)
    expect(main).not.toMatch(/import\.meta\.env\.DEV/)
    expect(main).toMatch(/onUnhandledFrame:\s*['"]bypass['"]/)
    expect(main).toMatch(/url:\s*['"]\/mockServiceWorker\.js['"]/)
    expect(main).toMatch(/<App\s*\/>/)

    // OPS-3：nginx.conf（运行时行为由 Story 4.2 在 staging 验证）
    const nginx = readText('nginx.conf') ?? ''
    expect(nginx).toMatch(/try_files\s+\$uri\s+\/index\.html\s*;/)
    expect(nginx).toMatch(/resolver\s+127\.0\.0\.11\b/)
    const upstreamVar = /set\s+\$(\w+)\s+http:\/\/api:8080\s*;/.exec(nginx)?.[1]
    expect(upstreamVar, 'set $<var> http://api:8080;').toBeDefined()
    expect(nginx).toMatch(new RegExp(`proxy_pass\\s+\\$${upstreamVar}\\s*;`))
    expect(nginx, '写死上游或带 URI 部分都不对（不重新解析 / 剥前缀）').not.toMatch(/proxy_pass\s+http:\/\/api:8080/)
    expect(nginx).toMatch(/proxy_intercept_errors\s+on\s*;/)
    expect(nginx).toMatch(/error_page\s+502\s+503\s+504\s+=500\b/)
    expect(nginx).toMatch(/return\s+500\s+'\{"error":\{"code":"INTERNAL_ERROR","message":"[^"]+"\}\}'/)
    expect(nginx).toMatch(/Cache-Control\s+"?no-cache/)
    expect(nginx).toMatch(/Cache-Control\s+"public, max-age=31536000, immutable"/)
    expect(nginx).toMatch(/gzip\s+on\s*;/)
  })
})
