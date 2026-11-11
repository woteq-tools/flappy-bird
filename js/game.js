/**
 * game.js — the Flappy Bird engine: physics, spawning, collision and rendering.
 *
 * The canvas is driven with a fixed-timestep simulation (1/120 s) so the
 * physics behave identically on a 60 Hz phone and a 144 Hz monitor.
 */

import { AudioKit } from './audio.js';
import { Storage } from './storage.js';

/* ── tuning ─────────────────────────────────────────────────── */

const VIEW_W = 360; // logical width, in game units
const FIXED_DT = 1 / 120;
const MAX_FRAME = 0.25; // clamp huge frame gaps (tab was backgrounded)

const CFG = {
  gravity: 1520,
  flapImpulse: -438,
  maxFall: 780,
  birdX: 88,
  birdR: 12,
  hitR: 10.2,
  pipeW: 62,
  capH: 26,
  capExtra: 6,
  gapStart: 172,
  gapMin: 130,
  gapShrinkPerPoint: 1.7,
  spacing: 210,
  speedStart: 148,
  speedMax: 192,
  speedRamp: 1.3,
  groundH: 86,
  coinChance: 0.55,
  cloudSpeed: 13,
};

/* ── palette ────────────────────────────────────────────────── */

const C = {
  skyTop: '#3FBDF7',
  skyMid: '#7ED9FB',
  skyBot: '#B8EEFF',
  sun: '#FFF6C4',
  hillFar: '#8FDDB4',
  hillNear: '#4FC08C',
  soil: '#E2C68C',
  soilDark: '#C9A96A',
  grass: '#63C74E',
  grassDark: '#4AA33A',
  grassLight: '#87E26B',
  pipeLight: '#A8E86C',
  pipeMain: '#74CB4E',
  pipeDark: '#43962F',
  bird: '#FFD34D',
  birdDark: '#E8A317',
  birdLight: '#FFEDB0',
  beak: '#FF8A1F',
  beakDark: '#DD6206',
  eye: '#FFFFFF',
  pupil: '#1B2430',
  coin: '#FFC233',
  coinDark: '#C07C00',
  coinLight: '#FFE9A8',
};

/* ── helpers ────────────────────────────────────────────────── */

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Circle vs. axis-aligned rectangle overlap test. */
function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

/* ── game ───────────────────────────────────────────────────── */

