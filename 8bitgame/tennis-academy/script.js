// ---------- Canvas / court geometry ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const CANVAS_W = canvas.width;
const CANVAS_H = canvas.height;

const PX_PER_FT = 3.6;
const COURT_LEN_FT = 78, SINGLES_W_FT = 27, DOUBLES_W_FT = 36, SERVICE_LINE_FT = 21;

const courtLenPx = COURT_LEN_FT * PX_PER_FT;
const singlesWPx = SINGLES_W_FT * PX_PER_FT;
const doublesWPx = DOUBLES_W_FT * PX_PER_FT;
const serviceLinePx = SERVICE_LINE_FT * PX_PER_FT;

const centerX = CANVAS_W / 2;
const netY = CANVAS_H / 2;
const baselineTopY = netY - courtLenPx / 2;
const baselineBottomY = netY + courtLenPx / 2;
const singlesLeftX = centerX - singlesWPx / 2;
const singlesRightX = centerX + singlesWPx / 2;
const doublesLeftX = centerX - doublesWPx / 2;
const doublesRightX = centerX + doublesWPx / 2;
const serviceLineTopY = netY - serviceLinePx;
const serviceLineBottomY = netY + serviceLinePx;

const COURT_COLOR = '#2e7d32';
const RUNOFF_COLOR = '#1b5e20';
const LINE_COLOR = '#ffffff';
const NET_COLOR = '#e0e0e0';
const BALL_COLOR = '#ffeb3b';
const PLAYER_COLOR = '#42a5f5';
const AI_COLOR = '#ef5350';

// Movement bounds (allow slight runoff beyond doubles lines for realism)
const PLAYER_X_MIN = doublesLeftX - 6, PLAYER_X_MAX = doublesRightX + 6;
const PLAYER_Y_MIN = netY + 6, PLAYER_Y_MAX = CANVAS_H - 6;
const AI_X_MIN = doublesLeftX - 6, AI_X_MAX = doublesRightX + 6;
const AI_Y_MIN = 6, AI_Y_MAX = netY - 6;

const DEUCE_ZONE = { xMin: centerX + 10, xMax: singlesRightX - 5, yMin: baselineBottomY + 2, yMax: baselineBottomY + 26 };
const AD_ZONE = { xMin: singlesLeftX + 5, xMax: centerX - 10, yMin: baselineBottomY + 2, yMax: baselineBottomY + 26 };

const HIT_RADIUS = 22;
const VOLLEY_ZONE_DEPTH = 64; // distance from net considered "at net"
const SMASH_Z_THRESHOLD = 0.55;

// ---------- State machine ----------
const STATE = {
  MODE_SELECT: 'mode_select',
  TUT_INTRO: 'tut_intro',
  TUT_STEP: 'tut_step',
  TUT_DRILL_WAIT: 'tut_drill_wait',
  TUT_DRILL_PLAY: 'tut_drill_play',
  TUT_STEP_DONE: 'tut_step_done',
  TUT_COMPLETE: 'tut_complete',
  MATCH_SERVING: 'match_serving',
  MATCH_RALLY: 'match_rally',
  MATCH_POINT_END: 'match_point_end',
  MATCH_GAME_OVER: 'match_game_over',
  MATCH_SET_OVER: 'match_set_over',
  MATCH_OVER: 'match_over',
  PAUSED: 'paused',
};

let state = STATE.MODE_SELECT;
let prevStateBeforePause = null;
let pendingTimer = null;

const settings = { mode: 'tutorial', difficulty: 'medium', coachVoice: 'off' };

const AI_PARAMS = {
  easy: { speed: 95, reactionDelayMs: 260, errorMargin: 0.16 },
  medium: { speed: 130, reactionDelayMs: 160, errorMargin: 0.09 },
  hard: { speed: 175, reactionDelayMs: 80, errorMargin: 0.04 },
};

let match = null;

// ---------- Entities ----------
const playerPos = { x: centerX, y: baselineBottomY - 10 };
const aiPos = { x: centerX, y: baselineTopY + 10 };
const ball = { x: centerX, y: baselineBottomY - 10, z: 0, visible: false };

let flight = null; // {startX,startY,endX,endY,duration,elapsed,peakHeight,shotType,hitterIsPlayer,onComplete,resolved}

// ---------- Input ----------
const dirState = { up: false, down: false, left: false, right: false };
const KEY_DIRS = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};
let inputMode = 'free'; // 'free' | 'serve-only' | 'locked' | 'nav-only'

function setDirActive(dir, active) {
  if (dir) dirState[dir] = active;
}

function currentDirVector() {
  let dx = 0, dy = 0;
  if (dirState.left) dx -= 1;
  if (dirState.right) dx += 1;
  if (dirState.up) dy -= 1;
  if (dirState.down) dy += 1;
  if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }
  return { dx, dy };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

// ---------- DOM refs ----------
const overlay = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlay-msg');
const menuPanel = document.getElementById('menu-panel');
const overlayText = document.getElementById('overlay-text');
const coachTextEl = document.getElementById('coach-text');
const coachLogEl = document.getElementById('coach-log');
const coachStepEl = document.getElementById('coach-step-indicator');
const coachNavEl = document.getElementById('coach-nav');
const tutPrevBtn = document.getElementById('tut-prev-btn');
const tutNextBtn = document.getElementById('tut-next-btn');
const menuStartBtn = document.getElementById('menu-start-btn');
const hudPoints = document.getElementById('academy-score-points');
const hudGames = document.getElementById('academy-score-games');
const hudSets = document.getElementById('academy-score-sets');
const hudServer = document.getElementById('academy-server-indicator');

