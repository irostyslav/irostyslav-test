// ---------- Constants ----------
const KNIGHT_DELTAS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const KING_DELTAS = [...BISHOP_DIRS, ...ROOK_DIRS];

const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const GLYPH = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

const PAWN_BONUS = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [5, 5, 5, 5, 5, 5, 5, 5],
  [1, 1, 2, 3, 3, 2, 1, 1],
  [0, 0, 1, 4, 4, 1, 0, 0],
  [0, 0, 1, 4, 4, 1, 0, 0],
  [1, 1, 2, 3, 3, 2, 1, 1],
  [5, 5, 5, 5, 5, 5, 5, 5],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const KNIGHT_BONUS = [
  [-5, -4, -3, -3, -3, -3, -4, -5],
  [-4, -2, 0, 0, 0, 0, -2, -4],
  [-3, 0, 1, 2, 2, 1, 0, -3],
  [-3, 1, 2, 3, 3, 2, 1, -3],
  [-3, 1, 2, 3, 3, 2, 1, -3],
  [-3, 0, 1, 2, 2, 1, 0, -3],
  [-4, -2, 0, 0, 0, 0, -2, -4],
  [-5, -4, -3, -3, -3, -3, -4, -5],
];

const AI_PARAMS = {
  easy: { depth: 1, randomMoveChance: 0.30, thinkMs: 350 },
  medium: { depth: 2, randomMoveChance: 0, thinkMs: 450 },
  hard: { depth: 3, randomMoveChance: 0, thinkMs: 550 },
};

const FILES = 'abcdefgh';

// ---------- State ----------
const STATE = { MENU: 'menu', PLAYING: 'playing', PROMOTING: 'promoting', PAUSED: 'paused', GAME_OVER: 'gameover' };
const settings = { difficulty: 'medium' };

let state = STATE.MENU;
let board = null;
let turn = 'w';
let enPassantTarget = null;
let selected = null;
let legalForSelected = [];
let lastMove = null;
let moveHistory = [];
let captured = { w: [], b: [] };
let pendingPromotion = null;
let resultText = '';

// ---------- DOM ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlay-msg');
const menuPanel = document.getElementById('menu-panel');
const overlayText = document.getElementById('overlay-text');
const promoPanel = document.getElementById('promo-panel');
const helpPanel = document.getElementById('help-panel');
const hudStatus = document.getElementById('hud-status');
const badgeTurn = document.getElementById('badge-turn');
const badgeMoves = document.getElementById('badge-moves');
const badgeHelp = document.getElementById('badge-help');
const helpCloseBtn = document.getElementById('help-close-btn');
const moveList = document.getElementById('move-list');
const movelistWrap = document.getElementById('movelist-wrap');
const capturedWhiteEl = document.getElementById('captured-white');
const capturedBlackEl = document.getElementById('captured-black');
const resignBtn = document.getElementById('resign-btn');
const drawBtn = document.getElementById('draw-btn');

const CELL = canvas.width / 8;

// ---------- Halftone pattern ----------
function makeHalftoneTile() {
  const tile = document.createElement('canvas');
  tile.width = CELL;
  tile.height = CELL;
  const tctx = tile.getContext('2d');
  tctx.fillStyle = '#d8cba8';
  tctx.fillRect(0, 0, CELL, CELL);
  tctx.fillStyle = '#1b1812';
  const spacing = CELL / 6;
  const r = spacing * 0.32;
  for (let y = spacing / 2; y < CELL; y += spacing) {
    for (let x = spacing / 2; x < CELL; x += spacing) {
      tctx.beginPath();
      tctx.arc(x, y, r, 0, Math.PI * 2);
      tctx.fill();
    }
  }
  return tile;
}
const halftoneTile = makeHalftoneTile();
const halftonePattern = ctx.createPattern(halftoneTile, 'repeat');

// ---------- Board helpers ----------
function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function cloneBoard(b) { return b.map((row) => row.map((cell) => (cell ? { ...cell } : null))); }

function createInitialBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let c = 0; c < 8; c++) {
    b[0][c] = { type: backRank[c], color: 'b', hasMoved: false };
    b[1][c] = { type: 'p', color: 'b', hasMoved: false };
    b[6][c] = { type: 'p', color: 'w', hasMoved: false };
    b[7][c] = { type: backRank[c], color: 'w', hasMoved: false };
  }
  return b;
}

