// 标题字数计数（AD-19；FE-1 建，Story 2.4 接进 AddTodoForm）。长度由调用方计算，组件里不计长。
import { MAX_TITLE_LENGTH } from '@/api/title.ts'
import { cn } from '@/lib/utils.ts'

export type TitleCounterProps = { length: number; max?: number }

export function TitleCounter({ length, max = MAX_TITLE_LENGTH }: TitleCounterProps) {
  return (
    <span className={cn('text-xs tabular-nums', length > max ? 'text-destructive' : 'text-muted-foreground')}>
      {`${length}/${max}`}
    </span>
  )
}
