/* =====================================================
   NEON VOID — game.js
   Moteur complet : Canvas 2D, vagues progressives,
   système de score, multiplicateur, boost,
   logique Rewarded Video (simulée Phase 1)
   ===================================================== */

'use strict';

// ======================================================
// ÉTAT GLOBAL DU JEU
// ======================================================
const STATE = {
  phase:       'title',   // title | playing | paused | gameover | wave
  score:       0,
  highScore:   parseInt(localStorage.getItem('nv_highscore') || '0', 10),
  wave:        1,
  lives:       3,
  maxLives:    3,
  multiplier:  1,
  multTimer:   0,
  boostCharge: 100,       // 0–100
  boostActive: false,
  canContinue: true,      // une seule pub rewarded par partie
  frameId:     null,
  lastTime:    0,
};

// ======================================================
// CANVAS & CONTEXTES
// ======================================================
const canvas   = document.getElementById('game-canvas');
const ctx      = canvas.getContext('2d');
const bgCanvas = document.getElementById('bg-canvas');
const bgCtx    = bgCanvas.getContext('2d');

const W = 800;
const H = 600;
canvas.width  = W;
canvas.height = H;

// ======================================================
// ÉLÉMENTS DOM
// ======================================================
const screens = {
  title:    document.getElementById('screen-title'),
  gameover: document.getElementById('screen-gameover'),
  pause:    document.getElementById('screen-pause'),
  wave:     document.getElementById('screen-wave'),
};
const gameCanvas  = canvas;
const hud         = document.getElementById('hud');

const elScore     = document.getElementById('hud-score');
const elWave      = document.getElementById('hud-wave');
const elLives     = document.getElementById('hud-lives');
const elBoost     = document.getElementById('boost-fill');
const elMult      = document.getElementById('hud-mult');

const elGoScore   = document.getElementById('go-score');
const elGoHigh    = document.getElementById('go-highscore');
const elPauseScore= document.getElementById('pause-score');

const elTitleHigh = document.getElementById('title-highscore');
const elWaveNum   = document.getElementById('wave-number');
const elWaveSub   = document.getElementById('wave-sub');
const elCountdown = document.getElementById('ad-countdown');
const elAdOverlay = document.getElementById('ad-rewarded-overlay');
const elAdFill    = document.getElementById('ad-progress-fill');
const elBtnContinue = document.getElementById('btn-continue-ad');

// ======================================================
// ENTITÉS DE JEU
// ======================================================
let player   = null;
let bullets  = [];
let enemies  = [];
let particles= [];
let stars    = [];
let powerups = [];

// ======================================================
// ÉTOILES D'ARRIÈRE-PLAN ANIMÉES (bg canvas)
// ======================================================
function initBgStars() {
  bgCanvas.width  = window.innerWidth;
  bgCanvas.height = window.innerHeight;
  stars = [];
  const count = Math.floor((bgCanvas.width * bgCanvas.height) / 4000);
  for (let i = 0; i < count; i++) {
    stars.push({
      x:     Math.random() * bgCanvas.width,
      y:     Math.random() * bgCanvas.height,
      r:     Math.random() * 1.5 + 0.2,
      speed: Math.random() * 0.3 + 0.05,
      alpha: Math.random(),
      blink: Math.random() * Math.PI * 2,
    });
  }
}

function animateBgStars(ts) {
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  stars.forEach(s => {
    s.blink += 0.01;
    s.alpha = 0.3 + Math.sin(s.blink) * 0.3;
    bgCtx.beginPath();
    bgCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    bgCtx.fillStyle = `rgba(200,240,255,${s.alpha})`;
    bgCtx.fill();
    s.y += s.speed;
    if (s.y > bgCanvas.height) { s.y = 0; s.x = Math.random() * bgCanvas.width; }
  });
  requestAnimationFrame(animateBgStars);
}

initBgStars();
animateBgStars(0);
window.addEventListener('resize', initBgStars);

// ======================================================
// INPUT
// ======================================================
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ======================================================
// JOUEUR
// ======================================================
function createPlayer() {
  return {
    x: W / 2,
    y: H - 80,
    w: 32,
    h: 40,
    speed: 4.5,
    shootCooldown: 0,
    shootDelay: 14,      // frames
    invincible: 0,       // frames d'invincibilité après hit
    trail: [],           // traînée visuelle
  };
}