function findKing(b, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (p && p.type === 'k' && p.color === color) return { row: r, col: c };
    }
  }
  return null;
}

function isSquareAttacked(b, row, col, byColor) {
  const pawnDir = byColor === 'w' ? 1 : -1;
  for (const dc of [-1, 1]) {
    const rr = row + pawnDir, cc = col + dc;
    if (inBounds(rr, cc)) {
      const p = b[rr][cc];
      if (p && p.color === byColor && p.type === 'p') return true;
    }
  }
  for (const [dr, dc] of KNIGHT_DELTAS) {
    const rr = row + dr, cc = col + dc;
    if (inBounds(rr, cc)) {
      const p = b[rr][cc];
      if (p && p.color === byColor && p.type === 'n') return true;
    }
  }
  for (const [dr, dc] of KING_DELTAS) {
    const rr = row + dr, cc = col + dc;
    if (inBounds(rr, cc)) {
      const p = b[rr][cc];
      if (p && p.color === byColor && p.type === 'k') return true;
    }
  }
  for (const [dr, dc] of BISHOP_DIRS) {
    let rr = row + dr, cc = col + dc;
    while (inBounds(rr, cc)) {
      const p = b[rr][cc];
      if (p) {
        if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }
  for (const [dr, dc] of ROOK_DIRS) {
    let rr = row + dr, cc = col + dc;
    while (inBounds(rr, cc)) {
      const p = b[rr][cc];
      if (p) {
        if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }
  return false;
}

function addPawnMove(moves, r, c, rr, cc, promoRow) {
  if (rr === promoRow) {
    for (const promo of ['q', 'r', 'b', 'n']) {
      moves.push({ from: { row: r, col: c }, to: { row: rr, col: cc }, promotion: promo });
    }
  } else {
    moves.push({ from: { row: r, col: c }, to: { row: rr, col: cc } });
  }
}

function genPieceMoves(b, r, c, epTarget) {
  const piece = b[r][c];
  const moves = [];
  const enemy = piece.color === 'w' ? 'b' : 'w';

  if (piece.type === 'p') {
    const dir = piece.color === 'w' ? -1 : 1;
    const startRow = piece.color === 'w' ? 6 : 1;
    const promoRow = piece.color === 'w' ? 0 : 7;
    const r1 = r + dir;
    if (inBounds(r1, c) && !b[r1][c]) {
      addPawnMove(moves, r, c, r1, c, promoRow);
      const r2 = r + dir * 2;
      if (r === startRow && !b[r2][c]) {
        moves.push({ from: { row: r, col: c }, to: { row: r2, col: c }, doublePush: true });
      }
    }
    for (const dc of [-1, 1]) {
      const cc = c + dc, rr = r1;
      if (!inBounds(rr, cc)) continue;
      const target = b[rr][cc];
      if (target && target.color === enemy) {
        addPawnMove(moves, r, c, rr, cc, promoRow);
      } else if (epTarget && epTarget.row === rr && epTarget.col === cc) {
        moves.push({ from: { row: r, col: c }, to: { row: rr, col: cc }, isEnPassant: true });
      }
    }
  } else if (piece.type === 'n') {
    for (const [dr, dc] of KNIGHT_DELTAS) {
      const rr = r + dr, cc = c + dc;
      if (!inBounds(rr, cc)) continue;
      const target = b[rr][cc];
      if (!target || target.color === enemy) moves.push({ from: { row: r, col: c }, to: { row: rr, col: cc } });
    }
  } else if (piece.type === 'b' || piece.type === 'r' || piece.type === 'q') {
    const dirs = piece.type === 'b' ? BISHOP_DIRS : piece.type === 'r' ? ROOK_DIRS : KING_DELTAS;
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc)) {
        const target = b[rr][cc];
        if (!target) {
          moves.push({ from: { row: r, col: c }, to: { row: rr, col: cc } });
        } else {
          if (target.color === enemy) moves.push({ from: { row: r, col: c }, to: { row: rr, col: cc } });
          break;
        }
        rr += dr; cc += dc;
      }
    }
  } else if (piece.type === 'k') {
    for (const [dr, dc] of KING_DELTAS) {
      const rr = r + dr, cc = c + dc;
      if (!inBounds(rr, cc)) continue;
      const target = b[rr][cc];
      if (!target || target.color === enemy) moves.push({ from: { row: r, col: c }, to: { row: rr, col: cc } });
    }
  }
  return moves;
}

function getCastleMoves(b, row, col) {
  const king = b[row][col];
  const moves = [];
  if (!king || king.type !== 'k' || king.hasMoved) return moves;
  const color = king.color;
  const enemy = color === 'w' ? 'b' : 'w';
  if (isSquareAttacked(b, row, col, enemy)) return moves;

  const kingsideRook = b[row][7];
  if (kingsideRook && kingsideRook.type === 'r' && kingsideRook.color === color && !kingsideRook.hasMoved) {
    if (!b[row][5] && !b[row][6] &&
        !isSquareAttacked(b, row, 5, enemy) && !isSquareAttacked(b, row, 6, enemy)) {
      moves.push({ from: { row, col }, to: { row, col: 6 }, isCastle: 'K' });
    }
  }
  const queensideRook = b[row][0];
  if (queensideRook && queensideRook.type === 'r' && queensideRook.color === color && !queensideRook.hasMoved) {
    if (!b[row][1] && !b[row][2] && !b[row][3] &&
        !isSquareAttacked(b, row, 2, enemy) && !isSquareAttacked(b, row, 3, enemy)) {
      moves.push({ from: { row, col }, to: { row, col: 2 }, isCastle: 'Q' });
    }
  }
  return moves;
}

function pseudoMovesFor(b, row, col, epTarget) {
  const piece = b[row][col];
  if (!piece) return [];
  let moves = genPieceMoves(b, row, col, epTarget);
  if (piece.type === 'k') moves = moves.concat(getCastleMoves(b, row, col));
  return moves;
}

function applyMove(b, move) {
  const { from, to } = move;
  const piece = b[from.row][from.col];
  let capturedPiece = b[to.row][to.col] || null;

  if (move.isEnPassant) {
    capturedPiece = b[from.row][to.col];
    b[from.row][to.col] = null;
  }

  b[to.row][to.col] = piece;
  b[from.row][from.col] = null;
  piece.hasMoved = true;

  if (move.isCastle) {
    const row = from.row;
    if (move.isCastle === 'K') {
      const rook = b[row][7];
      b[row][5] = rook;
      b[row][7] = null;
      if (rook) rook.hasMoved = true;
    } else {
      const rook = b[row][0];
      b[row][3] = rook;
      b[row][0] = null;
      if (rook) rook.hasMoved = true;
    }
  }

  if (move.promotion) piece.type = move.promotion;

  return { captured: capturedPiece };
}

function legalMovesFor(b, row, col, epTarget) {
  const piece = b[row][col];
  if (!piece) return [];
  const pseudo = pseudoMovesFor(b, row, col, epTarget);
  const legal = [];
  for (const m of pseudo) {
    const copy = cloneBoard(b);
    applyMove(copy, m);
    const kingPos = findKing(copy, piece.color);
    if (kingPos && !isSquareAttacked(copy, kingPos.row, kingPos.col, piece.color === 'w' ? 'b' : 'w')) {
      legal.push(m);
    }
  }
  return legal;
}

function allLegalMoves(b, color, epTarget) {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (p && p.color === color) moves.push(...legalMovesFor(b, r, c, epTarget));
    }
  }
  return moves;
}

