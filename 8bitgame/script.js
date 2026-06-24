const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highscoreEl = document.getElementById('highscore');
const overlayMsg = document.getElementById('overlay-msg');

const GRID = 16;
const COLS = canvas.width / GRID;
const ROWS = canvas.height / GRID;
const TICK_MS = 110;

const WHITE = '#fff';
const BLACK = '#000';

let snake, dir, nextDir, food, score, highscore, running, loopId;

highscore = Number(localStorage.getItem('8bitgame-highscore') || 0);
highscoreEl.textContent = `BEST ${highscore}`;

function resetState() {
  snake = [
    { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) },
    { x: Math.floor(COLS / 2) - 1, y: Math.floor(ROWS / 2) },
    { x: Math.floor(COLS / 2) - 2, y: Math.floor(ROWS / 2) },
  ];
  dir = { x: 1, y: 0 };
  nextDir = dir;
  score = 0;
  scoreEl.textContent = `SCORE ${score}`;
  placeFood();
}

function placeFood() {
  let pos;
  do {
    pos = {
      x: Math.floor(Math.random() * COLS),
      y: Math.floor(Math.random() * ROWS),
    };
  } while (snake.some(s => s.x === pos.x && s.y === pos.y));
  food = pos;
}

function drawCell(x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x * GRID + 1, y * GRID + 1, GRID - 2, GRID - 2);
}

function draw() {
  ctx.fillStyle = BLACK;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawCell(food.x, food.y, WHITE);

  snake.forEach((segment, i) => {
    drawCell(segment.x, segment.y, WHITE);
    if (i > 0) {
      ctx.fillStyle = BLACK;
      ctx.fillRect(segment.x * GRID + 4, segment.y * GRID + 4, GRID - 8, GRID - 8);
    }
  });
}

function step() {
  dir = nextDir;
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  const hitWall = head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS;
  const hitSelf = snake.some(s => s.x === head.x && s.y === head.y);
  if (hitWall || hitSelf) {
    gameOver();
    return;
  }

  snake.unshift(head);

  if (head.x === food.x && head.y === food.y) {
    score += 1;
    scoreEl.textContent = `SCORE ${score}`;
    placeFood();
  } else {
    snake.pop();
  }

  draw();
}

function gameOver() {
  running = false;
  clearInterval(loopId);
  if (score > highscore) {
    highscore = score;
    localStorage.setItem('8bitgame-highscore', String(highscore));
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
  clearInterval(loopId);
  loopId = setInterval(step, TICK_MS);
}

const KEY_DIRS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    startGame();
    return;
  }

  const newDir = KEY_DIRS[e.key];
  if (!newDir) return;
  e.preventDefault();

  const isOpposite = newDir.x === -dir.x && newDir.y === -dir.y;
  if (!isOpposite) nextDir = newDir;
});

resetState();
draw();
overlayMsg.textContent = 'PRESS SPACE TO START';
overlayMsg.classList.add('visible');
