# Supabase

`schema.sql` is the source of truth for table structure, indexes, RLS policies, and triggers used by the app.

## Drift policy

The Supabase dashboard is editable. If you change the DB there (add a column, tweak an RLS policy, etc.), **mirror the change in `schema.sql` and commit it** in the same change. Otherwise the next reviewer can't tell what production looks like.

## Applying

For a new project:

```bash
supabase db push   # if using supabase CLI
# or paste schema.sql into the dashboard SQL editor
```

For migrations: keep using the dashboard for now, then update `schema.sql`. Move to proper `supabase/migrations/*.sql` files once schema churn slows.
