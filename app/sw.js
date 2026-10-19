// Service Worker: macht App und Song-Liste offline verfügbar
// und liefert offline gespeicherte MP3s aus.
const VERSION = 'v2';
const SHELL = `spsc-shell-${VERSION}`;
const DATA = 'spsc-data';
const AUDIO = 'spsc-audio';
const THUMBS = 'spsc-thumbs';

const SHELL_FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-180.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES.map(f => new Request(f, { cache: 'reload' })));
    const res = await fetch('songs.json', { cache: 'no-cache' });
    if (res.ok) await (await caches.open(DATA)).put('songs.json', res);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('spsc-shell-') && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Song-Liste: Netzwerk zuerst, sonst gespeicherte Version
  if (url.origin === location.origin && url.pathname.endsWith('/songs.json')) {
    event.respondWith((async () => {
      const cache = await caches.open(DATA);
      try {
        const res = await fetch(req);
        if (res.ok) await cache.put('songs.json', res.clone());
        return res;
      } catch {
        return (await cache.match('songs.json')) || Response.error();
      }
    })());
    return;
  }

  // App-Dateien: Cache zuerst, im Hintergrund aktualisieren
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { event.waitUntil(network); return cached; }
      return (await network) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    })());
    return;
  }

  // Offline gespeicherte MP3s
  if (/\.mp3$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req.url, { cacheName: AUDIO, ignoreVary: true });
      if (!cached) return fetch(req);
      return rangeResponse(req, cached);
    })());
    return;
  }

  // YouTube-Vorschaubilder für die Offline-Ansicht merken
  if (url.hostname === 'i.ytimg.com') {
    event.respondWith((async () => {
      const cache = await caches.open(THUMBS);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      cache.put(req, res.clone());
      return res;
    })());
  }
});

// Audio-Elemente fragen Teilbereiche an (Range). Bei normalen Antworten
// schneiden wir den gewünschten Bereich aus, undurchsichtige geben wir ganz zurück.
async function rangeResponse(req, cached) {
  const range = req.headers.get('range');
  if (!range || cached.type === 'opaque') return cached;
  const buf = await cached.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const size = buf.byteLength;
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
  if (m && !m[1] && m[2]) { start = size - parseInt(m[2], 10); end = size - 1; }
  end = Math.min(end, size - 1);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
