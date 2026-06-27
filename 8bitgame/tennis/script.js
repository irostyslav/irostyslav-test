/* ---------- DOM ---------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scorePointsEl = document.getElementById('score-points');
const scoreGamesEl = document.getElementById('score-games');
const scoreSetsEl = document.getElementById('score-sets');
const serverIndicatorEl = document.getElementById('server-indicator');
const winsEl = document.getElementById('wins');
const overlayMsg = document.getElementById('overlay-msg');
const menuPanel = document.getElementById('menu-panel');
const overlayText = document.getElementById('overlay-text');

/* ---------- Constants ---------- */
const COURT_W = 480;
const COURT_H = 320;
const PADDLE_W = 10;
const PADDLE_MARGIN = 16;
const BALL_SIZE = 8;
const HITBOX_MARGIN = 6;
const PLAYER_SPEED = 220; // px/sec
const MAX_BALL_SPEED = 520; // px/sec

const PADDLE_HEIGHTS = { small: 40, normal: 56, large: 76 };
const BALL_SPEED = { slow: 200, normal: 260, fast: 330 };

const AI_PARAMS = {
  easy: { speed: 140, reactionDelayMs: 350, errorMargin: 40 },
  medium: { speed: 200, reactionDelayMs: 180, errorMargin: 22 },
  hard: { speed: 260, reactionDelayMs: 70, errorMargin: 8 },
};

/* ---------- Game state ---------- */
const STATE = {
  MENU: 'menu',
  SERVING: 'serving',
  RALLY: 'rally',
  POINT_SCORED: 'point_scored',
  GAME_OVER_GAME: 'game_over_game',
  SET_OVER: 'set_over',
  MATCH_OVER: 'match_over',
  PAUSED: 'paused',
};

let state = STATE.MENU;
let pausedFrom = null;
let pendingTimer = null;
let lastTime = 0;

const settings = {
  difficulty: 'medium',
  matchFormat: 3,
  ballSpeed: 'normal',
  paddleSize: 'normal',
  deuceRule: 'deuce',
  sound: 'on',
};

let match = null;
let checkpoint = null;

let matchesWon = Number(localStorage.getItem('tennis-matches-won') || 0);
winsEl.textContent = `WINS ${matchesWon}`;

function recordMatchWin() {
  matchesWon++;
  localStorage.setItem('tennis-matches-won', String(matchesWon));
  winsEl.textContent = `WINS ${matchesWon}`;
}

/* ---------- Input ---------- */
const dirState = { up: 0, down: 0 };
let pressCounter = 0;

function setDirActive(dir, active) {
  if (active) {
    if (!dirState[dir]) dirState[dir] = ++pressCounter;
  } else {
    dirState[dir] = 0;
  }
}

function currentDirection() {
  let best = null;
  let bestVal = 0;
  for (const d of ['up', 'down']) {
    if (dirState[d] > bestVal) {
      bestVal = dirState[d];
      best = d;
    }
  }
  return best;
}

const KEY_DIRS = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
};

/* ---------- Settings menu ---------- */
function initMenuGroups() {
  document.querySelectorAll('.menu-group').forEach((group) => {
    const key = group.dataset.setting;
    const buttons = Array.from(group.querySelectorAll('.menu-opt'));
    buttons.forEach((btn) => {
      if (btn.dataset.value === String(settings[key])) btn.classList.add('selected');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        buttons.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        settings[key] = key === 'matchFormat' ? Number(btn.dataset.value) : btn.dataset.value;
      });
    });
  });
}

/* ---------- Overlay helpers ---------- */
function hideOverlay() {
  overlayMsg.classList.remove('visible');
  menuPanel.classList.remove('visible');
  overlayText.classList.remove('visible');
}

function showMenu() {
  overlayText.innerHTML = '';
  overlayText.classList.remove('visible');
  menuPanel.classList.add('visible');
  overlayMsg.classList.add('visible');
}

function showOverlayPanel(buildFn) {
  menuPanel.classList.remove('visible');
  overlayText.innerHTML = '';
  buildFn(overlayText);
  overlayText.classList.add('visible');
  overlayMsg.classList.add('visible');
}

function showMessage(text) {
  showOverlayPanel((el) => { el.textContent = text; });
}

