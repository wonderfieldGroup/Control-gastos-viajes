begin;

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('USER_CREATED','USER_UPDATED','USER_ACTIVATED','USER_DEACTIVATED','PASSWORD_RESET','PASSWORD_CHANGED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from anon, authenticated;

create index if not exists admin_audit_log_target_created_idx
  on public.admin_audit_log (target_user_id, created_at desc);

commit;
