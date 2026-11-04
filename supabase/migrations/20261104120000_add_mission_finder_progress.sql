-- ミッション・ファインダーの進み具合（何人が、どの問いまで進んだか）を数える。
-- 答えの中身は持たない。1回の利用（run）ごとに、いちばん先まで進んだ問いと、PDF保存・コピーをしたかだけを残す。

create table if not exists public.neulog_mission_runs (
  run_id uuid primary key,
  visitor_hash text not null check (char_length(visitor_hash) = 64),
  furthest_step text not null check (furthest_step ~ '^[A-Za-z0-9]{1,12}$'),
  furthest_index smallint not null check (furthest_index between 0 and 99),
  ai boolean not null default false,
  saved_pdf boolean not null default false,
  copied boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists neulog_mission_runs_started_at_idx on public.neulog_mission_runs (started_at desc);

alter table public.neulog_mission_runs enable row level security;
revoke all on table public.neulog_mission_runs from anon, authenticated;
grant select, insert, update on table public.neulog_mission_runs to service_role;

-- 進んだ分だけ記録する（戻っても減らさない）。別の人の run_id は上書きしない
create or replace function public.neulog_record_mission_progress(
  p_run uuid,
  p_visitor text,
  p_step text,
  p_index integer,
  p_ai boolean,
  p_event text
) returns void
language sql
set search_path = public
as $$
  insert into public.neulog_mission_runs as r (run_id, visitor_hash, furthest_step, furthest_index, ai, saved_pdf, copied)
  values (p_run, p_visitor, p_step, p_index, coalesce(p_ai, false), coalesce(p_event = 'pdf', false), coalesce(p_event = 'copy', false))
  on conflict (run_id) do update set
    furthest_step = case when excluded.furthest_index > r.furthest_index then excluded.furthest_step else r.furthest_step end,
    furthest_index = greatest(r.furthest_index, excluded.furthest_index),
    ai = r.ai or excluded.ai,
    saved_pdf = r.saved_pdf or excluded.saved_pdf,
    copied = r.copied or excluded.copied,
    updated_at = now()
  where r.visitor_hash = excluded.visitor_hash;
$$;

revoke all on function public.neulog_record_mission_progress(uuid, text, text, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.neulog_record_mission_progress(uuid, text, text, integer, boolean, text) to service_role;

-- 記録の回数制限（1人あたり1時間）を、既存の neulog_rate_limits で数えられるようにする
alter table public.neulog_rate_limits
  drop constraint if exists neulog_rate_limits_action_check;

alter table public.neulog_rate_limits
  add constraint neulog_rate_limits_action_check
  check (action = any (array[
    'reaction'::text,
    'start_game'::text,
    'submit_score'::text,
    'visit'::text,
    'poll_vote'::text,
    'mission_ai'::text,
    'mission_ai_site'::text,
    'mission_progress'::text
  ]));
