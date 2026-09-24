-- -----------------------------------------------------------------------------
-- database/prelude.sql — PostgreSQL compatibility objects used by the schema
--
-- Run this once before the migrations on Neon or bare PostgreSQL. The historical
-- schema includes a minimal `auth.users` table and uses `auth.uid()` in a few
-- residual public-read policies. These objects keep that SQL valid without any
-- hosted-authentication dependency.
--
-- Gallery files live in Vercel Blob; this database contains their metadata and
-- the separate homepage hero WebP. All schema objects are standard PostgreSQL.
-- -----------------------------------------------------------------------------

create schema if not exists auth;

comment on schema auth is
  'Compatibility schema for auth.users foreign keys retained by the migration history and auth.uid() used by residual row-level policies.';

create table if not exists auth.users (
  id    uuid primary key,
  email text unique,
  created_at timestamptz not null default now()
);

comment on table auth.users is
  'Minimal compatibility table retained for historical foreign keys; the application uses its own signed administrator session.';

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

comment on function auth.uid() is
  'Returns the caller id from request JWT claims, or null when unauthenticated.';

-- Roles are created by the migration chain when absent and remain owned by the
-- database owner. A locked-down instance may require an administrator to create
-- the roles before applying the schema.

-- These objects are required: without auth.uid(), residual row-level policies
-- fail at query time; without auth.users, the first migration cannot create its
-- historical foreign key before a later migration removes it.
