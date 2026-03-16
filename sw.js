// ═══════════════════════════════════════════════════════════════════════════════
// sw.js — Service Worker
// Cache First для оболочки, Network First для внешних API
// ═══════════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'app-v2';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
];

// ─── Установка ────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] install error:', err))
  );
});

// ─── Активация ────────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Перехват запросов ────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Пропустить не-HTTP (chrome-extension://, data:, etc.)
  if (!url.protocol.startsWith('http')) return;

  // Пропустить не-GET
  if (event.request.method !== 'GET') return;

  // Внешние API — SW не перехватывает, браузер делает запрос напрямую
  const externalHosts = [
    'script.google.com',
    'script.googleusercontent.com',
    'api.github.com',
    'unpkg.com',
    'cdn.jsdelivr.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
  ];
  if (externalHosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
    return;
  }

  // Оболочка приложения — Cache First, при промахе идём в сеть
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Кэшировать только валидные не-opaque ответы
        if (response && response.status === 200 && response.type !== 'opaque') {
          // ВАЖНО: clone() до того как тело будет прочитано cache.put()
          const toCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// ─── Сообщения от приложения ──────────────────────────────────────────────────

self.addEventListener('message', event => {
  if (!event.data) return;

  const reply = data => {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(data);
  };

  if (event.data.type === 'CLEAR_CACHE') {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => reply({ ok: true, message: 'Кэш очищен' }))
      .catch(err => reply({ ok: false, message: err.message }));
    return;
  }

  if (event.data.type === 'GET_CACHE_INFO') {
    caches.open(CACHE_NAME)
      .then(cache => cache.keys())
      .then(keys => reply({
        ok: true, cacheName: CACHE_NAME,
        data: keys.map(r => r.url), count: keys.length,
      }))
      .catch(err => reply({ ok: false, message: err.message }));
    return;
  }

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
});