function isCheck(b, color) {
  const k = findKing(b, color);
  return !!k && isSquareAttacked(b, k.row, k.col, color === 'w' ? 'b' : 'w');
}

function isCheckmate(b, color, epTarget) {
  return isCheck(b, color) && allLegalMoves(b, color, epTarget).length === 0;
}

function isStalemate(b, color, epTarget) {
  return !isCheck(b, color) && allLegalMoves(b, color, epTarget).length === 0;
}

// ---------- SAN-ish move label ----------
function squareName(sq) { return FILES[sq.col] + (8 - sq.row); }

function describeMove(b, move, color) {
  const piece = b[move.from.row][move.from.col];
  if (move.isCastle === 'K') return 'O-O';
  if (move.isCastle === 'Q') return 'O-O-O';
  const capture = b[move.to.row][move.to.col] || move.isEnPassant;
  const letter = piece.type === 'p' ? '' : piece.type.toUpperCase();
  const fromFile = piece.type === 'p' && capture ? FILES[move.from.col] : '';
  let s = `${letter}${fromFile}${capture ? 'x' : ''}${squareName(move.to)}`;
  if (move.promotion) s += `=${move.promotion.toUpperCase()}`;
  return s;
}

// ---------- Evaluation ----------
function evaluateBoard(b) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (!p) continue;
      let val = PIECE_VALUE[p.type];
      if (p.type === 'p') val += p.color === 'w' ? PAWN_BONUS[r][c] : PAWN_BONUS[7 - r][c];
      if (p.type === 'n') val += p.color === 'w' ? KNIGHT_BONUS[r][c] : KNIGHT_BONUS[7 - r][c];
      score += p.color === 'w' ? val : -val;
    }
  }
  if (isCheck(b, 'b')) score += 30;
  if (isCheck(b, 'w')) score -= 30;
  return score;
}

