// 固定界面文案只在这里定义（UX-DR2、AD-21）；界面文案一律全角标点。
// 永不显示服务端 error.message，只按 code 映射到这里的文案（AD-13）。
import type { ErrorCode } from './types.ts'

export const FAILURE = '操作失败，请重试'
export const CAPACITY = '待办已满（500 条），请先清理'

export type Notice = { kind: 'capacity'; text: typeof CAPACITY } | { kind: 'failure'; text: typeof FAILURE }

/** LIMIT_EXCEEDED → 容量横幅；其余 code → 操作失败提示。 */
export function noticeFor(code: ErrorCode): Notice {
  return code === 'LIMIT_EXCEEDED' ? { kind: 'capacity', text: CAPACITY } : { kind: 'failure', text: FAILURE }
}
