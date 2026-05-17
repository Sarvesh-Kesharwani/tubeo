-- Run this in the existing TodoTrails Supabase project.
-- Creates the Tubeo News state (per-user prompt + summaries) and the shared
-- raw HTML cache that the daily cron writes into.

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
