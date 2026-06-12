# Smart POS — Claude Rules

## Branching
- Luôn làm việc trực tiếp trên branch `main`. Không tạo worktree hay branch mới trừ khi được yêu cầu rõ ràng.

## Migrations (Supabase) — chống regression Security Advisor
Khi `CREATE OR REPLACE FUNCTION` (hoặc DROP + CREATE) một hàm đã có, PostgreSQL làm RƠI
`SET search_path` và (với signature mới) cấp EXECUTE mặc định cho PUBLIC. Đã gây 4 đợt
advisor warning (20260505/20260508+20260520/20260603/20260612). Mọi migration đụng function phải:
1. Khai báo lại `SET search_path = public` trong định nghĩa.
2. Giữ nguyên **ownership guard** có sẵn trong body (pattern: admin OR `manager_id = auth_owner_id(auth.uid())` OR `user_address_access`; skip khi `auth.uid() IS NULL`).
3. Signature mới → kèm `REVOKE ... FROM PUBLIC, anon;` + `GRANT ... TO authenticated;` (hàm trigger/webhook thì revoke cả authenticated).
