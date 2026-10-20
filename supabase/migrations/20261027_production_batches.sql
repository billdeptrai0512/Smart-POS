-- production_batches — mỗi dòng là một lần "Sản xuất mẻ" thành phẩm (xem 20261026_batch_products).
-- `inputs` chụp lượng nguyên liệu gốc lúc làm → sửa công thức mẻ sau này không viết lại lịch sử.
-- Chỉ ghi qua RPC (bảng chỉ có policy SELECT). Hủy = đặt cancelled_at, không xóa cứng.
-- Quyền theo địa chỉ: cùng quy tắc daily_ingredient_usage (20261006), KHÔNG dùng auth_owner_id.

CREATE TABLE IF NOT EXISTS public.production_batches (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    address_id         uuid NOT NULL REFERENCES public.addresses(id) ON DELETE CASCADE,
    product_id         uuid REFERENCES public.products(id) ON DELETE SET NULL,
    output_ingredient  text    NOT NULL,
    batches            numeric NOT NULL CHECK (batches > 0),
    output_qty         numeric NOT NULL CHECK (output_qty > 0),
    inputs             jsonb   NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
    staff_name         text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    cancelled_at       timestamptz
);

ALTER TABLE public.production_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "production_batches_read" ON public.production_batches;
CREATE POLICY "production_batches_read" ON public.production_batches
    FOR SELECT TO authenticated
    USING (
        (SELECT public.is_admin_auth(auth.uid()))
        OR address_id IN (SELECT address_id FROM public.user_address_access WHERE auth_id = (SELECT auth.uid()))
        OR address_id IN (SELECT id FROM public.addresses WHERE manager_id = (SELECT id FROM public.users WHERE auth_id = (SELECT auth.uid())))
    );

REVOKE ALL ON public.production_batches FROM PUBLIC, anon;
GRANT SELECT ON public.production_batches TO authenticated;

-- produce_batch: ghi 1 lần sản xuất. Thành phẩm cộng số mẻ × sản lượng mẻ, nguyên liệu gốc trừ số mẻ × công thức mẻ.
-- p_output_ingredient = key nguyên liệu của thành phẩm (client chuẩn hoá từ tên, normalizeIngredientKey).
CREATE OR REPLACE FUNCTION public.produce_batch(
    p_address_id        UUID,
    p_product_id        UUID,
    p_output_ingredient TEXT,
    p_batches           NUMERIC,
    p_staff_name        TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_yield  NUMERIC;
    v_inputs JSONB;
    v_id     UUID;
BEGIN
    -- Ownership guard (pattern 20260520/20260612). Skip service_role/migrations.
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

    IF p_batches IS NULL OR p_batches <= 0 THEN
        RAISE EXCEPTION 'batches must be positive (got %)', p_batches;
    END IF;

    SELECT batch_yield INTO v_yield
    FROM products
    WHERE id = p_product_id AND is_batch AND is_active AND owner_address_id = p_address_id;
    IF COALESCE(v_yield, 0) <= 0 THEN
        RAISE EXCEPTION 'Not a batch product of this address, or no batch yield: %', p_product_id;
    END IF;

    SELECT COALESCE(jsonb_object_agg(ingredient, ROUND((amount * p_batches)::NUMERIC, 2)), '{}'::JSONB)
    INTO v_inputs
    FROM recipes
    WHERE product_id = p_product_id AND amount > 0;
    IF v_inputs = '{}'::JSONB THEN
        RAISE EXCEPTION 'Batch product % has no recipe', p_product_id;
    END IF;

    INSERT INTO production_batches (address_id, product_id, output_ingredient, batches, output_qty, inputs, staff_name)
    VALUES (p_address_id, p_product_id, p_output_ingredient, p_batches, ROUND((v_yield * p_batches)::NUMERIC, 2), v_inputs, p_staff_name)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.produce_batch(uuid, uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.produce_batch(uuid, uuid, text, numeric, text) TO authenticated;

-- cancel_production_batch: hủy mềm (làm nhầm). Client bỏ dòng đã hủy nên tiêu hao tự hoàn lại.
CREATE OR REPLACE FUNCTION public.cancel_production_batch(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_address UUID;
BEGIN
    SELECT address_id INTO v_address FROM production_batches WHERE id = p_id;
    IF v_address IS NULL THEN
        RAISE EXCEPTION 'Production batch % not found', p_id;
    END IF;

    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = v_address
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', v_address USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE production_batches SET cancelled_at = now() WHERE id = p_id AND cancelled_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_production_batch(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_production_batch(uuid) TO authenticated;
