function drawIcon(canvasId, pattern) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const cell = canvas.width / pattern.length;

  ctx.fillStyle = '#fff';
  pattern.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) ctx.fillRect(x * cell, y * cell, cell, cell);
    });
  });
}

const SNAKE_ICON = [
  [0, 1, 1, 1, 1, 0, 0, 0],
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 1, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

const TETRIS_ICON = [
  [0, 0, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 1, 0, 0, 1, 1, 0, 0],
  [1, 1, 1, 1, 1, 1, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1],
];

const BOMBER_ICON = [
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [1, 1, 0, 1, 1, 1, 0, 0],
  [1, 1, 1, 1, 1, 1, 0, 0],
  [1, 1, 0, 1, 1, 1, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
];

const TENNIS_ICON = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 1, 0, 0],
  [0, 1, 0, 0, 0, 1, 0, 0],
  [0, 1, 0, 1, 0, 1, 0, 0],
  [0, 1, 0, 0, 0, 1, 0, 0],
  [0, 1, 1, 1, 1, 1, 0, 0],
  [0, 0, 0, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 1, 0, 0, 0],
];

drawIcon('icon-snake', SNAKE_ICON);
drawIcon('icon-tetris', TETRIS_ICON);
drawIcon('icon-bomber', BOMBER_ICON);
drawIcon('icon-tennis', TENNIS_ICON);

document.getElementById('refresh-btn').addEventListener('click', () => location.reload());
