-- "Bỏ qua" của "Việc cần làm" (trang /addresses) lưu trên server để mọi thiết bị / quản lý cùng thấy.
-- Trước đây chỉ nằm trong localStorage của từng máy. Chỉ có hiệu lực trong ngày: dòng của ngày cũ không còn được đọc.
-- Bảng không có policy (deny-all với client); đọc/ghi qua 2 RPC SECURITY DEFINER có ownership guard
-- (pattern admin OR manager_id = auth_owner_id OR user_address_access).
CREATE TABLE IF NOT EXISTS restock_skips (
    address_id UUID        NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    day        DATE        NOT NULL DEFAULT vn_business_date(now()),
    ingredient TEXT        NOT NULL,
    skipped_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (address_id, day, ingredient)
);
ALTER TABLE restock_skips ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_restock_skips(p_address_ids UUID[])
RETURNS TABLE (address_id UUID, ingredient TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT s.address_id, s.ingredient
    FROM restock_skips s
    JOIN addresses a ON a.id = s.address_id
    WHERE s.address_id = ANY(p_address_ids)
      AND s.day = vn_business_date(now())
      AND (
          public.is_admin_auth(auth.uid())
          OR a.manager_id = public.auth_owner_id(auth.uid())
          OR a.id IN (SELECT uaa.address_id FROM user_address_access uaa WHERE uaa.auth_id = auth.uid())
      );
$$;

CREATE OR REPLACE FUNCTION set_restock_skip(p_address_id UUID, p_ingredient TEXT, p_skipped BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = p_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', p_address_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_skipped THEN
        INSERT INTO restock_skips (address_id, ingredient, skipped_by)
        VALUES (p_address_id, p_ingredient, auth.uid())
        ON CONFLICT (address_id, day, ingredient) DO NOTHING;
    ELSE
        DELETE FROM restock_skips
        WHERE address_id = p_address_id AND day = vn_business_date(now()) AND ingredient = p_ingredient;
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_restock_skips(UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_restock_skips(UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_restock_skips(UUID[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_restock_skip(UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_restock_skip(UUID, TEXT, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_restock_skip(UUID, TEXT, BOOLEAN) TO authenticated;
