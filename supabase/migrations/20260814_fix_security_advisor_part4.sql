-- ==============================================================================================
-- 20260814_fix_security_advisor_part4.sql
-- Description: khoá lại 4 hàm CHỈ DÙNG NỘI BỘ bị lộ ra /rest/v1/rpc — lần lặp thứ 5 của
--              regression "CREATE OR REPLACE cấp lại EXECUTE cho PUBLIC" (xem CLAUDE.md).
--
-- VẤN ĐỀ NẶNG NHẤT. sync_group_unit_cost và recompute_group_unit_cost GHI giá vốn (WAC) cho
-- mọi địa chỉ trong nhóm kho, và cả hai KHÔNG có ownership guard — đúng thiết kế, vì chúng chỉ
-- được PERFORM từ những hàm SECURITY DEFINER đã guard sẵn (set_ingredient_unit_cost,
-- process_ingredient_restock, cancel_restock, edit_ingredient_restock). Nhưng 20260714 cấp
-- GRANT/REVOKE cho 4 RPC public của nó mà BỎ SÓT 3 hàm nội bộ, nên từ 2026-07-14 tới nay:
--     bất kỳ ai cầm anon key (nằm sẵn trong bundle client) + một address UUID
--     đều ghi đè được giá vốn nguyên liệu, KHÔNG cần đăng nhập.
-- Address UUID không đoán được, nhưng ai từng đăng nhập vào quán đó là giữ nó vĩnh viễn —
-- nhân viên đã nghỉ, co-manager đã gỡ quyền. Đây là leo thang quyền thật, không phải lint noise.
--
-- seed_default_ingredient_costs đã bị revoke ở 20260603, rồi 20260705_add_tare_weight định
-- nghĩa lại nó ⇒ quyền quay về. Cùng một cái bẫy, khác migration.
--
-- KHÔNG đụng tới: auth_owner_id / can_write_address / is_admin_auth / is_manager_auth. RLS
-- policy gọi chúng và phép EXECUTE được kiểm theo ROLE ĐANG GỌI, nên revoke là mọi truy vấn
-- đi qua policy đó ăn 42501 — đã xảy ra một lần với anon (xem comment ở AuthContext.jsx).
-- Hai linter 0028/0029 sẽ còn kêu chúng mãi; đó là đánh đổi có chủ đích của kiến trúc RLS này.
--
-- IDEMPOTENT — chạy lại an toàn. Quét theo proname nên bắt hết overload.
-- ==============================================================================================

BEGIN;

DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT p.oid::regprocedure AS func_sig
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname IN (
              -- Chỉ được PERFORM từ hàm SECURITY DEFINER khác. Hàm cha chạy dưới quyền OWNER
              -- nên phép EXECUTE bên trong vẫn qua, revoke không làm hỏng đường gọi thật.
              'get_warehouse_group_address_ids',
              'sync_group_unit_cost',
              'recompute_group_unit_cost',
              -- Chỉ chạy từ trigger. Trigger fire không kiểm EXECUTE.
              'seed_default_ingredient_costs'
          )
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', rec.func_sig);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', rec.func_sig);
    END LOOP;
END
$$;

COMMIT;
