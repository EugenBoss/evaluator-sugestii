const CACHE_NAME = 'evaluator-pm-v2';
const ASSETS = ['/', '/index.html', '/logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // NEVER cache or intercept these — let them go directly to network
  if (
    url.includes('/api/') ||
    url.includes('supabase') ||
    url.includes('cdn.jsdelivr.net') ||
    url.includes('stripe.com') ||
    url.includes('resend.com') ||
    url.includes('vercel-insights') ||
    url.includes('vercel.live') ||
    url.includes('supabase-auth.js')
  ) {
    return; // Don't call respondWith — browser handles normally
  }

  // Everything else: network first, fallback to cache
  e.respondWith(
    fetch(e.request).then((res) => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
