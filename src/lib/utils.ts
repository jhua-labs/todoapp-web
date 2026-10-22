// shadcn init 生成的是 `export { cn } from "cn"`（cn 包为 shadcn 官方的 clsx + tailwind-merge 替代品）。
// AD-18 约定 `cn` 是本文件里的函数，这里包一层同签名函数，行为与原 re-export 完全相同。
import { cn as merge, type ClassValue } from 'cn'

export function cn(...inputs: ClassValue[]): string {
  return merge(...inputs)
}
