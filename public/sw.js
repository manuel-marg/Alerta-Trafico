// Service Worker para Alerta de Tráfico PWA

const CACHE_NAME = 'alerta-trafico-v23';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/fonts/fonts.css',
  '/fonts/google-sans-latin.woff2',
  '/fonts/google-sans-latin-ext.woff2',
  '/fonts/roboto-latin.woff2',
  '/fonts/roboto-latin-ext.woff2',
  '/fonts/material-symbols-outlined.woff2',
  '/icons/android-chrome-192x192.png',
  '/icons/android-chrome-512x512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32x32.png',
  '/icons/favicon-16x16.png',
  '/icons/favicon.ico'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    clients.claim().then(() => {
      return caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
      });
    })
  );
});

// Servir fuentes e iconos desde caché del Service Worker para carga instantánea
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/'))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request);
      })
    );
  }
});

// Manejador del evento PUSH (Llegada de la notificación en segundo plano)
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Alerta de Tráfico', body: event.data.text() };
    }
  }

  const title = data.title || '🚦 ¡Alerta de Salida Matutina!';
  const options = {
    body: data.body || 'Revisa el tráfico actual para llegar a tiempo.',
    icon: data.icon || '/icons/android-chrome-192x192.png',
    badge: data.badge || '/icons/android-chrome-192x192.png',
    tag: data.tag || 'traffic-alert',
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    data: {
      url: data.url || '/',
      mapsUrl: data.mapsUrl || null
    },
    actions: data.actions || [
      { action: 'open_maps', title: '🗺️ Abrir Maps' },
      { action: 'open_app', title: '📱 Ver Detalles' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Manejador al hacer click en la notificación o sus botones
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  let targetUrl = event.notification.data?.url || '/';

  // Si el usuario presionó la acción de Maps y hay una URL de navegación
  if (event.action === 'open_maps' && event.notification.data?.mapsUrl) {
    targetUrl = event.notification.data.mapsUrl;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si la URL es externa (Google Maps), abrirla directamente
      if (targetUrl.startsWith('http') && !targetUrl.includes(self.location.host)) {
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      }

      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
