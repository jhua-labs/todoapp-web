// 卡片头部：应用标题与副标题（AD-19；FE-1）。
export type AppHeaderProps = Record<string, never>

export function AppHeader(_props: AppHeaderProps) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-xl font-bold">待办</h1>
      <p className="text-sm text-muted-foreground">记下来，做完勾掉</p>
    </header>
  )
}
