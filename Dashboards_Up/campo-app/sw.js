/* Service worker: la app funciona sin conexión y recuerda los mapas ya vistos */
const VERSION = 'v1.0.0';
const SHELL = 'campo-shell-' + VERSION;
const TILES = 'campo-tiles-v1';
const MAX_TILES = 4000;
const ASSETS = [
  './', 'index.html', 'app.css', 'manifest.json',
  'js/db.js', 'js/geo.js', 'js/exif.js', 'js/watermark.js', 'js/app.js',
  'lib/leaflet.js', 'lib/leaflet.css', 'lib/jszip.min.js',
  'lib/images/layers.png', 'lib/images/layers-2x.png', 'lib/images/marker-icon.png', 'lib/images/marker-shadow.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];
const TILE_HOSTS = ['server.arcgisonline.com', 'tile.openstreetmap.org'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('campo-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES), keys = await c.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => c.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Teselas de mapa: primero caché, luego red (y se guardan)
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { c.put(req, res.clone()); if (Math.random() < 0.02) trimTiles(); }
        return res;
      } catch (err) { return new Response('', { status: 504 }); }
    })());
    return;
  }

  // Archivos de la app: caché inmediato y actualización en segundo plano
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      const res = await net;
      if (res) return res;
      if (req.mode === 'navigate') return c.match('index.html');
      return new Response('', { status: 504 });
    })());
  }
});
