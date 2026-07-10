#!/usr/bin/env node
// Chặn regression đã lặp lại 4 lần (xem CLAUDE.md): CREATE OR REPLACE FUNCTION
// làm rơi `SET search_path`. Quét toàn bộ migrations theo thứ tự file (tên có
// prefix ngày → thứ tự thời gian), giữ định nghĩa MỚI NHẤT của mỗi function
// name, và fail nếu định nghĩa hiệu lực cuối cùng thiếu search_path.
//
// ponytail: match theo tên function, không phân biệt overload theo signature
// (2 hàm trùng tên khác tham số sẽ gộp làm 1). Nếu dự án có overload thật,
// nâng cấp bằng cách giữ luôn phần args trong key.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(import.meta.dirname, '..', 'supabase', 'migrations')

const CREATE_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\([\s\S]*?\)([\s\S]*?)AS\s+\$/gi
// A body-preserving fix: `ALTER FUNCTION name(...) SET search_path = ...` patches an
// existing function's search_path without redefining it — just as valid a "fix" as
// including search_path in the original CREATE.
const ALTER_RE = /ALTER\s+FUNCTION\s+([\w."]+)\s*\([^)]*\)\s+SET\s+search_path/gi

const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()

const latest = new Map() // name -> { file, hasSearchPath }

for (const file of files) {
    const sql = readFileSync(join(DIR, file), 'utf8')
    const events = []
    for (const match of sql.matchAll(CREATE_RE)) {
        const name = match[1].replace(/"/g, '').split('.').pop()
        events.push({ index: match.index, name, hasSearchPath: /search_path/i.test(match[2]) })
    }
    for (const match of sql.matchAll(ALTER_RE)) {
        const name = match[1].replace(/"/g, '').split('.').pop()
        events.push({ index: match.index, name, hasSearchPath: true })
    }
    events.sort((a, b) => a.index - b.index)
    for (const { name, hasSearchPath } of events) {
        latest.set(name, { file, hasSearchPath })
    }
}

const offenders = [...latest.entries()].filter(([, v]) => !v.hasSearchPath)

if (offenders.length) {
    console.error('Các function sau KHÔNG có SET search_path trong định nghĩa hiệu lực cuối cùng:\n')
    for (const [name, v] of offenders) {
        console.error(`  - ${name}  (định nghĩa cuối: ${v.file})`)
    }
    console.error(`\n${offenders.length} function thiếu search_path. Thêm "SET search_path = public" vào định nghĩa.`)
    process.exit(1)
}

console.log(`OK: ${latest.size} function đều có search_path trong định nghĩa hiệu lực cuối cùng.`)
