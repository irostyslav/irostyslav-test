/* ---------- DOM ---------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highscoreEl = document.getElementById('highscore');
const livesEl = document.getElementById('lives');
const bombsEl = document.getElementById('bombs');
const blastEl = document.getElementById('blast');
const timeEl = document.getElementById('time');
const keyStatusEl = document.getElementById('key-status');
const overlayMsg = document.getElementById('overlay-msg');

/* ---------- Constants ---------- */
const TILE = 32;
const COLS = 21;
const ROWS = 15;
const HITBOX = 22;
const PLAYER_SPEED = 150; // px/sec
const ENEMY_SPEED = 70; // px/sec
const BOMB_FUSE = 2.0; // seconds
const EXPLOSION_DURATION = 0.4; // seconds
const DEFAULT_BLAST_RADIUS = 2;
const DEFAULT_BOMB_CAPACITY = 1;
const LIVES_START = 3;
const LEVEL_TIME = 180; // seconds
const HIT_INVULN = 1.0; // seconds of grace after taking damage

const T_FLOOR = 0;
const T_WALL = 1;
const T_BLOCK = 2;
const T_KEY = 3;
const T_EXIT = 4;

const SCORE_BLOCK = 10;
const SCORE_RAT = 100;
const SCORE_KEY = 500;
const SCORE_LEVEL = 1000;
const SCORE_TIME_MULT = 10;

/* ---------- Level map ----------
   # solid wall, + destructible block, . floor,
   P player start, E enemy start, K key, X exit */
const LEVEL_MAP = [
  "#####################",
  "#P.++.++++++++++.++E#",
  "#.#.#.#+#.#+#.#+#+#+#",
  "#+.+..+++++.++.++..+#",
  "#.#+#.#.#+#.#+#+#.#+#",
  "#++....+...+..+.+...#",
  "#.#+#+#.#+#+#+#+#+#.#",
  "#+++.K++...+++..++++#",
  "#+#.#+#+#+#+#.#.#.#+#",
  "#..+....+++.++++++++#",
  "#+#+#+#.#.#+#+#+#+#+#",
  "#..++++++.++.+++++..#",
  "#.#+#+#+#.#+#.#+#+#.#",
  "#......+++++++..+..X#",
  "#####################",
];

/* ---------- Game state ---------- */
const STATE = {
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  PLAYER_DEAD: 'player_dead',
  LEVEL_COMPLETE: 'level_complete',
  GAME_OVER: 'game_over',
  VICTORY: 'victory',
};

let state = STATE.TITLE;
let tiles, player, enemies, bombs, explosions;
let score, lives, bombCapacity, blastRadius, hasKey, levelTimeRemaining, timedOut;
let lastTime = 0;

let highscore = Number(localStorage.getItem('bomber-highscore') || 0);
highscoreEl.textContent = `BEST ${highscore}`;

function checkHighscore() {
  if (score > highscore) {
    highscore = score;
    localStorage.setItem('bomber-highscore', String(highscore));
    highscoreEl.textContent = `BEST ${highscore}`;
  }
}

/* ---------- Input ---------- */
const dirState = { up: 0, down: 0, left: 0, right: 0 };
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
  for (const d of ['up', 'down', 'left', 'right']) {
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
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};

const DIR_VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/* ---------- Level loading ---------- */
function parseLevel() {
  const grid = [];
  let playerStart = null;
  let enemyStart = null;
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      const ch = LEVEL_MAP[y][x];
      if (ch === '#') row.push(T_WALL);
      else if (ch === '+') row.push(T_BLOCK);
      else if (ch === 'K') row.push(T_KEY);
      else if (ch === 'X') row.push(T_EXIT);
      else if (ch === 'P') { row.push(T_FLOOR); playerStart = { x, y }; }
      else if (ch === 'E') { row.push(T_FLOOR); enemyStart = { x, y }; }
      else row.push(T_FLOOR);
    }
    grid.push(row);
  }
  return { grid, playerStart, enemyStart };
}

function spawnEntity(tilePos, speed) {
  return {
    x: tilePos.x * TILE + (TILE - HITBOX) / 2,
    y: tilePos.y * TILE + (TILE - HITBOX) / 2,
    dir: 'down',
    speed,
    alive: true,
  };
}

