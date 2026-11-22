import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const PUBLISHABLE_KEY = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SECRET_KEY = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const COLORS = ["red", "yellow", "green", "blue"] as const;
type Color = typeof COLORS[number];
type Card = { id: string; color: Color | "wild"; value: string };
type GameState = {
  playerIds: string[];
  hands: Record<string, Card[]>;
  drawPile: Card[];
  discardPile: Card[];
  turnIndex: number;
  direction: 1 | -1;
  currentColor: Color;
  drawnCardId: string | null;
  unoPending: string | null;
  unoCalled: boolean;
  winnerId: string | null;
  lastAction: string;
  lastPlayerId: string | null;
  turnNumber: number;
};

class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const color of COLORS) {
    deck.push({ id: crypto.randomUUID(), color, value: "0" });
    for (let n = 1; n <= 9; n++) {
      deck.push({ id: crypto.randomUUID(), color, value: String(n) });
      deck.push({ id: crypto.randomUUID(), color, value: String(n) });
    }
    for (const value of ["skip", "reverse", "draw2"]) {
      deck.push({ id: crypto.randomUUID(), color, value });
      deck.push({ id: crypto.randomUUID(), color, value });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: crypto.randomUUID(), color: "wild", value: "wild" });
    deck.push({ id: crypto.randomUUID(), color: "wild", value: "wild4" });
  }
  return shuffle(deck);
}

function newGameState(players: { user_id: string }[]): GameState {
  const deck = newDeck();
  const playerIds = players.map((player) => player.user_id);
  const hands: Record<string, Card[]> = {};
  for (const id of playerIds) hands[id] = [];
  for (let round = 0; round < 7; round++) {
    for (const id of playerIds) hands[id].push(deck.pop()!);
  }
  const firstNumber = deck.findIndex((card) => card.value.match(/^\d$/));
  const first = deck.splice(firstNumber, 1)[0];
  return {
    playerIds,
    hands,
    drawPile: deck,
    discardPile: [first],
    turnIndex: 0,
    direction: 1,
    currentColor: first.color as Color,
    drawnCardId: null,
    unoPending: null,
    unoCalled: false,
    winnerId: null,
    lastAction: "The game has started. Good luck!",
    lastPlayerId: null,
    turnNumber: 1,
  };
}

function currentPlayerId(state: GameState): string {
  return state.playerIds[state.turnIndex];
}

function advance(state: GameState, steps = 1) {
  const size = state.playerIds.length;
  state.turnIndex = (state.turnIndex + state.direction * steps + size * 2) % size;
  state.drawnCardId = null;
  state.turnNumber++;
}

function drawOne(state: GameState, userId: string): Card | null {
  if (state.drawPile.length === 0 && state.discardPile.length > 1) {
    const top = state.discardPile.pop()!;
    state.drawPile = shuffle(state.discardPile.splice(0));
    state.discardPile = [top];
  }
  const card = state.drawPile.pop() ?? null;
  if (card) state.hands[userId].push(card);
  return card;
}

function drawMany(state: GameState, userId: string, amount: number) {
  for (let i = 0; i < amount; i++) {
    if (!drawOne(state, userId)) break;
  }
}

function cardName(card: Card): string {
  const color = card.color === "wild" ? "Wild" : card.color[0].toUpperCase() + card.color.slice(1);
  const value = ({ skip: "Skip", reverse: "Reverse", draw2: "Draw Two", wild: "Wild", wild4: "Wild Draw Four" } as Record<string, string>)[card.value] ?? card.value;
  return card.color === "wild" ? value : color + " " + value;
}

function isPlayable(card: Card, top: Card, color: Color): boolean {
  return card.color === "wild" || card.color === color || card.value === top.value;
}

async function getPlayers(gameId: string) {
  const { data, error } = await admin
    .from("uno_game_players")
    .select("user_id, display_name, seat")
    .eq("game_id", gameId)
    .order("seat");
  if (error) throw new ApiError("Could not load the room players.", 500);
  return data ?? [];
}

async function getGameForPlayer(gameId: string, userId: string) {
  const { data: membership, error: memberError } = await admin
    .from("uno_game_players")
    .select("game_id")
    .eq("game_id", gameId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memberError || !membership) throw new ApiError("You are not a member of this room.", 403);

  const { data: game, error } = await admin
    .from("uno_games")
    .select("id, room_code, host_id, status, version, state")
    .eq("id", gameId)
    .maybeSingle();
  if (error || !game) throw new ApiError("This room no longer exists.", 404);
  return game;
}

