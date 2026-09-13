#!/usr/bin/env node
// Hook cho Claude Code (xem .claude/settings.json). Exit 2 + stderr = đẩy lỗi ngược lại cho
// agent tự sửa, thay vì trông vào việc agent nhớ luật trong CLAUDE.md.
//
//   migration — sau khi Edit/Write file supabase/migrations/*.sql: chạy check-search-path
//               (regression search_path/REVOKE đã lặp 5 đợt).
//   stop      — trước khi agent báo xong: eslint các file src/ đang đổi + tsc.
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

process.chdir(join(import.meta.dirname, '..'))
const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
const run = cmd => execSync(cmd, { encoding: 'utf8', stdio: 'pipe' })
const check = cmd => { try { run(cmd) } catch (e) { process.stderr.write(`${cmd}\n${e.stdout}${e.stderr}`); process.exit(2) } }

if (process.argv[2] === 'migration') {
    if (/supabase[\\/]migrations[\\/][^\\/]+\.sql$/.test(input.tool_input?.file_path ?? '')) {
        check('node scripts/check-search-path.mjs')
    }
}

if (process.argv[2] === 'stop') {
    if (input.stop_hook_active) process.exit(0) // đã chặn 1 lượt rồi — không lặp vô hạn

    const files = run('git status --porcelain --untracked-files=all').split('\n')
        .map(l => l.slice(3).split(' -> ').pop().replace(/"/g, '').trim())
        .filter(f => /^src\/.*\.(jsx?|tsx?)$/.test(f) && existsSync(f))
    if (!files.length) process.exit(0)

    // ponytail: bỏ qua nếu diff y hệt lần pass trước — lint+tsc ~30s, không chạy lại mỗi lượt chat.
    const marker = run('git rev-parse --git-path claude-stop-ok').trim()
    const hash = createHash('sha1').update(run('git diff HEAD -- src') + files.map(f => readFileSync(f, 'utf8')).join()).digest('hex')
    if (existsSync(marker) && readFileSync(marker, 'utf8') === hash) process.exit(0)

    check(`npx eslint ${files.map(f => `"${f}"`).join(' ')}`)
    check('npx tsc --noEmit')
    writeFileSync(marker, hash)
}