function drawPlayer(p) {
  if (p.invincible > 0 && Math.floor(p.invincible / 4) % 2 === 0) return; // clignotement

  // Traînée
  p.trail.forEach((t, i) => {
    const alpha = (i / p.trail.length) * 0.4;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawShip(t.x, t.y, '#00f5ff', 0.5);
    ctx.restore();
  });

  // Vaisseau
  drawShip(p.x, p.y, STATE.boostActive ? '#9b30ff' : '#00f5ff', 1);

  // Moteur
  const engineAlpha = 0.6 + Math.random() * 0.4;
  const engineLen = STATE.boostActive ? 40 + Math.random() * 20 : 18 + Math.random() * 12;
  const grad = ctx.createLinearGradient(p.x, p.y + p.h / 2, p.x, p.y + p.h / 2 + engineLen);
  grad.addColorStop(0, STATE.boostActive ? 'rgba(155,48,255,0.9)' : 'rgba(0,245,255,0.9)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = engineAlpha;
  ctx.beginPath();
  ctx.moveTo(p.x - 6, p.y + p.h / 2 - 5);
  ctx.lineTo(p.x + 6, p.y + p.h / 2 - 5);
  ctx.lineTo(p.x, p.y + p.h / 2 + engineLen);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

function drawShip(x, y, color, scale = 1) {
  const w = 32 * scale;
  const h = 40 * scale;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 15;
  ctx.lineWidth = 1.5;

  // Fuselage
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2);
  ctx.lineTo(x + w * 0.35, y + h * 0.1);
  ctx.lineTo(x + w * 0.5, y + h / 2);
  ctx.lineTo(x - w * 0.5, y + h / 2);
  ctx.lineTo(x - w * 0.35, y + h * 0.1);
  ctx.closePath();
  ctx.fillStyle = 'rgba(4,6,15,0.9)';
  ctx.fill();
  ctx.stroke();

  // Cockpit
  ctx.beginPath();
  ctx.ellipse(x, y - h * 0.1, w * 0.14, h * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Ailes
  ctx.beginPath();
  ctx.moveTo(x - w * 0.35, y);
  ctx.lineTo(x - w * 0.9, y + h * 0.45);
  ctx.lineTo(x - w * 0.25, y + h * 0.45);
  ctx.closePath();
  ctx.fillStyle = 'rgba(4,6,15,0.85)';
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + w * 0.35, y);
  ctx.lineTo(x + w * 0.9, y + h * 0.45);
  ctx.lineTo(x + w * 0.25, y + h * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// ======================================================
// TIRS
// ======================================================
function spawnBullet(p) {
  const dual = STATE.wave >= 3;
  if (dual) {
    bullets.push({ x: p.x - 10, y: p.y - 20, vy: -12, vx: 0, w: 3, h: 10, color: '#00f5ff' });
    bullets.push({ x: p.x + 10, y: p.y - 20, vy: -12, vx: 0, w: 3, h: 10, color: '#00f5ff' });
  } else {
    bullets.push({ x: p.x, y: p.y - 20, vy: -12, vx: 0, w: 3, h: 12, color: '#00f5ff' });
  }
  // Tir triple en vague 6+
  if (STATE.wave >= 6) {
    bullets.push({ x: p.x, y: p.y - 10, vy: -11, vx: -3, w: 2, h: 10, color: '#9b30ff' });
    bullets.push({ x: p.x, y: p.y - 10, vy: -11, vx:  3, w: 2, h: 10, color: '#9b30ff' });
  }
}

function drawBullet(b) {
  ctx.save();
  ctx.shadowColor = b.color;
  ctx.shadowBlur  = 12;
  ctx.fillStyle   = b.color;
  ctx.beginPath();
  ctx.roundRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 2);
  ctx.fill();
  ctx.restore();
}

// ======================================================
// ENNEMIS
// ======================================================
const ENEMY_TYPES = {
  drone: {
    w: 28, h: 22, hp: 1, speed: 1.8, score: 10, color: '#ff2d78',
    pattern: 'sine', fireRate: 0,
  },
  heavy: {
    w: 40, h: 32, hp: 3, speed: 1.0, score: 30, color: '#9b30ff',
    pattern: 'straight', fireRate: 120,
  },
  zigzag: {
    w: 24, h: 20, hp: 1, speed: 2.5, score: 20, color: '#ffe600',
    pattern: 'zigzag', fireRate: 0,
  },
  boss: {
    w: 80, h: 60, hp: 20, speed: 0.8, score: 200, color: '#ff2d78',
    pattern: 'boss', fireRate: 60,
  },
};

function createEnemy(typeKey, x, y) {
  const t = ENEMY_TYPES[typeKey];
  return {
    type: typeKey,
    x, y,
    w: t.w, h: t.h,
    hp: t.hp + Math.floor(STATE.wave * 0.5),
    maxHp: t.hp + Math.floor(STATE.wave * 0.5),
    speed: t.speed + STATE.wave * 0.08,
    score: t.score,
    color: t.color,
    pattern: t.pattern,
    fireRate: t.fireRate,
    fireCd: Math.floor(Math.random() * t.fireRate),
    angle: 0,
    zigDir: 1,
    zigTimer: 0,
    bossDir: 1,
  };
}

function spawnWave(wave) {
  enemies = [];
  const cols = 8 + Math.min(wave, 4);
  const rows = 2 + Math.min(Math.floor(wave / 2), 3);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let type = 'drone';
      if (wave >= 4 && r === rows - 1 && c % 3 === 0) type = 'heavy';
      if (wave >= 3 && r % 2 === 0 && c % 4 === 0)   type = 'zigzag';
      const x = 60 + c * (W - 120) / (cols - 1);
      const y = 50 + r * 55;
      enemies.push(createEnemy(type, x, y));
    }
  }

  // Boss toutes les 5 vagues
  if (wave % 5 === 0) {
    enemies.push(createEnemy('boss', W / 2, 80));
  }
}