function loadLevel() {
  const { grid, playerStart, enemyStart } = parseLevel();
  tiles = grid;
  player = spawnEntity(playerStart, PLAYER_SPEED);
  player.invuln = 0;
  enemies = [{ ...spawnEntity(enemyStart, ENEMY_SPEED), type: 'rat', dirTimer: 0 }];
  bombs = [];
  explosions = [];
  hasKey = false;
  levelTimeRemaining = LEVEL_TIME;
  timedOut = false;
  dirState.up = dirState.down = dirState.left = dirState.right = 0;
}

function resetRun() {
  score = 0;
  lives = LIVES_START;
  bombCapacity = DEFAULT_BOMB_CAPACITY;
  blastRadius = DEFAULT_BLAST_RADIUS;
  loadLevel();
}

/* ---------- Collision helpers ---------- */
function tileAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return T_WALL;
  return tiles[ty][tx];
}

function tileBlocking(tx, ty) {
  return tileAt(tx, ty) === T_WALL || tileAt(tx, ty) === T_BLOCK;
}

function bombBlockingFor(tx, ty, entity) {
  return bombs.some((b) => {
    if (b.x !== tx || b.y !== ty) return false;
    if (b.owner === entity && !b.armed) return false;
    return true;
  });
}

function boxBlocked(px, py, entity) {
  const tx0 = Math.floor(px / TILE);
  const ty0 = Math.floor(py / TILE);
  const tx1 = Math.floor((px + HITBOX - 1) / TILE);
  const ty1 = Math.floor((py + HITBOX - 1) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tileBlocking(tx, ty)) return true;
      if (bombBlockingFor(tx, ty, entity)) return true;
    }
  }
  return false;
}

function centerTile(entity) {
  return {
    x: Math.floor((entity.x + HITBOX / 2) / TILE),
    y: Math.floor((entity.y + HITBOX / 2) / TILE),
  };
}

function boxesOverlap(a, b) {
  return a.x < b.x + HITBOX && a.x + HITBOX > b.x && a.y < b.y + HITBOX && a.y + HITBOX > b.y;
}

function moveEntity(entity, dir, dt) {
  if (!dir) return false;
  const v = DIR_VECTORS[dir];
  const nx = entity.x + v.x * entity.speed * dt;
  const ny = entity.y + v.y * entity.speed * dt;
  entity.dir = dir;
  if (!boxBlocked(nx, ny, entity)) {
    entity.x = nx;
    entity.y = ny;
    return true;
  }
  return false;
}

/* ---------- Bombs & explosions ---------- */
function placeBomb() {
  if (state !== STATE.PLAYING || !player.alive) return;
  const tile = centerTile(player);
  if (bombs.some((b) => b.x === tile.x && b.y === tile.y)) return;
  if (bombs.filter((b) => b.owner === player).length >= bombCapacity) return;
  bombs.push({
    x: tile.x,
    y: tile.y,
    timer: BOMB_FUSE,
    armed: false,
    owner: player,
    exploded: false,
  });
}

function addExplosionCell(x, y) {
  explosions.push({ x, y, timer: EXPLOSION_DURATION });
}

function destroyBlock(x, y) {
  tiles[y][x] = T_FLOOR;
  score += SCORE_BLOCK;
}

function explodeBomb(bomb) {
  if (bomb.exploded) return;
  bomb.exploded = true;
  const idx = bombs.indexOf(bomb);
  if (idx !== -1) bombs.splice(idx, 1);

  addExplosionCell(bomb.x, bomb.y);
  const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  for (const d of dirs) {
    for (let r = 1; r <= blastRadius; r++) {
      const tx = bomb.x + d.x * r;
      const ty = bomb.y + d.y * r;
      if (tileAt(tx, ty) === T_WALL) break;
      addExplosionCell(tx, ty);
      const chained = bombs.find((b) => b.x === tx && b.y === ty && !b.exploded);
      if (chained) explodeBomb(chained);
      if (tileAt(tx, ty) === T_BLOCK) {
        destroyBlock(tx, ty);
        break;
      }
    }
  }
}

