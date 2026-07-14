# Supabase

`schema.sql` is the source of truth for table structure, indexes, RLS policies, and triggers used by the app.

## Drift policy

The Supabase dashboard is editable. If you change the DB there (add a column, tweak an RLS policy, etc.), **mirror the change in `schema.sql` and commit it** in the same change. Otherwise the next reviewer can't tell what production looks like.

## Applying

For a brand-new project: paste `schema.sql` into the dashboard SQL editor, or `supabase db push`.

For an existing project: write a new file in `supabase/migrations/` (see naming pattern of existing
files — `YYYYMMDD_description.sql`). CI (`.github/workflows/ci.yml`, job `deploy-migrations`) runs
`supabase db push` automatically on every push to `main` that passes lint/typecheck/test — no manual
dashboard step needed. That job targets prod behind a required-reviewer approval gate (GitHub
Environment `production`). Mirror the change into `schema.sql` in the same PR so it stays the source
of truth for table structure.

Function migrations (`CREATE OR REPLACE FUNCTION`) must follow the `SET search_path` + ownership
guard + `REVOKE`/`GRANT` rules in the repo's `CLAUDE.md` — Security Advisor has flagged regressions
here multiple times.
