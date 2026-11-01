-- ミッション・ファインダー（neulog-mission）のAI利用回数を、既存の neulog_rate_limits で数えられるようにする。
--   mission_ai      : 1人あたりの1日の回数
--   mission_ai_site : サイト全体の1日の回数

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
    'mission_ai_site'::text
  ]));