function showMatchOverOverlay(playerWon) {
  showOverlayPanel((el) => {
    const msg = document.createElement('p');
    msg.style.margin = '0 0 4px';
    msg.textContent = `${playerWon ? 'YOU WIN THE MATCH!' : 'AI WINS THE MATCH'}\nSETS ${match.sets.player} - ${match.sets.ai}`;
    el.appendChild(msg);

    if (checkpoint) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'menu-opt';
      retryBtn.id = 'retry-last-game-btn';
      retryBtn.textContent = 'RETRY LAST GAME';
      retryBtn.addEventListener('click', (e) => { e.stopPropagation(); retryLastGame(); });
      el.appendChild(retryBtn);
    }

    const newBtn = document.createElement('button');
    newBtn.className = 'menu-opt';
    newBtn.id = 'new-match-btn';
    newBtn.textContent = 'NEW MATCH';
    newBtn.addEventListener('click', (e) => { e.stopPropagation(); startNewMatch(); });
    el.appendChild(newBtn);
  });
}

/* ---------- Sound ---------- */
let audioCtx = null;

function playSound(type) {
  if (settings.sound === 'off') return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = type === 'hit' ? 440 : type === 'wall' ? 300 : 220;
    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  } catch (e) {
    // Web Audio unavailable; sound is a non-essential enhancement.
  }
}

/* ---------- Entities & physics ---------- */
let paddleP, paddleA, ball;
let aiTargetY = 0;
let aiReactTimer = 0;

function initEntities() {
  const h = PADDLE_HEIGHTS[settings.paddleSize];
  paddleP = { x: PADDLE_MARGIN, y: COURT_H / 2 - h / 2, w: PADDLE_W, h };
  paddleA = { x: COURT_W - PADDLE_MARGIN - PADDLE_W, y: COURT_H / 2 - h / 2, w: PADDLE_W, h };
  ball = { x: COURT_W / 2, y: COURT_H / 2, vx: 0, vy: 0, size: BALL_SIZE };
}

function resetRallyPositions() {
  paddleP.y = COURT_H / 2 - paddleP.h / 2;
  paddleA.y = COURT_H / 2 - paddleA.h / 2;
  const serverPaddle = match.server === 'player' ? paddleP : paddleA;
  ball.x = match.server === 'player'
    ? serverPaddle.x + serverPaddle.w + 4
    : serverPaddle.x - ball.size - 4;
  ball.y = serverPaddle.y + serverPaddle.h / 2 - ball.size / 2;
  ball.vx = 0;
  ball.vy = 0;
  aiReactTimer = 0;
  aiTargetY = paddleA.y + paddleA.h / 2;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function movePlayer(dt) {
  const dir = currentDirection();
  if (!dir) return;
  const delta = (dir === 'up' ? -1 : 1) * PLAYER_SPEED * dt;
  paddleP.y = clamp(paddleP.y + delta, 0, COURT_H - paddleP.h);
}

function moveAI(dt) {
  const params = AI_PARAMS[match.settingsSnapshot.difficulty];
  aiReactTimer -= dt * 1000;
  if (aiReactTimer <= 0) {
    aiReactTimer = params.reactionDelayMs;
    aiTargetY = ball.y + (Math.random() * 2 - 1) * params.errorMargin;
  }
  const center = paddleA.y + paddleA.h / 2;
  const dy = aiTargetY - center;
  const maxStep = params.speed * dt;
  if (Math.abs(dy) <= maxStep) paddleA.y = aiTargetY - paddleA.h / 2;
  else paddleA.y += Math.sign(dy) * maxStep;
  paddleA.y = clamp(paddleA.y, 0, COURT_H - paddleA.h);
}

function moveBall(dt) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  if (ball.y <= 0) {
    ball.y = 0;
    ball.vy *= -1;
    playSound('wall');
  } else if (ball.y >= COURT_H - ball.size) {
    ball.y = COURT_H - ball.size;
    ball.vy *= -1;
    playSound('wall');
  }
}

function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function expandedPaddleRect(p) {
  return { x: p.x - HITBOX_MARGIN, y: p.y - HITBOX_MARGIN, w: p.w + HITBOX_MARGIN * 2, h: p.h + HITBOX_MARGIN * 2 };
}

function bounceOffPaddle(paddle, dirSign) {
  const center = paddle.y + paddle.h / 2;
  const offset = clamp((ball.y + ball.size / 2 - center) / (paddle.h / 2), -1, 1);
  const speed = Math.min(Math.hypot(ball.vx, ball.vy) * 1.05, MAX_BALL_SPEED);
  const angle = offset * 0.5;
  ball.vx = Math.cos(angle) * speed * dirSign;
  ball.vy = Math.sin(angle) * speed + offset * 40;
  ball.x = dirSign === 1 ? paddle.x + paddle.w + 1 : paddle.x - ball.size - 1;
  playSound('hit');
}

