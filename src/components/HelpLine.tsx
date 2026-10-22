// 输入框下方的帮助行（AD-19；FE-1）：固定 id 供 aria-describedby 关联，三种模式由 props 决定。
import { cn } from '@/lib/utils.ts'

export type HelpLineProps = { id: string; mode: 'add' | 'edit' | 'tooLong' }

const TEXT: Record<HelpLineProps['mode'], string> = {
  add: '回车添加 · 双击标题可修改',
  edit: '回车保存 · Esc 取消 · 清空后回车会删除这一条',
  tooLong: '标题最多 200 个字',
}

export function HelpLine({ id, mode }: HelpLineProps) {
  return (
    <p id={id} className={cn('text-xs', mode === 'tooLong' ? 'text-destructive' : 'text-muted-foreground')}>
      {TEXT[mode]}
    </p>
  )
}
