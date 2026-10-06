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
const playBtn = document.getElementById('play-btn');
const hiscoreContainer = document.getElementById('hiscore-container');
const hiscoreNameSection = document.getElementById('hiscore-name-section');
const hiscoreNameInput = document.getElementById('hiscore-name-input');
const hiscoreSaveBtn = document.getElementById('hiscore-save-btn');
const hiscoreResults = document.getElementById('hiscore-results');
const hiscoreNewMsg = document.getElementById('hiscore-new-msg');
const hiscoreTableEl = document.getElementById('hiscore-table');
const hiscoreStatsEl = document.getElementById('hiscore-stats');
const hiscoreClearBtn = document.getElementById('hiscore-clear-btn');

let gridColor;
let board, current, next, score, lines, level, combo, maxCombo, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

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
  return cleared;
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
  const cleared = clearLines();
  if (cleared > 0) {
    combo++;
    if (combo > maxCombo) maxCombo = combo;
  } else {
    combo = 0;
  }
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

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;

  if (colorIndex === BOMB) {
    const cx = x * size + size / 2;
    const cy = y * size + size / 2;
    const radius = size / 2 - 3;
    context.fillStyle = color;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
    // mecha
    context.strokeStyle = '#ffe082';
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
    context.globalAlpha = 1;
    return;
  }

  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
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
  if (!board || !current) return;

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
  if (!next) return;
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
  restartBtn.classList.remove('hidden');
  playBtn.classList.add('hidden');
  showGameOverHiscores();
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
  combo = 0;
  maxCombo = 0;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  hiscoreContainer.classList.add('hidden');
  restartBtn.classList.remove('hidden');
  playBtn.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

// ---- Tabla de récords ----

const HISCORES_KEY = 'tetris.highscores';
const STATS_KEY = 'tetris.stats';
const LASTNAME_KEY = 'tetris.lastName';
const MAX_HISCORES = 5;

let pendingSaveScore = 0;
let pendingSaveLines = 0;

function loadHiscores() {
  try {
    const raw = localStorage.getItem(HISCORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed
      .filter(e => e && typeof e.name === 'string' && typeof e.score === 'number' && isFinite(e.score))
      .map(e => ({
        name: e.name,
        score: e.score,
        lines: typeof e.lines === 'number' && isFinite(e.lines) ? e.lines : 0,
        date: typeof e.date === 'string' ? e.date : '',
      }));
    const sorted = valid.sort((a, b) => b.score - a.score).slice(0, MAX_HISCORES);
    // Self-heal: if storage had stale/extra/unsorted/invalid data, persist the normalized version.
    if (JSON.stringify(sorted) !== JSON.stringify(parsed)) saveHiscores(sorted);
    return sorted;
  } catch {
    return [];
  }
}

function saveHiscores(list) {
  try {
    localStorage.setItem(HISCORES_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable or full: ignore, game keeps working without persistence
  }
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { bestCombo: 0, maxLines: 0 };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { bestCombo: 0, maxLines: 0 };
    return {
      bestCombo: typeof parsed.bestCombo === 'number' && isFinite(parsed.bestCombo) ? parsed.bestCombo : 0,
      maxLines: typeof parsed.maxLines === 'number' && isFinite(parsed.maxLines) ? parsed.maxLines : 0,
    };
  } catch {
    return { bestCombo: 0, maxLines: 0 };
  }
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // ignore
  }
}

function loadLastName() {
  try {
    return localStorage.getItem(LASTNAME_KEY) || '';
  } catch {
    return '';
  }
}

function saveLastName(name) {
  try {
    localStorage.setItem(LASTNAME_KEY, name);
  } catch {
    // ignore
  }
}

function clearHiscores() {
  try {
    localStorage.removeItem(HISCORES_KEY);
    localStorage.removeItem(STATS_KEY);
  } catch {
    // ignore
  }
}

function qualifiesForHiscores(finalScore) {
  if (!finalScore || finalScore <= 0) return false;
  const list = loadHiscores();
  if (list.length < MAX_HISCORES) return true;
  const sorted = [...list].sort((a, b) => b.score - a.score);
  return finalScore > sorted[MAX_HISCORES - 1].score;
}

