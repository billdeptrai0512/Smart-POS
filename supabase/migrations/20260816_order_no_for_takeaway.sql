-- ==============================================================================================
-- 20260816_order_no_for_takeaway.sql
-- Description: 20260814_order_sequential_number.sql cố tình KHÔNG cấp order_no cho đơn mang đi
-- ("chưa có màn hình in bill nào cho luồng mang đi, cấp số cho nó chỉ tổ tốn số vô ích") — nhưng
-- OrdersList.jsx (History) đã in bill cho đơn mang đi lẻ từ trước rồi (chỉ là PrintBill luôn nhận
-- orderNo={null} cứng cho nhánh này), nên giả định đó không còn đúng. Giờ cấp số cho CẢ mang đi.
--
-- Khác với bàn: mang đi không có khái niệm "gọi thêm cùng 1 lần mở" để dùng lại số — mỗi đơn mang
-- đi độc lập, luôn cấp số MỚI (không cần bước tìm-hoặc-cấp qua advisory lock như bàn). Dùng chung
-- 1 bộ đếm addresses.next_order_no với bàn nên số vẫn tăng dần đều xuyên suốt theo địa chỉ.
--
-- CÙNG signature (JSONB) → search_path + ownership guard theo CLAUDE.md, REVOKE/GRANT re-declare.
-- Toàn bộ thân hàm giữ NGUYÊN VĂN từ 20260816_fix_bulk_create_orders_table_name_order_no.sql,
-- chỉ đổi khối IF v_table_name IS NOT NULL ở cuối (thêm nhánh ELSE cấp số cho mang đi).
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION bulk_create_orders(orders_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_rec JSONB;
  item_rec JSONB;
  extra_id_txt TEXT;
  recipe_rec RECORD;
  ei_rec RECORD;
  new_order_id UUID;
  new_order_time TIMESTAMPTZ;
  v_address_id UUID;
  v_discount_amount INTEGER;
  v_discount_capped INTEGER;
  v_table_name TEXT;
  v_order_total INTEGER;
  v_order_cost NUMERIC;
  v_order_no INTEGER;
  v_product_id UUID;
  v_quantity INTEGER;
  v_extra_ids JSONB;
  v_unit_price INTEGER;
  v_extras_price INTEGER;
  v_extra_price INTEGER;
  v_extra_name TEXT;
  v_options_text TEXT;
  v_line_cogs NUMERIC;
  v_ing_cost INTEGER;
BEGIN
  FOR order_rec IN
    SELECT elem FROM jsonb_array_elements(orders_payload) WITH ORDINALITY AS t(elem, ord)
    ORDER BY elem->>'address_id', elem->>'table_name', ord
  LOOP
    v_address_id := (order_rec->>'address_id')::UUID;

    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = v_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', v_address_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    new_order_time := COALESCE((order_rec->>'created_at')::TIMESTAMPTZ, now());
    v_discount_amount := COALESCE((order_rec->>'discount_amount')::INTEGER, 0);
    v_table_name := NULLIF(TRIM(COALESCE(order_rec->>'table_name', '')), '');

    INSERT INTO orders (id, total, total_cost, discount_amount, payment_method, address_id, staff_name, table_name, created_at)
    VALUES (
      COALESCE((order_rec->>'id')::UUID, gen_random_uuid()),
      0, 0, GREATEST(v_discount_amount, 0),
      order_rec->>'payment_method',
      v_address_id,
      order_rec->>'staff_name',
      v_table_name,
      new_order_time
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO new_order_id;

    IF new_order_id IS NULL THEN
      CONTINUE;
    END IF;

    v_order_total := 0;
    v_order_cost := 0;
    v_order_no := NULL;

    FOR item_rec IN SELECT * FROM jsonb_array_elements(order_rec->'items')
    LOOP
      v_product_id := (item_rec->>'product_id')::UUID;
      v_quantity := (item_rec->>'quantity')::INTEGER;
      v_extra_ids := COALESCE(item_rec->'extra_ids', '[]'::JSONB);

      SELECT price INTO v_unit_price FROM products WHERE id = v_product_id AND owner_address_id = v_address_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid product % for address %', v_product_id, v_address_id USING ERRCODE = 'invalid_parameter_value';
      END IF;

      v_extras_price := 0;
      v_options_text := NULL;
      FOR extra_id_txt IN SELECT * FROM jsonb_array_elements_text(v_extra_ids)
      LOOP
        SELECT price, name INTO v_extra_price, v_extra_name
        FROM product_extras
        WHERE id = extra_id_txt::UUID AND product_id = v_product_id AND address_id = v_address_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Invalid extra % for product %', extra_id_txt, v_product_id USING ERRCODE = 'invalid_parameter_value';
        END IF;
        v_extras_price := v_extras_price + v_extra_price;
        v_options_text := CASE WHEN v_options_text IS NULL THEN v_extra_name ELSE v_options_text || ', ' || v_extra_name END;
      END LOOP;

      v_order_total := v_order_total + (v_unit_price + v_extras_price) * v_quantity;

      v_line_cogs := 0;
      FOR recipe_rec IN SELECT ingredient, amount FROM recipes WHERE product_id = v_product_id AND address_id = v_address_id
      LOOP
        SELECT unit_cost INTO v_ing_cost FROM ingredient_costs WHERE ingredient = recipe_rec.ingredient AND address_id = v_address_id;
        v_line_cogs := v_line_cogs + COALESCE(v_ing_cost, 0) * recipe_rec.amount;
      END LOOP;
      FOR extra_id_txt IN SELECT * FROM jsonb_array_elements_text(v_extra_ids)
      LOOP
        FOR ei_rec IN SELECT ingredient, amount FROM extra_ingredients WHERE extra_id = extra_id_txt::UUID
        LOOP
          SELECT unit_cost INTO v_ing_cost FROM ingredient_costs WHERE ingredient = ei_rec.ingredient AND address_id = v_address_id;
          v_line_cogs := v_line_cogs + COALESCE(v_ing_cost, 0) * ei_rec.amount;
        END LOOP;
      END LOOP;
      v_order_cost := v_order_cost + v_line_cogs * v_quantity;

      INSERT INTO order_items (order_id, product_id, quantity, options, unit_cost, extra_ids, discount_amount)
      VALUES (new_order_id, v_product_id, v_quantity, v_options_text, ROUND(v_line_cogs)::INTEGER, v_extra_ids, COALESCE((item_rec->>'discount_amount')::INTEGER, 0));
    END LOOP;

    v_discount_capped := LEAST(GREATEST(v_discount_amount, 0), v_order_total);

    -- Số hoá đơn: bàn dùng lại số của lần mở bàn (gọi thêm không sinh số mới, cần advisory
    -- lock để 2 đợt "mở bàn mới" cùng bàn gửi song song không tự cấp 2 số khác nhau). Mang đi
    -- không có khái niệm "gọi thêm cùng 1 lần mở" — mỗi đơn độc lập, luôn cấp số mới, không cần
    -- khoá theo bàn (không có "bàn" để khoá).
    IF v_table_name IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(v_address_id::text || ':' || v_table_name, 0));

      SELECT order_no INTO v_order_no
      FROM orders
      WHERE address_id = v_address_id
        AND table_name = v_table_name
        AND table_closed_at IS NULL
        AND deleted_at IS NULL
        AND order_no IS NOT NULL
      LIMIT 1;

      IF v_order_no IS NULL THEN
        UPDATE addresses SET next_order_no = next_order_no + 1
        WHERE id = v_address_id
        RETURNING next_order_no - 1 INTO v_order_no;
      END IF;
    ELSE
      UPDATE addresses SET next_order_no = next_order_no + 1
      WHERE id = v_address_id
      RETURNING next_order_no - 1 INTO v_order_no;
    END IF;

    UPDATE orders
    SET total = v_order_total - v_discount_capped,
        total_cost = ROUND(v_order_cost)::INTEGER,
        discount_amount = v_discount_capped,
        order_no = v_order_no
    WHERE id = new_order_id;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) TO authenticated;

COMMIT;
