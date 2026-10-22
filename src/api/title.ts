// 标题规则（AD-7）：前端拦截，与后端同一套规则。用例共享 ../docs/contracts/title-cases.json。
//
// 浏览器包读不到 ../docs/，所以裁剪码点表写死在这里；title.test.ts 把它与共享文件逐项比对，漂移即红。
// 不调用原生 String.prototype 的裁剪方法（其空白集合与契约不同）；不做 Unicode 规范化。
// 本文件不得 import src/mocks/*（契约替身是独立实现），也不得 import client/todos（AD-13：组件可 import 本文件）。

/** 只从两端裁掉的码点（全部在 BMP），与 title-cases.json.trimCodePoints 一致，共 25 个。 */
export const TRIM_CODE_POINTS: readonly number[] = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]

export const MAX_TITLE_LENGTH = 200

const TRIM_SET: ReadonlySet<number> = new Set(TRIM_CODE_POINTS)

export type TitleCheck =
  | { kind: 'ok'; title: string }
  | { kind: 'empty' }
  | { kind: 'tooLong'; length: number }
  | { kind: 'invalid' }

/** 两端裁掉 TRIM_CODE_POINTS 里的码点，内部空白保留。裁剪码点全在 BMP，按 UTF-16 单元比较即可。 */
export function trimTitle(raw: string): string {
  let start = 0
  let end = raw.length
  while (start < end && TRIM_SET.has(raw.charCodeAt(start))) start++
  while (end > start && TRIM_SET.has(raw.charCodeAt(end - 1))) end--
  return raw.slice(start, end)
}

/** 裁剪后的 Unicode 码点数（代理对计 1），供计数器显示。 */
export function titleLength(raw: string): number {
  return [...trimTitle(raw)].length
}

/** 含 U+0000 或孤立代理项（U+D800..U+DFFF 未配对）即非法。 */
function hasForbiddenCodePoint(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    // for...of 按码点迭代：配对的代理项会合成 > 0xFFFF 的码点，落在此区间的只可能是孤立代理项
    if (cp === 0 || (cp >= 0xd800 && cp <= 0xdfff)) return true
  }
  return false
}

export function checkTitle(raw: string): TitleCheck {
  const title = trimTitle(raw)
  if (title.length === 0) return { kind: 'empty' }
  if (hasForbiddenCodePoint(title)) return { kind: 'invalid' }
  const length = [...title].length
  if (length > MAX_TITLE_LENGTH) return { kind: 'tooLong', length }
  return { kind: 'ok', title }
}