// ---------- Coach system ----------
function coachSay(text, opts = {}) {
  coachTextEl.textContent = text;
  appendCoachLog(text);
  if (settings.coachVoice === 'on' && opts.speak !== false) speakCoachMessage(text);
}

function appendCoachLog(text) {
  const li = document.createElement('li');
  li.textContent = text;
  coachLogEl.appendChild(li);
  while (coachLogEl.children.length > 5) coachLogEl.removeChild(coachLogEl.firstChild);
}

const FEMALE_VOICE_NAMES = [
  'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'veena', 'zira',
  'susan', 'allison', 'ava', 'serena', 'female', 'woman', 'kathy', 'fenella',
];

let cachedCoachVoice = null;

function pickCoachVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const english = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
  const pool = english.length ? english : voices;
  const named = pool.find((v) => FEMALE_VOICE_NAMES.some((n) => v.name.toLowerCase().includes(n)));
  if (named) return named;
  const flaggedFemale = pool.find((v) => /female/i.test(v.name));
  if (flaggedFemale) return flaggedFemale;
  const notMale = pool.find((v) => !/male/i.test(v.name));
  return notMale || pool[0];
}

function getCoachVoice() {
  if (!cachedCoachVoice) cachedCoachVoice = pickCoachVoice();
  return cachedCoachVoice;
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.addEventListener('voiceschanged', () => { cachedCoachVoice = pickCoachVoice(); });
}

function speakCoachMessage(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getCoachVoice();
    if (voice) utterance.voice = voice;
    utterance.pitch = 1.15;
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (e) { /* speech synthesis unavailable in this environment */ }
}

function cancelSpeech() {
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
}

// ---------- Menu groups ----------
function initMenuGroups() {
  document.querySelectorAll('.menu-group').forEach((group) => {
    const key = group.dataset.setting;
    const opts = Array.from(group.querySelectorAll('.menu-opt'));
    opts.forEach((opt, i) => {
      if (opt.dataset.value === settings[key]) opt.classList.add('selected');
      opt.addEventListener('click', () => {
        if (opt.disabled) return;
        settings[key] = opt.dataset.value;
        opts.forEach((o) => o.classList.remove('selected'));
        opt.classList.add('selected');
        if (key === 'mode') updateDifficultyAvailability();
      });
    });
  });
  updateDifficultyAvailability();

  if (!('speechSynthesis' in window)) {
    const onBtn = document.querySelector('.menu-group[data-setting="coachVoice"] .menu-opt[data-value="on"]');
    if (onBtn) { onBtn.disabled = true; onBtn.textContent = 'N/A'; }
  }
}

function updateDifficultyAvailability() {
  const diffGroup = document.querySelector('.menu-group[data-setting="difficulty"]');
  if (!diffGroup) return;
  const disable = settings.mode === 'tutorial';
  diffGroup.querySelectorAll('.menu-opt').forEach((opt) => { opt.disabled = disable; });
}

// ---------- Overlay helpers ----------
function hideOverlay() {
  overlayMsg.classList.remove('visible');
  menuPanel.classList.remove('visible');
  overlayText.classList.remove('visible');
  overlayText.innerHTML = '';
}

function showMenu() {
  overlayMsg.classList.add('visible');
  menuPanel.classList.add('visible');
  overlayText.classList.remove('visible');
}

function showOverlayText(html) {
  overlayMsg.classList.add('visible');
  menuPanel.classList.remove('visible');
  overlayText.classList.add('visible');
  overlayText.innerHTML = html;
}

// ---------- HUD ----------
function pointName(n) { return ['0', '15', '30', '40'][n] ?? '40'; }

function pointLabel() {
  if (!match) return '';
  if (match.inTiebreak) return `${match.tiebreak.player} - ${match.tiebreak.ai}`;
  const p = match.points.player, a = match.points.ai;
  if (p >= 3 && a >= 3) {
    if (p === a) return 'DEUCE';
    return p > a ? 'AD - YOU' : 'AD - AI';
  }
  return `${pointName(p)} - ${pointName(a)}`;
}

function updateHud() {
  if (!match) {
    hudPoints.textContent = '0 - 0';
    hudGames.textContent = 'GAMES 0-0';
    hudSets.textContent = 'SETS 0-0';
    hudServer.textContent = 'SERVE: -';
    return;
  }
  hudPoints.textContent = pointLabel();
  hudGames.textContent = `GAMES ${match.games.player}-${match.games.ai}`;
  hudSets.textContent = `SETS ${match.sets.player}-${match.sets.ai}`;
  hudServer.textContent = `SERVE: ${match.server === 'player' ? 'YOU' : 'AI'}`;
}

// ---------- Match scoring ----------
function createMatch() {
  return {
    points: { player: 0, ai: 0 },
    games: { player: 0, ai: 0 },
    sets: { player: 0, ai: 0 },
    server: 'player',
    setsToWin: 2,
    inTiebreak: false,
    tiebreak: { player: 0, ai: 0 },
  };
}

function otherSide(side) { return side === 'player' ? 'ai' : 'player'; }

function awardPoint(side) {
  if (!match) return;
  if (state !== STATE.MATCH_POINT_END) state = STATE.MATCH_POINT_END;
  if (match.inTiebreak) {
    match.tiebreak[side]++;
    updateHud();
    const a = match.tiebreak.player, b = match.tiebreak.ai;
    if (Math.max(a, b) >= 7 && Math.abs(a - b) >= 2) {
      finishTiebreak(side);
      return;
    }
    scheduleAdvanceServe();
    return;
  }
  match.points[side]++;
  updateHud();
  const p = match.points.player, a = match.points.ai;
  if (Math.max(p, a) >= 4 && Math.abs(p - a) >= 2) {
    winGame(side);
    return;
  }
  scheduleAdvanceServe();
}