function checkPaddleCollisions() {
  const ballRect = { x: ball.x, y: ball.y, w: ball.size, h: ball.size };
  if (ball.vx < 0 && aabbOverlap(ballRect, expandedPaddleRect(paddleP))) {
    bounceOffPaddle(paddleP, 1);
  } else if (ball.vx > 0 && aabbOverlap(ballRect, expandedPaddleRect(paddleA))) {
    bounceOffPaddle(paddleA, -1);
  }
}

function checkScoring() {
  if (ball.x + ball.size < 0) awardPoint('ai');
  else if (ball.x > COURT_W) awardPoint('player');
}

/* ---------- Scoring ---------- */
function pointName(n) {
  return ['0', '15', '30', '40'][Math.min(n, 3)];
}

function pointLabel() {
  const { player, ai } = match.points;
  if (match.settingsSnapshot.deuceRule === 'deuce' && player >= 3 && ai >= 3) {
    if (player === ai) return 'DEUCE';
    return player > ai ? 'AD - YOU' : 'AD - AI';
  }
  return `${pointName(player)} - ${pointName(ai)}`;
}

function updateHud() {
  if (!match) return;
  scorePointsEl.textContent = pointLabel();
  scoreGamesEl.textContent = `GAMES ${match.games.player}-${match.games.ai}`;
  scoreSetsEl.textContent = `SETS ${match.sets.player}-${match.sets.ai}`;
  serverIndicatorEl.textContent = `SERVE: ${match.server === 'player' ? 'YOU' : 'AI'}`;
}

function awardPoint(side) {
  if (state !== STATE.RALLY) return;
  playSound('score');
  match.points[side]++;
  const other = side === 'player' ? 'ai' : 'player';
  const p = match.points[side];
  const o = match.points[other];
  const gameWon = match.settingsSnapshot.deuceRule === 'sudden'
    ? p >= 4
    : p >= 4 && p - o >= 2;

  if (gameWon) {
    winGame(side);
  } else {
    state = STATE.POINT_SCORED;
    updateHud();
    showMessage(pointLabel());
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      enterServing();
    }, 900);
  }
}

function isSetWon() {
  const { player, ai } = match.games;
  const max = Math.max(player, ai);
  if (max < 4) return false;
  if (Math.abs(player - ai) >= 2) return true;
  return max >= 5;
}

function isMatchWon() {
  return match.sets.player >= match.setsToWin || match.sets.ai >= match.setsToWin;
}

function winGame(side) {
  match.games[side]++;
  state = STATE.GAME_OVER_GAME;
  updateHud();
  showMessage(`GAME ${side === 'player' ? 'YOU' : 'AI'}\nGAMES ${match.games.player} - ${match.games.ai}`);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    advanceGame();
  }, 1600);
}

function advanceGame() {
  if (isSetWon()) {
    advanceSet();
    return;
  }
  const gamesPlayed = match.games.player + match.games.ai;
  match.points = { player: 0, ai: 0 };
  match.server = match.server === 'player' ? 'ai' : 'player';
  if (gamesPlayed >= 2) captureCheckpoint();
  enterServing();
}

function advanceSet() {
  const winnerSide = match.games.player > match.games.ai ? 'player' : 'ai';
  match.sets[winnerSide]++;
  match.games = { player: 0, ai: 0 };
  match.points = { player: 0, ai: 0 };
  updateHud();

  if (isMatchWon()) {
    enterMatchOver();
    return;
  }

  state = STATE.SET_OVER;
  showMessage(`SET ${winnerSide === 'player' ? 'YOU' : 'AI'}\nSETS ${match.sets.player} - ${match.sets.ai}`);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    match.server = match.server === 'player' ? 'ai' : 'player';
    captureCheckpoint();
    enterServing();
  }, 2200);
}

function enterMatchOver() {
  state = STATE.MATCH_OVER;
  const playerWon = match.sets.player > match.sets.ai;
  if (playerWon) recordMatchWin();
  showMatchOverOverlay(playerWon);
}

/* ---------- Checkpoint / match lifecycle ---------- */
function captureCheckpoint() {
  checkpoint = {
    sets: { ...match.sets },
    games: { ...match.games },
    server: match.server,
    setsToWin: match.setsToWin,
    settingsSnapshot: { ...match.settingsSnapshot },
  };
}

function enterServing() {
  state = STATE.SERVING;
  resetRallyPositions();
  hideOverlay();
  updateHud();
}

