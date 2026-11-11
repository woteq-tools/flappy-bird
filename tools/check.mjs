#!/usr/bin/env node
/**
 * check.mjs — sanity checks for the PWA.
 *
 * Verifies that every file referenced by the manifest, the service worker and
 * index.html actually exists, so a typo can never silently break the install
 * or the offline cache.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const ok = [];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/* --- manifest ------------------------------------------------------- */
let manifest;
try {
  manifest = JSON.parse(read('manifest.json'));
  ok.push('manifest.json parses');
} catch (err) {
  problems.push(`manifest.json is not valid JSON: ${err.message}`);
}

if (manifest) {
  for (const field of ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color']) {
    if (!manifest[field]) problems.push(`manifest.json is missing "${field}"`);
  }
  if (manifest.display !== 'standalone') problems.push('manifest display should be "standalone"');

  const sizes = new Set();
  for (const icon of manifest.icons || []) {
    if (!exists(icon.src)) problems.push(`manifest icon missing on disk: ${icon.src}`);
    else ok.push(`icon ${icon.src} (${icon.sizes}, ${icon.purpose || 'any'})`);
    sizes.add(icon.sizes);
  }
  if (!sizes.has('192x192')) problems.push('manifest is missing a 192x192 icon');
  if (!sizes.has('512x512')) problems.push('manifest is missing a 512x512 icon');
  if (!sizes.has('512x512') || ![...sizes].some((s) => s === '192x192')) {
    problems.push('manifest needs both 192x192 and 512x512 icons');
  }
  const hasMaskable = (manifest.icons || []).some((i) => (i.purpose || '').includes('maskable'));
  if (!hasMaskable) problems.push('manifest is missing a maskable icon');
}

/* --- service worker ------------------------------------------------- */
const sw = read('sw.js');
const shellMatch = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
if (!shellMatch) {
  problems.push('sw.js: could not find SHELL_ASSETS');
} else {
  const assets = [...shellMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const asset of assets) {
    const rel = asset.replace(/^\.\//, '').replace(/^\/$/, 'index.html');
    if (!exists(rel)) problems.push(`sw.js precache references a missing file: ${asset}`);
  }
  ok.push(`sw.js precaches ${assets.length} assets`);
  if (!/self\.addEventListener\('fetch'/.test(sw)) problems.push('sw.js has no fetch handler');
  if (!/SKIP_WAITING/.test(sw)) problems.push('sw.js does not support skipWaiting');
}

/* --- index.html ----------------------------------------------------- */
const html = read('index.html');
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
for (const ref of refs) {
  if (ref.startsWith('http') || ref.startsWith('data:')) continue;
  if (!exists(ref)) problems.push(`index.html references a missing file: ${ref}`);
}
ok.push(`index.html references ${refs.length} local files`);

if (!/<meta name="theme-color"/.test(html)) problems.push('index.html has no theme-color meta tag');
if (!/viewport-fit=cover/.test(html)) problems.push('index.html viewport is missing viewport-fit=cover');

/* --- report --------------------------------------------------------- */
console.log('✓ ' + ok.join('\n✓ '));
if (problems.length) {
  console.error('\n✗ ' + problems.join('\n✗ '));
  process.exit(1);
}
console.log('\nAll checks passed.');
