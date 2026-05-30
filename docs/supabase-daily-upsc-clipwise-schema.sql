create table if not exists public.tubeo_daily_upsc_clipwise_tbl (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  user_email text not null,
  user_name text,
  video_id text not null,
  video_link text not null,
  video_name text not null,
  category text not null check (category in ('upsc', 'clipwise')),
  marked_completed boolean not null default false,
  completed_at timestamptz,
  llm_summary_generated boolean not null default false,
  llm_summary jsonb,
  llm_summary_raw text,
  llm_prompt_hash text,
  llm_generated_at timestamptz,
  summary_date date,
  clipwise_progress jsonb not null default '{}'::jsonb,
  source_url text,
  thumbnail text,
  duration_sec integer not null default 0,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_key, category, video_id)
);

create index if not exists tubeo_daily_upsc_clipwise_owner_category_idx
on public.tubeo_daily_upsc_clipwise_tbl (owner_key, category);

create index if not exists tubeo_daily_upsc_clipwise_summary_date_idx
on public.tubeo_daily_upsc_clipwise_tbl (owner_key, summary_date)
where summary_date is not null;

create or replace function public.set_tubeo_daily_upsc_clipwise_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tubeo_daily_upsc_clipwise_updated_at on public.tubeo_daily_upsc_clipwise_tbl;
create trigger tubeo_daily_upsc_clipwise_updated_at
before update on public.tubeo_daily_upsc_clipwise_tbl
for each row
execute function public.set_tubeo_daily_upsc_clipwise_updated_at();

alter table public.tubeo_daily_upsc_clipwise_tbl enable row level security;

revoke all on public.tubeo_daily_upsc_clipwise_tbl from anon;
revoke all on public.tubeo_daily_upsc_clipwise_tbl from authenticated;
grant select, insert, update, delete on public.tubeo_daily_upsc_clipwise_tbl to service_role;
