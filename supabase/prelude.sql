-- -----------------------------------------------------------------------------
-- supabase/prelude.sql — what a bare PostgreSQL is missing from the Supabase platform
--
-- Run this ONCE, before the migrations, against a database that is not Supabase
-- (Neon, or any bare PostgreSQL). It creates only the two things the schema
-- actually assumes from the Supabase platform:
--
--   1. an `auth` schema holding `auth.users` — `public.admin_users.user_id` is a
--      foreign key to it, because on Supabase staff accounts live in Supabase Auth;
--   2. `auth.uid()` — the function every Row Level Security policy is written
--      against (`is_staff(p_user_id uuid default auth.uid())`).
--
-- Nothing else in the 16 migrations is Supabase-specific. The gallery migration
-- notices that there is no `storage` schema and skips its bucket setup; every
-- table, constraint, trigger, function, policy and grant in the schema is plain
-- PostgreSQL and behaves identically here.
--
-- `auth.uid()` reads the same PostgREST-compatible claims Supabase reads, so it
-- works under PostgREST (including Neon's Data API, which is PostgREST), under a
-- direct connection that sets the claims itself, and under this project's local
-- verification harness. When Neon's Data API installs `pg_session_jwt` it defines
-- `auth.user_id()`; this function is the same idea under the name this schema uses.
-- -----------------------------------------------------------------------------

create schema if not exists auth;

comment on schema auth is
  'Holds the identity shim the schema expects: auth.users (the staff account foreign key) and auth.uid() (what the RLS policies read). On Supabase this schema belongs to the platform.';

create table if not exists auth.users (
  id    uuid primary key,
  email text unique,
  created_at timestamptz not null default now()
);

comment on table auth.users is
  'Minimal stand-in for Supabase''s auth.users: id + email are all the schema needs. On Supabase, rows here are created by Supabase Auth; elsewhere, insert them yourself (or point them at whichever auth provider you use).';

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      -- PostgREST sets `request.jwt.claim.sub` (Supabase's own helper reads it this way)…
      current_setting('request.jwt.claim.sub', true),
      -- …and always sets the whole claim set as JSON. Reading both means one
      -- definition works on Supabase, on Neon's Data API, and in the harness.
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

comment on function auth.uid() is
  'The caller''s user id from the request JWT claims, or null when unauthenticated. Anonymous requests see null, which is why every policy that asks is_staff()/is_admin() denies them.';

-- The roles the migrations create if missing (anon / authenticated / service_role)
-- stay owned by whoever runs this. On Neon that is `neondb_owner`, which may create
-- roles and set BYPASSRLS on them; on a locked-down instance, create them yourself
-- beforehand as a superuser.

-- Doing the rows above is not optional: without `auth.uid()` the migrations still
-- apply (it is only referenced inside function bodies and policies), but every
-- policy would fail at query time with "function auth.uid() does not exist".
-- Without `auth.users` the migration 20260922090000_init_schema.sql fails outright.
