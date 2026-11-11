/**
 * main.js — wires the canvas game to the DOM chrome, keyboard, touch input,
 * the install prompt and the service worker.
 */

import { FlappyGame } from './game.js';
import { Storage } from './storage.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game');
const stage = $('stage');

const ui = {
  hud: $('hud'),
  start: $('startOverlay'),
  pause: $('pauseOverlay'),
  over: $('overOverlay'),
  soundBtn: $('soundBtn'),
  pauseBtn: $('pauseBtn'),
  playBtn: $('playBtn'),
  retryBtn: $('retryBtn'),
  homeBtn: $('homeBtn'),
  resumeBtn: $('resumeBtn'),
  quitBtn: $('quitBtn'),
  installBtn: $('installBtn'),
  toast: $('toast'),
  coinCount: $('coinCount'),
  bestCount: $('bestCount'),
  startBest: $('startBest'),
  startCoins: $('startCoins'),
  startGames: $('startGames'),
  overScore: $('overScore'),
  overBest: $('overBest'),
  overCoins: $('overCoins'),
  overTitle: $('overTitle'),
  newBest: $('newBestBadge'),
};

let toastTimer = 0;

function toast(message, ms = 2600) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, ms);
}

/* ── game ───────────────────────────────────────────────────── */

const game = new FlappyGame(canvas, {
  onEvent: ({ type, payload }) => {
    switch (type) {
      case 'score':
        ui.bestCount.textContent = Math.max(Storage.get('best') || 0, payload);
        break;

      case 'coin':
        ui.coinCount.textContent = Storage.get('coins') || 0;
        break;

      case 'over':
        ui.overScore.textContent = payload.score;
        ui.overBest.textContent = payload.best;
        ui.overCoins.textContent = payload.coins;
        ui.newBest.hidden = !payload.isBest;
        ui.overTitle.textContent = payload.isBest ? 'New Record!' : 'Game Over';
        ui.bestCount.textContent = payload.best;
        ui.coinCount.textContent = payload.totalCoins;
        break;

      case 'state':
        applyState(payload);
        break;
    }
  },
});

function applyState(state) {
  ui.start.hidden = state !== 'ready';
  ui.pause.hidden = state !== 'paused';
  ui.over.hidden = state !== 'over';
  ui.pauseBtn.hidden = !(state === 'playing' || state === 'dying' || state === 'paused');

  if (state === 'ready') {
    ui.startBest.textContent = Storage.get('best') || 0;
    ui.startCoins.textContent = Storage.get('coins') || 0;
    ui.startGames.textContent = Storage.get('games') || 0;
  }
}

/* ── input ─────────────────────────────────────────────────── */

function primaryAction() {
  switch (game.state) {
    case 'ready':
      game.startRun();
      break;
    case 'over':
      game.restart();
      break;
    case 'paused':
      game.resume();
      break;
    case 'playing':
    case 'dying':
      game.press();
      break;
  }
}

// Canvas taps and clicks.
canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  game.press();
});

// Tapping the dimmed area of an overlay triggers its main action.
ui.start.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button')) return;
  game.startRun();
});
ui.over.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button')) return;
  game.restart();
});
ui.pause.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button')) return;
  game.resume();
});

// Keyboard.
window.addEventListener('keydown', (event) => {
  const key = event.key;

  if (key === ' ' || key === 'Spacebar' || key === 'ArrowUp' || key === 'w' || key === 'W') {
    event.preventDefault();
    if (game.state === 'paused') return;
    primaryAction();
    return;
  }

  if (key === 'Escape' || key === 'p' || key === 'P') {
    event.preventDefault();
    if (game.state === 'ready' || game.state === 'over') return;
    game.togglePause();
    return;
  }

  if (key === 'm' || key === 'M') {
    toggleSound();
  }
});

// Buttons.
ui.playBtn.addEventListener('click', () => game.startRun());
ui.retryBtn.addEventListener('click', () => game.restart());
ui.homeBtn.addEventListener('click', () => game.toMenu());
ui.resumeBtn.addEventListener('click', () => game.resume());
ui.quitBtn.addEventListener('click', () => game.toMenu());
ui.pauseBtn.addEventListener('click', () => game.togglePause());

function toggleSound() {
  const next = !(Storage.get('sound') !== false);
  game.setSound(next);
  ui.soundBtn.classList.toggle('muted', !next);
  ui.soundBtn.setAttribute('aria-label', next ? 'Mute sound' : 'Unmute sound');
  toast(next ? 'Sound on' : 'Sound off', 1400);
}

ui.soundBtn.classList.toggle('muted', Storage.get('sound') === false);
ui.soundBtn.addEventListener('click', toggleSound);

// Pause automatically when the app is backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (game.state === 'playing' || game.state === 'dying')) {
    game.pause();
  }
});

// Block the long-press context menu / text selection on the game area.
stage.addEventListener('contextmenu', (event) => event.preventDefault());

/* ── install prompt ────────────────────────────────────────── */

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  ui.installBtn.hidden = false;
});

ui.installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  ui.installBtn.hidden = true;
  if (outcome === 'accepted') toast('Installing Flappy Bird…');
});

window.addEventListener('appinstalled', () => {
  ui.installBtn.hidden = true;
  toast('Flappy Bird installed 🎉');
});

/* ── service worker ────────────────────────────────────────── */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');

      if (reg.waiting) {
        showUpdateToast(reg.waiting);
      }

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast(worker);
          }
        });
      });
    } catch {
      /* offline / unsupported — the game still runs, just not offline */
    }
  });
}

let reloading = false;

function showUpdateToast(worker) {
  toast('Update ready — tap to refresh', 6000);
  ui.toast.style.cursor = 'pointer';
  ui.toast.onclick = () => {
    worker.postMessage({ type: 'SKIP_WAITING' });
  };
}

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (reloading) return;
  reloading = true;
  window.location.reload();
});

/* ── boot ───────────────────────────────────────────────────── */

// Handy for debugging from the device console (e.g. `__game.state`).
window.__game = game;

ui.bestCount.textContent = Storage.get('best') || 0;
ui.coinCount.textContent = Storage.get('coins') || 0;
applyState('ready');

// iOS Safari has no install prompt — point people at the share sheet.
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone =
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if (isIOS && !standalone) {
  ui.installBtn.hidden = false;
  ui.installBtn.textContent = '📲 Share → Add to Home Screen';
  ui.installBtn.addEventListener('click', () => {
    toast('Tap the Share button, then "Add to Home Screen"');
  });
}
