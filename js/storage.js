/**
 * storage.js — tiny safe wrapper around localStorage.
 *
 * Every access is guarded: private-mode browsers and some WebViews throw on
 * `localStorage` access, and a crash here must never take the game down.
 */

const KEY = 'woteq.flappy.v1';

const DEFAULTS = {
  best: 0,
  coins: 0,
  games: 0,
  sound: true,
};

let memory = { ...DEFAULTS };
let usable = true;

function read() {
  if (!usable) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return memory;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      memory = { ...DEFAULTS, ...parsed };
    }
  } catch {
    /* corrupted or blocked — fall back to in-memory defaults */
  }
  return memory;
}

function write() {
  if (!usable) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    usable = false;
  }
}

export const Storage = {
  get(key) {
    const data = read();
    return key in data ? data[key] : DEFAULTS[key];
  },

  set(key, value) {
    const data = read();
    data[key] = value;
    memory = data;
    write();
    return value;
  },

  /** Adds `amount` to a numeric key and returns the new value. */
  add(key, amount = 1) {
    const data = read();
    const next = (Number(data[key]) || 0) + amount;
    data[key] = next;
    memory = data;
    write();
    return next;
  },
};
