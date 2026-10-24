-- Test SQL cho dashboard admin (migration 20261034/35/36): loại thành viên đăng nhập khỏi "Vào trang
-- chủ" + cờ 'active' trong admin_branch_stages. Dán nguyên file vào Supabase SQL editor rồi Run.
--
-- AN TOÀN TRÊN PROD: toàn bộ chạy trong 1 khối DO và luôn kết thúc bằng RAISE EXCEPTION nên Postgres
-- rollback hết — không ghi gì vào DB. Kết quả đọc ở thông báo lỗi:
--   "PASS ..." = đạt hết;  "FAIL: ..." = có assert sai (nội dung nói rõ cái nào).
-- Cần ít nhất 1 user role='admin' có auth_id (để qua guard của RPC).

DO $$
DECLARE
    v_admin UUID;
    v_a UUID := gen_random_uuid();  -- ghé /login, không đăng nhập      → khách mới
    v_b UUID := gen_random_uuid();  -- ghé /login rồi đăng nhập          → nhân viên/quản lý
    v_c UUID := gen_random_uuid();  -- bấm hướng dẫn rồi đăng nhập lại   → vẫn là khách của phễu
    s0 JSONB; s1 JSONB; st JSONB;
    n INT; n_active INT; n_addr INT; n_sum INT;
    caught BOOLEAN;
BEGIN
    SELECT auth_id INTO v_admin FROM users WHERE role = 'admin' AND auth_id IS NOT NULL LIMIT 1;
    IF v_admin IS NULL THEN RAISE EXCEPTION 'FAIL: không có user admin nào có auth_id để giả lập'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

    -- 1. Quyền gọi: ghi mở cho anon, đọc thống kê chỉ authenticated.
    IF NOT has_function_privilege('anon', 'public.mark_login_page_member(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: anon phải gọi được mark_login_page_member'; END IF;
    IF has_function_privilege('anon', 'public.login_page_visit_stats()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: anon không được gọi login_page_visit_stats'; END IF;
    IF has_function_privilege('anon', 'public.admin_branch_stages()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: anon không được gọi admin_branch_stages'; END IF;

    -- 2. Phễu ghé trang: đếm thay đổi đúng theo 3 loại visitor.
    s0 := login_page_visit_stats();
    IF NOT (s0 ? 'today_members' AND s0 ? 'week_members' AND s0 ? 'all_members') THEN
        RAISE EXCEPTION 'FAIL: login_page_visit_stats thiếu key *_members (chưa apply 20261036?)'; END IF;

    PERFORM track_login_page_visit(v_a);
    PERFORM track_login_page_visit(v_a);          -- gọi lại cùng ngày không đếm đôi
    PERFORM track_login_page_visit(v_b);
    PERFORM track_login_page_visit(v_c);
    INSERT INTO guest_onboarding_funnel (visitor_id, max_stage) VALUES (v_c, 0);
    PERFORM mark_login_page_member(v_b);
    PERFORM mark_login_page_member(v_b);          -- idempotent
    PERFORM mark_login_page_member(v_c);
    PERFORM mark_login_page_member(NULL);         -- NULL bị bỏ qua, không lỗi

    s1 := login_page_visit_stats();
    IF (s1->>'today')::int - (s0->>'today')::int <> 2 THEN
        RAISE EXCEPTION 'FAIL: today khách mới phải +2 (A và C), thực tế +%', (s1->>'today')::int - (s0->>'today')::int; END IF;
    IF (s1->>'today_members')::int - (s0->>'today_members')::int <> 1 THEN
        RAISE EXCEPTION 'FAIL: today_members phải +1 (chỉ B), thực tế +%', (s1->>'today_members')::int - (s0->>'today_members')::int; END IF;
    IF (s1->>'week')::int - (s0->>'week')::int <> 2 OR (s1->>'week_members')::int - (s0->>'week_members')::int <> 1 THEN
        RAISE EXCEPTION 'FAIL: số "week" không khớp today'; END IF;
    IF (s1->>'all')::int - (s0->>'all')::int <> 2 OR (s1->>'all_members')::int - (s0->>'all_members')::int <> 1 THEN
        RAISE EXCEPTION 'FAIL: số "all" không khớp today'; END IF;

    -- 3. Guard: không phải admin thì RPC phải từ chối.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    caught := false;
    BEGIN PERFORM login_page_visit_stats(); EXCEPTION WHEN OTHERS THEN caught := true; END;
    IF NOT caught THEN RAISE EXCEPTION 'FAIL: login_page_visit_stats không chặn non-admin'; END IF;
    caught := false;
    BEGIN PERFORM admin_branch_stages(); EXCEPTION WHEN OTHERS THEN caught := true; END;
    IF NOT caught THEN RAISE EXCEPTION 'FAIL: admin_branch_stages không chặn non-admin'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

    -- 4. admin_branch_stages: 8 nhóm cộng lại = số địa chỉ còn sống; mọi địa chỉ trong lists có 'active'
    --    kiểu boolean; số 'active' trong lists = active_today.
    st := admin_branch_stages();
    SELECT COUNT(*) INTO n_addr FROM addresses WHERE deleted_at IS NULL;
    n_sum := (st->>'never')::int + (st->>'ordered')::int + (st->>'trial_counted')::int + (st->>'trial_uncounted')::int
           + (st->>'expired_pre')::int + (st->>'paid_counted')::int + (st->>'paid_uncounted')::int + (st->>'expired_post')::int;
    IF n_sum <> n_addr THEN
        RAISE EXCEPTION 'FAIL: 8 nhóm cộng = %, nhưng có % địa chỉ còn sống', n_sum, n_addr; END IF;

    SELECT COUNT(*), COUNT(*) FILTER (WHERE (e->>'active')::boolean)
      INTO n, n_active
      FROM jsonb_each(st->'lists') l, jsonb_array_elements(l.value) e;
    IF n <> n_addr THEN RAISE EXCEPTION 'FAIL: lists có % địa chỉ, mong đợi %', n, n_addr; END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_each(st->'lists') l, jsonb_array_elements(l.value) e
        WHERE jsonb_typeof(e->'active') IS DISTINCT FROM 'boolean'
    ) THEN RAISE EXCEPTION 'FAIL: có địa chỉ trong lists thiếu cờ active (chưa apply 20261035?)'; END IF;
    IF n_active <> (st->>'active_today')::int THEN
        RAISE EXCEPTION 'FAIL: active trong lists = %, active_today = %', n_active, st->>'active_today'; END IF;

    -- Luôn raise để rollback; "PASS" ở đầu thông báo = đạt.
    RAISE EXCEPTION 'PASS (đã rollback, DB không đổi) — khách mới +2, đăng nhập +1, % địa chỉ / % hôm nay chạy', n_addr, n_active;
END $$;
