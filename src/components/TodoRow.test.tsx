// Story 2.3（FE-1）T6.6：TodoRow 编辑态切换与焦点回位（AC-6 的组件层逻辑断言）。
// jsdom 焦点只作逻辑断言，真实浏览器焦点以 E2E 为准（test-design 层级裁决）。
// 注意：本文件位于 src/components/，会被 scaffold.test.ts 的 hex 扫描覆盖，文件里不要写 # 开头的色值样式串。
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Todo } from '../api/types.ts'
import { TodoRow, type TodoRowProps } from './TodoRow.tsx'

const NOW = new Date('2026-10-20T02:00:00.000Z')
const MILK: Todo = {
  id: '0b6f2c9e-1a3d-4c5e-9f70-1d2e3f4a5b61',
  title: '买牛奶',
  completed: false,
  createdAt: '2026-10-20T01:59:30.000Z',
  updatedAt: '2026-10-20T01:59:30.000Z',
}

function props(overrides: Partial<TodoRowProps> = {}): TodoRowProps {
  return {
    todo: MILK,
    now: NOW,
    editing: false,
    pending: false,
    helpId: 'todo-help',
    deleteRef: null,
    onToggle: vi.fn(async () => true),
    onStartEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onEditTooLongChange: vi.fn(),
    onRename: vi.fn(async () => true),
    onDelete: vi.fn(async () => true),
    ...overrides,
  }
}

describe('Story 2.3 TodoRow 编辑态与焦点回位', () => {
  it('[P1] AC-6 FE-K1 首次渲染不抢焦点；编辑态渲染占位编辑器并关联 helpId；退出编辑后焦点回到标题按钮', () => {
    const { rerender } = render(
      <ul>
        <TodoRow {...props()} />
      </ul>,
    )
    expect(document.activeElement).toBe(document.body)

    rerender(
      <ul>
        <TodoRow {...props({ editing: true })} />
      </ul>,
    )
    const editor = screen.getByRole('textbox', { name: '编辑待办标题：买牛奶' })
    expect(editor).toHaveAttribute('aria-describedby', 'todo-help')
    expect(editor).toHaveValue('买牛奶')
    expect(screen.queryByRole('button', { name: '编辑：买牛奶' })).toBeNull()
    // 删除控件在编辑态仍在
    expect(screen.getByRole('button', { name: '删除：买牛奶' })).toBeInTheDocument()

    rerender(
      <ul>
        <TodoRow {...props({ editing: false })} />
      </ul>,
    )
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: '编辑：买牛奶' })).toHaveFocus()
  })

  it('[P1] AC-6 FE-K1 deleteRef 指向删除按钮', () => {
    const ref = { current: null as HTMLButtonElement | null }
    render(
      <ul>
        <TodoRow {...props({ deleteRef: ref })} />
      </ul>,
    )
    expect(ref.current).toBe(screen.getByRole('button', { name: '删除：买牛奶' }))
  })
})
