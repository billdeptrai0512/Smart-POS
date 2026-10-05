-- Nhóm là tầng duy nhất: địa chỉ HOÀN TOÀN chưa có nhóm → tự chia theo category (món chính →
-- "Nguyên liệu chính", bao bì/'tools' cũ → "Bao bì"). Địa chỉ đã có nhóm giữ nguyên. Idempotent; chỉ dữ liệu.
WITH targets AS (
    SELECT DISTINCT address_id,
           CASE WHEN category IN ('packaging', 'tools') THEN 'packaging' ELSE 'main' END AS section
    FROM public.ingredient_costs ic
    WHERE address_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.ingredient_groups g WHERE g.address_id = ic.address_id)
),
ins AS (
    INSERT INTO public.ingredient_groups (address_id, name, section, sort_order)
    SELECT address_id, CASE section WHEN 'packaging' THEN 'Bao bì' ELSE 'Nguyên liệu chính' END,
           section, 1 + (section = 'packaging')::int
    FROM targets
    RETURNING id, address_id, section
)
UPDATE public.ingredient_costs ic
SET group_id = ins.id
FROM ins
WHERE ic.address_id = ins.address_id
  AND ins.section = CASE WHEN ic.category IN ('packaging', 'tools') THEN 'packaging' ELSE 'main' END;
