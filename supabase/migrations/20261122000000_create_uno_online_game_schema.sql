create table public.uno_games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  version integer not null default 0,
  state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.uno_game_players (
  game_id uuid not null references public.uno_games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  seat smallint not null check (seat between 0 and 3),
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id),
  unique (game_id, seat)
);

create index uno_game_players_user_id_idx on public.uno_game_players(user_id);
create index uno_games_room_code_idx on public.uno_games(room_code);

alter table public.uno_games enable row level security;
alter table public.uno_game_players enable row level security;

revoke all on public.uno_games from anon, authenticated;
revoke all on public.uno_game_players from anon, authenticated;
grant select on public.uno_game_players to authenticated;

create policy "Players can read their own UNO memberships"
on public.uno_game_players
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "UNO players can receive room broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.uno_game_players p
    where p.user_id = (select auth.uid())
      and ('uno:' || p.game_id::text) = (select realtime.topic())
  )
);
