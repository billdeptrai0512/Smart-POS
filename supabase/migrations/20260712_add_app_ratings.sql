-- Đánh giá app trong SupportModal — 5 sao + comment tuỳ chọn, submit-only từ client.
-- Không có SELECT policy cho client: xem qua Supabase dashboard (service role).

BEGIN;

CREATE TABLE IF NOT EXISTS app_ratings (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_ratings_user ON app_ratings (user_id);

ALTER TABLE app_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_app_ratings_insert" ON app_ratings;
CREATE POLICY "own_app_ratings_insert" ON app_ratings
    FOR INSERT
    WITH CHECK (
        user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
    );

COMMIT;
