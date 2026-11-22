create policy "No direct client access to UNO game state"
on public.uno_games
for select
to anon, authenticated
using (false);
