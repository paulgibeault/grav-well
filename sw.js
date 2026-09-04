/* Gravity Well Service Worker — offline-first cache.
 *
 * CANONICAL FLEET SHAPE (tools/templates/game-sw.js in the launcher repo).
 * The structure here — version line, owned-prefix cleanup, scope-guarded
 * fetch, skip-waiting message — is meant to be identical across every arcade
 * app; only APP_VERSION, CACHE_PREFIX and the precache list differ. Fix a
 * bug here and it has to be carried everywhere.
 */

// Written by fleet CI on every deploy (fleet-ci.yml, "Bump patch version").
// DO NOT EDIT BY HAND, and keep the line exactly as written — single quotes,
// no leading whitespace — or the deploy-time rewrite silently stops firing
// and every fix ships to nobody who has already visited.
const APP_VERSION = '0.1.5';

// Every cache this game will ever own starts with this prefix. Cleanup is
// filtered to it; see activate for why that is not optional.
const CACHE_PREFIX = 'grav-well-';
const CACHE_NAME = `${CACHE_PREFIX}v${APP_VERSION}`;

// WARNING: This list is manually maintained. When adding new static assets
// (JS files, CSS files, images, sounds, etc.), update this list too or
// offline mode will silently break for those assets.
// tools/verify-artifact.mjs cross-checks every entry against the deploy.
// Everything this game needs to boot offline — GENERATED, not maintained.
// tools/stage.mjs rewrites the region below from the files the deploy actually
// publishes (tools/inject-precache.mjs), so the list cannot drift from the
// artifact and a content-hashed bundle name needs no hand edit. To leave a
// file out, name it in PRECACHE_EXCLUDE in tools/stage.mjs — never here.
//
// What is checked in is a placeholder: service workers are off on loopback, so
// a dev checkout never reads it.
// arcade:precache-begin
const ASSETS = [
  './',
  './index.html',
];
// arcade:precache-end

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.all(
      // Per-asset add(), not addAll(). addAll() rejects the WHOLE install on a
      // single 404, so one missing file costs a returning player their entire
      // offline shell — silently. A gap should cost one file and a log line.
      ASSETS.map(asset => cache.add(asset).catch(err =>
        console.warn('[sw] precache skipped', asset, err && err.message)))
    ))
  );
  // Deliberately NOT skipWaiting(). The new worker installs and waits; the
  // launcher spots it and offers the player an explicit "update ready" reload,
  // then sends the message below once they accept. Activating unannounced
  // would swap the cache under a running game, so anything fetched lazily
  // after the swap would come from a different build than the code asking.
});

self.addEventListener('message', event => {
  // Sent by the launcher's update control (menu → "Check for Updates", or the
  // automatic prompt) once the player accepts the reload.
  if (event.data && event.data.type === 'arcade:sw.skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          // ONLY our own caches. caches.keys() is ORIGIN-scoped and the whole
          // fleet shares paulgibeault.github.io, so a bare `k !== CACHE_NAME`
          // filter would delete the launcher's cache and every sibling
          // game's on each activation.
          .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Only requests within this game's own scope. Without this guard the
  // handler below caches EVERY request the page makes under our cache —
  // including launcher assets like /arcade-sdk.js, which then get served
  // stale from here indefinitely, and cross-origin responses we have no
  // business storing.
  if (!event.request.url.startsWith(self.registration.scope)) return;

  if (event.request.mode === 'navigate') {
    // Network-first for the HTML shell to prevent stale content
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  // Cache-first for static assets; cache successful fetches too, so assets
  // missing from ASSETS (or added later) still work offline next time.
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