function updateBombs(dt) {
  for (const bomb of bombs.slice()) {
    bomb.timer -= dt;
    if (!bomb.armed) {
      const ownerTile = centerTile(bomb.owner);
      if (ownerTile.x !== bomb.x || ownerTile.y !== bomb.y) bomb.armed = true;
    }
    if (bomb.timer <= 0) explodeBomb(bomb);
  }
}

function updateExplosions(dt) {
  for (const exp of explosions.slice()) {
    exp.timer -= dt;
    if (exp.timer <= 0) {
      explosions.splice(explosions.indexOf(exp), 1);
      continue;
    }
    const rect = { x: exp.x * TILE, y: exp.y * TILE };
    const expBox = { x: rect.x + (TILE - HITBOX) / 2, y: rect.y + (TILE - HITBOX) / 2 };
    if (player.alive && boxesOverlap(player, expBox)) hitPlayer();
    for (const enemy of enemies) {
      if (enemy.alive && boxesOverlap(enemy, expBox)) killEnemy(enemy);
    }
  }
}

function killEnemy(enemy) {
  enemy.alive = false;
  if (enemy.type === 'rat') score += SCORE_RAT;
}

/* ---------- Player ---------- */
function hitPlayer() {
  if (!player.alive || player.invuln > 0) return;
  lives -= 1;
  updateHud();
  if (lives <= 0) {
    gameOver();
  } else {
    enterPlayerDead();
  }
}

function enterPlayerDead() {
  state = STATE.PLAYER_DEAD;
  player.alive = false;
  const msg = timedOut
    ? `TIME'S UP\nLIVES x${lives}\nPRESS SPACE TO CONTINUE`
    : `YOU GOT BLASTED\nLIVES x${lives}\nPRESS SPACE TO CONTINUE`;
  showOverlay(msg);
}

function gameOver() {
  state = STATE.GAME_OVER;
  player.alive = false;
  checkHighscore();
  showOverlay(`GAME OVER\nSCORE ${score}\nPRESS R TO RESTART`);
}

function completeLevel() {
  score += SCORE_LEVEL + Math.floor(levelTimeRemaining) * SCORE_TIME_MULT;
  state = STATE.VICTORY;
  checkHighscore();
  showOverlay(`YOU ESCAPED THE SHADOW MAZE\nSCORE ${score}\nPRESS R TO PLAY AGAIN`);
}

function pickupCheck() {
  const t = centerTile(player);
  const tile = tileAt(t.x, t.y);
  if (tile === T_KEY) {
    tiles[t.y][t.x] = T_FLOOR;
    hasKey = true;
    score += SCORE_KEY;
  } else if (tile === T_EXIT && hasKey) {
    completeLevel();
  }
}

/* ---------- Enemy AI (Rat: random walk) ---------- */
function randomDir() {
  const dirs = ['up', 'down', 'left', 'right'];
  return dirs[Math.floor(Math.random() * dirs.length)];
}

function updateEnemy(enemy, dt) {
  if (!enemy.alive) return;
  enemy.dirTimer -= dt;
  const moved = moveEntity(enemy, enemy.dir, dt);
  if (!moved || enemy.dirTimer <= 0) {
    enemy.dir = randomDir();
    enemy.dirTimer = 0.8 + Math.random() * 0.8;
  }
  if (player.alive && boxesOverlap(player, enemy)) hitPlayer();
}

/* ---------- Game loop ---------- */
function update(dt) {
  if (state !== STATE.PLAYING) return;

  if (player.invuln > 0) player.invuln -= dt;

  moveEntity(player, currentDirection(), dt);
  pickupCheck();

  for (const enemy of enemies) updateEnemy(enemy, dt);

  updateBombs(dt);
  updateExplosions(dt);

  levelTimeRemaining -= dt;
  if (levelTimeRemaining <= 0) {
    levelTimeRemaining = 0;
    timedOut = true;
    hitPlayer();
  }

  updateHud();
}