function updateEnemy(e, dt) {
  switch (e.pattern) {
    case 'sine':
      e.angle += 0.04;
      e.x += Math.sin(e.angle) * 1.5;
      e.y += e.speed * 0.5;
      break;
    case 'straight':
      e.y += e.speed * 0.6;
      break;
    case 'zigzag':
      e.zigTimer++;
      if (e.zigTimer > 30) { e.zigDir *= -1; e.zigTimer = 0; }
      e.x += e.speed * e.zigDir;
      e.y += e.speed * 0.4;
      break;
    case 'boss':
      e.x += e.speed * e.bossDir;
      if (e.x > W - e.w / 2 - 10 || e.x < e.w / 2 + 10) e.bossDir *= -1;
      e.y = Math.min(e.y + 0.3, 100);
      break;
  }

  // Tirs ennemis
  if (e.fireRate > 0) {
    e.fireCd--;
    if (e.fireCd <= 0) {
      e.fireCd = e.fireRate - Math.floor(STATE.wave * 3);
      spawnEnemyBullet(e);
    }
  }
}

let enemyBullets = [];
function spawnEnemyBullet(e) {
  if (e.type === 'boss') {
    // Tir en éventail
    for (let a = -30; a <= 30; a += 15) {
      const rad = (a * Math.PI) / 180;
      enemyBullets.push({
        x: e.x, y: e.y + e.h / 2,
        vx: Math.sin(rad) * 4,
        vy: Math.cos(rad) * 4,
        w: 5, h: 5, color: '#ff2d78',
      });
    }
  } else {
    enemyBullets.push({
      x: e.x, y: e.y + e.h / 2,
      vx: 0, vy: 4 + STATE.wave * 0.2,
      w: 4, h: 8, color: '#ff2d78',
    });
  }
}

