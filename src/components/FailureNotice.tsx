// 操作失败提示（AD-13、AD-19；FE-1）：role="alert"，常驻直到关闭或下一次成功，组件内不设任何定时器。
// 文案由调用方经 props 传入，组件里不写固定文案。
import { XIcon } from 'lucide-react'
import { Alert } from '@/components/ui/alert.tsx'
import { Button } from '@/components/ui/button.tsx'

export type FailureNoticeProps = { message: string; onDismiss: () => void }

export function FailureNotice({ message, onDismiss }: FailureNoticeProps) {
  return (
    <Alert variant="destructive" className="flex items-center gap-2">
      <span aria-hidden="true">⚠</span>
      <span className="flex-1">{message}</span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭提示" onClick={onDismiss}>
        <XIcon aria-hidden="true" />
      </Button>
    </Alert>
  )
}