function insertHiscore(name, finalScore, finalLines) {
  const list = loadHiscores();
  const entry = { name, score: finalScore, lines: finalLines, date: new Date().toISOString() };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const trimmed = list.slice(0, MAX_HISCORES);
  saveHiscores(trimmed);
  return { list: trimmed, entry };
}

function updateStatsIfNeeded(finalCombo, finalLines) {
  const stats = loadStats();
  let changed = false;
  if (finalCombo > stats.bestCombo) { stats.bestCombo = finalCombo; changed = true; }
  if (finalLines > stats.maxLines) { stats.maxLines = finalLines; changed = true; }
  if (changed) saveStats(stats);
  return stats;
}

function renderStats(stats) {
  hiscoreStatsEl.textContent = `Mejor combo: ${stats.bestCombo} · Máx. líneas: ${stats.maxLines}`;
}

function renderHiscoresTable(list, highlightEntry) {
  hiscoreTableEl.innerHTML = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hiscore-empty';
    p.textContent = 'Sin récords todavía.';
    hiscoreTableEl.appendChild(p);
    return;
  }
  const table = document.createElement('table');
  table.className = 'hiscore-table';
  list.forEach((entry, i) => {
    const row = document.createElement('tr');
    if (highlightEntry && entry === highlightEntry) row.classList.add('hiscore-highlight');

    const posCell = document.createElement('td');
    posCell.textContent = `${i + 1}.`;

    const nameCell = document.createElement('td');
    nameCell.textContent = entry.name; // textContent: nunca HTML con input del jugador

    const scoreCell = document.createElement('td');
    scoreCell.textContent = entry.score.toLocaleString();

    const linesCell = document.createElement('td');
    linesCell.textContent = `${entry.lines} líneas`;

    row.append(posCell, nameCell, scoreCell, linesCell);
    table.appendChild(row);
  });
  hiscoreTableEl.appendChild(table);
}

function showStartScreen() {
  overlayTitle.textContent = 'TETRIS';
  overlayScore.textContent = '';
  restartBtn.classList.add('hidden');
  playBtn.classList.remove('hidden');
  hiscoreNameSection.classList.add('hidden');
  hiscoreResults.classList.remove('hidden');
  hiscoreNewMsg.classList.add('hidden');
  renderHiscoresTable(loadHiscores());
  renderStats(loadStats());
  hiscoreContainer.classList.remove('hidden');
  overlay.classList.remove('hidden');
}

function showGameOverHiscores() {
  const stats = updateStatsIfNeeded(maxCombo, lines);
  renderStats(stats);
  if (qualifiesForHiscores(score)) {
    pendingSaveScore = score;
    pendingSaveLines = lines;
    hiscoreNameInput.value = loadLastName();
    hiscoreNameSection.classList.remove('hidden');
    hiscoreResults.classList.add('hidden');
  } else {
    hiscoreNameSection.classList.add('hidden');
    hiscoreResults.classList.remove('hidden');
    hiscoreNewMsg.classList.add('hidden');
    renderHiscoresTable(loadHiscores());
  }
  hiscoreContainer.classList.remove('hidden');
}

function saveHiscoreEntry() {
  const raw = (hiscoreNameInput.value || '').trim().slice(0, 12);
  const name = raw || 'Jugador';
  saveLastName(name);
  const { list, entry } = insertHiscore(name, pendingSaveScore, pendingSaveLines);
  hiscoreNameSection.classList.add('hidden');
  hiscoreResults.classList.remove('hidden');
  hiscoreNewMsg.classList.remove('hidden');
  renderHiscoresTable(list, entry);
}

playBtn.addEventListener('click', () => {
  init();
  playBtn.blur();
});

hiscoreSaveBtn.addEventListener('click', () => {
  saveHiscoreEntry();
  hiscoreSaveBtn.blur();
});

hiscoreNameInput.addEventListener('keydown', e => {
  if (e.code === 'Enter') {
    e.preventDefault();
    saveHiscoreEntry();
  }
});

hiscoreClearBtn.addEventListener('click', () => {
  if (window.confirm('¿Seguro que quieres borrar todos los récords y estadísticas? Esta acción no se puede deshacer.')) {
    clearHiscores();
    renderHiscoresTable(loadHiscores());
    renderStats(loadStats());
  }
  hiscoreClearBtn.blur();
});

document.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
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

setTheme('dark');

showStartScreen();