export class FlappyGame {
  constructor(canvas, { onEvent } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.onEvent = onEvent || (() => {});
    this.audio = new AudioKit();
    this.audio.setEnabled(Storage.get('sound') !== false);

    this.state = 'ready';
    this.time = 0;
    this.acc = 0;
    this.lastTime = 0;
    this.raf = 0;

    this.scale = 1;
    this.viewH = 640;
    this.dpr = 1;

    this.reset();
    this.bindResize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ── lifecycle ───────────────────────────────────────────── */

  reset() {
    this.score = 0;
    this.sessionCoins = 0;
    this.pipes = [];
    this.particles = [];
    this.floaters = [];
    this.clouds = [];
    this.shake = 0;
    this.scrollX = 0;
    this.speed = CFG.speedStart;
    this.nextPipeX = VIEW_W + 90;
    this.dying = false;
    this.flash = 0;

    for (let i = 0; i < 6; i++) {
      this.clouds.push({
        x: rand(0, VIEW_W),
        y: rand(40, this.viewH * 0.5),
        r: rand(16, 34),
        speed: rand(0.5, 1),
        alpha: rand(0.45, 0.85),
      });
    }

    this.bird = {
      x: CFG.birdX,
      y: this.viewH * 0.42,
      vy: 0,
      rot: 0,
      wing: 0,
    };
  }

  bindResize() {
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.canvas.parentElement || this.canvas);
    }
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
  }

  resize() {
    const parent = this.canvas.parentElement || document.body;
    const rect = parent.getBoundingClientRect();
    const cssW = Math.max(240, rect.width);
    const cssH = Math.max(320, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    this.dpr = dpr;
    this.scale = cssW / VIEW_W;
    this.viewH = cssH / this.scale;

    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
    this.ctx.imageSmoothingEnabled = true;

    // Keep the bird at a sensible height when the viewport changes.
    const groundTop = this.groundTop;
    if (this.state === 'ready') this.bird.y = clamp(this.bird.y, 60, groundTop - 60);
    this.bird.y = clamp(this.bird.y, 20, groundTop);
  }

  get groundTop() {
    return this.viewH - CFG.groundH;
  }

  /* ── input ───────────────────────────────────────────────── */

  /** A tap / click / key press. */
  press() {
    this.audio.unlock();
    if (this.state === 'ready') {
      this.startRun();
      return;
    }
    if (this.state === 'playing') this.doFlap();
  }

  doFlap() {
    this.bird.vy = CFG.flapImpulse;
    this.bird.wing = -1;
    this.audio.flap();
    this.spawnDust(this.bird.x - 10, this.bird.y + 8, 3, '#FFFFFF');
  }

  startRun() {
    this.reset();
    this.state = 'playing';
    this.audio.start();
    this.doFlap();
    this.emit('state', 'playing');
  }

  restart() {
    this.startRun();
  }

  toMenu() {
    this.reset();
    this.state = 'ready';
    this.emit('state', 'ready');
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'dying') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.emit('state', 'paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState || 'playing';
    this.lastTime = performance.now();
    this.acc = 0;
    this.emit('state', this.state);
  }

  togglePause() {
    if (this.state === 'paused') this.resume();
    else this.pause();
  }

  setSound(on) {
    this.audio.setEnabled(on);
    Storage.set('sound', !!on);
  }

  emit(type, payload) {
    this.onEvent({ type, payload });
  }

  /* ── simulation ──────────────────────────────────────────── */

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.lastTime) this.lastTime = now;
    const dt = Math.min((now - this.lastTime) / 1000, MAX_FRAME);
    this.lastTime = now;

    this.acc += dt;
    let guard = 0;
    while (this.acc >= FIXED_DT && guard++ < 30) {
      this.step(FIXED_DT);
      this.acc -= FIXED_DT;
    }
    this.render();
  }

  step(dt) {
    this.time += dt;
    this.updateBackground(dt);
    this.updateParticles(dt);

    if (this.state === 'ready') {
      this.bird.y = this.viewH * 0.42 + Math.sin(this.time * 3.4) * 11;
      this.bird.rot = Math.sin(this.time * 3.4) * 0.06;
      this.bird.wing += dt * 6;
      return;
    }

    if (this.state === 'paused') return;

    // --- gravity -------------------------------------------------
    this.bird.vy = Math.min(this.bird.vy + CFG.gravity * dt, CFG.maxFall);
    this.bird.y += this.bird.vy * dt;

    // --- rotation ------------------------------------------------
    const target = this.bird.vy < -60 ? -0.42 : clamp(this.bird.vy / 620, -0.42, 1.3);
    this.bird.rot += (target - this.bird.rot) * Math.min(1, dt * 9);
    this.bird.wing += dt * (this.bird.vy < 0 ? 22 : 14);

    if (this.state === 'playing') {
      this.updatePipes(dt);
      if (this.checkCollisions()) return;
    } else if (this.state === 'dying') {
      // No control, just tumble to the floor.
      if (this.bird.y + CFG.birdR >= this.groundTop) {
        this.bird.y = this.groundTop - CFG.birdR;
        this.gameOver();
      }
    }
  }

  updateBackground(dt) {
    const slow = this.state === 'playing' ? 1 : 0.45;
    this.scrollX += CFG.cloudSpeed * this.speed * 0.1 * slow * dt;

    for (const cloud of this.clouds) {
      cloud.x -= CFG.cloudSpeed * cloud.speed * slow * dt;
      if (cloud.x < -cloud.r * 2.4) {
        cloud.x = VIEW_W + cloud.r * 2;
        cloud.y = rand(40, this.viewH * 0.5);
        cloud.r = rand(16, 34);
      }
    }
  }

  updatePipes(dt) {
    const speed = this.speed;
    this.scrollX += speed * dt;

    for (const pipe of this.pipes) pipe.x -= speed * dt;

    // Difficulty ramps with the score, then plateaus.
    const ramp = Math.min(this.score, 24);
    this.speed = Math.min(CFG.speedMax, CFG.speedStart + ramp * CFG.speedRamp);
    const gap = Math.max(
      CFG.gapMin,
      CFG.gapStart - ramp * CFG.gapShrinkPerPoint,
    );

    // Spawn the next pipe.
    const last = this.pipes[this.pipes.length - 1];
    if (!last || last.x + CFG.spacing < VIEW_W + 60) {
      const margin = 58;
      const minY = margin;
      const maxY = this.groundTop - margin - gap;
      const gapY = rand(minY, Math.max(minY + 1, maxY));
      const pipe = { x: VIEW_W + 40, gapY, gap, scored: false, coin: null };
      if (Math.random() < CFG.coinChance) {
        pipe.coin = { taken: false, y: gapY + gap / 2, spin: rand(0, Math.PI * 2) };
      }
      this.pipes.push(pipe);
    }

    // Score + coin pickup.
    for (const pipe of this.pipes) {
      if (!pipe.scored && pipe.x + CFG.pipeW < this.bird.x) {
        pipe.scored = true;
        this.score++;
        this.audio.score();
        this.spawnDust(this.bird.x + 14, this.bird.y, 6, '#FFFFFF');
        this.emit('score', this.score);
      }
      if (pipe.coin && !pipe.coin.taken) {
        const cx = pipe.x + CFG.pipeW / 2;
        const dx = cx - this.bird.x;
        const dy = pipe.coin.y - this.bird.y;
        if (dx * dx + dy * dy < (CFG.birdR + 11) ** 2) {
          pipe.coin.taken = true;
          this.sessionCoins++;
          this.audio.coin();
          this.floaters.push({ x: cx, y: pipe.coin.y, life: 0.9, text: '+1' });
          this.spawnBurst(cx, pipe.coin.y, 12, C.coin);
          this.emit('coin', this.sessionCoins);
        }
      }
    }

    // Retire pipes that are off screen.
    this.pipes = this.pipes.filter((p) => p.x + CFG.pipeW > -40);
  }

  checkCollisions() {
    const b = this.bird;
    const r = CFG.hitR;
    const capX = CFG.pipeW + CFG.capExtra * 2;

    for (const pipe of this.pipes) {
      const capTop = pipe.gapY - CFG.capH;
      const botTop = pipe.gapY + pipe.gap;

      if (
        circleHitsRect(b.x, b.y, r, pipe.x, -10, CFG.pipeW, capTop + 10) ||
        circleHitsRect(b.x, b.y, r, pipe.x - CFG.capExtra, capTop, capX, CFG.capH) ||
        circleHitsRect(b.x, b.y, r, pipe.x, botTop + CFG.capH, CFG.pipeW, this.groundTop - botTop) ||
        circleHitsRect(b.x, b.y, r, pipe.x - CFG.capExtra, botTop, capX, CFG.capH)
      ) {
        this.hit();
        return true;
      }
    }

    if (b.y + CFG.birdR >= this.groundTop) {
      b.y = this.groundTop - CFG.birdR;
      this.hit();
      return true;
    }
    if (b.y - CFG.birdR <= -8) {
      b.y = -8 + CFG.birdR;
      b.vy = Math.max(b.vy, 0);
    }
    return false;
  }

  hit() {
    this.state = 'dying';
    this.dying = true;
    this.shake = 12;
    this.flash = 0.35;
    this.audio.hit();
    this.bird.vy = -190;
    this.spawnBurst(this.bird.x, this.bird.y, 14, '#FFFFFF');
    this.emit('state', 'dying');
  }

  gameOver() {
    this.state = 'over';
    this.audio.gameOver();
    const best = Storage.get('best') || 0;
    const isBest = this.score > best;
    if (isBest) Storage.set('best', this.score);
    const totalCoins = Storage.add('coins', this.sessionCoins);
    Storage.add('games', 1);
    this.emit('over', {
      score: this.score,
      best: Math.max(best, this.score),
      coins: this.sessionCoins,
      totalCoins,
      isBest,
    });
    this.emit('state', 'over');
  }

  /* ── particles ───────────────────────────────────────────── */

  spawnDust(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + rand(-4, 4),
        y: y + rand(-4, 4),
        vx: rand(-70, -20),
        vy: rand(-40, 10),
        life: rand(0.25, 0.55),
        max: 0.55,
        size: rand(1.6, 3.4),
        color,
        gravity: 90,
      });
    }
  }

  spawnBurst(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(60, 220);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.3, 0.7),
        max: 0.7,
        size: rand(1.8, 4),
        color,
        gravity: 260,
      });
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= 34 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 34);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.6);
  }

  /* ── rendering ───────────────────────────────────────────── */

  render() {
    const ctx = this.ctx;
    ctx.save();

    if (this.shake > 0.2) {
      const s = this.shake;
      ctx.translate(rand(-s, s), rand(-s, s));
    }

    this.drawSky(ctx);
    this.drawSun(ctx);
    this.drawClouds(ctx);
    this.drawHills(ctx);
    this.drawPipes(ctx);
    this.drawCoins(ctx);
    this.drawParticles(ctx);
    this.drawBird(ctx);
    this.drawGround(ctx);
    this.drawFloaters(ctx);
    this.drawScore(ctx);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,80,60,${this.flash * 0.5})`;
      ctx.fillRect(-40, -40, VIEW_W + 80, this.viewH + 80);
    }

    ctx.restore();
  }

  drawSky(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.groundTop);
    g.addColorStop(0, C.skyTop);
    g.addColorStop(0.55, C.skyMid);
    g.addColorStop(1, C.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, this.viewH);
  }

  drawSun(ctx) {
    const x = VIEW_W * 0.78;
    const y = this.viewH * 0.13;
    const glow = ctx.createRadialGradient(x, y, 4, x, y, 90);
    glow.addColorStop(0, 'rgba(255,246,196,0.55)');
    glow.addColorStop(0.4, 'rgba(255,246,196,0.16)');
    glow.addColorStop(1, 'rgba(255,246,196,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 90, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = C.sun;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  drawClouds(ctx) {
    for (const cloud of this.clouds) {
      const x = cloud.x;
      const y = cloud.y;
      const r = cloud.r;
      ctx.fillStyle = `rgba(255,255,255,${cloud.alpha})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.58, 0, 0, Math.PI * 2);
      ctx.ellipse(x - r * 0.62, y + r * 0.18, r * 0.66, r * 0.42, 0, 0, Math.PI * 2);
      ctx.ellipse(x + r * 0.6, y + r * 0.2, r * 0.56, r * 0.36, 0, 0, Math.PI * 2);
      ctx.ellipse(x + r * 0.05, y - r * 0.3, r * 0.52, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawHills(ctx) {
    const layers = [
      { color: C.hillFar, amp: 26, len: 300, y: this.groundTop - 46, par: 0.14 },
      { color: C.hillNear, amp: 34, len: 380, y: this.groundTop - 18, par: 0.26 },
    ];
    for (const L of layers) {
      ctx.fillStyle = L.color;
      ctx.beginPath();
      ctx.moveTo(0, this.groundTop);
      for (let x = 0; x <= VIEW_W + 12; x += 10) {
        const wx = x + this.scrollX * L.par;
        const yy = L.y - Math.abs(Math.sin((wx / L.len) * Math.PI * 2)) * L.amp;
        ctx.lineTo(x, yy);
      }
      ctx.lineTo(VIEW_W, this.groundTop);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawPipe(ctx, x, gapY, gap) {
    const w = CFG.pipeW;
    const capH = CFG.capH;
    const ext = CFG.capExtra;
    const groundTop = this.groundTop;

    // --- top pipe ---
    const topShaftH = gapY - capH;
    this.pipeShaft(ctx, x, -10, w, topShaftH + 10);
    this.pipeCap(ctx, x - ext, gapY - capH, w + ext * 2, capH, true);

    // --- bottom pipe ---
    const botTop = gapY + gap;
    this.pipeShaft(ctx, x, botTop + capH, w, groundTop - botTop - capH + 10);
    this.pipeCap(ctx, x - ext, botTop, w + ext * 2, capH, false);
  }

  pipeShaft(ctx, x, y, w, h) {
    if (h <= 0) return;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, C.pipeDark);
    g.addColorStop(0.14, C.pipeLight);
    g.addColorStop(0.34, C.pipeMain);
    g.addColorStop(0.82, C.pipeMain);
    g.addColorStop(1, C.pipeDark);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }

  pipeCap(ctx, x, y, w, h, isTop) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, C.pipeDark);
    g.addColorStop(0.14, C.pipeLight);
    g.addColorStop(0.34, C.pipeMain);
    g.addColorStop(0.82, C.pipeMain);
    g.addColorStop(1, C.pipeDark);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    // Dark lip on the joint side.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    if (isTop) ctx.fillRect(x, y + h - 5, w, 5);
    else ctx.fillRect(x, y, w, 5);

    // Top highlight.
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x + w * 0.16, y + 2, w * 0.16, h - 4);
  }

  drawPipes(ctx) {
    for (const pipe of this.pipes) {
      this.drawPipe(ctx, pipe.x, pipe.gapY, pipe.gap);
    }
  }

  drawCoins(ctx) {
    for (const pipe of this.pipes) {
      const coin = pipe.coin;
      if (!coin || coin.taken) continue;
      const x = pipe.x + CFG.pipeW / 2;
      const y = coin.y;
      const wobble = Math.abs(Math.cos(coin.spin + this.time * 2.6));
      const rx = 3 + wobble * 8;
      const ry = 10;

      ctx.save();
      ctx.shadowColor = 'rgba(255,180,0,0.55)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = C.coinDark;
      ctx.beginPath();
      ctx.ellipse(x, y, rx + 1.5, ry + 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const g = ctx.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
      g.addColorStop(0, C.coinLight);
      g.addColorStop(0.5, C.coin);
      g.addColorStop(1, C.coinDark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.ellipse(x - rx * 0.3, y - ry * 0.35, rx * 0.22, ry * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const t = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawFloaters(ctx) {
    ctx.textAlign = 'center';
    ctx.font = '900 20px ui-rounded, "Trebuchet MS", system-ui, sans-serif';
    for (const f of this.floaters) {
      ctx.globalAlpha = clamp(f.life / 0.9, 0, 1);
      ctx.fillStyle = C.coin;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 4;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  drawGround(ctx) {
    const gy = this.groundTop;
    const h = CFG.groundH;

    // soil
    ctx.fillStyle = C.soil;
    ctx.fillRect(0, gy + 16, VIEW_W, h);

    // soil speckles
    ctx.fillStyle = C.soilDark;
    const spacing = 46;
    const off = this.scrollX % spacing;
    for (let x = -spacing; x < VIEW_W + spacing; x += spacing) {
      ctx.beginPath();
      ctx.ellipse(x + off, gy + 40, 5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // grass band
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, gy, VIEW_W, 18);
    ctx.fillStyle = C.grassDark;
    ctx.fillRect(0, gy, VIEW_W, 5);
    ctx.fillStyle = C.grassLight;

    // chevrons
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    const cw = 34;
    const coff = this.scrollX % cw;
    for (let x = -cw; x < VIEW_W + cw; x += cw) {
      ctx.beginPath();
      ctx.moveTo(x + coff, gy + 7);
      ctx.lineTo(x + coff + 9, gy + 13);
      ctx.lineTo(x + coff + 18, gy + 7);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  drawBird(ctx) {
    const b = this.bird;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.beginPath();
    ctx.ellipse(0, 13, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.fillStyle = C.bird;
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 11.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // lower shading
    ctx.fillStyle = C.birdDark;
    ctx.beginPath();
    ctx.ellipse(0, 5.5, 12, 5.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // belly
    ctx.fillStyle = C.birdLight;
    ctx.beginPath();
    ctx.ellipse(-1, 4.5, 8, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // wing — flaps on the flap cycle
    const flap = Math.sin(b.wing) * 0.5;
    ctx.save();
    ctx.translate(-2, 2);
    ctx.rotate(-0.5 + flap);
    ctx.fillStyle = C.birdDark;
    ctx.beginPath();
    ctx.ellipse(-3, 0, 7.5, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // beak
    ctx.fillStyle = C.beakDark;
    ctx.beginPath();
    ctx.moveTo(9, -2.5);
    ctx.lineTo(20, 2);
    ctx.lineTo(9, 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.beak;
    ctx.beginPath();
    ctx.moveTo(9, -2.5);
    ctx.lineTo(19, 1.2);
    ctx.lineTo(9, 2.6);
    ctx.closePath();
    ctx.fill();

    // eye
    ctx.fillStyle = C.eye;
    ctx.beginPath();
    ctx.arc(4.2, -4.6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.pupil;
    ctx.beginPath();
    ctx.arc(5.6, -4.2, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(6.5, -5.2, 0.9, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawScore(ctx) {
    if (this.state === 'ready') return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '900 46px ui-rounded, "Trebuchet MS", system-ui, sans-serif';
    const y = 76;
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = 'rgba(28,58,88,0.9)';
    ctx.strokeText(String(this.score), VIEW_W / 2, y);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(String(this.score), VIEW_W / 2, y);
  }
}