function drawEnemy(e) {
  ctx.save();
  ctx.shadowColor = e.color;
  ctx.shadowBlur  = 15;
  ctx.strokeStyle = e.color;
  ctx.lineWidth   = 1.5;

  if (e.type === 'boss') {
    drawBoss(e);
  } else {
    // Corps
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - e.h / 2);
    ctx.lineTo(e.x + e.w / 2, e.y + e.h / 2);
    ctx.lineTo(e.x - e.w / 2, e.y + e.h / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(4,6,15,0.85)';
    ctx.fill();
    ctx.stroke();

    // Oeil
    ctx.beginPath();
    ctx.arc(e.x, e.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = e.color;
    ctx.fill();
  }

  // Barre de vie (si hp > 1)
  if (e.maxHp > 1) {
    const bw = e.w + 10;
    const bx = e.x - bw / 2;
    const by = e.y + e.h / 2 + 5;
    ctx.fillStyle = '#1a2540';
    ctx.fillRect(bx, by, bw, 4);
    ctx.fillStyle = e.color;
    ctx.fillRect(bx, by, bw * (e.hp / e.maxHp), 4);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function drawBoss(e) {
  ctx.save();
  ctx.shadowColor = '#ff2d78';
  ctx.shadowBlur  = 25;
  ctx.strokeStyle = '#ff2d78';
  ctx.lineWidth   = 2;

  // Corps hexagonal
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const px = e.x + Math.cos(a) * e.w / 2;
    const py = e.y + Math.sin(a) * e.h / 2;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(20,0,10,0.9)';
  ctx.fill();
  ctx.stroke();

  // Détails internes
  ctx.beginPath();
  ctx.arc(e.x, e.y, 16, 0, Math.PI * 2);
  ctx.fillStyle = '#ff2d78';
  ctx.globalAlpha = 0.3 + Math.sin(Date.now() * 0.005) * 0.2;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#ff2d78';
  ctx.shadowBlur = 8;
  ctx.stroke();

  // Barre de vie boss
  const bw = 200;
  const bx = e.x - bw / 2;
  const by = e.y + e.h / 2 + 10;
  ctx.fillStyle = '#1a0010';
  ctx.fillRect(bx, by, bw, 8);
  const healthFrac = e.hp / e.maxHp;
  ctx.fillStyle = healthFrac > 0.5 ? '#ff2d78' : healthFrac > 0.25 ? '#ffe600' : '#00ff88';
  ctx.fillRect(bx, by, bw * healthFrac, 8);
  ctx.strokeStyle = '#ff2d78';
  ctx.shadowBlur = 10;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, 8);

  ctx.restore();
}

// ======================================================
// PARTICULES
// ======================================================
function spawnExplosion(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 4;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r:  2 + Math.random() * 3,
      life: 1,
      decay: 0.03 + Math.random() * 0.04,
      color,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// ======================================================
// POWER-UPS
// ======================================================
function spawnPowerup(x, y) {
  if (Math.random() > 0.25) return; // 25% de chance
  const types = ['life', 'boost', 'multiplier'];
  const type  = types[Math.floor(Math.random() * types.length)];
  const colors = { life: '#00ff88', boost: '#9b30ff', multiplier: '#ffe600' };
  const icons  = { life: '♥', boost: '⚡', multiplier: '×2' };
  powerups.push({
    x, y, type,
    vy: 1.5,
    r: 12,
    color: colors[type],
    icon: icons[type],
    life: 300,
  });
}

function updatePowerups() {
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.y += p.vy;
    p.life--;
    if (p.y > H + 20 || p.life <= 0) powerups.splice(i, 1);
  }
}

function drawPowerups() {
  powerups.forEach(p => {
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 20;
    ctx.strokeStyle = p.color;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4,6,15,0.8)';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = p.color;
    ctx.font = `${p.r}px Rajdhani`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.icon, p.x, p.y);
    ctx.restore();
  });
}

function collectPowerup(p) {
  switch (p.type) {
    case 'life':
      if (STATE.lives < STATE.maxLives) STATE.lives++;
      break;
    case 'boost':
      STATE.boostCharge = Math.min(100, STATE.boostCharge + 40);
      break;
    case 'multiplier':
      STATE.multiplier = Math.min(8, STATE.multiplier + 1);
      STATE.multTimer  = 300;
      break;
  }
  spawnExplosion(p.x, p.y, p.color, 18);
  updateHUD();
}

// ======================================================
// COLLISIONS
// ======================================================
function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax - aw / 2 < bx + bw / 2 &&
         ax + aw / 2 > bx - bw / 2 &&
         ay - ah / 2 < by + bh / 2 &&
         ay + ah / 2 > by - bh / 2;
}