function orderedMoves(b, color, epTarget) {
  const moves = allLegalMoves(b, color, epTarget).filter((m) => !m.promotion || m.promotion === 'q');
  moves.sort((m1, m2) => {
    const v1 = b[m1.to.row][m1.to.col] ? PIECE_VALUE[b[m1.to.row][m1.to.col].type] : 0;
    const v2 = b[m2.to.row][m2.to.col] ? PIECE_VALUE[b[m2.to.row][m2.to.col].type] : 0;
    return v2 - v1;
  });
  return moves;
}

function minimax(b, depth, alpha, beta, maximizing, epTarget) {
  const color = maximizing ? 'w' : 'b';
  if (depth === 0) return evaluateBoard(b);
  const moves = orderedMoves(b, color, epTarget);
  if (moves.length === 0) {
    if (isCheck(b, color)) return maximizing ? -100000 - depth : 100000 + depth;
    return 0;
  }
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const copy = cloneBoard(b);
      applyMove(copy, m);
      const nextEp = m.doublePush ? { row: (m.from.row + m.to.row) / 2, col: m.to.col } : null;
      const val = minimax(copy, depth - 1, alpha, beta, false, nextEp);
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of moves) {
    const copy = cloneBoard(b);
    applyMove(copy, m);
    const nextEp = m.doublePush ? { row: (m.from.row + m.to.row) / 2, col: m.to.col } : null;
    const val = minimax(copy, depth - 1, alpha, beta, true, nextEp);
    best = Math.min(best, val);
    beta = Math.min(beta, val);
    if (alpha >= beta) break;
  }
  return best;
}

function chooseAiMove() {
  const params = AI_PARAMS[settings.difficulty];
  const moves = orderedMoves(board, 'b', enPassantTarget);
  if (moves.length === 0) return null;

  if (Math.random() < params.randomMoveChance) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  let bestMove = moves[0];
  let bestVal = Infinity;
  for (const m of moves) {
    const copy = cloneBoard(board);
    applyMove(copy, m);
    const nextEp = m.doublePush ? { row: (m.from.row + m.to.row) / 2, col: m.to.col } : null;
    const val = minimax(copy, params.depth - 1, -Infinity, Infinity, true, nextEp);
    if (val < bestVal) {
      bestVal = val;
      bestMove = m;
    }
  }
  return bestMove;
}

// ---------- Game flow ----------
function newGame() {
  board = createInitialBoard();
  turn = 'w';
  enPassantTarget = null;
  selected = null;
  legalForSelected = [];
  lastMove = null;
  moveHistory = [];
  captured = { w: [], b: [] };
  pendingPromotion = null;
  resultText = '';
  state = STATE.PLAYING;
  hideOverlay();
  renderMoveList();
  renderCaptured();
  updateHud();
  updateTurnBadge();
  draw();
}

function hideOverlay() {
  overlayMsg.classList.remove('visible');
  menuPanel.classList.remove('visible');
  overlayText.classList.remove('visible');
  promoPanel.classList.remove('visible');
  helpPanel.classList.remove('visible');
}