function scheduleAdvanceServe() {
  clearPendingTimer();
  pendingTimer = setTimeout(() => { enterServing(); }, 900);
}

function clearPendingTimer() {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
}

function winGame(side) {
  match.games[side]++;
  match.points = { player: 0, ai: 0 };
  match.server = otherSide(match.server);
  updateHud();
  coachSay(side === 'player' ? 'Game! You take that one.' : 'Game to the AI. Stay focused.', { speak: true });
  state = STATE.MATCH_GAME_OVER;

  if (match.games.player === 6 && match.games.ai === 6) {
    match.inTiebreak = true;
    match.tiebreak = { player: 0, ai: 0 };
    coachSay('Six games all — that means a TIEBREAK. First to 7 points, win by two.', { speak: true });
    clearPendingTimer();
    pendingTimer = setTimeout(() => { enterServing(); }, 1400);
    return;
  }

  if (isSetWon(side)) { advanceSet(side); return; }

  clearPendingTimer();
  pendingTimer = setTimeout(() => { enterServing(); }, 1400);
}

function finishTiebreak(side) {
  match.games[side] = 7;
  match.inTiebreak = false;
  updateHud();
  coachSay(`Tiebreak to ${side === 'player' ? 'you' : 'the AI'}! That wins the set.`, { speak: true });
  state = STATE.MATCH_GAME_OVER;
  advanceSet(side);
}

function isSetWon(side) {
  const g = match.games[side], o = match.games[otherSide(side)];
  return g >= 6 && g - o >= 2;
}

function advanceSet(side) {
  match.sets[side]++;
  match.games = { player: 0, ai: 0 };
  match.points = { player: 0, ai: 0 };
  match.inTiebreak = false;
  updateHud();
  state = STATE.MATCH_SET_OVER;
  if (isMatchWon(side)) {
    clearPendingTimer();
    pendingTimer = setTimeout(() => { enterMatchOver(side); }, 1200);
    return;
  }
  coachSay(`Set to ${side === 'player' ? 'you' : 'the AI'}!`, { speak: true });
  clearPendingTimer();
  pendingTimer = setTimeout(() => { enterServing(); }, 1600);
}

function isMatchWon(side) { return match.sets[side] >= match.setsToWin; }

function enterMatchOver(winnerSide) {
  clearPendingTimer();
  cancelSpeech();
  state = STATE.MATCH_OVER;
  const won = winnerSide === 'player';
  coachSay(won ? "Match won! Great job — you're learning fast." : 'Match goes to the AI this time. Want to run it again?', { speak: true });
  showOverlayText(`
    <p>${won ? 'YOU WIN THE MATCH!' : 'AI WINS THE MATCH'}</p>
    <button id="new-match-btn" class="menu-opt" type="button">NEW MATCH</button>
  `);
  document.getElementById('new-match-btn').addEventListener('click', startNewMatch);
}

function startNewMatch() {
  match = null;
  hideOverlay();
  coachTextEl.textContent = 'Welcome! Choose Tutorial or Match above to begin.';
  coachLogEl.innerHTML = '';
  state = STATE.MODE_SELECT;
  showMenu();
}

// ---------- Serve geometry ----------
function deuceSideForPoint() {
  if (!match) return true;
  const total = match.inTiebreak ? (match.tiebreak.player + match.tiebreak.ai) : (match.points.player + match.points.ai);
  return total % 2 === 0;
}

function serverStanceX(serverIsPlayer, deuce) {
  // Player's "right" (facing the net, -y) is +x; AI's "right" (facing the net, +y) is -x.
  const serverOnRight = serverIsPlayer ? deuce : !deuce;
  return serverOnRight
    ? lerp(centerX + 12, singlesRightX - 8, 0.5)
    : lerp(singlesLeftX + 8, centerX - 12, 0.5);
}

function serveTargetBox(serverIsPlayer, deuce) {
  const serverOnRight = serverIsPlayer ? deuce : !deuce;
  const targetOnRight = !serverOnRight;
  const xMin = targetOnRight ? centerX : singlesLeftX;
  const xMax = targetOnRight ? singlesRightX : centerX;
  const yMin = serverIsPlayer ? serviceLineTopY : netY;
  const yMax = serverIsPlayer ? netY : serviceLineBottomY;
  return { xMin, xMax, yMin, yMax };
}

function enterServing() {
  clearPendingTimer();
  if (!match) return;
  state = STATE.MATCH_SERVING;
  const serverIsPlayer = match.server === 'player';
  const deuce = deuceSideForPoint();
  const sideLabel = deuce ? 'RIGHT — the deuce court' : 'LEFT — the ad court';
  if (serverIsPlayer) {
    playerPos.x = serverStanceX(true, deuce);
    playerPos.y = baselineBottomY - 8;
    inputMode = 'serve-only';
    coachSay(`Your serve. Stand on the ${sideLabel}. ${deuce ? 'Score is even' : 'Score is odd'}, so you'll serve diagonally cross-court. Press SPACE or tap to serve.`);
  } else {
    aiPos.x = serverStanceX(false, deuce);
    aiPos.y = baselineTopY + 8;
    inputMode = 'free';
    coachSay(`AI serving from the ${sideLabel.replace('RIGHT', 'AI’s right').replace('LEFT', 'AI’s left')}. Get ready to return.`);
    clearPendingTimer();
    pendingTimer = setTimeout(() => { launchServe(); }, 1100);
  }
  ball.visible = true;
  ball.x = serverIsPlayer ? playerPos.x : aiPos.x;
  ball.y = serverIsPlayer ? playerPos.y : aiPos.y;
  ball.z = 0;
  hideOverlay();
}

