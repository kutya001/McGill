const CACHE_NAME = 'mcgill-trainer-v5';
const STATIC_ASSETS = [
    '/McGill/',
    '/McGill/index.html',
    '/McGill/manifest.json',
    '/McGill/icon-256.png',
    '/McGill/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(names.map(name => {
                if (name !== CACHE_NAME) return caches.delete(name);
            }))
        ).then(() => self.clients.claim())
    );
});

// Слушаем сообщение SKIP_WAITING для принудительной активации
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // index.json (workouts + games) — Network First, кэшируем и попутно prefetch файлов
    if (url.includes('workouts/index.json') || url.includes('games/index.json')) {
        event.respondWith(
            fetch(event.request)
                .then(async response => {
                    // Клонируем ДО любого чтения body
                    const toCache = response.clone();
                    const toRead  = response.clone();

                    // Кэшируем индекс
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(event.request, toCache);

                    // Prefetch дочерних файлов (только workouts/index.json)
                    if (url.includes('workouts/index.json')) {
                        try {
                            const data = await toRead.json();
                            const base = url.replace('index.json', '');
                            // Нормализуем: строки и объекты {file:"..."}
                            const files = Array.isArray(data)
                                ? data.map(e => typeof e === 'string' ? e : e?.file).filter(Boolean)
                                : [];
                            const uniqueFiles = [...new Set(files)];
                            uniqueFiles.forEach(f => {
                                const fileUrl = base + f;
                                cache.match(fileUrl).then(cached => {
                                    if (!cached) {
                                        fetch(fileUrl)
                                            .then(r => { if (r.ok) cache.put(fileUrl, r); })
                                            .catch(() => {});
                                    }
                                });
                            });
                        } catch(e) {}
                    }

                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Workouts JSON + Games HTML/JSON — Stale-While-Revalidate
    if ((url.includes('/workouts/') && url.endsWith('.json')) ||
        (url.includes('/games/') && (url.endsWith('.html') || url.endsWith('.json')))) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                const networkFetch = fetch(event.request).then(response => {
                    if (response && response.status === 200) {
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
                    }
                    return response;
                }).catch(() => null);
                return cached || networkFetch;
            })
        );
        return;
    }

    // Остальное — Stale-While-Revalidate
    event.respondWith(
        caches.match(event.request).then(cached => {
            const networkFetch = fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
                }
                return response;
            }).catch(() => null);
            return cached || networkFetch;
        })
    );
});
