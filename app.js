import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm";

const SUPABASE_URL = "https://xygvdcjwdwyujbojnmkm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_q2GrN1u_sqROG-KK1E8SDA_DIZ1wQjz";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const app = document.querySelector("#app");
const topbar = document.querySelector("#topbar-right");
const toast = document.querySelector("#toast");
const colorModal = document.querySelector("#color-modal");
let session = null;
let snapshot = null;
let roomChannel = null;
let watchedGameId = null;
let pendingWildCardId = null;
let authMode = "signin";
let busy = false;
let toastTimer;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
const nameOf = () => session?.user?.user_metadata?.display_name || session?.user?.email?.split("@")[0] || "Player";

function notify(message, warning = false) {
  toast.textContent = message;
  toast.className = "toast " + (warning ? "warning " : "") + "is-visible";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3600);
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll("[data-loading]").forEach((el) => { el.disabled = value; });
}
async function api(body) {
  const result = await supabase.functions.invoke("uno-game", { body });
  if (result.error) {
    let message = result.error.message || "The game server could not complete that action.";
    let status = result.error.context?.status ?? 0;
    try {
      const detail = await result.error.context?.clone?.().json();
      if (detail?.error) message = detail.error;
    } catch {}
    const error = new Error(message);
    error.status = status;
    error.code = result.error.name || "FUNCTION_ERROR";
    throw error;
  }
  if (result.data?.error) {
    const error = new Error(result.data.error);
    error.status = 400;
    throw error;
  }
  return result.data;
}
async function saveName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (!name) throw new Error("Please enter a display name.");
  const { error } = await supabase.auth.updateUser({ data: { display_name: name } });
  if (error) throw error;
  return name;
}
function renderTopbar() {
  topbar.innerHTML = session?.user
    ? '<span class="signed-in-as"><span class="online-dot"></span>' + esc(nameOf()) + '</span><button class="button button-quiet button-small" data-action="signout">Sign out</button>'
    : '<span class="topbar-note">Play with your people</span>';
}
function renderAuth(message = "") {
  snapshot = null;
  renderTopbar();
  const signup = authMode === "signup";
  app.innerHTML =
    '<section class="auth-layout">' +
      '<div class="hero-copy">' +
        '<div class="eyebrow"><span class="eyebrow-dot"></span> THE CLASSIC, TOGETHER</div>' +
        '<h1>One more card.<br><span>One more chance.</span></h1>' +
        '<p class="hero-description">Bring your crew together for a quick game of UNO. Create a private room, share the code, and let the colors fly.</p>' +
        '<div class="hero-pills"><span><i class="mini-dot red"></i> 2–4 players</span><span><i class="mini-dot yellow"></i> Live multiplayer</span><span><i class="mini-dot green"></i> Private rooms</span></div>' +
        '<div class="hero-card-stack" aria-hidden="true"><div class="stack-card stack-blue"><span>7</span></div><div class="stack-card stack-yellow"><span>↻</span></div><div class="stack-card stack-red"><span>+2</span></div></div>' +
      '</div>' +
      '<section class="panel auth-panel">' +
        '<div class="panel-kicker">YOUR GAME STARTS HERE</div>' +
        '<h2>' + (signup ? "Create your account" : "Welcome back") + '</h2>' +
        '<p class="panel-subtitle">' + (signup ? "Make an account to play with friends." : "Sign in and get back in the game.") + '</p>' +
        '<div class="auth-tabs"><button class="' + (!signup ? "active" : "") + '" data-auth-mode="signin">Sign in</button><button class="' + (signup ? "active" : "") + '" data-auth-mode="signup">Create account</button></div>' +
        (message ? '<div class="inline-notice">' + esc(message) + '</div>' : "") +
        '<form id="auth-form" class="form-stack">' +
          (signup ? '<label class="field-label" for="auth-name">Display name</label><input class="text-input" id="auth-name" name="displayName" maxlength="24" autocomplete="nickname" placeholder="What should friends call you?" required>' : "") +
          '<label class="field-label" for="auth-email">Email address</label><input class="text-input" id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>' +
          '<label class="field-label" for="auth-password">Password</label><input class="text-input" id="auth-password" name="password" type="password" minlength="6" autocomplete="' + (signup ? "new-password" : "current-password") + '" placeholder="At least 6 characters" required>' +
          '<button class="button button-primary button-full" type="submit" data-loading>' + (signup ? "Create account" : "Sign in") + ' <span class="button-arrow">→</span></button>' +
        '</form><p class="auth-footnote">Your account keeps your name and game access in sync across devices.</p>' +
      '</section>' +
    '</section>';
}
function renderDashboard() {
  renderTopbar();
  const name = esc(nameOf());
  const active = localStorage.getItem("uno-active-game");
  app.innerHTML =
    '<section class="dashboard-heading"><div><div class="eyebrow"><span class="eyebrow-dot"></span> READY WHEN YOU ARE</div><h1>Let\'s play, <span>' + name + '.</span></h1><p>Start a room or enter a friend\'s code to join their table.</p></div><div class="dashboard-stamp"><span class="stamp-top">PLAY</span><strong>UNO</strong><span class="stamp-bottom">ONLINE</span></div></section>' +
    (active ? '<button class="resume-banner" data-action="resume"><span class="resume-icon">↗</span><span><b>You\'ve got a game to return to</b><small>Pick up where you left off</small></span><span class="resume-arrow">→</span></button>' : "") +
    '<section class="room-grid">' +
      '<article class="panel room-panel create-panel"><div class="room-icon create-icon">＋</div><div class="panel-kicker">HOST A GAME</div><h2>Create a room</h2><p>Set up a private table and invite up to three friends with a room code.</p>' +
        '<form id="create-form" class="form-stack room-form"><label class="field-label" for="display-name">Your display name</label><input class="text-input" id="display-name" name="displayName" maxlength="24" value="' + name + '" required><button class="button button-primary button-full" type="submit" data-loading>Create room <span class="button-arrow">→</span></button></form>' +
      '</article>' +
      '<article class="panel room-panel join-panel"><div class="room-icon join-icon">⌁</div><div class="panel-kicker">JOIN YOUR FRIENDS</div><h2>Enter a room code</h2><p>Already have an invite? Enter the six-character code your friend shared.</p>' +
        '<form id="join-form" class="form-stack room-form"><label class="field-label" for="join-name">Your display name</label><input class="text-input" id="join-name" name="displayName" maxlength="24" value="' + name + '" required><label class="field-label" for="room-code">Room code</label><input class="text-input room-code-input" id="room-code" name="roomCode" maxlength="6" minlength="6" placeholder="ABC123" autocomplete="off" autocapitalize="characters" required><button class="button button-light button-full" type="submit" data-loading>Join room <span class="button-arrow">→</span></button></form>' +
      '</article>' +
    '</section>' +
    '<section class="how-it-works"><div><span class="step-number">01</span><span><b>Make a room</b><small>One person hosts.</small></span></div><span class="step-connector"></span><div><span class="step-number">02</span><span><b>Share the code</b><small>Friends join in.</small></span></div><span class="step-connector"></span><div><span class="step-number">03</span><span><b>Play to win</b><small>First out wins.</small></span></div></section>';
}
function renderLobby() {
  if (!snapshot) return;
  renderTopbar();
  const seats = [0, 1, 2, 3].map((seat) => snapshot.players.find((p) => p.seat === seat));
  const seatHtml = seats.map((p, index) => p
    ? '<div class="seat-card occupied"><div class="seat-avatar avatar-' + index + '">' + esc(p.displayName.slice(0, 1).toUpperCase()) + '</div><b>' + esc(p.displayName) + (p.id === session.user.id ? " (you)" : "") + '</b><span>' + (p.id === snapshot.hostId ? "HOST" : "PLAYER") + '</span></div>'
    : '<div class="seat-card empty"><div class="seat-avatar">＋</div><b>Open seat</b><span>INVITED PLAYER</span></div>'
  ).join("");
  app.innerHTML =
    '<section class="lobby-shell"><div class="lobby-heading"><button class="text-back" data-action="leave-room">← Back to home</button><div class="eyebrow"><span class="eyebrow-dot"></span> PRIVATE ROOM</div><h1>Waiting for <span>players.</span></h1><p>' + (snapshot.isHost ? "Your room is ready. Invite your friends to join the table." : "You\'re in! The host will start the game when everyone is ready.") + '</p></div>' +
      '<div class="panel lobby-panel"><div class="room-code-heading"><div><span class="panel-kicker">YOUR ROOM CODE</span><strong>' + esc(snapshot.roomCode) + '</strong></div><button class="button button-quiet button-small" data-action="copy-code">Copy code</button></div>' +
      '<div class="room-progress"><div><span>' + snapshot.players.length + ' of 4 players</span><span>' + (snapshot.players.length >= 2 ? "Ready to play" : "Waiting for one more player") + '</span></div><div class="progress-track"><span style="width:' + (snapshot.players.length * 25) + '%"></span></div></div>' +
      '<div class="seat-grid">' + seatHtml + '</div><div class="lobby-bottom"><div class="lobby-tip"><span class="tip-icon">✦</span><span>Share the code with friends. You can play with 2–4 people.</span></div>' +
      (snapshot.isHost ? '<button class="button button-primary start-button" data-action="start" data-loading ' + (snapshot.players.length < 2 ? "disabled" : "") + '>Start game <span class="button-arrow">→</span></button>' : '<div class="waiting-indicator"><span class="spinner"></span> Waiting for host</div>') +
      '</div></div></section>';
}
function labelCard(card) {
  return ({ skip: "SKIP", reverse: "↻", draw2: "+2", wild: "WILD", wild4: "+4" })[card.value] ?? card.value;
}
function canPlayCard(card, game) {
  if (!game || game.currentPlayerId !== session.user.id) return false;
  if (game.hasDrawn && game.drawnCardId !== card.id) return false;
  const top = game.discardTop;
  if (card.color !== "wild" && card.color !== game.currentColor && card.value !== top.value) return false;
  if (card.value === "wild4" && snapshot.game.myHand.some((item) => item.id !== card.id && item.color === game.currentColor)) return false;
  return true;
}
function renderCard(card, index, game) {
  const legal = canPlayCard(card, game);
  const color = card.color === "wild" ? "wild" : card.color;
  return '<button class="uno-card face ' + color + ' ' + (legal ? "playable" : "not-playable") + '" data-card-id="' + esc(card.id) + '" style="--card-index:' + index + '" ' + (legal ? "" : "disabled") + ' aria-label="' + esc(labelCard(card)) + ' card' + (legal ? ", playable" : "") + '">' +
    '<span class="card-corner card-corner-top">' + esc(labelCard(card)) + '</span><span class="card-symbol">' + esc(labelCard(card)) + '</span><span class="card-corner card-corner-bottom">' + esc(labelCard(card)) + '</span></button>';
}
function backCards(count) {
  const amount = Math.min(3, count);
  let html = '<span class="opponent-card-stack">';
  for (let i = 0; i < amount; i++) html += '<i class="mini-back back-' + i + '"></i>';
  return html + '</span>';
}
function renderGame() {
  if (!snapshot?.game) return;
  renderTopbar();
  const game = snapshot.game;
  const me = session.user.id;
  const opponents = snapshot.players.filter((p) => p.id !== me);
  const myTurn = game.currentPlayerId === me;
  const winner = game.winnerId;
  const winnerName = snapshot.players.find((p) => p.id === winner)?.displayName ?? "Someone";
  const pendingName = snapshot.players.find((p) => p.id === game.unoPendingUserId)?.displayName ?? "A player";
  const canCall = game.unoPendingUserId === me && !game.unoCalled;
  const canCatch = myTurn && game.unoPendingUserId && game.unoPendingUserId !== me && !game.unoCalled;
  const topCard = game.discardTop;
  const opponentHtml = opponents.map((p) => {
    const active = game.currentPlayerId === p.id;
    return '<div class="opponent ' + (active ? "is-active" : "") + '"><div class="opponent-avatar avatar-' + ((p.seat + 1) % 4) + '">' + esc(p.displayName.slice(0, 1).toUpperCase()) + '</div><div class="opponent-details"><b>' + esc(p.displayName) + '</b><span>' + (active ? "Their turn" : p.id === snapshot.hostId ? "Host" : "Waiting") + '</span></div><div class="opponent-cards">' + backCards(p.handCount) + '<b>' + p.handCount + '</b></div>' + (active ? '<span class="active-indicator"></span>' : "") + '</div>';
  }).join("");
  const myCards = game.myHand.map((card, i) => renderCard(card, i, game)).join("");
  const statusName = snapshot.players.find((p) => p.id === game.currentPlayerId)?.displayName ?? "Player";
  app.innerHTML =
    '<section class="game-shell"><div class="game-topline"><div class="game-room-id"><span class="live-pulse"></span><span>ROOM ' + esc(snapshot.roomCode) + '</span></div><div class="game-turn-count">TURN ' + game.turnNumber + '</div><button class="text-back" data-action="copy-code">Copy invite code</button></div>' +
      '<div class="opponents-row">' + opponentHtml + '</div>' +
      '<div class="felt-table"><div class="table-glow"></div><div class="table-status"><span class="turn-pill ' + (myTurn ? "your-turn" : "") + '">' + (myTurn ? "YOUR TURN" : esc(statusName + "\'S TURN")) + '</span><span class="current-color-label"><i class="color-dot ' + game.currentColor + '"></i> ' + game.currentColor.toUpperCase() + '</span></div>' +
        '<div class="pile-area"><div class="pile-column"><button class="uno-card back draw-pile ' + (myTurn && !game.hasDrawn && !winner ? "deck-ready" : "") + '" data-action="draw" ' + (!myTurn || game.hasDrawn || winner ? "disabled" : "") + ' aria-label="Draw a card"><span class="back-oval">UNO</span><span class="deck-label">DRAW</span></button><span class="pile-caption">DRAW PILE</span></div><div class="pile-arrow">↔</div>' +
        '<div class="pile-column"><div class="uno-card face discard-card ' + topCard.color + '" aria-label="Top card ' + esc(labelCard(topCard)) + '"><span class="card-corner card-corner-top">' + esc(labelCard(topCard)) + '</span><span class="card-symbol">' + esc(labelCard(topCard)) + '</span><span class="card-corner card-corner-bottom">' + esc(labelCard(topCard)) + '</span></div><span class="pile-caption">DISCARD PILE</span></div></div>' +
        '<div class="action-message">' + esc(game.lastAction || "Your game is on.") + '</div>' +
        (game.unoPendingUserId && !game.unoCalled && !winner ? '<div class="uno-alert">' + (canCatch ? "They forgot to call it!" : esc(pendingName) + " needs to call UNO!") + '</div>' : "") +
        (winner ? '<div class="winner-overlay"><div class="winner-confetti">✦ ✧ ✦</div><span class="panel-kicker">GAME OVER</span><h2>' + esc(winnerName) + ' wins!</h2><p>What a game. Ready for another round?</p><button class="button button-primary" data-action="leave-room" data-loading>Back to home <span class="button-arrow">→</span></button></div>' : "") +
      '</div>' +
      '<div class="player-controls"><div class="my-player-info"><div class="my-avatar">' + esc(nameOf().slice(0, 1).toUpperCase()) + '</div><div><b>' + esc(nameOf()) + ' <span>(you)</span></b><small>' + (myTurn ? "It\'s your move" : "Watching the table") + '</small></div><span class="my-card-count">' + game.myHand.length + ' <small>CARDS</small></span></div>' +
      '<div class="control-buttons">' + (canCall ? '<button class="button button-uno" data-action="call-uno">UNO!</button>' : "") + (canCatch ? '<button class="button button-catch" data-action="catch-uno">Catch UNO +2</button>' : "") + (game.hasDrawn && myTurn ? '<button class="button button-light button-small" data-action="pass">Pass turn</button>' : "") + '</div></div>' +
      '<div class="hand-heading"><span>YOUR HAND</span><small>' + (game.myHand.length === 1 ? "One card left — don\'t forget UNO!" : "Select a glowing card to play") + '</small></div><div class="hand-rail"><div class="my-hand">' + myCards + '</div></div>' +
      '<div class="game-rules-note">Match the color or number. Wild cards change the color. Wild Draw Four is only legal when you have no card matching the current color. No stacking.</div></section>';
}
function render() {
  if (!session?.user) renderAuth();
  else if (!snapshot) renderDashboard();
  else if (snapshot.status === "waiting") renderLobby();
  else renderGame();
}
async function stopWatching() {
  if (roomChannel) {
    try { await supabase.removeChannel(roomChannel); } catch {}
  }
  roomChannel = null;
  watchedGameId = null;
}
async function watchGame(gameId) {
  if (watchedGameId === gameId && roomChannel) return;
  await stopWatching();
  watchedGameId = gameId;
  await supabase.realtime.setAuth();
  roomChannel = supabase.channel("uno:" + gameId, { config: { private: true } })
    .on("broadcast", { event: "state" }, () => refreshGame())
    .on("broadcast", { event: "closed" }, () => {
      snapshot = null;
      localStorage.removeItem("uno-active-game");
      void stopWatching();
      renderDashboard();
      notify("The host closed this room.");
    })
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("Room realtime connection:", error);
        notify("Live connection interrupted. Reconnecting…", true);
      }
    });
}
async function refreshGame() {
  if (!snapshot?.gameId) return;
  try {
    snapshot = await api({ action: "get", gameId: snapshot.gameId });
    render();
  } catch (error) { notify(error.message, true); }
}
async function openRoom(room) {
  snapshot = room;
  localStorage.setItem("uno-active-game", snapshot.gameId);
  render();
  await watchGame(snapshot.gameId);
}
let restoreInProgress = false;

