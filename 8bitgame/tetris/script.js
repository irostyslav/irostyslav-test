const boardCanvas = document.getElementById('board');
const boardCtx = boardCanvas.getContext('2d');
const nextCanvas = document.getElementById('next');
const nextCtx = nextCanvas.getContext('2d');

const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const highscoreEl = document.getElementById('highscore');
const overlayMsg = document.getElementById('overlay-msg');

const CELL = 18;
const COLS = boardCanvas.width / CELL;
const ROWS = boardCanvas.height / CELL;

const WHITE = '#fff';
const BLACK = '#000';

const SHAPES = {
  I: [
    ['....', 'XXXX', '....', '....'],
    ['..X.', '..X.', '..X.', '..X.'],
    ['....', '....', 'XXXX', '....'],
    ['.X..', '.X..', '.X..', '.X..'],
  ],
  O: [
    ['....', '.XX.', '.XX.', '....'],
    ['....', '.XX.', '.XX.', '....'],
    ['....', '.XX.', '.XX.', '....'],
    ['....', '.XX.', '.XX.', '....'],
  ],
  T: [
    ['....', '.X..', 'XXX.', '....'],
    ['....', '.X..', '.XX.', '.X..'],
    ['....', '....', 'XXX.', '.X..'],
    ['....', '.X..', 'XX..', '.X..'],
  ],
  S: [
    ['....', '.XX.', 'XX..', '....'],
    ['.X..', '.XX.', '..X.', '....'],
    ['....', '.XX.', 'XX..', '....'],
    ['.X..', '.XX.', '..X.', '....'],
  ],
  Z: [
    ['....', 'XX..', '.XX.', '....'],
    ['..X.', '.XX.', '.X..', '....'],
    ['....', 'XX..', '.XX.', '....'],
    ['..X.', '.XX.', '.X..', '....'],
  ],
  J: [
    ['....', 'X...', 'XXX.', '....'],
    ['.XX.', '.X..', '.X..', '....'],
    ['....', 'XXX.', '..X.', '....'],
    ['.X..', '.X..', 'XX..', '....'],
  ],
  L: [
    ['....', '..X.', 'XXX.', '....'],
    ['.X..', '.X..', '.XX.', '....'],
    ['....', 'XXX.', 'X...', '....'],
    ['XX..', '.X..', '.X..', '....'],
  ],
};
const TYPES = Object.keys(SHAPES);

let board, piece, nextType, score, lines, level, highscore, running, dropTimer;

const MAX_HISTORY = 5;
let history = [];
let hasLost = false;
let rewindController;

highscore = Number(localStorage.getItem('tetris-highscore') || 0);
highscoreEl.textContent = `BEST ${highscore}`;

function cellsOf(type, rotation) {
  const cells = [];
  SHAPES[type][rotation].forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === 'X') cells.push({ x, y });
    });
  });
  return cells;
}

function randomType() {
  return TYPES[Math.floor(Math.random() * TYPES.length)];
}

function spawnPiece(type) {
  return { type, rotation: 0, x: Math.floor(COLS / 2) - 2, y: -1 };
}

function collides(type, rotation, ox, oy) {
  return cellsOf(type, rotation).some(({ x, y }) => {
    const bx = ox + x;
    const by = oy + y;
    if (bx < 0 || bx >= COLS || by >= ROWS) return true;
    if (by < 0) return false;
    return board[by][bx];
  });
}

function resetState() {
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  score = 0;
  lines = 0;
  level = 1;
  scoreEl.textContent = `SCORE ${score}`;
  linesEl.textContent = `LINES ${lines}`;
  levelEl.textContent = level;
  nextType = randomType();
  piece = spawnPiece(randomType());
  history = [];
  hasLost = false;
  if (rewindController) rewindController.setActive(false);
}

function snapshotState() {
  return {
    board: board.map((row) => row.slice()),
    piece: { ...piece },
    nextType,
    score,
    lines,
    level,
  };
}

function recordHistory() {
  history.push(snapshotState());
  if (history.length > MAX_HISTORY) history.shift();
}

function restoreFromHistory(stepsBack) {
  const snap = history[Math.max(0, history.length - stepsBack)];
  if (!snap) return;
  board = snap.board.map((row) => row.slice());
  piece = { ...snap.piece };
  nextType = snap.nextType;
  score = snap.score;
  lines = snap.lines;
  level = snap.level;
  scoreEl.textContent = `SCORE ${score}`;
  linesEl.textContent = `LINES ${lines}`;
  levelEl.textContent = level;
  history = [];
  hasLost = false;
  if (rewindController) rewindController.setActive(false);
  draw();
  overlayMsg.classList.remove('visible');
  running = true;
  restartDropTimer();
}

function dropSpeed() {
  return Math.max(100, 800 - (level - 1) * 70);
}

function drawCell(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
  ctx.fillStyle = BLACK;
  ctx.fillRect(x * CELL + 4, y * CELL + 4, CELL - 8, CELL - 8);
}

