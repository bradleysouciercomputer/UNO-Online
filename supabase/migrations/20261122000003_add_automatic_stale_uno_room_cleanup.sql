create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres;

create or replace function private.cleanup_stale_uno_rooms()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  deleted_empty_waiting integer := 0;
  deleted_waiting integer := 0;
  deleted_playing integer := 0;
  deleted_finished integer := 0;
  deleted_cron_history integer := 0;
begin
  delete from public.uno_games g
  where g.status = 'waiting'
    and g.updated_at < now() - interval '10 minutes'
    and not exists (
      select 1 from public.uno_game_players p where p.game_id = g.id
    );
  get diagnostics deleted_empty_waiting = row_count;

  delete from public.uno_games
  where status = 'waiting'
    and updated_at < now() - interval '12 hours';
  get diagnostics deleted_waiting = row_count;

  delete from public.uno_games
  where status = 'playing'
    and updated_at < now() - interval '14 days';
  get diagnostics deleted_playing = row_count;

  delete from public.uno_games
  where status = 'finished'
    and updated_at < now() - interval '7 days';
  get diagnostics deleted_finished = row_count;

  delete from cron.job_run_details
  where end_time < now() - interval '14 days';
  get diagnostics deleted_cron_history = row_count;

  return jsonb_build_object(
    'deleted_empty_waiting', deleted_empty_waiting,
    'deleted_waiting', deleted_waiting,
    'deleted_playing', deleted_playing,
    'deleted_finished', deleted_finished,
    'deleted_cron_history', deleted_cron_history
  );
end;
$$;

revoke all on function private.cleanup_stale_uno_rooms() from public, anon, authenticated;
grant execute on function private.cleanup_stale_uno_rooms() to postgres;

select cron.schedule(
  'uno-stale-room-cleanup',
  '*/15 * * * *',
  'select private.cleanup_stale_uno_rooms();'
);
