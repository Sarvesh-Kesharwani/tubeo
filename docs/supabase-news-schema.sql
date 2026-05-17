-- Run this in the existing TodoTrails Supabase project.
-- Creates the Tubeo News state (per-user prompt + summaries) and the shared
-- raw HTML cache that the daily cron writes into.
--
-- This schema does not touch existing TodoTrails tables. It creates only:
-- - public.tubeo_news_state
-- - public.tubeo_news_raw
-- - tubeo_private.news_access_tokens
--
-- If you do not use a service-role key in the app, copy the final returned
-- access_token into TUBEO_SUPABASE_NEWS_ACCESS_TOKEN and use an anon/publishable
-- key as TUBEO_SUPABASE_NEWS_KEY.

create table if not exists public.tubeo_news_state (
  owner_key text primary key,
  user_email text not null,
  user_name text,
  prompt text not null default '',
  summaries jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_tubeo_news_state_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tubeo_news_state_updated_at on public.tubeo_news_state;
create trigger tubeo_news_state_updated_at
before update on public.tubeo_news_state
for each row
execute function public.set_tubeo_news_state_updated_at();

alter table public.tubeo_news_state enable row level security;
revoke all on public.tubeo_news_state from anon;
revoke all on public.tubeo_news_state from authenticated;
grant select, insert, update, delete on public.tubeo_news_state to service_role;


-- Shared raw HTML cache, keyed by IST date (YYYY-MM-DD).
-- The daily cron writes one row per available InsightsOnIndia page.
create table if not exists public.tubeo_news_raw (
  date text primary key,
  url text not null,
  html text not null,
  fetched_at timestamptz not null default now()
);

alter table public.tubeo_news_raw enable row level security;
revoke all on public.tubeo_news_raw from anon;
revoke all on public.tubeo_news_raw from authenticated;
grant select, insert, update, delete on public.tubeo_news_raw to service_role;


-- Optional limited server access path for deployments where the service-role key
-- is unavailable. The token lives in a private schema and is checked through RLS
-- using the x-tubeo-news-token request header.
create schema if not exists tubeo_private;

create table if not exists tubeo_private.news_access_tokens (
  id text primary key,
  token text not null,
  created_at timestamptz not null default now()
);

alter table tubeo_private.news_access_tokens enable row level security;

insert into tubeo_private.news_access_tokens (id, token)
values (
  'tubeo_news_server',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (id) do nothing;

create or replace function tubeo_private.tubeo_news_access_allowed()
returns boolean
language sql
stable
security definer
set search_path = tubeo_private, pg_temp
as $$
  select exists (
    select 1
    from tubeo_private.news_access_tokens
    where id = 'tubeo_news_server'
      and token = (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-tubeo-news-token')
  );
$$;

revoke all on function tubeo_private.tubeo_news_access_allowed() from public;
grant usage on schema tubeo_private to anon;
grant execute on function tubeo_private.tubeo_news_access_allowed() to anon;

grant select, insert, update, delete on public.tubeo_news_state to anon;
grant select, insert, update, delete on public.tubeo_news_raw to anon;

drop policy if exists tubeo_news_state_server_token on public.tubeo_news_state;
create policy tubeo_news_state_server_token
on public.tubeo_news_state
for all
to anon
using (tubeo_private.tubeo_news_access_allowed())
with check (tubeo_private.tubeo_news_access_allowed());

drop policy if exists tubeo_news_raw_server_token on public.tubeo_news_raw;
create policy tubeo_news_raw_server_token
on public.tubeo_news_raw
for all
to anon
using (tubeo_private.tubeo_news_access_allowed())
with check (tubeo_private.tubeo_news_access_allowed());

select token as access_token
from tubeo_private.news_access_tokens
where id = 'tubeo_news_server';