function makeSnapshot(game: any, players: any[], userId: string) {
  const state = game.state as GameState | null;
  const hands = state?.hands ?? {};
  return {
    gameId: game.id,
    roomCode: game.room_code,
    hostId: game.host_id,
    status: game.status,
    version: game.version,
    isHost: game.host_id === userId,
    players: players.map((player) => ({
      id: player.user_id,
      displayName: player.display_name,
      seat: player.seat,
      handCount: hands[player.user_id]?.length ?? 0,
    })),
    game: state ? {
      myHand: hands[userId] ?? [],
      discardTop: state.discardPile[state.discardPile.length - 1],
      currentColor: state.currentColor,
      currentPlayerId: currentPlayerId(state),
      direction: state.direction,
      hasDrawn: currentPlayerId(state) === userId && state.drawnCardId !== null,
      drawnCardId: currentPlayerId(state) === userId ? state.drawnCardId : null,
      unoPendingUserId: state.unoPending,
      unoCalled: state.unoCalled,
      winnerId: state.winnerId,
      lastAction: state.lastAction,
      lastPlayerId: state.lastPlayerId,
      turnNumber: state.turnNumber,
    } : null,
  };
}

async function broadcast(gameId: string, event = "state") {
  const channel = admin.channel("uno:" + gameId, { config: { private: true } });
  try {
    await channel.send({
      type: "broadcast",
      event,
      payload: { changedAt: Date.now() },
    });
  } catch (error) {
    console.error("Realtime broadcast failed:", error);
  } finally {
    try { await admin.removeChannel(channel); } catch { /* no-op */ }
  }
}