function launchServe() {
  if (!match) return;
  const serverIsPlayer = match.server === 'player';
  const deuce = deuceSideForPoint();
  const box = serveTargetBox(serverIsPlayer, deuce);
  const targetX = lerp(box.xMin, box.xMax, 0.3 + Math.random() * 0.4);
  const targetY = lerp(box.yMin, box.yMax, 0.3 + Math.random() * 0.4);
  const fromX = serverIsPlayer ? playerPos.x : aiPos.x;
  const fromY = serverIsPlayer ? playerPos.y : aiPos.y;
  state = STATE.MATCH_RALLY;
  inputMode = 'free';
  startFlight({
    startX: fromX, startY: fromY, endX: targetX, endY: targetY,
    duration: 0.62, peakHeight: 14, shotType: 'serve',
    hitterIsPlayer: serverIsPlayer, isServe: true,
  });
}

// ---------- Generic flight / contact system ----------
function startFlight(opts) {
  flight = {
    startX: opts.startX, startY: opts.startY, endX: opts.endX, endY: opts.endY,
    duration: opts.duration, elapsed: 0, peakHeight: opts.peakHeight,
    shotType: opts.shotType, hitterIsPlayer: opts.hitterIsPlayer, isServe: !!opts.isServe,
    resolved: false,
  };
  ball.visible = true;
}

function classifyContact(isPlayerSide, pos, t) {
  const nearNet = Math.abs(pos.y - netY) < VOLLEY_ZONE_DEPTH;
  const beforeBounce = t < 1;
  if (nearNet && beforeBounce) {
    return ball.z > SMASH_Z_THRESHOLD ? 'smash' : 'volley';
  }
  const forehand = isPlayerSide ? (ball.x > pos.x) : (ball.x < pos.x);
  return forehand ? 'forehand' : 'backhand';
}

function describeShot(type) {
  switch (type) {
    case 'serve': return 'serve';
    case 'volley': return 'volley — hit before it bounced, right at the net';
    case 'smash': return 'smash — a powerful hit on a high ball near the net';
    case 'forehand': return 'forehand, hit from the dominant side';
    case 'backhand': return 'backhand, hit across the body';
    default: return type;
  }
}

function resolveContact(isPlayerSide, pos, t) {
  const shotType = flight.isServe ? 'return' : classifyContact(isPlayerSide, pos, t);
  flight.resolved = true;
  if (shotType !== 'return') coachSay(`Nice ${describeShot(shotType)}!`, { speak: false });
  const opponentIsPlayer = !isPlayerSide;
  const targetArea = opponentIsPlayer
    ? { xMin: singlesLeftX + 8, xMax: singlesRightX - 8, yMin: netY + 30, yMax: baselineBottomY - 10 }
    : { xMin: singlesLeftX + 8, xMax: singlesRightX - 8, yMin: baselineTopY + 10, yMax: netY - 30 };
  const tx = clamp(lerp(targetArea.xMin, targetArea.xMax, Math.random()), targetArea.xMin, targetArea.xMax);
  const ty = clamp(lerp(targetArea.yMin, targetArea.yMax, Math.random()), targetArea.yMin, targetArea.yMax);
  startFlight({
    startX: pos.x, startY: pos.y, endX: tx, endY: ty,
    duration: 0.7 + Math.random() * 0.3, peakHeight: 10 + Math.random() * 14,
    shotType: 'rally', hitterIsPlayer: isPlayerSide,
  });
}

function landingInBounds(x, y, isPlayerHalf) {
  const yOk = isPlayerHalf ? (y > netY && y <= baselineBottomY) : (y < netY && y >= baselineTopY);
  return x >= singlesLeftX && x <= singlesRightX && yOk;
}

function handleLanding() {
  const landedOnPlayerHalf = flight.endY > netY;
  const inBounds = landingInBounds(flight.endX, flight.endY, landedOnPlayerHalf);
  const hitterWasPlayer = flight.hitterIsPlayer;
  const wasServe = flight.isServe;
  flight = null;
  state = STATE.MATCH_POINT_END;

  if (!inBounds) {
    const winner = otherSide(hitterWasPlayer ? 'player' : 'ai');
    if (wasServe) coachSay('Fault! That serve missed the box.', { speak: true });
    else coachSay('Out! Unforced error — that ball landed out with no pressure forcing the mistake.', { speak: true });
    awardPoint(winner);
    return;
  }

  const winner = hitterWasPlayer ? 'player' : 'ai';
  if (wasServe) coachSay('Ace! An untouchable serve — straight to a point.', { speak: true });
  else coachSay(`Winner for ${winner === 'player' ? 'you' : 'the AI'}!`, { speak: true });
  awardPoint(winner);
}

function updateFlight(dt) {
  if (!flight) return;
  flight.elapsed += dt;
  const t = clamp(flight.elapsed / flight.duration, 0, 1.4);
  ball.x = t <= 1 ? lerp(flight.startX, flight.startY === flight.endY ? flight.startX : flight.startX, t) : flight.endX;
  ball.x = lerp(flight.startX, flight.endX, Math.min(t, 1));
  ball.y = lerp(flight.startY, flight.endY, Math.min(t, 1));
  const clampedT = Math.min(t, 1);
  ball.z = Math.max(0, flight.peakHeight / 18) * 4 * clampedT * (1 - clampedT);

  if (!flight.resolved && t >= 0.12) {
    const targetIsPlayer = flight.endY > netY;
    if (targetIsPlayer) {
      const dist = Math.hypot(ball.x - playerPos.x, ball.y - playerPos.y);
      if (dist < HIT_RADIUS && t < 1.05) { resolveContact(true, playerPos, t); return; }
    } else {
      maybeAiReturn(t);
    }
  }

  if (t >= 1) handleLanding();
}