function showMenu() {
  state = STATE.MENU;
  overlayMsg.classList.add('visible');
  menuPanel.classList.add('visible');
  overlayText.classList.remove('visible');
  promoPanel.classList.remove('visible');
  helpPanel.classList.remove('visible');
  updateHud();
}

function showOverlayText(html) {
  overlayMsg.classList.add('visible');
  menuPanel.classList.remove('visible');
  promoPanel.classList.remove('visible');
  helpPanel.classList.remove('visible');
  overlayText.classList.add('visible');
  overlayText.innerHTML = html;
}

function showPromoPanel() {
  overlayMsg.classList.add('visible');
  menuPanel.classList.remove('visible');
  overlayText.classList.remove('visible');
  helpPanel.classList.remove('visible');
  promoPanel.classList.add('visible');
}

function showHelpPanel() {
  overlayMsg.classList.add('visible');
  menuPanel.classList.remove('visible');
  overlayText.classList.remove('visible');
  promoPanel.classList.remove('visible');
  helpPanel.classList.add('visible');
}

function endGame(text) {
  resultText = text;
  state = STATE.GAME_OVER;
  selected = null;
  legalForSelected = [];
  showOverlayText(`${text}\n<button class="menu-opt" id="back-to-menu-btn" type="button">MENU</button>`);
  document.getElementById('back-to-menu-btn').addEventListener('click', () => showMenu());
  updateHud();
  draw();
}

function finishMove(move, color) {
  const label = describeMove(board, move, color);
  const { captured: cap } = applyMove(board, move);
  if (cap) captured[color].push(cap.type);

  enPassantTarget = move.doublePush ? { row: (move.from.row + move.to.row) / 2, col: move.to.col } : null;
  lastMove = move;
  turn = color === 'w' ? 'b' : 'w';
  moveHistory.push({ color, label });

  renderMoveList();
  renderCaptured();

  if (isCheckmate(board, turn, enPassantTarget)) {
    endGame(color === 'w' ? 'CHECKMATE — YOU WIN' : 'CHECKMATE — AI WINS');
    return;
  }
  if (isStalemate(board, turn, enPassantTarget)) {
    endGame('STALEMATE — DRAW');
    return;
  }

  updateHud();
  updateTurnBadge();
  draw();

  if (turn === 'b' && state === STATE.PLAYING) {
    setTimeout(aiTurn, AI_PARAMS[settings.difficulty].thinkMs);
  }
}

function aiTurn() {
  if (state !== STATE.PLAYING || turn !== 'b') return;
  const move = chooseAiMove();
  if (!move) return;
  finishMove(move, 'b');
}

function playerMove(move) {
  if (move.promotion) {
    pendingPromotion = move;
    state = STATE.PROMOTING;
    showPromoPanel();
    return;
  }
  selected = null;
  legalForSelected = [];
  finishMove(move, 'w');
}

function resolvePromotion(pieceType) {
  if (!pendingPromotion) return;
  const move = { ...pendingPromotion, promotion: pieceType };
  pendingPromotion = null;
  selected = null;
  legalForSelected = [];
  state = STATE.PLAYING;
  hideOverlay();
  finishMove(move, 'w');
}

// ---------- HUD / panels ----------
function updateHud() {
  if (state === STATE.MENU) {
    hudStatus.textContent = 'SET DIFFICULTY TO BEGIN';
  } else if (state === STATE.GAME_OVER) {
    hudStatus.textContent = resultText;
  } else if (state === STATE.PAUSED) {
    hudStatus.textContent = 'PAUSED';
  } else if (turn === 'w') {
    hudStatus.textContent = isCheck(board, 'w') ? 'YOUR MOVE — CHECK!' : 'YOUR MOVE';
  } else {
    hudStatus.textContent = isCheck(board, 'b') ? 'AI THINKING — CHECK!' : 'AI THINKING…';
  }
}

function updateTurnBadge() {
  badgeTurn.innerHTML = turn === 'w' ? GLYPH.w.k : GLYPH.b.k;
}

function renderMoveList() {
  moveList.innerHTML = '';
  for (let i = 0; i < moveHistory.length; i += 2) {
    const li = document.createElement('li');
    const num = i / 2 + 1;
    const white = moveHistory[i] ? moveHistory[i].label : '';
    const black = moveHistory[i + 1] ? moveHistory[i + 1].label : '';
    li.textContent = `${num}. ${white} ${black}`;
    moveList.appendChild(li);
  }
  moveList.scrollTop = moveList.scrollHeight;
}