function startMatch() {
  match = {
    sets: { player: 0, ai: 0 },
    games: { player: 0, ai: 0 },
    points: { player: 0, ai: 0 },
    server: 'player',
    setsToWin: Math.ceil(settings.matchFormat / 2),
    settingsSnapshot: { ...settings },
  };
  checkpoint = null;
  initEntities();
  enterServing();
}

function retryLastGame() {
  if (!checkpoint) return;
  match = {
    sets: { ...checkpoint.sets },
    games: { ...checkpoint.games },
    points: { player: 0, ai: 0 },
    server: checkpoint.server,
    setsToWin: checkpoint.setsToWin,
    settingsSnapshot: { ...checkpoint.settingsSnapshot },
  };
  initEntities();
  enterServing();
}

function startNewMatch() {
  checkpoint = null;
  match = null;
  state = STATE.MENU;
  showMenu();
}

function hardReset() {
  clearTimeout(pendingTimer);
  pendingTimer = null;
  checkpoint = null;
  match = null;
  state = STATE.MENU;
  showMenu();
}

function launchServe() {
  if (state !== STATE.SERVING) return;
  const speed = BALL_SPEED[match.settingsSnapshot.ballSpeed];
  const dirSign = match.server === 'player' ? 1 : -1;
  const angle = Math.random() * 0.6 - 0.3;
  ball.vx = Math.cos(angle) * speed * dirSign;
  ball.vy = Math.sin(angle) * speed;
  state = STATE.RALLY;
}

function togglePause() {
  if (state === STATE.RALLY || state === STATE.SERVING) {
    pausedFrom = state;
    state = STATE.PAUSED;
    showMessage('PAUSED\nPRESS P TO RESUME');
  } else if (state === STATE.PAUSED) {
    hideOverlay();
    state = pausedFrom;
  }
}

function handlePrimaryAction() {
  if (state === STATE.MENU) startMatch();
  else if (state === STATE.SERVING) launchServe();
}

/* ---------- Update / draw / loop ---------- */
function update(dt) {
  if (state === STATE.SERVING || state === STATE.RALLY) {
    movePlayer(dt);
    moveAI(dt);
  }
  if (state === STATE.RALLY) {
    moveBall(dt);
    checkPaddleCollisions();
    checkScoring();
  }
}

function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, COURT_W, COURT_H);

  ctx.strokeStyle = '#fff';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(COURT_W / 2, 0);
  ctx.lineTo(COURT_W / 2, COURT_H);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#fff';
  ctx.fillRect(paddleP.x, paddleP.y, paddleP.w, paddleP.h);
  ctx.fillRect(paddleA.x, paddleA.y, paddleA.w, paddleA.h);
  ctx.fillRect(ball.x, ball.y, ball.size, ball.size);
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

/* ---------- Input bindings ---------- */
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    togglePause();
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    hardReset();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    handlePrimaryAction();
    return;
  }
  const dir = KEY_DIRS[e.key];
  if (dir) {
    e.preventDefault();
    setDirActive(dir, true);
  }
});

window.addEventListener('keyup', (e) => {
  const dir = KEY_DIRS[e.key];
  if (dir) setDirActive(dir, false);
});

overlayMsg.addEventListener('click', handlePrimaryAction);

canvas.addEventListener('click', () => { if (state === STATE.SERVING) launchServe(); });
canvas.addEventListener('touchstart', (e) => {
  if (state === STATE.SERVING) {
    e.preventDefault();
    launchServe();
  }
}, { passive: false });

const DPAD_DIRS = { 'btn-up': 'up', 'btn-down': 'down' };

Object.keys(DPAD_DIRS).forEach((id) => {
  const btn = document.getElementById(id);
  const dir = DPAD_DIRS[id];
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); setDirActive(dir, true); }, { passive: false });
  btn.addEventListener('touchend', (e) => { e.preventDefault(); setDirActive(dir, false); }, { passive: false });
  btn.addEventListener('touchcancel', (e) => { e.preventDefault(); setDirActive(dir, false); }, { passive: false });
  btn.addEventListener('mousedown', () => setDirActive(dir, true));
  btn.addEventListener('mouseup', () => setDirActive(dir, false));
  btn.addEventListener('mouseleave', () => setDirActive(dir, false));
});

/* ---------- Init ---------- */
initMenuGroups();
initEntities();
showMenu();
requestAnimationFrame((t) => { lastTime = t; requestAnimationFrame(loop); });
