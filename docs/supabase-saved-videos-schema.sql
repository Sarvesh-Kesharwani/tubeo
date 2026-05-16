-- Run this in the existing TodoTrails Supabase project.
-- It only creates Tubeo-owned, tubeo_-prefixed objects.

create table if not exists public.tubeo_saved_videos (
  owner_key text primary key,
  user_email text not null,
  user_name text,
  videos jsonb not null default '[]'::jsonb,
  videos_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_tubeo_saved_videos_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tubeo_saved_videos_updated_at on public.tubeo_saved_videos;
create trigger tubeo_saved_videos_updated_at
before update on public.tubeo_saved_videos
for each row
execute function public.set_tubeo_saved_videos_updated_at();

alter table public.tubeo_saved_videos enable row level security;

revoke all on public.tubeo_saved_videos from anon;
revoke all on public.tubeo_saved_videos from authenticated;
grant select, insert, update, delete on public.tubeo_saved_videos to service_role;
