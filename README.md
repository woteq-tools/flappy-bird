# Flappy Bird

An installable **Flappy Bird clone** for Android — tap to flap, dodge the pipes, grab the coins and
chase your high score. Plain HTML, CSS and JavaScript, no build step, no dependencies, no accounts,
no tracking.

**Live:** <https://woteq-tools.github.io/flappy-bird/>

> Add it to your home screen from Chrome (⋮ → *Add to Home screen*) and it runs full screen, offline,
> like a native app.

---

## Features

| | |
|---|---|
| **Gameplay** | One-tap flap, gravity, momentum, rotating bird, pipe collision, falling death animation |
| **Progression** | The gap shrinks and the pipes speed up as your score climbs |
| **Coins** | Gold coins hide between the pipes — they are saved to your profile |
| **Scoring** | Live score on the canvas, personal best and games played, kept in `localStorage` |
| **Sound** | Every effect is synthesised with the Web Audio API — no audio files to download |
| **Controls** | Tap / click, `Space`, `↑` or `W` to flap · `Esc` or `P` to pause · `M` to mute |
| **Pause** | Manual pause button, plus automatic pause when the app is backgrounded |
| **PWA** | `manifest.json` (standalone, portrait, maskable icons), service worker, install prompt |
| **Offline** | The whole app shell is precached — it launches and plays with no network at all |
| **Responsive** | Portrait canvas that fills any screen, safe-area aware for notches and gesture bars |

Everything is drawn procedurally on a `<canvas>`: sky, sun, clouds, hills, pipes, coins, the bird and
the ground. There are no image assets at all — the app shell is under 100 kB.

---

## Play

| Action | Touch | Keyboard |
|---|---|---|
| Flap | Tap the screen | `Space` / `↑` / `W` |
| Pause | Pause button | `Esc` / `P` |
| Mute | Speaker button | `M` |
| Retry | Tap anywhere on the game-over card | `Space` |

---

## Project layout

```
index.html            markup + overlays (menu, pause, game over)
css/styles.css        all styling, dark chrome around a bright game canvas
js/main.js            bootstrap: DOM wiring, input, install prompt, service worker
js/game.js            the engine — physics, spawning, collision, rendering
js/audio.js           Web Audio sound effects (synthesised, no files)
js/storage.js         guarded localStorage wrapper
sw.js                 service worker: precached shell, offline navigation
manifest.json         PWA manifest (standalone, portrait, maskable icons)
icons/                generated PNG icons
tools/make-icons.mjs  generates every icon from scratch (pure Node, no deps)
tools/check.mjs       validates the manifest, service worker and HTML references
```

## Development

```bash
npm start          # serve the folder on http://localhost:8080
npm run icons      # regenerate icons/ from tools/make-icons.mjs
npm run check      # validate manifest + service worker + asset references
```

`tools/make-icons.mjs` contains a small PNG encoder (Node's `zlib` does the compression) and a
software rasteriser, so the icons can be rebuilt without installing anything.

## How it works

* **Fixed timestep simulation** — physics run at a fixed `1/120 s` step with an accumulator, so the
  game feels identical on a 60 Hz phone and a 144 Hz monitor.
* **Logical coordinate system** — the canvas renders a fixed 360-unit-wide world; the visible height
  adapts to the device aspect ratio, so the play field simply gets taller on a long screen.
* **Forgiving hitbox** — the collision circle is slightly smaller than the drawn bird, which makes
  near misses feel fair.
* **Offline** — the service worker precaches the shell on install, serves navigations
  network-first with a cached fallback, and refreshes assets in the background.

## Deploying

The game is a static site, so any static host works. For GitHub Pages:

```bash
git init && git add . && git commit -m "Flappy Bird PWA"
gh repo create woteq-tools/flappy-bird --public --source=. --push
gh api -X PUT repos/woteq-tools/flappy-bird/pages -f source[branch]=main -f source[path]=/ --jq '.html_url'
```

It is live at <https://woteq-tools.github.io/flappy-bird/>.

---

Made by [Woteq Tools](https://woteq-tools.github.io/) — small, free, offline-friendly browser apps.