function maybeAiReturn(t) {
  const dist = Math.hypot(ball.x - aiPos.x, ball.y - aiPos.y);
  const params = AI_PARAMS[settings.difficulty];
  const reach = HIT_RADIUS + 30;
  if (dist < reach && t > 0.55 && t < 0.98) {
    if (Math.random() < params.errorMargin) return; // AI lets it go past
    resolveContact(false, aiPos, t);
  }
}

function updateAiMovement(dt) {
  if (!flight) return;
  const targetIsAi = flight.endY <= netY;
  if (!targetIsAi) return;
  const params = AI_PARAMS[settings.difficulty];
  const dx = flight.endX - aiPos.x;
  const dy = clamp(flight.endY, AI_Y_MIN, AI_Y_MAX) - aiPos.y;
  const dist = Math.hypot(dx, dy) || 1;
  const step = params.speed * dt;
  aiPos.x = clamp(aiPos.x + (dx / dist) * Math.min(step, Math.abs(dx)), AI_X_MIN, AI_X_MAX);
  aiPos.y = clamp(aiPos.y + (dy / dist) * Math.min(step, Math.abs(dy)), AI_Y_MIN, AI_Y_MAX);
}

// ---------- Tutorial ----------
const tutorialSteps = [
  {
    id: 'tour',
    title: 'COURT TOUR',
    narration: 'Welcome to the court! The lines at top and bottom are the baselines. The side lines mark the singles court. The net splits the court in half — that thin pink band in the middle.',
    setup() {},
    checkSuccess() { return true; },
    drillType: 'narration',
  },
  {
    id: 'serve-deuce',
    title: 'SERVE POSITION — DEUCE COURT',
    narration: 'When the score is even (like 0-0, 15-15, 30-30), the server stands to the RIGHT of center — the deuce court. Move there now with the D-PAD or arrow keys.',
    setup() { inputMode = 'nav-only'; playerPos.x = centerX; playerPos.y = baselineBottomY - 8; },
    checkSuccess() {
      return playerPos.x >= DEUCE_ZONE.xMin && playerPos.x <= DEUCE_ZONE.xMax &&
        playerPos.y >= DEUCE_ZONE.yMin && playerPos.y <= DEUCE_ZONE.yMax;
    },
    drillType: 'position',
  },
  {
    id: 'serve-ad',
    title: 'SERVE POSITION — AD COURT',
    narration: 'When the score is odd (like 15-0, 30-15), the server moves to the LEFT of center — the ad court (short for "advantage"). Move there now.',
    setup() { inputMode = 'nav-only'; playerPos.x = centerX; playerPos.y = baselineBottomY - 8; },
    checkSuccess() {
      return playerPos.x >= AD_ZONE.xMin && playerPos.x <= AD_ZONE.xMax &&
        playerPos.y >= AD_ZONE.yMin && playerPos.y <= AD_ZONE.yMax;
    },
    drillType: 'position',
  },
  {
    id: 'fault-let',
    title: 'FAULTS & LETS',
    narration: 'Watch closely: the server gets two tries. A serve that misses the box is a "fault." Miss both and it is a "double fault" — a free point for the opponent. If the serve clips the net but still lands in, it is a "let" — no penalty, just serve again.',
    setup() {
      inputMode = 'locked';
      this._phase = 0;
      runFaultDemo();
    },
    checkSuccess() { return this._phase >= 2; },
    drillType: 'demo',
  },
  {
    id: 'score',
    title: 'READING THE SCORE',
    narration: 'Tennis points go Love (zero), 15, 30, 40, then Game. Use NEXT to step through a sample game.',
    setup() { inputMode = 'locked'; this._sub = 0; this.subTexts = [
      'Love - Love. That means 0-0. "Love" is just tennis-speak for zero.',
      '15 - Love. The server won the first point.',
      '15 - 30. Now the receiver is ahead.',
      '40 - 30. One point from winning the game.',
      '40 - 40 is called DEUCE. From deuce, you must win by two clear points.',
      'Advantage you! Win one more point to take the game.',
      'Game! That is how a score like "30-15" tells you exactly who is ahead and by how much.',
    ]; },
    checkSuccess() { return this._sub >= this.subTexts.length - 1; },
    drillType: 'score-walkthrough',
  },
  {
    id: 'shot-types',
    title: 'SHOT TYPES — GUIDED RALLY',
    narration: 'Time to rally! Move to meet the ball. I will call out each shot type as you play: forehand, backhand, volley, or smash. Get at least four different shots named, then we will move on.',
    setup() {
      inputMode = 'free';
      this._seen = new Set();
      this._hits = 0;
      startCooperativeRally();
    },
    checkSuccess() { return this._seen && (this._seen.size >= 4 || this._hits >= 10); },
    drillType: 'rally',
  },
  {
    id: 'outcomes',
    title: 'WINNERS, ERRORS & ACES',
    narration: 'Every point ends one of three ways: a WINNER (a great shot the opponent cannot reach), an UNFORCED ERROR (a shot you had time for, but hit out or into the net), or an ACE (a serve nobody touches). Watch these three example points.',
    setup() { inputMode = 'locked'; this._idx = 0; runOutcomeDemo(); },
    checkSuccess() { return this._idx >= 3; },
    drillType: 'demo',
  },
  {
    id: 'summary',
    title: 'SUMMARY',
    narration: "Great work! You now know how to read a score, where to stand to serve, and how to name a shot. Press NEXT to jump into a real MATCH and put it to use, or BACK to replay this tutorial.",
    setup() { inputMode = 'locked'; },
    checkSuccess() { return true; },
    drillType: 'summary',
  },
];

