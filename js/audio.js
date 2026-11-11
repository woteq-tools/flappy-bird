/**
 * audio.js — all sound effects are synthesised with the Web Audio API.
 *
 * No audio files means the whole game ships as text + code, which keeps the
 * service-worker cache tiny and the app fully offline capable.
 */

export class AudioKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.noiseBuffer = null;
  }

  /** Creates/resumes the AudioContext. Must be called from a user gesture. */
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = this.makeNoise();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.master) {
      this.master.gain.value = this.enabled ? 0.55 : 0;
    }
  }

  makeNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  get ready() {
    return !!this.ctx && this.enabled && this.ctx.state === 'running';
  }

  /* ── primitives ──────────────────────────────────────────── */

  tone({ freq = 440, to = null, type = 'sine', dur = 0.15, gain = 0.3, delay = 0 }) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  noise({ dur = 0.12, gain = 0.25, freq = 1200, q = 1, sweepTo = null, delay = 0 }) {
    if (!this.ready || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  /* ── game sounds ─────────────────────────────────────────── */

  flap() {
    if (!this.ready) return;
    this.noise({ dur: 0.11, gain: 0.16, freq: 1500, q: 0.9, sweepTo: 420 });
    this.tone({ freq: 520, to: 760, type: 'triangle', dur: 0.09, gain: 0.12 });
  }

  score() {
    this.tone({ freq: 880, type: 'square', dur: 0.08, gain: 0.13 });
    this.tone({ freq: 1320, type: 'square', dur: 0.12, gain: 0.12, delay: 0.07 });
  }

  coin() {
    this.tone({ freq: 988, type: 'triangle', dur: 0.07, gain: 0.16 });
    this.tone({ freq: 1319, type: 'triangle', dur: 0.16, gain: 0.14, delay: 0.06 });
  }

  hit() {
    if (!this.ready) return;
    this.noise({ dur: 0.22, gain: 0.32, freq: 420, q: 0.6, sweepTo: 120 });
    this.tone({ freq: 220, to: 70, type: 'square', dur: 0.22, gain: 0.16 });
  }

  fall() {
    this.tone({ freq: 700, to: 180, type: 'sine', dur: 0.35, gain: 0.1 });
  }

  gameOver() {
    this.tone({ freq: 523, type: 'triangle', dur: 0.18, gain: 0.16 });
    this.tone({ freq: 415, type: 'triangle', dur: 0.18, gain: 0.16, delay: 0.16 });
    this.tone({ freq: 311, type: 'triangle', dur: 0.34, gain: 0.16, delay: 0.32 });
  }

  start() {
    this.tone({ freq: 660, type: 'square', dur: 0.08, gain: 0.12 });
    this.tone({ freq: 990, type: 'square', dur: 0.14, gain: 0.12, delay: 0.08 });
  }
}
