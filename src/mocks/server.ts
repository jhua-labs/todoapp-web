// Node 侧（Vitest）的 MSW server。生命周期在 src/test/setup.ts 里管理。
import { setupServer } from 'msw/node'
import { handlers } from './handlers.ts'

export const server = setupServer(...handlers)
