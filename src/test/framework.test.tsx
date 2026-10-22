// 组件测试基座自检（INF-F2）：环境、渲染、共享契约可读。业务用例由各 story 自己写。
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readSharedContract } from './sharedContracts.ts'

describe('组件测试基座', () => {
  it('时区固定为 Asia/Shanghai（AD-16）', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Shanghai')
    // UTC 00:00 在上海是 08:00；断言具体值，防止只是读到了环境变量而没生效
    expect(new Date('2026-10-20T00:00:00.000Z').getHours()).toBe(8)
  })

  it('jsdom + Testing Library 可渲染，并能按可读名称查询（getByRole + name）', () => {
    // 用内联组件，不依赖业务 App（App 以后会变成 TodoApp 并在挂载时发请求）
    render(
      <main>
        <h1>待办</h1>
      </main>,
    )
    expect(screen.getByRole('heading', { level: 1, name: '待办' })).toBeInTheDocument()
  })

  it('@ 路径别名可解析（AD-18）', async () => {
    const { ERROR_CODES } = await import('@/api/types.ts')
    expect(ERROR_CODES).toEqual(['VALIDATION_ERROR', 'NOT_FOUND', 'LIMIT_EXCEEDED', 'INTERNAL_ERROR'])
  })

  it('能读到工作区根的共享契约（AD-1、AD-7）', () => {
    expect(readSharedContract('todoapp-api.yaml')).toMatch(/^openapi: 3\.1\.0$/m)
    expect(JSON.parse(readSharedContract('title-cases.json')).cases.length).toBeGreaterThan(0)
  })
})
