// Service worker del catálogo: cachea el "cascarón" de la página para que abra
// rápido y también sin conexión.
// Los productos (el CSV) NO se cachean aquí: siempre se piden a la red, y app.js
// guarda la última copia en localStorage por si no hay conexión.
//
// ⚠️ SUBIR ESTE NÚMERO EN CADA CAMBIO (v1 → v2 → v3…). Si no, los celulares
// que ya abrieron la página siguen viendo la versión vieja.
const CACHE = 'timeless-catalogo-v49';
const ASSETS = [
  './',
  './index.html',
  './reclamaciones.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // Solo borra las cachés propias (mismo prefijo): la copia de pruebas vive en el
      // mismo dominio y usa otro prefijo, así no se borran entre sí.
      Promise.all(keys.filter((k) => k !== CACHE && k.indexOf(CACHE.replace(/\d+$/, '')) === 0).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first solo para archivos del mismo origen (la página en sí y las fotos).
// Las peticiones a docs.google.com (el CSV publicado) van siempre directo a la red.
// Los .csv del mismo origen (el de prueba) tampoco se cachean: precios y stock
// tienen que salir siempre frescos.
// config.js va red-primero: así un cambio de número de WhatsApp o de usuario de
// Instagram se toma sin esperar otra versión.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.csv')) return;
  if (url.pathname.endsWith('/config.js')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