function renderRestoreLoading() {
  renderTopbar();
  app.innerHTML = '<section class="restore-state panel"><span class="spinner"></span><h1>Rejoining your room…</h1><p>Restoring your saved UNO game. Your room is being kept safe while we reconnect.</p></section>';
}

function renderRestoreProblem(message) {
  renderTopbar();
  app.innerHTML =
    '<section class="restore-state panel">' +
      '<div class="restore-icon">↻</div>' +
      '<div class="panel-kicker">ROOM SAVED</div>' +
      '<h1>Having trouble reconnecting.</h1>' +
      '<p>' + esc(message || "Your saved room could not be reached right now.") + '</p>' +
      '<p class="restore-note">Your room code and saved room reference have been kept. Nothing has been deleted. Try reconnecting, or explicitly close the waiting room.</p>' +
      '<div class="restore-actions"><button class="button button-primary" data-action="retry-restore" data-loading>Try again</button><button class="button button-quiet" data-action="close-saved-room" data-loading>Close room &amp; go home</button></div>' +
    '</section>';
}

async function restoreGame() {
  const id = localStorage.getItem("uno-active-game");
  if (!id || !session?.user) { renderDashboard(); return; }
  if (restoreInProgress) return;

  restoreInProgress = true;
  renderRestoreLoading();
  let lastError = null;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const restored = await api({ action: "get", gameId: id });
        if (localStorage.getItem("uno-active-game") !== id || !session?.user) return;
        await openRoom(restored);
        return;
      } catch (error) {
        lastError = error;
        if (error.status === 401 && attempt === 0) {
          try {
            const refreshed = await supabase.auth.refreshSession();
            if (refreshed.data?.session) {
              session = refreshed.data.session;
              continue;
            }
          } catch {}
        }
        const retryable = !error.status || error.status >= 500 || error.status === 408 || error.status === 429;
        if (!retryable || attempt === 3) break;
        await new Promise((resolve) => setTimeout(resolve, [400, 900, 1600][attempt]));
      }
    }
    snapshot = null;
    renderRestoreProblem(lastError?.message);
  } finally {
    restoreInProgress = false;
  }
}
async function move(type, extra = {}) {
  if (!snapshot || busy) return;
  setBusy(true);
  try {
    snapshot = await api(Object.assign({ action: "move", gameId: snapshot.gameId, type }, extra));
    render();
  } catch (error) {
    notify(error.message, true);
    await refreshGame();
  } finally { setBusy(false); }
}
function hideWildChoice() {
  pendingWildCardId = null;
  colorModal.classList.add("is-hidden");
}
app.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-auth-mode]");
  if (tab) { authMode = tab.dataset.authMode; renderAuth(); return; }
  const cardButton = event.target.closest("[data-card-id]");
  if (cardButton && snapshot?.game) {
    const cardId = cardButton.dataset.cardId;
    const card = snapshot.game.myHand.find((item) => item.id === cardId);
    if (!card || !canPlayCard(card, snapshot.game)) return;
    if (card.color === "wild") {
      pendingWildCardId = cardId;
      colorModal.classList.remove("is-hidden");
    } else await move("play", { cardId });
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled || busy) return;
  const action = button.dataset.action;
  if (action === "signout") {
    await supabase.auth.signOut();
    session = null; snapshot = null;
    localStorage.removeItem("uno-active-game");
    await stopWatching(); renderAuth();
  } else if (action === "resume" || action === "retry-restore") {
    await restoreGame();
  } else if (action === "close-saved-room") {
    const savedGameId = localStorage.getItem("uno-active-game");
    if (!savedGameId) { renderDashboard(); return; }
    setBusy(true);
    try {
      await api({ action: "leave", gameId: savedGameId });
      localStorage.removeItem("uno-active-game");
      snapshot = null;
      await stopWatching();
      renderDashboard();
      notify("Your waiting room was closed.");
    } catch (error) {
      notify(error.message || "The room could not be closed. It has been kept saved.", true);
      renderRestoreProblem(error.message);
    } finally { setBusy(false); }
  } else if (action === "copy-code") {
    if (!snapshot?.roomCode) return;
    try { await navigator.clipboard.writeText(snapshot.roomCode); notify("Room code copied."); }
    catch { notify("Your room code is " + snapshot.roomCode); }
  } else if (action === "start") {
    setBusy(true);
    try { snapshot = await api({ action: "start", gameId: snapshot.gameId }); render(); }
    catch (error) { notify(error.message, true); await refreshGame(); }
    finally { setBusy(false); }
  } else if (action === "draw") await move("draw");
  else if (action === "pass") await move("pass");
  else if (action === "call-uno") await move("call_uno");
  else if (action === "catch-uno") await move("catch_uno");
  else if (action === "leave-room") {
    if (!snapshot) return;
    setBusy(true);
    try {
      await api({ action: "leave", gameId: snapshot.gameId });
      snapshot = null;
      localStorage.removeItem("uno-active-game");
      await stopWatching(); renderDashboard();
    } catch (error) { notify(error.message, true); }
    finally { setBusy(false); }
  } else if (action === "cancel-wild") hideWildChoice();
});
colorModal.addEventListener("click", async (event) => {
  if (event.target.closest('[data-action="cancel-wild"]')) { hideWildChoice(); return; }
  const choice = event.target.closest("[data-color]");
  if (!choice || !pendingWildCardId) return;
  const cardId = pendingWildCardId;
  const color = choice.dataset.color;
  hideWildChoice();
  await move("play", { cardId, color });
});
app.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const form = event.target;
  const data = new FormData(form);
  if (form.id === "auth-form") {
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    setBusy(true);
    try {
      if (authMode === "signup") {
        const displayName = String(data.get("displayName") || "").trim();
        const result = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName.slice(0, 24) } } });
        if (result.error) throw result.error;
        if (!result.data.session) renderAuth("Account created. Check your email to confirm your address, then sign in.");
        else { session = result.data.session; renderDashboard(); }
      } else {
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        session = result.data.session;
        await restoreGame();
      }
    } catch (error) { notify(error.message || "Could not sign in.", true); }
    finally { setBusy(false); }
  } else if (form.id === "create-form") {
    setBusy(true);
    try {
      const displayName = await saveName(data.get("displayName"));
      await openRoom(await api({ action: "create", displayName }));
    } catch (error) { notify(error.message || "Could not create a room.", true); }
    finally { setBusy(false); }
  } else if (form.id === "join-form") {
    setBusy(true);
    try {
      const displayName = await saveName(data.get("displayName"));
      await openRoom(await api({ action: "join", roomCode: data.get("roomCode"), displayName }));
    } catch (error) { notify(error.message || "Could not join the room.", true); }
    finally { setBusy(false); }
  }
});
const initial = await supabase.auth.getSession();
session = initial.data.session;
renderTopbar();
if (session?.user) await restoreGame();
else renderAuth(localStorage.getItem("uno-active-game") ? "Sign in to return to your saved room. Your room has not been removed." : "");
supabase.auth.onAuthStateChange((event, nextSession) => {
  session = nextSession;
  if (event === "SIGNED_OUT" || !nextSession) {
    snapshot = null;
    void stopWatching();
    renderAuth(localStorage.getItem("uno-active-game") ? "Sign in again to return to your saved room. Your room has been kept." : "");
  } else if (event === "SIGNED_IN" && localStorage.getItem("uno-active-game") && !snapshot && !restoreInProgress) {
    void restoreGame();
  }
});
