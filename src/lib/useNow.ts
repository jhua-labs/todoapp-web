// 相对时间的参考时间（AD-20）：默认每 60 秒刷新一次，卸载时清除定时器。
import { useEffect, useState } from 'react'

export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