function checkCollisions() {
  // Tirs joueur vs ennemis
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (rectOverlap(b.x, b.y, b.w, b.h, e.x, e.y, e.w, e.h)) {
        e.hp--;
        hit = true;
        spawnExplosion(b.x, b.y, e.color, 6);
        if (e.hp <= 0) {
          addScore(e.score);
          spawnExplosion(e.x, e.y, e.color, e.type === 'boss' ? 30 : 14);
          spawnPowerup(e.x, e.y);
          enemies.splice(j, 1);
        }
        break;
      }
    }
    if (hit) bullets.splice(i, 1);
  }

  if (!player || player.invincible > 0) return;

  // Tirs ennemis vs joueur
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];
    if (rectOverlap(b.x, b.y, b.w, b.h, player.x, player.y, player.w, player.h)) {
      enemyBullets.splice(i, 1);
      hitPlayer();
      return;
    }
  }

  // Ennemis vs joueur
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (rectOverlap(e.x, e.y, e.w, e.h, player.x, player.y, player.w * 0.6, player.h * 0.6)) {
      spawnExplosion(e.x, e.y, e.color, 18);
      enemies.splice(i, 1);
      hitPlayer();
      return;
    }
  }

  // Power-ups vs joueur
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    const dx = p.x - player.x, dy = p.y - player.y;
    if (Math.sqrt(dx * dx + dy * dy) < p.r + 18) {
      collectPowerup(p);
      powerups.splice(i, 1);
    }
  }
}

function hitPlayer() {
  if (!player) return;
  STATE.lives--;
  STATE.multiplier = 1;
  STATE.multTimer  = 0;
  spawnExplosion(player.x, player.y, '#00f5ff', 20);
  player.invincible = 120; // 2s d'invincibilité

  if (STATE.lives <= 0) {
    triggerGameOver();
  } else {
    updateHUD();
  }
}

// ======================================================
// SCORE & MULTIPLICATEUR
// ======================================================
function addScore(base) {
  STATE.score += base * STATE.multiplier;
  STATE.multTimer = Math.min(STATE.multTimer + 60, 400);

  if (STATE.multTimer > 0 && STATE.multiplier < 8) {
    STATE.multiplier = Math.min(8, 1 + Math.floor(STATE.score / 500));
  }

  updateHUD();

  if (STATE.score > STATE.highScore) {
    STATE.highScore = STATE.score;
    localStorage.setItem('nv_highscore', STATE.highScore);
  }
}

// ======================================================
// HUD
// ======================================================
function updateHUD() {
  elScore.textContent = STATE.score.toLocaleString();
  elWave.textContent  = STATE.wave;
  elMult.textContent  = STATE.multiplier;

  elLives.innerHTML = '';
  for (let i = 0; i < STATE.maxLives; i++) {
    const icon = document.createElement('span');
    icon.className = 'life-icon' + (i >= STATE.lives ? ' lost' : '');
    icon.textContent = '♥';
    elLives.appendChild(icon);
  }

  elBoost.style.width = STATE.boostCharge + '%';
}

// ======================================================
// GESTION DES ÉCRANS
// ======================================================
function showScreen(name) {
  Object.values(screens).forEach(s => {
    if (s) s.style.display = 'none';
  });
  if (name && screens[name]) screens[name].style.display = 'flex';
}

function showGame() {
  showScreen(null);
  gameCanvas.style.display = 'block';
  hud.classList.add('active');
}

function hideGame() {
  gameCanvas.style.display = 'none';
  hud.classList.remove('active');
}

// ======================================================
// DÉMARRAGE / RESTART
// ======================================================
function startGame() {
  STATE.score      = 0;
  STATE.wave       = 1;
  STATE.lives      = 3;
  STATE.maxLives   = 3;
  STATE.multiplier = 1;
  STATE.multTimer  = 0;
  STATE.boostCharge= 100;
  STATE.boostActive= false;
  STATE.canContinue= true;
  STATE.phase      = 'playing';

  player       = createPlayer();
  bullets      = [];
  enemies      = [];
  enemyBullets = [];
  particles    = [];
  powerups     = [];

  spawnWave(STATE.wave);
  showGame();
  updateHUD();
  elTitleHigh.textContent = STATE.highScore.toLocaleString();

  if (STATE.frameId) cancelAnimationFrame(STATE.frameId);
  STATE.lastTime = performance.now();
  STATE.frameId  = requestAnimationFrame(gameLoop);
}

// Reprendre après rewarded (même score, +1 vie)
function continueAfterAd() {
  STATE.lives      = 1;
  STATE.multiplier = 1;
  STATE.multTimer  = 0;
  STATE.phase      = 'playing';
  STATE.canContinue= false;

  player             = createPlayer();
  player.invincible  = 180;
  bullets            = [];
  enemyBullets       = [];

  if (enemies.length === 0) spawnWave(STATE.wave);

  showGame();
  updateHUD();
  STATE.lastTime = performance.now();
  STATE.frameId  = requestAnimationFrame(gameLoop);
}