function renderCaptured() {
  capturedWhiteEl.innerHTML = captured.w.map((t) => GLYPH.b[t]).join('');
  capturedBlackEl.innerHTML = captured.b.map((t) => GLYPH.w[t]).join('');
}

// ---------- Rendering ----------
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!board) return;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const isDark = (r + c) % 2 === 1;
      ctx.fillStyle = isDark ? halftonePattern : '#f1e9d6';
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
  }

  if (lastMove) {
    ctx.strokeStyle = '#1b1812';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(lastMove.from.col * CELL + 1, lastMove.from.row * CELL + 1, CELL - 2, CELL - 2);
    ctx.strokeRect(lastMove.to.col * CELL + 1, lastMove.to.row * CELL + 1, CELL - 2, CELL - 2);
  }

  if (board) {
    const kingPos = findKing(board, turn);
    if (kingPos && isCheck(board, turn)) {
      ctx.strokeStyle = '#1b1812';
      ctx.lineWidth = 4;
      ctx.setLineDash([]);
      ctx.strokeRect(kingPos.col * CELL + 3, kingPos.row * CELL + 3, CELL - 6, CELL - 6);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(kingPos.col * CELL + 7, kingPos.row * CELL + 7, CELL - 14, CELL - 14);
    }
  }

  if (selected) {
    ctx.strokeStyle = '#1b1812';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(selected.col * CELL + 2, selected.row * CELL + 2, CELL - 4, CELL - 4);
    ctx.setLineDash([]);
  }

  for (const m of legalForSelected) {
    const cx = m.to.col * CELL + CELL / 2;
    const cy = m.to.row * CELL + CELL / 2;
    const isCapture = !!board[m.to.row][m.to.col] || m.isEnPassant;
    ctx.strokeStyle = '#1b1812';
    ctx.fillStyle = '#1b1812';
    if (isCapture) {
      ctx.lineWidth = 2.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(CELL * 0.72)}px 'Arial Black', sans-serif`;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const cx = c * CELL + CELL / 2;
      const cy = r * CELL + CELL / 2 + 2;
      ctx.fillStyle = piece.color === 'w' ? '#f1e9d6' : '#1b1812';
      ctx.strokeStyle = '#1b1812';
      ctx.lineWidth = piece.color === 'w' ? 2 : 0.5;
      const glyph = GLYPH[piece.color][piece.type];
      if (piece.color === 'w') ctx.strokeText(glyph, cx, cy);
      ctx.fillText(glyph, cx, cy);
    }
  }
}

// ---------- Input ----------
function squareFromEvent(evt) {
  const rect = canvas.getBoundingClientRect();
  const point = evt.touches ? evt.touches[0] : evt;
  const x = (point.clientX - rect.left) * (canvas.width / rect.width);
  const y = (point.clientY - rect.top) * (canvas.height / rect.height);
  const col = Math.floor(x / CELL);
  const row = Math.floor(y / CELL);
  if (!inBounds(row, col)) return null;
  return { row, col };
}

function handleBoardTap(evt) {
  evt.preventDefault();
  if (state !== STATE.PLAYING || turn !== 'w') return;
  const sq = squareFromEvent(evt);
  if (!sq) return;

  if (selected) {
    const move = legalForSelected.find((m) => m.to.row === sq.row && m.to.col === sq.col);
    if (move) {
      if (move.promotion && move.promotion !== 'q') return;
      playerMove(move);
      return;
    }
  }

  const piece = board[sq.row][sq.col];
  if (selected && sq.row === selected.row && sq.col === selected.col) {
    selected = null;
    legalForSelected = [];
  } else if (piece && piece.color === 'w') {
    selected = sq;
    legalForSelected = legalMovesFor(board, sq.row, sq.col, enPassantTarget);
  } else {
    selected = null;
    legalForSelected = [];
  }
  draw();
}

canvas.addEventListener('click', handleBoardTap);
canvas.addEventListener('touchstart', handleBoardTap, { passive: false });

promoPanel.querySelectorAll('.menu-opt').forEach((btn) => {
  btn.addEventListener('click', () => resolvePromotion(btn.dataset.piece));
});

badgeHelp.addEventListener('click', () => {
  if (state === STATE.PLAYING) state = STATE.PAUSED;
  showHelpPanel();
});
helpCloseBtn.addEventListener('click', () => {
  helpPanel.classList.remove('visible');
  if (state === STATE.PAUSED) {
    state = STATE.PLAYING;
    overlayMsg.classList.remove('visible');
  } else if (state === STATE.MENU) {
    menuPanel.classList.add('visible');
  } else if (state === STATE.GAME_OVER) {
    overlayText.classList.add('visible');
  } else if (state === STATE.PROMOTING) {
    promoPanel.classList.add('visible');
  }
  updateHud();
});
badgeMoves.addEventListener('click', () => {
  movelistWrap.classList.toggle('hidden-list');
});

resignBtn.addEventListener('click', () => {
  if (state !== STATE.PLAYING && state !== STATE.PAUSED) return;
  endGame('YOU RESIGNED — AI WINS');
});

drawBtn.addEventListener('click', () => {
  if (state !== STATE.PLAYING && state !== STATE.PAUSED) return;
  const evalScore = evaluateBoard(board);
  if (evalScore >= -50) {
    endGame('DRAW AGREED');
  } else {
    showOverlayText('AI DECLINES THE DRAW OFFER\n<button class="menu-opt" id="dismiss-decline-btn" type="button">CONTINUE</button>');
    document.getElementById('dismiss-decline-btn').addEventListener('click', () => {
      hideOverlay();
      state = STATE.PLAYING;
      updateHud();
    });
    state = STATE.PAUSED;
  }
});

// ---------- Menu ----------
function initMenuGroups() {
  document.querySelectorAll('.menu-group').forEach((group) => {
    const key = group.dataset.setting;
    const opts = Array.from(group.querySelectorAll('.menu-opt'));
    opts.forEach((opt) => {
      if (opt.dataset.value === settings[key]) opt.classList.add('selected');
      opt.addEventListener('click', () => {
        settings[key] = opt.dataset.value;
        opts.forEach((o) => o.classList.remove('selected'));
        opt.classList.add('selected');
      });
    });
  });
}

document.getElementById('menu-start-btn').addEventListener('click', newGame);

function togglePause() {
  if (state === STATE.PLAYING) {
    state = STATE.PAUSED;
    showOverlayText('PAUSED\n<button class="menu-opt" id="resume-btn" type="button">RESUME</button>');
    document.getElementById('resume-btn').addEventListener('click', resumeFromPause);
  } else if (state === STATE.PAUSED) {
    resumeFromPause();
  }
  updateHud();
}

function resumeFromPause() {
  state = STATE.PLAYING;
  hideOverlay();
  updateHud();
  if (turn === 'b') setTimeout(aiTurn, AI_PARAMS[settings.difficulty].thinkMs);
}

function hardReset() {
  state = STATE.MENU;
  board = null;
  selected = null;
  legalForSelected = [];
  showMenu();
}

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    if (state === STATE.MENU) { newGame(); e.preventDefault(); }
    return;
  }
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    if (state === STATE.PLAYING || state === STATE.PAUSED) { togglePause(); e.preventDefault(); }
    return;
  }
  if (e.key === 'r' || e.key === 'R') { hardReset(); e.preventDefault(); }
});

// ---------- Debug hook ----------
window.__debugState = () => ({
  state, settings, turn, enPassantTarget,
  board: board ? cloneBoard(board) : null,
  selected: selected ? { ...selected } : null,
  legalForSelected: legalForSelected.map((m) => ({ from: { ...m.from }, to: { ...m.to } })),
  moveHistory: moveHistory.slice(),
  captured: { w: captured.w.slice(), b: captured.b.slice() },
  resultText,
});

window.__chessApi = {
  createInitialBoard, cloneBoard, applyMove, legalMovesFor, allLegalMoves,
  isCheck, isCheckmate, isStalemate, findKing, aiTurn,
  setBoard(b, t, ep) { board = b; turn = t; enPassantTarget = ep || null; state = STATE.PLAYING; hideOverlay(); draw(); updateHud(); updateTurnBadge(); },
};

// ---------- Init ----------
initMenuGroups();
showMenu();
draw();
