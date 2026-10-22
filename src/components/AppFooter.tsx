// 卡片底部说明（AD-19；FE-1）。
export type AppFooterProps = Record<string, never>

export function AppFooter(_props: AppFooterProps) {
  return (
    <footer>
      <p className="text-xs text-muted-foreground">数据保存在服务器，换浏览器也不会丢</p>
    </footer>
  )
}