function draw() {
  boardCtx.fillStyle = BLACK;
  boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (board[y][x]) drawCell(boardCtx, x, y, WHITE);
    }
  }

  cellsOf(piece.type, piece.rotation).forEach(({ x, y }) => {
    const by = piece.y + y;
    if (by >= 0) drawCell(boardCtx, piece.x + x, by, WHITE);
  });

  nextCtx.fillStyle = BLACK;
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  cellsOf(nextType, 0).forEach(({ x, y }) => {
    drawCell(nextCtx, x, y, WHITE);
  });
}

function tryMove(dx, dy) {
  if (!collides(piece.type, piece.rotation, piece.x + dx, piece.y + dy)) {
    piece.x += dx;
    piece.y += dy;
    draw();
    return true;
  }
  return false;
}

function tryRotate() {
  const newRotation = (piece.rotation + 1) % 4;
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collides(piece.type, newRotation, piece.x + kick, piece.y)) {
      piece.rotation = newRotation;
      piece.x += kick;
      draw();
      return;
    }
  }
}

const LINE_SCORE = { 1: 40, 2: 100, 3: 300, 4: 1200 };

function clearLines() {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (board[y].every(Boolean)) {
      board.splice(y, 1);
      board.unshift(Array(COLS).fill(0));
      cleared += 1;
      y += 1;
    }
  }
  if (cleared > 0) {
    score += (LINE_SCORE[cleared] || 0) * level;
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    scoreEl.textContent = `SCORE ${score}`;
    linesEl.textContent = `LINES ${lines}`;
    levelEl.textContent = level;
  }
}

function lockPiece() {
  cellsOf(piece.type, piece.rotation).forEach(({ x, y }) => {
    const bx = piece.x + x;
    const by = piece.y + y;
    if (by >= 0) board[by][bx] = 1;
  });
  clearLines();
  restartDropTimer();

  piece = spawnPiece(nextType);
  nextType = randomType();

  if (collides(piece.type, piece.rotation, piece.x, piece.y)) {
    gameOver();
    return;
  }
  draw();
}

function step() {
  recordHistory();
  if (!tryMove(0, 1)) {
    lockPiece();
  }
}

function hardDrop() {
  recordHistory();
  while (tryMove(0, 1)) {}
  lockPiece();
}

function restartDropTimer() {
  clearInterval(dropTimer);
  dropTimer = setInterval(step, dropSpeed());
}

function gameOver() {
  running = false;
  clearInterval(dropTimer);
  hasLost = true;
  if (rewindController) rewindController.setActive(true);
  if (score > highscore) {
    highscore = score;
    localStorage.setItem('tetris-highscore', String(highscore));
    highscoreEl.textContent = `BEST ${highscore}`;
  }
  overlayMsg.textContent = `GAME OVER — SCORE ${score}\nPRESS SPACE TO RETRY`;
  overlayMsg.classList.add('visible');
}

function startGame() {
  resetState();
  draw();
  overlayMsg.classList.remove('visible');
  running = true;
  restartDropTimer();
}

function bindRepeatable(id, action) {
  const btn = document.getElementById(id);
  let interval = null;
  const start = (e) => {
    e.preventDefault();
    action();
    clearInterval(interval);
    interval = setInterval(action, 120);
  };
  const stop = () => clearInterval(interval);
  btn.addEventListener('touchstart', start, { passive: false });
  btn.addEventListener('touchend', stop);
  btn.addEventListener('touchcancel', stop);
  btn.addEventListener('mousedown', start);
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (running) hardDrop();
    else startGame();
    return;
  }
  if (!running) return;

  switch (e.key) {
    case 'ArrowLeft':
    case 'a':
      e.preventDefault();
      tryMove(-1, 0);
      break;
    case 'ArrowRight':
    case 'd':
      e.preventDefault();
      tryMove(1, 0);
      break;
    case 'ArrowDown':
    case 's':
      e.preventDefault();
      tryMove(0, 1);
      break;
    case 'ArrowUp':
    case 'w':
      e.preventDefault();
      tryRotate();
      break;
  }
});

overlayMsg.addEventListener('click', () => {
  if (!running) startGame();
});

document.getElementById('btn-rotate').addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (running) tryRotate();
}, { passive: false });
document.getElementById('btn-rotate').addEventListener('click', () => {
  if (running) tryRotate();
});

bindRepeatable('btn-left', () => running && tryMove(-1, 0));
bindRepeatable('btn-right', () => running && tryMove(1, 0));
bindRepeatable('btn-down', () => running && tryMove(0, 1));

rewindController = window.RewindDial.attach({
  getHistoryLength: () => history.length,
  onCommit: restoreFromHistory,
});

resetState();
draw();
overlayMsg.textContent = 'TAP OR PRESS SPACE TO START';
overlayMsg.classList.add('visible');