function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      drawTile(x, y, tiles[y][x]);
    }
  }

  for (const exp of explosions) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(exp.x * TILE + 2, exp.y * TILE + 2, TILE - 4, TILE - 4);
  }

  for (const bomb of bombs) {
    const blink = bomb.timer < 0.6 ? Math.floor(bomb.timer * 10) % 2 === 0 : true;
    if (blink) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(bomb.x * TILE + TILE / 2, bomb.y * TILE + TILE / 2, TILE * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(enemy.x + HITBOX / 2, enemy.y + HITBOX / 2, HITBOX / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillRect(enemy.x + HITBOX * 0.25, enemy.y + HITBOX * 0.3, 3, 3);
    ctx.fillRect(enemy.x + HITBOX * 0.65, enemy.y + HITBOX * 0.3, 3, 3);
  }

  if (player.alive) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(player.x, player.y, HITBOX, HITBOX);
    ctx.fillStyle = '#000';
    const n = 4;
    const cx = player.x + HITBOX / 2;
    const cy = player.y + HITBOX / 2;
    if (player.dir === 'up') ctx.fillRect(cx - n / 2, player.y, n, n);
    else if (player.dir === 'down') ctx.fillRect(cx - n / 2, player.y + HITBOX - n, n, n);
    else if (player.dir === 'left') ctx.fillRect(player.x, cy - n / 2, n, n);
    else ctx.fillRect(player.x + HITBOX - n, cy - n / 2, n, n);
  }
}

function drawTile(x, y, tile) {
  const px = x * TILE;
  const py = y * TILE;
  if (tile === T_WALL) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
  } else if (tile === T_BLOCK) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + 6, py + 6);
    ctx.lineTo(px + TILE - 6, py + TILE - 6);
    ctx.moveTo(px + TILE - 6, py + 6);
    ctx.lineTo(px + 6, py + TILE - 6);
    ctx.stroke();
  } else if (tile === T_KEY) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px + TILE / 2, py + TILE / 2 - 4, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(px + TILE / 2 - 2, py + TILE / 2, 4, 12);
  } else if (tile === T_EXIT) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.strokeRect(px + 5, py + 5, TILE - 10, TILE - 10);
    if (hasKey) ctx.fillRect(px + 9, py + 9, TILE - 18, TILE - 18);
  }
}

function updateHud() {
  scoreEl.textContent = `SCORE ${String(score).padStart(6, '0')}`;
  livesEl.textContent = `LIVES x${lives}`;
  bombsEl.textContent = `BOMBS ${bombCapacity}`;
  blastEl.textContent = `BLAST ${blastRadius}`;
  timeEl.textContent = `TIME ${Math.ceil(levelTimeRemaining)}`;
  keyStatusEl.textContent = `KEY ${hasKey ? '✓' : '✗'}`;
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

/* ---------- State transitions ---------- */
function showOverlay(text) {
  overlayMsg.textContent = text;
  overlayMsg.classList.add('visible');
}

function hideOverlay() {
  overlayMsg.classList.remove('visible');
}

function startGame() {
  resetRun();
  hideOverlay();
  updateHud();
  state = STATE.PLAYING;
}

function continueAfterDeath() {
  loadLevel();
  hideOverlay();
  updateHud();
  state = STATE.PLAYING;
}

function restartLevel() {
  loadLevel();
  hideOverlay();
  updateHud();
  state = STATE.PLAYING;
}

function togglePause() {
  if (state === STATE.PLAYING) {
    state = STATE.PAUSED;
    showOverlay('PAUSED\nPRESS P TO RESUME');
  } else if (state === STATE.PAUSED) {
    hideOverlay();
    state = STATE.PLAYING;
  }
}

function handlePrimaryAction() {
  if (state === STATE.TITLE || state === STATE.GAME_OVER || state === STATE.VICTORY) {
    startGame();
  } else if (state === STATE.PLAYER_DEAD) {
    continueAfterDeath();
  } else if (state === STATE.PLAYING) {
    placeBomb();
  }
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
    if (state === STATE.PLAYING || state === STATE.PAUSED) restartLevel();
    else startGame();
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

const DPAD_DIRS = {
  'btn-up': 'up',
  'btn-down': 'down',
  'btn-left': 'left',
  'btn-right': 'right',
};

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

const bombBtn = document.getElementById('btn-bomb');
bombBtn.addEventListener('touchstart', (e) => { e.preventDefault(); placeBomb(); }, { passive: false });
bombBtn.addEventListener('click', () => placeBomb());

/* ---------- Init ---------- */
resetRun();
updateHud();
showOverlay('SHADOW BOMBER\nTAP OR PRESS SPACE TO START');
requestAnimationFrame((t) => { lastTime = t; requestAnimationFrame(loop); });