// ======================================================
// GAME OVER
// ======================================================
function triggerGameOver() {
  STATE.phase = 'gameover';
  if (STATE.frameId) { cancelAnimationFrame(STATE.frameId); STATE.frameId = null; }

  elGoScore.textContent = STATE.score.toLocaleString();
  elGoHigh.textContent  = STATE.highScore.toLocaleString();
  elTitleHigh.textContent = STATE.highScore.toLocaleString();

  // Masquer le bouton si déjà utilisé
  elBtnContinue.style.display = STATE.canContinue ? 'flex' : 'none';

  hideGame();
  showScreen('gameover');
}

// ======================================================
// PAUSE
// ======================================================
function togglePause() {
  if (STATE.phase === 'gameover' || STATE.phase === 'title') return;
  if (STATE.phase === 'playing') {
    STATE.phase = 'paused';
    if (STATE.frameId) { cancelAnimationFrame(STATE.frameId); STATE.frameId = null; }
    elPauseScore.textContent = STATE.score.toLocaleString();
    showScreen('pause');
  } else if (STATE.phase === 'paused') {
    STATE.phase = 'playing';
    showScreen(null);
    STATE.lastTime = performance.now();
    STATE.frameId  = requestAnimationFrame(gameLoop);
  }
}

// ======================================================
// REWARDED VIDEO (simulée Phase 1)
// ======================================================
function showRewardedAd() {
  if (!STATE.canContinue) return;

  elAdOverlay.style.display = 'flex';
  elBtnContinue.disabled    = true;

  const DURATION = 5000; // 5 secondes (simule une pub courte)
  const start    = performance.now();

  /* ── POINT D'INTÉGRATION PHASE 2 ──
     Remplace le setTimeout par :
     window.adProvider.showRewardedVideo({
       onReward:  () => grantReward(),
       onClose:   () => elAdOverlay.style.display = 'none',
       onError:   () => { elAdOverlay.style.display = 'none'; alert("Pub indisponible"); },
     });
  */

  function tick() {
    const elapsed = performance.now() - start;
    const frac    = Math.min(elapsed / DURATION, 1);
    const rem     = Math.ceil((DURATION - elapsed) / 1000);

    elAdFill.style.width        = (frac * 100) + '%';
    elCountdown.textContent     = rem;

    if (frac < 1) {
      requestAnimationFrame(tick);
    } else {
      grantReward();
    }
  }
  requestAnimationFrame(tick);
}

function grantReward() {
  elAdOverlay.style.display = 'none';
  elBtnContinue.disabled    = false;

  // Petit délai pour que le joueur voit le résultat
  setTimeout(() => {
    showScreen(null);
    continueAfterAd();
  }, 300);
}

// ======================================================
// TRANSITION VAGUE
// ======================================================
function showWaveTransition(waveNum, sub, callback) {
  STATE.phase = 'wave';
  elWaveNum.textContent = waveNum;
  elWaveSub.textContent  = sub;
  showScreen('wave');

  setTimeout(() => {
    showScreen(null);
    STATE.phase = 'playing';
    callback();
  }, 2500);
}