let tutorialIndex = 0;

function startTutorial() {
  match = null;
  tutorialIndex = 0;
  state = STATE.TUT_STEP;
  hideOverlay();
  coachNavEl.classList.add('visible');
  enterTutorialStep(0);
}

function enterTutorialStep(i) {
  tutorialIndex = i;
  const step = tutorialSteps[i];
  coachStepEl.textContent = `STEP ${i + 1}/${tutorialSteps.length}`;
  tutPrevBtn.disabled = i === 0;
  tutNextBtn.textContent = i === tutorialSteps.length - 1 ? 'GO TO MATCH' : 'NEXT';
  tutPrevBtn.textContent = i === tutorialSteps.length - 1 ? 'REPLAY' : 'BACK';
  tutNextBtn.disabled = !['narration', 'summary', 'score-walkthrough'].includes(step.drillType);
  coachSay(`${step.title}: ${step.narration}`);
  step.setup();
}

function runFaultDemo() {
  const step = tutorialSteps[3];
  playerPos.x = serverStanceX(true, true);
  playerPos.y = baselineBottomY - 8;
  ball.visible = true;
  ball.x = playerPos.x; ball.y = playerPos.y; ball.z = 0;
  startFlight({
    startX: playerPos.x, startY: playerPos.y,
    endX: singlesLeftX - 18, endY: serviceLineTopY - 12,
    duration: 0.6, peakHeight: 14, shotType: 'serve', hitterIsPlayer: true, isServe: true,
  });
  tutFlightOverride = () => {
    coachSay('Fault — that first serve missed the box. No penalty yet, second serve coming.');
    step._phase = 1;
    flight = null; ball.visible = false;
    setTimeout(() => {
      const box = serveTargetBox(true, true);
      startFlight({
        startX: playerPos.x, startY: playerPos.y,
        endX: lerp(box.xMin, box.xMax, 0.5), endY: lerp(box.yMin, box.yMax, 0.5),
        duration: 0.6, peakHeight: 14, shotType: 'serve', hitterIsPlayer: true, isServe: true,
      });
      ball.visible = true;
      tutFlightOverride = () => {
        coachSay('Good serve — in! That is how a let differs from a fault: a let just gets replayed, a fault costs you a try.');
        step._phase = 2;
        flight = null; ball.visible = false;
        tutFlightOverride = null;
        tutNextBtn.disabled = false;
      };
    }, 1400);
  };
}

function runOutcomeDemo() {
  const step = tutorialSteps[6];
  const labels = [
    { text: 'Winner! That forehand landed deep in the corner — untouchable.', target: { x: singlesRightX - 14, y: baselineTopY + 20 } },
    { text: 'Unforced error. That shot drifted wide with no pressure forcing the mistake.', target: { x: singlesRightX + 24, y: netY - 20 } },
    { text: 'Ace! A serve right on the line that nobody could reach.', target: { x: singlesLeftX + 14, y: serviceLineTopY - 14 } },
  ];
  function playOne(i) {
    if (i >= labels.length) { step._idx = labels.length; tutNextBtn.disabled = false; return; }
    playerPos.x = centerX; playerPos.y = baselineBottomY - 8;
    ball.visible = true; ball.x = playerPos.x; ball.y = playerPos.y; ball.z = 0;
    startFlight({
      startX: playerPos.x, startY: playerPos.y,
      endX: labels[i].target.x, endY: labels[i].target.y,
      duration: 0.55, peakHeight: 14, shotType: i === 2 ? 'serve' : 'rally', hitterIsPlayer: true, isServe: i === 2,
    });
    tutFlightOverride = () => {
      coachSay(labels[i].text);
      step._idx = i + 1;
      flight = null; ball.visible = false;
      tutFlightOverride = null;
      setTimeout(() => playOne(i + 1), 1100);
    };
  }
  playOne(0);
}

function startCooperativeRally() {
  ball.visible = true;
  ball.x = aiPos.x; ball.y = aiPos.y; ball.z = 0;
  startFlight({
    startX: aiPos.x, startY: aiPos.y, endX: playerPos.x, endY: baselineBottomY - 24,
    duration: 1.1, peakHeight: 16, shotType: 'rally', hitterIsPlayer: false,
  });
}

// Self-contained physics for the tutorial's cooperative rally step — deliberately decoupled
// from the match flight/contact system so it never touches match state or scoring.
function tutorialRallyTick(dt) {
  if (!flight) { startCooperativeRally(); return; }
  flight.elapsed += dt;
  const t = clamp(flight.elapsed / flight.duration, 0, 1);
  ball.x = lerp(flight.startX, flight.endX, t);
  ball.y = lerp(flight.startY, flight.endY, t);
  const ct = Math.min(t, 1);
  ball.z = Math.max(0, flight.peakHeight / 18) * 4 * ct * (1 - ct);
  ball.visible = true;

  if (!flight.hitterIsPlayer) {
    // heading toward the player
    aiPos.x = lerp(aiPos.x, flight.startX, 0.02);
    if (!flight.resolved) {
      const dist = Math.hypot(ball.x - playerPos.x, ball.y - playerPos.y);
      if (dist < HIT_RADIUS + 10 && t > 0.45) {
        const shotType = classifyContact(true, playerPos, t);
        tutorialOnContact(shotType);
        flight.resolved = true;
        const tx = clamp(aiPos.x + (Math.random() - 0.5) * 50, AI_X_MIN, AI_X_MAX);
        const ty = clamp(baselineTopY + 20 + Math.random() * 40, AI_Y_MIN, AI_Y_MAX);
        startFlight({ startX: playerPos.x, startY: playerPos.y, endX: tx, endY: ty, duration: 0.9, peakHeight: 10 + Math.random() * 16, shotType: 'rally', hitterIsPlayer: true });
        return;
      }
    }
    if (t >= 1) {
      flight = null;
      setTimeout(() => {
        if (state === STATE.TUT_STEP && tutorialSteps[tutorialIndex].drillType === 'rally') startCooperativeRally();
      }, 400);
    }
  } else {
    // heading toward the AI — AI always returns it to keep the rally cooperative
    aiPos.x = lerp(aiPos.x, flight.endX, 0.05);
    if (t >= 0.85 && !flight.resolved) {
      flight.resolved = true;
      const tx = clamp(playerPos.x + (Math.random() - 0.5) * 40, PLAYER_X_MIN, PLAYER_X_MAX);
      const ty = clamp(baselineBottomY - 24 - Math.random() * 30, PLAYER_Y_MIN, PLAYER_Y_MAX);
      startFlight({ startX: aiPos.x, startY: aiPos.y, endX: tx, endY: ty, duration: 1.0, peakHeight: 8 + Math.random() * 20, shotType: 'rally', hitterIsPlayer: false });
    }
  }
}