async function saveState(game: any, state: GameState, status = "playing") {
  const { data, error } = await admin
    .from("uno_games")
    .update({
      state,
      status,
      version: game.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", game.id)
    .eq("version", game.version)
    .eq("status", "playing")
    .select("id, version")
    .maybeSingle();

  if (error) throw new ApiError("The move could not be saved. Please retry.", 500);
  if (!data) throw new ApiError("The game changed at the same time. Refreshing the latest move; please try again.", 409);
}

function cleanName(value: unknown, fallback: string): string {
  const name = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  return name || fallback.slice(0, 24) || "Player";
}

async function handleAction(body: any, user: any) {
  const gameId = String(body.gameId ?? "");
  if (!gameId) throw new ApiError("A game ID is required.");
  const game = await getGameForPlayer(gameId, user.id);
  if (game.status !== "playing" || !game.state) throw new ApiError("This game has not started.");
  const state = structuredClone(game.state) as GameState;
  const type = String(body.type ?? "");
  const players = await getPlayers(gameId);

  if (type === "call_uno") {
    if (state.unoPending !== user.id || state.unoCalled) {
      throw new ApiError("There is no UNO call waiting for you.");
    }
    state.unoCalled = true;
    state.lastAction = "UNO!";
    state.lastPlayerId = user.id;
    await saveState(game, state);
    await broadcast(gameId);
    return makeSnapshot({ ...game, state, version: game.version + 1 }, players, user.id);
  }

  if (type === "catch_uno") {
    if (currentPlayerId(state) !== user.id) throw new ApiError("Only the player whose turn it is can catch UNO.");
    if (!state.unoPending || state.unoPending === user.id || state.unoCalled) {
      throw new ApiError("There is no uncaught UNO call right now.");
    }
    const caughtId = state.unoPending;
    drawMany(state, caughtId, 2);
    const caughtName = players.find((p) => p.user_id === caughtId)?.display_name ?? "A player";
    state.unoPending = null;
    state.unoCalled = false;
    state.lastAction = caughtName + " was caught without calling UNO and drew 2 cards.";
    state.lastPlayerId = user.id;
    await saveState(game, state);
    await broadcast(gameId);
    return makeSnapshot({ ...game, state, version: game.version + 1 }, players, user.id);
  }

  if (currentPlayerId(state) !== user.id) throw new ApiError("It is not your turn.");
  if (state.unoPending === user.id && !state.unoCalled) {
    throw new ApiError("Call UNO before taking another turn.");
  }
  if (state.unoPending && state.unoPending !== user.id) {
    if (!state.unoCalled) drawMany(state, state.unoPending, 2);
    state.unoPending = null;
    state.unoCalled = false;
  }

  const top = state.discardPile[state.discardPile.length - 1];
  const playerName = players.find((p) => p.user_id === user.id)?.display_name ?? "Player";

  if (type === "draw") {
    if (state.drawnCardId) throw new ApiError("You have already drawn. Play that card if legal, or pass.");
    const card = drawOne(state, user.id);
    if (card) {
      state.drawnCardId = card.id;
      state.lastAction = playerName + " drew a card.";
    } else {
      advance(state);
      state.lastAction = playerName + " could not draw and passed.";
    }
    state.lastPlayerId = user.id;
  } else if (type === "pass") {
    if (!state.drawnCardId) throw new ApiError("Draw a card before passing.");
    state.lastAction = playerName + " passed.";
    state.lastPlayerId = user.id;
    advance(state);
  } else if (type === "play") {
    const cardId = String(body.cardId ?? "");
    const hand = state.hands[user.id] ?? [];
    const cardIndex = hand.findIndex((item) => item.id === cardId);
    if (cardIndex < 0) throw new ApiError("That card is not in your hand.");
    const card = hand[cardIndex];
    if (state.drawnCardId && state.drawnCardId !== card.id) {
      throw new ApiError("After drawing, you may only play the card you just drew.");
    }
    if (!isPlayable(card, top, state.currentColor)) throw new ApiError("That card does not match the color or symbol on the pile.");
    if (card.value === "wild4" && hand.some((item) => item.id !== card.id && item.color === state.currentColor)) {
      throw new ApiError("You can only play Wild Draw Four when you have no card of the current color.");
    }

    let chosenColor: Color | null = null;
    if (card.color === "wild") {
      chosenColor = COLORS.includes(body.color) ? body.color : null;
      if (!chosenColor) throw new ApiError("Choose a color for your wild card.");
    }

    hand.splice(cardIndex, 1);
    state.discardPile.push(card);
    state.currentColor = chosenColor ?? card.color as Color;
    state.drawnCardId = null;
    state.lastAction = playerName + " played " + cardName(card) + (chosenColor ? " and chose " + chosenColor + "." : ".");
    state.lastPlayerId = user.id;

    if (hand.length === 0) {
      state.winnerId = user.id;
      state.unoPending = null;
      state.unoCalled = false;
      await saveState(game, state, "finished");
      await broadcast(gameId);
      return makeSnapshot({ ...game, state, status: "finished", version: game.version + 1 }, players, user.id);
    }

    if (hand.length === 1) {
      state.unoPending = user.id;
      state.unoCalled = false;
    }

    if (card.value === "skip") {
      advance(state, 2);
    } else if (card.value === "reverse") {
      state.direction = state.direction === 1 ? -1 : 1;
      advance(state, state.playerIds.length === 2 ? 2 : 1);
    } else if (card.value === "draw2" || card.value === "wild4") {
      const target = state.playerIds[(state.turnIndex + state.direction + state.playerIds.length) % state.playerIds.length];
      drawMany(state, target, card.value === "draw2" ? 2 : 4);
      advance(state, 2);
    } else {
      advance(state);
    }
  } else {
    throw new ApiError("Unknown game action.");
  }

  await saveState(game, state);
  await broadcast(gameId);
  return makeSnapshot({ ...game, state, version: game.version + 1 }, players, user.id);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Use POST for game actions." }, 405);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw new ApiError("Please sign in to play.", 401);

    const authClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) throw new ApiError("Your session is invalid. Please sign in again.", 401);

    const body = await req.json();
    const action = String(body.action ?? "");

    if (action === "create") {
      const displayName = cleanName(body.displayName, user.user_metadata?.display_name ?? user.email?.split("@")[0] ?? "Player");
      let game: any = null;
      for (let attempt = 0; attempt < 5 && !game; attempt++) {
        const roomCode = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
        const { data, error } = await admin.from("uno_games").insert({
          room_code: roomCode,
          host_id: user.id,
          status: "waiting",
        }).select("id, room_code, host_id, status, version, state").single();
        if (!error) game = data;
        else if (error.code !== "23505") throw new ApiError("Could not create the room. Please try again.", 500);
      }
      if (!game) throw new ApiError("Could not generate a room code. Please try again.", 500);
      const { error: playerError } = await admin.from("uno_game_players").insert({
        game_id: game.id,
        user_id: user.id,
        display_name: displayName,
        seat: 0,
      });
      if (playerError) {
        await admin.from("uno_games").delete().eq("id", game.id);
        throw new ApiError("Could not join the new room.", 500);
      }
      const players = await getPlayers(game.id);
      return respond(makeSnapshot(game, players, user.id));
    }

    if (action === "join") {
      const code = String(body.roomCode ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) throw new ApiError("Enter a valid 6-character room code.");
      const { data: game, error } = await admin.from("uno_games")
        .select("id, room_code, host_id, status, version, state")
        .eq("room_code", code)
        .maybeSingle();
      if (error || !game) throw new ApiError("Room not found. Check the code and try again.", 404);
      if (game.status !== "waiting") throw new ApiError("This game has already started.");
      const { data: existing } = await admin.from("uno_game_players")
        .select("user_id")
        .eq("game_id", game.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) {
        const players = await getPlayers(game.id);
        return respond(makeSnapshot(game, players, user.id));
      }

      const displayName = cleanName(body.displayName, user.user_metadata?.display_name ?? user.email?.split("@")[0] ?? "Player");
      let joined = false;
      for (let seat = 0; seat < 4; seat++) {
        const { error: insertError } = await admin.from("uno_game_players").insert({
          game_id: game.id, user_id: user.id, display_name: displayName, seat,
        });
        if (!insertError) { joined = true; break; }
        if (insertError.code === "23505") {
          const { data: memberNow } = await admin.from("uno_game_players").select("user_id")
            .eq("game_id", game.id).eq("user_id", user.id).maybeSingle();
          if (memberNow) { joined = true; break; }
          continue;
        }
        throw new ApiError("Could not join this room.", 500);
      }
      if (!joined) throw new ApiError("This room is full (4 players maximum).");
      const { data: latestGame } = await admin.from("uno_games").select("status").eq("id", game.id).single();
      if (!latestGame || latestGame.status !== "waiting") {
        await admin.from("uno_game_players").delete().eq("game_id", game.id).eq("user_id", user.id);
        throw new ApiError("The host started the game while you were joining. Please join another room.", 409);
      }
      const { data: roomBump, error: roomBumpError } = await admin.from("uno_games")
        .update({ version: game.version + 1, updated_at: new Date().toISOString() })
        .eq("id", game.id).eq("version", game.version).eq("status", "waiting")
        .select("id").maybeSingle();
      if (roomBumpError || !roomBump) {
        await admin.from("uno_game_players").delete().eq("game_id", game.id).eq("user_id", user.id);
        throw new ApiError("The room changed while you were joining. Please try the code again.", 409);
      }
      const players = await getPlayers(game.id);
      await broadcast(game.id);
      return respond(makeSnapshot({ ...game, version: game.version + 1 }, players, user.id));
    }

    if (action === "get") {
      const game = await getGameForPlayer(String(body.gameId ?? ""), user.id);
      const players = await getPlayers(game.id);
      return respond(makeSnapshot(game, players, user.id));
    }

    if (action === "start") {
      const gameId = String(body.gameId ?? "");
      const game = await getGameForPlayer(gameId, user.id);
      if (game.host_id !== user.id) throw new ApiError("Only the room host can start the game.", 403);
      if (game.status !== "waiting") throw new ApiError("This game has already started.");
      const players = await getPlayers(gameId);
      if (players.length < 2) throw new ApiError("You need at least 2 players to start.");
      const state = newGameState(players);
      const { data: updated, error: updateError } = await admin.from("uno_games")
        .update({ status: "playing", state, version: game.version + 1, updated_at: new Date().toISOString() })
        .eq("id", game.id).eq("version", game.version).eq("status", "waiting")
        .select("id").maybeSingle();
      if (updateError || !updated) throw new ApiError("The room changed while starting. Please refresh.", 409);
      await broadcast(gameId);
      return respond(makeSnapshot({ ...game, status: "playing", state, version: game.version + 1 }, players, user.id));
    }

    if (action === "leave") {
      const gameId = String(body.gameId ?? "");
      const game = await getGameForPlayer(gameId, user.id);
      if (game.status === "playing") throw new ApiError("You cannot leave while a game is in progress.");
      if (game.host_id === user.id) {
        if (game.status === "waiting") {
          const { data: deleted, error: deleteError } = await admin.from("uno_games")
            .delete().eq("id", gameId).eq("version", game.version).select("id").maybeSingle();
          if (deleteError || !deleted) throw new ApiError("The room changed before it could close. Please retry.", 409);
        } else {
          await admin.from("uno_games").delete().eq("id", gameId);
        }
        await broadcast(gameId, "closed");
      } else {
        if (game.status === "waiting") {
          const { data: bumped, error: bumpError } = await admin.from("uno_games")
            .update({ version: game.version + 1, updated_at: new Date().toISOString() })
            .eq("id", gameId).eq("version", game.version).eq("status", "waiting")
            .select("id").maybeSingle();
          if (bumpError || !bumped) throw new ApiError("The room changed while you were leaving. Please retry.", 409);
        }
        await admin.from("uno_game_players").delete().eq("game_id", gameId).eq("user_id", user.id);
        await broadcast(gameId);
      }
      return respond({ left: true });
    }

    if (action === "move") {
      const snapshot = await handleAction(body, user);
      return respond(snapshot);
    }

    throw new ApiError("Unknown request.");
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (!(error instanceof ApiError)) console.error("UNO function error:", error);
    return respond({ error: error instanceof Error ? error.message : "Something went wrong." }, status);
  }
});
