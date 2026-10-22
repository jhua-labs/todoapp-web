// 相对时间的唯一实现（AD-20）。纯函数：只看入参 iso 与注入的 now，不读当前时钟。
// 按浏览器本地时区计算日历日（用 Date 的本地 getter，不指定时区）。

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * <60 秒「刚刚」（含负 diff）、<60 分钟「N 分钟前」、同一本地日「今天 HH:mm」、
 * 前一本地日「昨天 HH:mm」、同一本地年「M月D日」、更早「YYYY年M月D日」。
 */
export function formatRelative(iso: string, now: Date): string {
  const then = new Date(Date.parse(iso))
  const diff = now.getTime() - then.getTime()

  if (diff < MINUTE_MS) return '刚刚'
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} 分钟前`

  const hhmm = `${pad2(then.getHours())}:${pad2(then.getMinutes())}`
  if (sameLocalDay(then, now)) return `今天 ${hhmm}`

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (sameLocalDay(then, yesterday)) return `昨天 ${hhmm}`

  const md = `${then.getMonth() + 1}月${then.getDate()}日`
  if (then.getFullYear() === now.getFullYear()) return md
  return `${then.getFullYear()}年${md}`
}
