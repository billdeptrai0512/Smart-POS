-- ============================================================
-- Share-clone chi nhánh xuyên tài khoản + hook referral — 2026-06-20
--
-- Vấn đề: 20 chi nhánh cùng hệ thống, KHÁC quản lý trưởng (account độc lập).
-- BackupModal chỉ clone trong cùng 1 tài khoản (RLS chặn đọc địa chỉ của manager
-- khác). Cách giải: chủ hệ thống phát 1 MÃ; manager mới dán mã → đọc snapshot
-- config qua RPC SECURITY DEFINER (mã = "chìa khoá", không cần manager_id khớp),
-- rồi GHI vào địa chỉ của chính họ (RLS cho ghi địa chỉ mình).
--
-- Kèm việc rẻ-cứu-tương-lai: cột addresses.referred_from_address_id ghi nguồn
-- clone — nền cho referral program (xem docs/MONETIZATION.md §11).
--
-- ⚠️ PROD + DEV CHUNG 1 DB. Chỉ thêm cột/bảng/hàm. IDEMPOTENT.
-- ⚠️ KHÔNG bọc BEGIN/COMMIT: Supabase SQL editor tách câu lệnh sai khi có
--    transaction wrapper + nhiều hàm dollar-quote. Nếu editor VẪN báo
--    "unterminated dollar-quoted string", chạy TỪNG block CREATE FUNCTION riêng.
-- ============================================================

-- ── 1. Attribution column (referral hook) ─────────────────────────────────────
ALTER TABLE addresses
    ADD COLUMN IF NOT EXISTS referred_from_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL;

-- ── 2. Bảng mã chia sẻ — dùng lại được, 30 ngày, 1 mã/địa chỉ nguồn ────────────
CREATE TABLE IF NOT EXISTS address_share_codes (
    code              TEXT PRIMARY KEY,
    source_address_id UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX IF NOT EXISTS idx_share_code_source ON address_share_codes(source_address_id);

-- RLS bật, KHÔNG policy: client không đụng trực tiếp. Mọi truy cập qua RPC
-- SECURITY DEFINER (chạy bằng owner → bỏ qua RLS).
ALTER TABLE address_share_codes ENABLE ROW LEVEL SECURITY;

-- ── 3. create_address_share_code — chủ địa chỉ phát/lấy mã ─────────────────────
CREATE OR REPLACE FUNCTION public.create_address_share_code(p_address_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT;
BEGIN
    IF p_address_id IS NULL THEN
        RAISE EXCEPTION 'Thiếu địa chỉ';
    END IF;

    -- Ownership guard. Skip khi auth.uid() IS NULL (service_role / migration).
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_auth(auth.uid()) THEN
        IF NOT EXISTS (
            SELECT 1 FROM addresses a
             WHERE a.id = p_address_id
               AND a.manager_id = public.auth_owner_id(auth.uid())
        ) THEN
            RAISE EXCEPTION 'Không có quyền với chi nhánh này'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- Tái dùng mã còn hạn cho địa chỉ (ổn định, không spam mã mới mỗi lần bấm).
    SELECT code INTO v_code
      FROM address_share_codes
     WHERE source_address_id = p_address_id AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_code IS NOT NULL THEN
        RETURN v_code;
    END IF;

    -- 8 ký tự (K + 7 hex hoa), gõ tay được; loop tới khi unique.
    -- md5 + gen_random_uuid là hàm lõi (pg_catalog) → an toàn với search_path=public;
    -- gen_random_bytes thuộc pgcrypto (schema extensions) nên KHÔNG dùng ở đây.
    LOOP
        v_code := 'K' || upper(substr(md5(gen_random_uuid()::text), 1, 7));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM address_share_codes WHERE code = v_code);
    END LOOP;

    INSERT INTO address_share_codes (code, source_address_id)
    VALUES (v_code, p_address_id);

    RETURN v_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_address_share_code(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_address_share_code(UUID) TO authenticated;

-- ── 4. get_shared_config — manager mới đọc snapshot config của địa chỉ nguồn ────
-- LANGUAGE sql (1 câu SELECT, không DECLARE/BEGIN) → thân hàm chỉ có 1 dấu ';'
-- ở cuối nên Supabase SQL editor không cắt nhầm. Mã sai/hết hạn → 0 dòng → NULL
-- (client bắt !data → báo lỗi).
CREATE OR REPLACE FUNCTION public.get_shared_config(p_code TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'source_address_id', sc.source_address_id,
        'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'price', p.price,
            'sort_order', p.sort_order, 'count_as_cup', p.count_as_cup))
            FROM products p WHERE p.owner_address_id = sc.source_address_id AND p.is_active), '[]'::jsonb),
        'recipes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'product_id', r.product_id, 'ingredient', r.ingredient,
            'amount', r.amount, 'unit', r.unit))
            FROM recipes r WHERE r.address_id = sc.source_address_id), '[]'::jsonb),
        'extras', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', e.id, 'product_id', e.product_id, 'name', e.name,
            'price', e.price, 'sort_order', e.sort_order, 'is_sticky', e.is_sticky))
            FROM product_extras e WHERE e.address_id = sc.source_address_id), '[]'::jsonb),
        'extra_ingredients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'extra_id', ei.extra_id, 'ingredient', ei.ingredient,
            'amount', ei.amount, 'unit', ei.unit))
            FROM extra_ingredients ei
            WHERE ei.extra_id IN (SELECT id FROM product_extras WHERE address_id = sc.source_address_id)), '[]'::jsonb),
        'costs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'ingredient', c.ingredient, 'unit_cost', c.unit_cost, 'unit', c.unit))
            FROM ingredient_costs c WHERE c.address_id = sc.source_address_id), '[]'::jsonb),
        'ingredient_sort_order',
            COALESCE((SELECT ingredient_sort_order FROM addresses WHERE id = sc.source_address_id), '[]'::jsonb)
    )
    FROM address_share_codes sc
    WHERE sc.code = upper(trim(p_code))
      AND sc.expires_at > now();
$$;

REVOKE EXECUTE ON FUNCTION public.get_shared_config(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_shared_config(TEXT) TO authenticated;
