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

// Nhánh thứ hai của CÙNG một regression: CREATE OR REPLACE cũng cấp lại EXECUTE cho PUBLIC.
// Với hàm chỉ dùng nội bộ (PERFORM từ hàm SECURITY DEFINER khác, hoặc chạy từ trigger) thì đó
// là lộ thẳng ra /rest/v1/rpc — sync_group_unit_cost ghi được giá vốn mà không cần đăng nhập
// suốt một tháng vì 20260714 quên REVOKE. Xem 20260814_fix_security_advisor_part4.
//
// Luật: REVOKE phải nằm ở file SAU HOẶC CÙNG file với định nghĩa mới nhất. So theo file thay vì
// "file cuối nhắc tên" vì comment ở migration sau cũng nhắc tên — bản đầu của check này im lặng
// bỏ qua đúng 3 hàm nguy hiểm nhất vì lý do đó.
const INTERNAL_ONLY = [
    'get_warehouse_group_address_ids',
    'sync_group_unit_cost',
    'recompute_group_unit_cost',
    'seed_default_ingredient_costs',
    'seed_default_expense_categories',
    'bump_order_sync_mark',
]

// Hai cách viết REVOKE trong repo này: gọi thẳng theo signature, hoặc vòng DO $$ quét proname
// trong một danh sách IN (...) rồi format() ra lệnh REVOKE.
const hasRevoke = (sql, name) =>
    new RegExp(`REVOKE[^;]{0,200}?\\b${name}\\s*\\(`, 'i').test(sql)
    || sql.split(/DO\s+\$\$/i).slice(1).some(b => b.includes(`'${name}'`) && /REVOKE/i.test(b))

const exposed = []
for (const name of INTERNAL_ONLY) {
    const defined = latest.get(name)
    if (!defined) continue
    const lastRevoke = files.filter(f => hasRevoke(readFileSync(join(DIR, f), 'utf8'), name)).at(-1)
    if (!lastRevoke || lastRevoke < defined.file) exposed.push([name, defined.file])
}

if (exposed.length) {
    console.error('Hàm nội bộ bị định nghĩa lại mà KHÔNG revoke lại quyền EXECUTE:\n')
    for (const [name, file] of exposed) console.error(`  - ${name}  (định nghĩa cuối: ${file}, không có REVOKE nào sau đó)`)
    console.error('\nThêm REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated vào migration đó.')
    process.exit(1)
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
