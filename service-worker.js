// SPEEDIX League — Service Worker
// Stratégie : network-first pour index.html (pour ne pas servir une version figée),
// cache-first pour les assets statiques (icônes, logos, CDN).
// ▸ Bump CACHE_VERSION à chaque release significative pour invalider l'ancien cache.
// ▸ Le client (index.html) détecte l'installation d'un nouveau SW, lui envoie
//   SKIP_WAITING, et recharge automatiquement dès que le nouveau prend le
//   contrôle — les utilisateurs ont ainsi la nouvelle version sans refresh manuel.

const CACHE_VERSION = 'speedix-v55';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-180.png',
  '/logo-speedix.png',
  '/logo-speedix-hd.png',
  '/logo-speedix-sm.png'
];

// ── Install : pré-cache les assets essentiels ────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] pre-cache partial fail', err);
      });
    })
  );
  // On ne skipWaiting QUE sur demande du client (message SKIP_WAITING), pour
  // éviter d'interrompre l'utilisateur au milieu d'une action. Le client envoie
  // ce message uniquement quand il a détecté qu'il y a bien un nouveau SW prêt.
});

// ── Message : SKIP_WAITING demandé par le client → on prend la main ──────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Activate : nettoie les vieux caches d'une version précédente ─────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => {
      return Promise.all(
        names.filter(n => n !== CACHE_VERSION).map(n => caches.delete(n))
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch : stratégie hybride ────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ne rien faire sur les requêtes non-GET (POST Supabase, PATCH, etc.)
  if (request.method !== 'GET') return;

  // Ne jamais intercepter les appels Supabase / Strava / autres API :
  // ces réponses sont dynamiques et doivent toujours aller au réseau.
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('strava.com') ||
    url.hostname.includes('dicebear.com')
  ) {
    return; // laisse passer au réseau sans toucher
  }

  // Network-first pour le HTML (pour voir les mises à jour immédiatement)
  if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(request)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(request, copy));
          return resp;
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Cache-first pour les assets statiques (icônes, logos, CDN)
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(resp => {
        // On met en cache uniquement les réponses OK
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(request, copy));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
