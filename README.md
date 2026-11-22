# UNO Online

A static GitHub Pages multiplayer UNO-style card game powered by Supabase Auth, an Edge Function, Postgres, and Realtime Broadcast.

## Features
- Email/password accounts and display names
- Private 6-character room codes; 2–4 players per room
- Live lobby updates and synchronized turns
- Server-side card hands and move validation
- Number cards, Skip, Reverse, Draw Two, Wild, Wild Draw Four
- UNO call and catch, plus winner detection
- Responsive layout for desktop and mobile

## Supabase setup
The database schema and Edge Function are deployed to the Supabase project configured in `app.js`.

- Database migration: `supabase/migrations/20261122000000_create_uno_online_game_schema.sql`
- Edge Function: `supabase/functions/uno-game/index.ts`
- Function JWT verification is enabled. The function reads the Supabase secret key only from its server-side environment.

In Supabase Dashboard, open **Realtime → Settings** and turn **Allow public access** off to enforce the private-channel authorization policy. The client subscribes to `uno:<game-uuid>`; the SQL policy only allows a signed-in room member to receive broadcasts. Broadcasts contain only a notification, never cards or game state.

For GitHub Pages, open **Settings → Pages**, choose **Deploy from a branch**, select **main** and **/(root)**, then save.

## Game rules
The game uses a standard 108-card deck and deals seven cards to each player. A player must match the current color or the top card's value, or play a Wild. After drawing, the player may play only the card just drawn if it is legal, or pass. Draw cards do not stack. Wild Draw Four is checked server-side and can only be played when the player has no card matching the current color. UNO must be called after reaching one card; the next player can catch an uncalled UNO for a two-card penalty.

## Security notes
Only the Supabase publishable key is present in the static client. The database has RLS enabled; clients cannot read game rows or write hands. The Edge Function authenticates the current user and performs privileged game operations server-side. Never add a Supabase secret or service-role key to this repository.