// ======================================================
// BOUCLE PRINCIPALE
// ======================================================
function gameLoop(timestamp) {
  if (STATE.phase !== 'playing') return;

  const dt = Math.min((timestamp - STATE.lastTime) / 16.67, 3); // delta normalisé 60fps
  STATE.lastTime = timestamp;

  // — FOND —
  ctx.fillStyle = '#000008';
  ctx.fillRect(0, 0, W, H);
  drawGridLines();

  // — JOUEUR : INPUT —
  if (player) {
    // Traînée
    player.trail.push({ x: player.x, y: player.y });
    if (player.trail.length > 8) player.trail.shift();

    // Boost
    if ((keys['ShiftLeft'] || keys['ShiftRight']) && STATE.boostCharge > 0 && !STATE.boostActive) {
      STATE.boostActive = true;
    }
    if (STATE.boostActive) {
      STATE.boostCharge -= 0.8;
      if (STATE.boostCharge <= 0) { STATE.boostCharge = 0; STATE.boostActive = false; }
    } else {
      STATE.boostCharge = Math.min(100, STATE.boostCharge + 0.15);
    }
    elBoost.style.width = STATE.boostCharge + '%';

    const spd = STATE.boostActive ? player.speed * 1.8 : player.speed;

    if ((keys['ArrowLeft']  || keys['KeyA']) && player.x > player.w / 2)     player.x -= spd * dt;
    if ((keys['ArrowRight'] || keys['KeyD']) && player.x < W - player.w / 2) player.x += spd * dt;
    if ((keys['ArrowUp']    || keys['KeyW']) && player.y > player.h / 2)     player.y -= spd * dt;
    if ((keys['ArrowDown']  || keys['KeyS']) && player.y < H - player.h / 2) player.y += spd * dt;

    // Tir
    player.shootCooldown = Math.max(0, player.shootCooldown - 1);
    if ((keys['Space'] || keys['KeyZ']) && player.shootCooldown === 0) {
      spawnBullet(player);
      player.shootCooldown = Math.max(6, player.shootDelay - Math.floor(STATE.wave * 0.5));
    }

    player.invincible = Math.max(0, player.invincible - 1);
    drawPlayer(player);
  }

  // — TIRS JOUEUR —
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.y < -20 || b.x < -20 || b.x > W + 20) { bullets.splice(i, 1); continue; }
    drawBullet(b);
  }

  // — ENNEMIS —
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    updateEnemy(e, dt);
    if (e.y > H + 60) { enemies.splice(i, 1); continue; } // ennemi sorti = malus invisible
    drawEnemy(e);
  }

  // — TIRS ENNEMIS —
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.y > H + 20 || b.x < -20 || b.x > W + 20 || b.y < -20) {
      enemyBullets.splice(i, 1); continue;
    }
    ctx.save();
    ctx.shadowColor = b.color;
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // — POWER-UPS —
  updatePowerups();
  drawPowerups();

  // — PARTICULES —
  updateParticles();
  drawParticles();

  // — MULTIPLICATEUR —
  if (STATE.multTimer > 0) {
    STATE.multTimer--;
    if (STATE.multTimer === 0) {
      STATE.multiplier = 1;
      updateHUD();
    }
  }

  // — COLLISIONS —
  checkCollisions();

  // — FIN DE VAGUE —
  if (enemies.length === 0 && STATE.phase === 'playing') {
    STATE.wave++;
    const sub = STATE.wave % 5 === 0
      ? '⚠ BOSS INCOMING'
      : subMessages[STATE.wave % subMessages.length];
    showWaveTransition(STATE.wave, sub, () => {
      bullets      = [];
      enemyBullets = [];
      powerups     = [];
      spawnWave(STATE.wave);
      updateHUD();
      STATE.frameId = requestAnimationFrame(gameLoop);
    });
    return; // stop la boucle pendant la transition
  }

  STATE.frameId = requestAnimationFrame(gameLoop);
}

const subMessages = [
  'Prépare-toi...', 'Ils arrivent.', 'Tiens bon.', 'Résiste.',
  '☠ Danger croissant', 'Pas de répit.', 'Toujours plus nombreux.',
];

// ======================================================
// GRILLE DÉCORATIVE
// ======================================================
function drawGridLines() {
  ctx.save();
  ctx.strokeStyle = 'rgba(0,245,255,0.03)';
  ctx.lineWidth   = 1;
  const step = 50;
  for (let x = 0; x <= W; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.restore();
}

// ======================================================
// ÉVÉNEMENTS BOUTONS
// ======================================================
document.getElementById('btn-start').addEventListener('click', () => {
  elTitleHigh.textContent = STATE.highScore.toLocaleString();
  startGame();
});

document.getElementById('btn-restart').addEventListener('click', () => {
  startGame();
});

document.getElementById('btn-quit-go').addEventListener('click', () => {
  showScreen('title');
  hideGame();
  STATE.phase = 'title';
  elTitleHigh.textContent = STATE.highScore.toLocaleString();
});

document.getElementById('btn-resume').addEventListener('click', () => {
  togglePause();
});

document.getElementById('btn-quit-pause').addEventListener('click', () => {
  if (STATE.frameId) { cancelAnimationFrame(STATE.frameId); STATE.frameId = null; }
  STATE.phase = 'title';
  hideGame();
  showScreen('title');
  elTitleHigh.textContent = STATE.highScore.toLocaleString();
});

// Rewarded video
elBtnContinue.addEventListener('click', () => {
  showRewardedAd();
});

// ======================================================
// INIT AFFICHAGE TITLE
// ======================================================
elTitleHigh.textContent = STATE.highScore.toLocaleString();
showScreen('title');
hideGame();