let tutFlightOverride = null;

function tutorialOnContact(shotType) {
  const step = tutorialSteps[tutorialIndex];
  if (step && step._seen) {
    step._seen.add(shotType);
    step._hits = (step._hits || 0) + 1;
    if (step.checkSuccess()) tutNextBtn.disabled = false;
  }
}

function tutorialAdvance(dir) {
  const step = tutorialSteps[tutorialIndex];
  if (step.drillType === 'score-walkthrough') {
    if (dir > 0 && step._sub < step.subTexts.length - 1) {
      step._sub++;
      coachSay(step.subTexts[step._sub]);
      if (step.checkSuccess()) tutNextBtn.disabled = false;
      return;
    }
    if (dir < 0 && step._sub > 0) {
      step._sub--;
      coachSay(step.subTexts[step._sub]);
      return;
    }
  }

  if (tutorialIndex === tutorialSteps.length - 1) {
    if (dir > 0) { goToMatchSetup(); return; }
    if (dir < 0) { startTutorial(); return; }
  }

  const next = tutorialIndex + dir;
  if (next < 0 || next >= tutorialSteps.length) return;
  enterTutorialStep(next);
}

function goToMatchSetup() {
  coachNavEl.classList.remove('visible');
  settings.mode = 'match';
  document.querySelectorAll('.menu-group[data-setting="mode"] .menu-opt').forEach((o) => {
    o.classList.toggle('selected', o.dataset.value === 'match');
  });
  updateDifficultyAvailability();
  coachTextEl.textContent = 'Pick a difficulty and press START to play a full match.';
  state = STATE.MODE_SELECT;
  showMenu();
}

// ---------- Match lifecycle ----------
function startMatch() {
  match = createMatch();
  coachNavEl.classList.remove('visible');
  updateHud();
  coachSay('Match starting! Best of 3 sets. Good luck.');
  enterServing();
}

// ---------- Pause / reset ----------
function togglePause() {
  if (state === STATE.PAUSED) {
    state = prevStateBeforePause || STATE.MODE_SELECT;
    prevStateBeforePause = null;
    hideOverlay();
    return;
  }
  if (state === STATE.MODE_SELECT || state === STATE.MATCH_OVER) return;
  prevStateBeforePause = state;
  state = STATE.PAUSED;
  cancelSpeech();
  showOverlayText('<p>PAUSED<br>Press P or ESC to resume</p>');
}

function hardReset() {
  clearPendingTimer();
  cancelSpeech();
  flight = null;
  ball.visible = false;
  match = null;
  tutorialIndex = 0;
  coachNavEl.classList.remove('visible');
  coachTextEl.textContent = 'Welcome! Choose Tutorial or Match above to begin.';
  coachLogEl.innerHTML = '';
  state = STATE.MODE_SELECT;
  showMenu();
}

// ---------- Primary action (Space / tap) ----------
function handlePrimaryAction() {
  if (state === STATE.MODE_SELECT) {
    if (settings.mode === 'tutorial') startTutorial();
    else startMatch();
    return;
  }
  if (state === STATE.MATCH_SERVING && match && match.server === 'player') {
    launchServe();
    return;
  }
}

// ---------- Drawing ----------
function drawCourtSurface() {
  ctx.fillStyle = RUNOFF_COLOR;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = COURT_COLOR;
  ctx.fillRect(doublesLeftX, baselineTopY, doublesWPx, courtLenPx);
}

function drawCourtLines() {
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 2;
  ctx.strokeRect(doublesLeftX, baselineTopY, doublesWPx, courtLenPx);
  ctx.strokeRect(singlesLeftX, baselineTopY, singlesWPx, courtLenPx);

  ctx.beginPath();
  ctx.moveTo(singlesLeftX, serviceLineTopY); ctx.lineTo(singlesRightX, serviceLineTopY);
  ctx.moveTo(singlesLeftX, serviceLineBottomY); ctx.lineTo(singlesRightX, serviceLineBottomY);
  ctx.moveTo(centerX, serviceLineTopY); ctx.lineTo(centerX, serviceLineBottomY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX - 6, baselineTopY); ctx.lineTo(centerX + 6, baselineTopY);
  ctx.moveTo(centerX - 6, baselineBottomY); ctx.lineTo(centerX + 6, baselineBottomY);
  ctx.stroke();
}

function drawNet() {
  ctx.fillStyle = NET_COLOR;
  ctx.fillRect(doublesLeftX - 4, netY - 1.5, doublesWPx + 8, 3);
  ctx.fillRect(doublesLeftX - 4, netY - 10, 2, 10);
  ctx.fillRect(doublesRightX + 2, netY - 10, 2, 10);
}

