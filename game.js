'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#b0bec5', // N - tuerca (gris metálico)
  '#ff5252', // BOMB - bomba roja
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N - tuerca
  [[9]],                                       // BOMB - power-up 1x1
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const BOMB = 9;
const BOMB_CHANCE = 0.1;
const BOMB_CELL_SCORE = 10;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const skinSelect = document.getElementById('skin-select');

let gridColor;
let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.random() < BOMB_CHANCE
    ? BOMB
    : Math.floor(Math.random() * (BOMB - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function explode(cx, cy) {
  let destroyed = 0;
  for (let r = cy - 1; r <= cy + 1; r++) {
    if (r < 0 || r >= ROWS) continue;
    for (let c = cx - 1; c <= cx + 1; c++) {
      if (c < 0 || c >= COLS) continue;
      if (board[r][c]) {
        board[r][c] = 0;
        destroyed++;
      }
    }
  }
  if (destroyed) {
    score += destroyed * BOMB_CELL_SCORE * level;
    updateHUD();
  }
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.type === BOMB) {
    explode(current.x, current.y);
  } else {
    merge();
  }
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

// ---- Skins ----
// Each skin provides a 10-entry color palette in lockstep with COLORS/PIECES
// (index 0 = unused/null, indices 1-8 = piece types, index 9 = BOMB) plus a
// `style` tag that selects how drawBlock renders a cell.
const SKINS = {
  retro: {
    label: 'Retro',
    style: 'flat',
    colors: COLORS,
  },
  neon: {
    label: 'Neón',
    style: 'neon',
    colors: [
      null,
      '#00f0ff', // I
      '#fff400', // O
      '#ff00e6', // T
      '#39ff14', // S
      '#ff2d55', // Z
      '#00aaff', // J
      '#ff8800', // L
      '#e0fbff', // N - tuerca
      '#ff0033', // BOMB
    ],
  },
  pastel: {
    label: 'Pastel',
    style: 'pastel',
    colors: [
      null,
      '#a8dadc', // I
      '#ffe8b3', // O
      '#d9c2e8', // T
      '#bfe3c8', // S
      '#f4b8ba', // Z
      '#bcd2f0', // J
      '#f6d3ad', // L
      '#d8dbe3', // N - tuerca
      '#f3a6a6', // BOMB
    ],
  },
  pixel: {
    label: 'Pixel art',
    style: 'pixel',
    colors: [
      null,
      '#2bb0c4', // I
      '#e0b23a', // O
      '#8e4fa0', // T
      '#4f9e5c', // S
      '#c6433f', // Z
      '#5a8fcf', // J
      '#d98a2b', // L
      '#8993a1', // N - tuerca
      '#d6281f', // BOMB
    ],
  },
};

let currentSkin = 'retro';

function populateSkinSelect() {
  skinSelect.innerHTML = Object.keys(SKINS)
    .map(key => `<option value="${key}">${SKINS[key].label}</option>`)
    .join('');
}

function loadSkin() {
  try {
    const saved = localStorage.getItem('tetris.skin');
    if (saved && SKINS[saved]) return saved;
  } catch (e) {
    // localStorage no disponible: usar el valor por defecto
  }
  return 'retro';
}

function applySkin(skin) {
  if (!SKINS[skin]) skin = 'retro';
  currentSkin = skin;
  try {
    localStorage.setItem('tetris.skin', skin);
  } catch (e) {
    // localStorage no disponible: la elección no persiste
  }
  const isNeon = skin === 'neon';
  canvas.style.background = isNeon ? '#000' : '';
  nextCanvas.style.background = isNeon ? '#000' : '';
  if (current) {
    draw();
    drawNext();
  }
}

function roundedRectPath(context, rx, ry, rw, rh, radius) {
  context.beginPath();
  context.moveTo(rx + radius, ry);
  context.lineTo(rx + rw - radius, ry);
  context.quadraticCurveTo(rx + rw, ry, rx + rw, ry + radius);
  context.lineTo(rx + rw, ry + rh - radius);
  context.quadraticCurveTo(rx + rw, ry + rh, rx + rw - radius, ry + rh);
  context.lineTo(rx + radius, ry + rh);
  context.quadraticCurveTo(rx, ry + rh, rx, ry + rh - radius);
  context.lineTo(rx, ry + radius);
  context.quadraticCurveTo(rx, ry, rx + radius, ry);
  context.closePath();
}

function drawRetroBlock(context, x, y, color, size) {
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
}

function drawNeonBlock(context, x, y, color, size) {
  context.shadowBlur = 14;
  context.shadowColor = color;
  context.fillStyle = color;
  context.fillRect(x * size + 2, y * size + 2, size - 4, size - 4);
  context.shadowBlur = 0;
  context.strokeStyle = 'rgba(255,255,255,0.4)';
  context.lineWidth = 1;
  context.strokeRect(x * size + 2.5, y * size + 2.5, size - 5, size - 5);
}

function drawPastelBlock(context, x, y, color, size) {
  const rx = x * size + 2, ry = y * size + 2, rw = size - 4, rh = size - 4;
  roundedRectPath(context, rx, ry, rw, rh, Math.min(6, rw / 2));
  context.fillStyle = color;
  context.fill();
  roundedRectPath(context, rx + 3, ry + 3, rw - 6, Math.max(4, rh * 0.35), Math.min(5, rw / 2));
  context.fillStyle = 'rgba(255,255,255,0.4)';
  context.fill();
}

function drawPixelBlock(context, x, y, color, size) {
  const px = x * size, py = y * size;
  context.fillStyle = color;
  context.fillRect(px + 1, py + 1, size - 2, size - 2);
  // textura de dither (checker) sobre el bloque
  const cell = Math.max(2, Math.floor(size / 6));
  context.fillStyle = 'rgba(0,0,0,0.18)';
  for (let yy = 0; yy < size; yy += cell * 2) {
    for (let xx = 0; xx < size; xx += cell * 2) {
      context.fillRect(px + xx, py + yy, cell, cell);
      context.fillRect(px + xx + cell, py + yy + cell, cell, cell);
    }
  }
  // contorno 1px más oscuro
  context.strokeStyle = 'rgba(0,0,0,0.5)';
  context.lineWidth = 1;
  context.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);
  // brillo en la esquina
  context.fillStyle = 'rgba(255,255,255,0.45)';
  context.fillRect(px + 2, py + 2, Math.max(3, size / 5), Math.max(3, size / 5));
}

function drawBombBlock(context, x, y, color, size, style) {
  const cx = x * size + size / 2;
  const cy = y * size + size / 2;
  const radius = size / 2 - 3;

  if (style === 'neon') {
    context.shadowBlur = 16;
    context.shadowColor = color;
  }

  context.fillStyle = color;
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fill();

  if (style === 'neon') {
    context.shadowBlur = 0;
  }

  if (style === 'pixel') {
    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.clip();
    const cell = Math.max(2, Math.floor(size / 6));
    context.fillStyle = 'rgba(0,0,0,0.18)';
    for (let yy = -radius; yy < radius; yy += cell * 2) {
      for (let xx = -radius; xx < radius; xx += cell * 2) {
        context.fillRect(cx + xx, cy + yy, cell, cell);
        context.fillRect(cx + xx + cell, cy + yy + cell, cell, cell);
      }
    }
    context.restore();
  }

  // mecha
  context.strokeStyle = style === 'pastel' ? 'rgba(120,96,90,0.6)' : '#ffe082';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(cx, cy - radius);
  context.lineTo(cx + 3, y * size + 2);
  context.stroke();

  // brillo
  context.fillStyle = 'rgba(255,255,255,0.3)';
  context.beginPath();
  context.arc(cx - radius * 0.3, cy - radius * 0.3, radius * 0.3, 0, Math.PI * 2);
  context.fill();

  // por seguridad, el glow nunca debe quedarse activo para el siguiente trazo
  context.shadowBlur = 0;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const skin = SKINS[currentSkin] || SKINS.retro;
  const color = skin.colors[colorIndex];
  context.globalAlpha = alpha ?? 1;

  if (colorIndex === BOMB) {
    drawBombBlock(context, x, y, color, size, skin.style);
    context.globalAlpha = 1;
    return;
  }

  switch (skin.style) {
    case 'neon':
      drawNeonBlock(context, x, y, color, size);
      break;
    case 'pastel':
      drawPastelBlock(context, x, y, color, size);
      break;
    case 'pixel':
      drawPixelBlock(context, x, y, color, size);
      break;
    default:
      drawRetroBlock(context, x, y, color, size);
  }
  context.globalAlpha = 1;
}

function getGridColor() {
  // el skin neón fuerza un fondo negro, así que usa una rejilla tenue propia
  // en vez del --grid del tema claro/oscuro (que son independientes del skin)
  if (currentSkin === 'neon') return 'rgba(0, 240, 255, 0.08)';
  return gridColor;
}

function drawGrid() {
  ctx.strokeStyle = getGridColor();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  if (gameOver) return;
  draw();
  animId = requestAnimationFrame(loop);
}

function setTheme(theme) {
  const isLight = theme === 'light';
  document.documentElement.dataset.theme = theme;
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
  themeToggle.textContent = isLight ? '☾ Oscuro' : '☀ Claro';
  themeToggle.setAttribute('aria-label', isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  themeToggle.setAttribute('aria-pressed', String(isLight));
  if (current) {
    draw();
    drawNext();
  }
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  // si el foco sigue en el <select> de skins, deja que las flechas lo naveguen
  // a él en vez de mover también la pieza (p.ej. tras abrirlo y cerrarlo con Escape)
  if (document.activeElement === skinSelect) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

themeToggle.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  themeToggle.blur(); // evita que Space reactive el botón
});

skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
  skinSelect.blur(); // evita que las flechas vuelvan a abrir el select
});

setTheme('dark');

populateSkinSelect();
const initialSkin = loadSkin();
skinSelect.value = initialSkin;
applySkin(initialSkin);

init();
