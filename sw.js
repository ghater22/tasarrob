/* ═══════════════════════════════════════════════════════════
   TASARROB — Service Worker v1.0
   استراتيجية: Cache-First مع تحديث في الخلفية
═══════════════════════════════════════════════════════════ */

const CACHE_NAME = 'tasarrob-v1';
const OFFLINE_URL = './tasarrob-v2.html';

// الموارد الأساسية للتخزين المؤقت
const CORE_ASSETS = [
  './tasarrob-v2.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

// الموارد الخارجية (خطوط وCharts)
const CDN_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

/* ── التثبيت ──────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // تخزين الموارد الأساسية
      await cache.addAll(CORE_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      // تخزين CDN بشكل منفصل (لا نفشل إن لم تُحمَّل)
      try {
        await cache.addAll(CDN_ASSETS);
      } catch(e) {
        console.warn('[SW] CDN caching skipped:', e.message);
      }
    })()
  );
  self.skipWaiting();
});

/* ── التفعيل: حذف الكاشات القديمة ──────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] حذف كاش قديم:', k);
            return caches.delete(k);
          })
      )
    )
  );
  self.clients.claim();
});

/* ── اعتراض الطلبات ─────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // تجاهل طلبات POST وغير HTTP
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // طلبات التنقل (HTML)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // الموارد الأساسية: Cache-First
  if (isCoreAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // CDN وموارد خارجية: Stale-While-Revalidate
  if (url.origin !== location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // باقي الطلبات: Network-First
  event.respondWith(networkFirst(request));
});

/* ── استراتيجيات التخزين المؤقت ────────────────────────── */

// Cache-First: أسرع، للموارد الثابتة
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('غير متاح بدون إنترنت', { status: 503 });
  }
}

// Network-First: للمحتوى المتغير
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('غير متاح', { status: 503 });
  }
}

// Network-First مع fallback للصفحة الرئيسية
async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request) || await caches.match(OFFLINE_URL);
    return cached || new Response(`
      <!DOCTYPE html><html lang="ar" dir="rtl">
      <head><meta charset="UTF-8"><title>تسرب — بدون إنترنت</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0D1B2A;color:white;text-align:center}
      h1{color:#00B5B5;font-size:2rem}p{color:rgba(255,255,255,.6)}button{margin-top:20px;padding:12px 28px;background:#00B5B5;color:white;border:none;border-radius:10px;font-size:1rem;cursor:pointer}</style></head>
      <body><div><h1>تسرب</h1><p>لا يوجد اتصال بالإنترنت<br>سيتم استعادة التطبيق عند الاتصال</p>
      <button onclick="location.reload()">إعادة المحاولة</button></div></body></html>
    `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// Stale-While-Revalidate: للخطوط والمكتبات
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise || new Response('', { status: 503 });
}

function isCoreAsset(url) {
  return CORE_ASSETS.some(asset => url.pathname.endsWith(asset.replace('./', '/')));
}

/* ── رسائل من الصفحة ─────────────────────────────────── */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
