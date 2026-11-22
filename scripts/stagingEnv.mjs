// Biến môi trường (CI: GitHub secrets) thắng file .env.staging.local (chạy tay trên máy). Dùng chung cho test:money / test:inventory.
import { readFileSync, existsSync } from 'fs'

const envFile = new URL('../.env.staging.local', import.meta.url)
const fileEnv = !existsSync(envFile) ? {} : Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
export const env = { ...fileEnv, ...process.env }
