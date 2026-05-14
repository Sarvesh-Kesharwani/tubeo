create table if not exists public.tubeo_user_sync_state (
  owner_key text primary key,
  user_email text not null,
  user_name text,
  state jsonb not null,
  state_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_tubeo_user_sync_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tubeo_user_sync_state_updated_at on public.tubeo_user_sync_state;
create trigger tubeo_user_sync_state_updated_at
before update on public.tubeo_user_sync_state
for each row
execute function public.set_tubeo_user_sync_state_updated_at();

alter table public.tubeo_user_sync_state enable row level security;

revoke all on public.tubeo_user_sync_state from anon;
revoke all on public.tubeo_user_sync_state from authenticated;
