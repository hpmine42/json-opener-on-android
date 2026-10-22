'use strict';

/* JSON Opener — Service Worker
 * Network-first so new deploys actually show up.
 * Share Target POST still intercepted here.
 */

const CACHE_NAME = 'json-opener-vue-v2';
const CORE_ASSETS = [
  './',
  './index.html',
  './sample.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/favicon-64.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

let lastShare = null;
let lastShareAt = 0;

self.addEventListener('message', (event) => {
  const client = event.source;
  const data = event.data;
  if (!data) return;
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (!client || !client.postMessage) return;
  if (data.type === 'QUERY_SHARE') {
    client.postMessage({ type: 'SHARE_TARGET', data: lastShare, at: lastShareAt });
  } else if (data.type === 'CLEAR_SHARE') {
    lastShare = null;
    lastShareAt = 0;
  } else if (data.type === 'PING') {
    client.postMessage({ type: 'PONG' });
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && isAppRoot(url)) {
    event.respondWith(
      (async () => {
        try {
          const form = await event.request.formData();
          const entry = { title: '', text: '', url: '', files: [] };
          for (const [key, value] of form.entries()) {
            if (key === 'files') {
              if (Array.isArray(value)) {
                for (const f of value) entry.files.push(f);
              } else {
                entry.files.push(value);
              }
            } else if (key in entry) {
              entry[key] = String(value);
            } else {
              entry[key] = String(value);
            }
          }
          lastShare = entry;
          lastShareAt = Date.now();
          try {
            if (self.clients && typeof self.clients.matchAll === 'function') {
              const clients = await self.clients.matchAll({ type: 'window' });
              for (const c of clients) c.postMessage({ type: 'SHARE_TARGET', data: lastShare, at: lastShareAt });
            }
          } catch (e) { /* ignore */ }

          const dest = new URL('./?shared=1', event.request.url);
          return Response.redirect(dest.href, 303);
        } catch (err) {
          return new Response('Share handling failed: ' + err.message, { status: 500 });
        }
      })()
    );
    return;
  }

  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    if (url.searchParams.has('json') || url.searchParams.has('share')) {
      event.respondWith(
        fetch('./index.html?file=' + encodeURIComponent(url.href)).catch(() =>
          caches.match('./index.html')
        )
      );
      return;
    }
  }

  /* Network first, cache fallback — so the UI always updates when online */
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      try {
        const response = await fetch(event.request);
        if (response && response.ok && response.type === 'basic' && event.request.method === 'GET') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      } catch (err) {
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const page = await caches.match('./index.html');
          if (page) return page;
        }
        throw err;
      }
    })()
  );
});

function isAppRoot(url) {
  const path = url.pathname;
  return path.endsWith('/') || path.endsWith('/index.html') || path === new URL('./', self.location.href).pathname;
}