function drawCourtLabels() {
  if (state !== STATE.TUT_STEP) return;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('AD COURT', centerX - singlesWPx / 4, baselineBottomY + 36);
  ctx.fillText('DEUCE COURT', centerX + singlesWPx / 4, baselineBottomY + 36);
}

function drawPlayers() {
  ctx.fillStyle = PLAYER_COLOR;
  ctx.beginPath();
  ctx.arc(playerPos.x, playerPos.y, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = AI_COLOR;
  ctx.beginPath();
  ctx.arc(aiPos.x, aiPos.y, 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawBall() {
  if (!ball.visible) return;
  const shadowR = 4 + ball.z * 1.5;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y, shadowR, shadowR * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  const lift = ball.z * 10;
  ctx.fillStyle = BALL_COLOR;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y - lift, 4, 0, Math.PI * 2);
  ctx.fill();
}

function draw() {
  drawCourtSurface();
  drawCourtLines();
  drawNet();
  drawCourtLabels();
  drawPlayers();
  drawBall();
}

// ---------- Update / loop ----------
function updateFreeMovement(dt) {
  const { dx, dy } = currentDirVector();
  if (dx === 0 && dy === 0) return;
  const speed = 130;
  if (inputMode === 'free' || inputMode === 'serve-only' || inputMode === 'nav-only') {
    playerPos.x = clamp(playerPos.x + dx * speed * dt, PLAYER_X_MIN, PLAYER_X_MAX);
    playerPos.y = clamp(playerPos.y + dy * speed * dt, PLAYER_Y_MIN, PLAYER_Y_MAX);
  }
}

let lastShotTypeCount = 0;
function update(dt) {
  if (state === STATE.PAUSED || state === STATE.MODE_SELECT) return;
  if (inputMode !== 'locked') updateFreeMovement(dt);

  if (state === STATE.TUT_STEP) {
    const step = tutorialSteps[tutorialIndex];
    if (step && step.checkSuccess()) tutNextBtn.disabled = false;
  }

  if (state === STATE.MATCH_RALLY) {
    updateAiMovement(dt);
    const before = flight;
    updateFlight(dt);
    if (before && flight && before !== flight) {
      const type = flight.shotType;
      if (type && type !== 'serve' && type !== 'rally') tutorialOnContact(type);
    }
  } else if (tutFlightOverride && flight) {
    flight.elapsed += dt;
    const t = clamp(flight.elapsed / flight.duration, 0, 1);
    ball.x = lerp(flight.startX, flight.endX, t);
    ball.y = lerp(flight.startY, flight.endY, t);
    const clampedT = Math.min(t, 1);
    ball.z = Math.max(0, flight.peakHeight / 18) * 4 * clampedT * (1 - clampedT);
    if (t >= 1) { const fn = tutFlightOverride; tutFlightOverride = null; fn(); }
  } else if (state === STATE.TUT_STEP && tutorialSteps[tutorialIndex].drillType === 'rally') {
    tutorialRallyTick(dt);
  }

  if ((state === STATE.MATCH_SERVING) && match && match.server === 'ai') {
    // movement frozen for player during AI serve windup; handled by pendingTimer -> launchServe
  }
}

let lastTime = null;
function loop(ts) {
  if (lastTime == null) lastTime = ts;
  let dt = (ts - lastTime) / 1000;
  lastTime = ts;
  dt = Math.min(dt, 0.05);
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ---------- Input bindings ----------
window.addEventListener('keydown', (e) => {
  const dir = KEY_DIRS[e.key];
  if (dir) { setDirActive(dir, true); e.preventDefault(); return; }
  if (e.key === ' ') { handlePrimaryAction(); e.preventDefault(); return; }
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { togglePause(); e.preventDefault(); return; }
  if (e.key === 'r' || e.key === 'R') { hardReset(); e.preventDefault(); return; }
});

window.addEventListener('keyup', (e) => {
  const dir = KEY_DIRS[e.key];
  if (dir) { setDirActive(dir, false); e.preventDefault(); }
});

canvas.addEventListener('click', handlePrimaryAction);
canvas.addEventListener('touchstart', (e) => { handlePrimaryAction(); e.preventDefault(); }, { passive: false });

menuStartBtn.addEventListener('click', handlePrimaryAction);
tutPrevBtn.addEventListener('click', () => tutorialAdvance(-1));
tutNextBtn.addEventListener('click', () => tutorialAdvance(1));

const DPAD_DIRS = { 'btn-up': 'up', 'btn-down': 'down', 'btn-left': 'left', 'btn-right': 'right' };
Object.entries(DPAD_DIRS).forEach(([id, dir]) => {
  const btn = document.getElementById(id);
  if (!btn) return;
  const start = (e) => { setDirActive(dir, true); e.preventDefault(); };
  const end = (e) => { setDirActive(dir, false); if (e) e.preventDefault(); };
  btn.addEventListener('touchstart', start, { passive: false });
  btn.addEventListener('touchend', end, { passive: false });
  btn.addEventListener('touchcancel', end, { passive: false });
  btn.addEventListener('mousedown', start);
  btn.addEventListener('mouseup', end);
  btn.addEventListener('mouseleave', end);
});

window.addEventListener('beforeunload', cancelSpeech);

// ---------- Debug hook ----------
window.__debugState = () => ({
  state, settings, match: match ? JSON.parse(JSON.stringify(match)) : null,
  tutorialIndex, playerPos: { ...playerPos }, aiPos: { ...aiPos }, ball: { ...ball },
});

// ---------- Init ----------
initMenuGroups();
showMenu();
requestAnimationFrame(loop);
