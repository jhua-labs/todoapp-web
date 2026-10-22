// 读取工作区根的共享契约文件（AD-1、AD-7）。只在开发机测试里用；镜像构建不跑测试。
// 相对 todoapp-web 根的路径是 ../docs/contracts/<name>。
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
export const SHARED_CONTRACTS_DIR = resolve(REPO_ROOT, '../docs/contracts')

export function readSharedContract(name: 'title-cases.json' | 'todoapp-api.yaml'): string {
  const file = resolve(SHARED_CONTRACTS_DIR, name)
  if (!existsSync(file)) {
    throw new Error(`找不到共享契约 ${file}：todoapp-web 必须放在工作区根下，与 docs/contracts/ 同级（AD-1）`)
  }
  return readFileSync(file, 'utf8')
}

export interface TitleCase {
  name: string
  input?: string
  repeat?: { unit: string; count: number }
  pad?: string
  valid: boolean
  trimmed?: string
}

export interface TitleCases {
  trimCodePoints: string[]
  minLength: number
  maxLength: number
  cases: TitleCase[]
}

export function loadTitleCases(): TitleCases {
  return JSON.parse(readSharedContract('title-cases.json')) as TitleCases
}

/** 展开 repeat / pad，得到实际输入与期望的裁剪结果。 */
export function expandTitleCase(c: TitleCase): { input: string; trimmed?: string } {
  if (c.repeat) {
    const body = c.repeat.unit.repeat(c.repeat.count)
    const pad = c.pad ?? ''
    return { input: pad + body + pad, trimmed: c.valid ? body : undefined }
  }
  return { input: c.input ?? '', trimmed: c.trimmed }
}
