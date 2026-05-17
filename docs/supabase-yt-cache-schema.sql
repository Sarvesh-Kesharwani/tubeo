-- Run this in the existing TodoTrails Supabase project.
-- Persistent L2 cache for YouTube Data API responses, keyed by IST calendar
-- date so each cache entry stays valid until midnight IST. Tubeo's refresh
-- button deletes the rows for today to force a re-fetch.

create table if not exists public.tubeo_yt_cache (
  cache_key text primary key,
  path text not null,
  params jsonb not null default '{}'::jsonb,
  data jsonb not null,
  cached_date text not null,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tubeo_yt_cache_cached_date_idx
  on public.tubeo_yt_cache (cached_date);

create or replace function public.set_tubeo_yt_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tubeo_yt_cache_updated_at on public.tubeo_yt_cache;
create trigger tubeo_yt_cache_updated_at
before update on public.tubeo_yt_cache
for each row
execute function public.set_tubeo_yt_cache_updated_at();

alter table public.tubeo_yt_cache enable row level security;
revoke all on public.tubeo_yt_cache from anon;
revoke all on public.tubeo_yt_cache from authenticated;
grant select, insert, update, delete on public.tubeo_yt_cache to service_role;
