'use strict';

const AUDIO_CACHE = 'spsc-audio';
const STORE_KEY = 'spsc-state-v1';

const $ = sel => document.querySelector(sel);
const view = $('#view');

let data = null;          // Inhalt von songs.json
let byId = new Map();
let cachedAudio = new Set(); // URLs der offline gespeicherten MP3s

// ---------- Zustand (Favoriten, gehört, Filter) ----------
const state = Object.assign(
  { favs: [], heard: [], tab: 'all', fav: false, unheard: false, offline: false, q: '' },
  readStore()
);
const favs = new Set(state.favs);
const heard = new Set(state.heard);

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function save() {
  state.favs = [...favs];
  state.heard = [...heard];
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}

// ---------- Hilfsfunktionen ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
const catName = id => data.categories.find(c => c.id === id)?.name ?? id;
const isOfflineAvailable = s => s.audio.some(u => cachedAudio.has(u));

// ---------- Daten laden ----------
async function loadData() {
  const res = await fetch('songs.json', { cache: 'no-cache' }).catch(() => null)
    || await caches.match('songs.json');
  if (!res || !res.ok) throw new Error('Song-Liste konnte nicht geladen werden');
  data = await res.json();
  byId = new Map(data.songs.map(s => [s.id, s]));
  for (const s of data.songs) {
    s._search = norm([s.id, s.title, s.artist, ...s.description, ...s.sections.flatMap(x => [x.heading, ...x.paragraphs])].join(' '));
  }
}

async function refreshCachedAudio() {
  if (!('caches' in window)) return;
  const cache = await caches.open(AUDIO_CACHE);
  cachedAudio = new Set((await cache.keys()).map(r => r.url));
}

// ---------- Liste ----------
function renderTabs() {
  const tabs = [{ id: 'all', short: 'Alle' }, ...data.categories];
  const nav = $('#tabs');
  nav.replaceChildren(...tabs.map(c => {
    const n = c.id === 'all' ? data.songs.length : data.songs.filter(s => s.category === c.id).length;
    const nf = c.id === 'all' ? favs.size : data.songs.filter(s => s.category === c.id && favs.has(s.id)).length;
    return h('button', {
      class: 'tab', role: 'tab', 'aria-selected': String(state.tab === c.id), title: c.name || 'Alle Songs',
      onclick: () => { state.tab = c.id; save(); go('#/'); render(); },
    }, c.short, ' ', h('span', { class: 'n' }, nf ? `${n} · ★${nf}` : n));
  }));
  $('#f-fav').setAttribute('aria-pressed', String(state.fav));
  $('#f-unheard').setAttribute('aria-pressed', String(state.unheard));
  $('#f-offline').setAttribute('aria-pressed', String(state.offline));
}

function filtered() {
  const terms = norm(state.q).split(/\s+/).filter(Boolean);
  return data.songs.filter(s =>
    (state.tab === 'all' || s.category === state.tab) &&
    (!state.fav || favs.has(s.id)) &&
    (!state.unheard || !heard.has(s.id)) &&
    (!state.offline || isOfflineAvailable(s)) &&
    terms.every(t => s._search.includes(t))
  );
}

function starButton(song, cls = 'star') {
  const on = favs.has(song.id);
  const b = h('button', {
    class: cls, 'aria-pressed': String(on), 'aria-label': on ? 'Favorit entfernen' : 'Als Favorit markieren',
    onclick: e => { e.preventDefault(); toggleFav(song.id); },
  });
  b.innerHTML = STAR;
  return b;
}

function songRow(s) {
  const badges = h('span', { class: 'badges' },
    s.audio.length ? h('span', { class: 'badge' }, 'MP3') : null,
    !s.audio.length && s.youtube.length ? h('span', { class: 'badge yt' }, 'YouTube') : null,
    !s.audio.length && !s.youtube.length ? h('span', { class: 'badge' }, 'nur Text') : null,
    isOfflineAvailable(s) ? h('span', { class: 'badge off' }, 'offline') : null,
    heard.has(s.id) ? h('span', { class: 'badge heard' }, '✓ gehört') : null,
  );
  return h('li', { class: 'song', id: 'row-' + s.id },
    h('a', { class: 'main', href: '#/song/' + s.id },
      h('span', { class: 'id' }, s.id), badges,
      h('span', { class: 'title' }, s.title),
      h('span', { class: 'artist' }, s.artist || '–'),
    ),
    starButton(s),
  );
}

function renderList() {
  renderTabs();
  const songs = filtered();
  const parts = [h('div', { class: 'summary' },
    h('span', {}, `${songs.length} ${songs.length === 1 ? 'Song' : 'Songs'}`),
    h('span', {}, `★ ${favs.size} Favoriten · ✓ ${heard.size} gehört`),
  )];
  if (!songs.length) {
    parts.push(h('p', { class: 'empty' }, state.fav && !favs.size
      ? 'Noch keine Favoriten. Tippe auf den Stern bei einem Song.'
      : 'Keine Songs gefunden.'));
  } else if (state.tab === 'all') {
    for (const c of data.categories) {
      const group = songs.filter(s => s.category === c.id);
      if (!group.length) continue;
      parts.push(h('h2', { class: 'group-title' }, `${c.name} (${group.length})`));
      parts.push(h('ul', { class: 'list' }, group.map(songRow)));
    }
  } else {
    parts.push(h('h2', { class: 'group-title' }, catName(state.tab)));
    parts.push(h('ul', { class: 'list' }, songs.map(songRow)));
  }
  view.replaceChildren(...parts);
}

// ---------- Detail ----------
let currentObjectUrl = null;

function renderDetail(id) {
  const s = byId.get(id);
  if (!s) { go('#/'); return; }
  renderTabs();
  if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }

  const list = filtered();
  const idx = list.findIndex(x => x.id === id);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  const media = [];
  if (s.audio.length) {
    for (const url of s.audio) {
      const audio = h('audio', { controls: true, preload: 'none', src: url });
      audio.addEventListener('ended', () => markHeard(s.id, true));
      audio.addEventListener('play', () => { document.querySelectorAll('audio').forEach(a => a !== audio && a.pause()); });
      useCachedAudio(audio, url);
      media.push(h('div', { class: 'player' }, audio));
    }
  } else if (s.youtube.length) {
    // Kein MP3 hinterlegt -> YouTube-Video einbetten
    for (const yt of s.youtube) {
      if (navigator.onLine) {
        media.push(h('div', { class: 'video' }, h('iframe', {
          src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0`, title: `${s.title} – ${s.artist}`, loading: 'lazy',
          allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture', allowfullscreen: true,
          referrerpolicy: 'strict-origin-when-cross-origin',
        })));
      } else {
        const box = h('div', { class: 'video-offline' }, h('span', {}, 'YouTube-Video – zum Abspielen wird Internet benötigt'));
        box.style.backgroundImage = `url(https://i.ytimg.com/vi/${yt}/hqdefault.jpg)`;
        media.push(box);
      }
    }
  } else {
    media.push(h('p', { class: 'muted' }, 'Für diesen Song ist kein MP3 und kein Video hinterlegt – nur der Text.'));
  }

  const desc = h('div', { class: 'desc' },
    s.description.length ? s.description.map(p => h('p', {}, p)) : h('p', { class: 'muted' }, 'Keine Beschreibung vorhanden.'),
    s.sections.map(sec => [h('h3', {}, sec.heading), sec.paragraphs.map(p => h('p', {}, p))]),
  );

  const favBtn = h('button', { class: 'btn fav', 'aria-pressed': String(favs.has(s.id)), onclick: () => toggleFav(s.id) },
    favs.has(s.id) ? '★ Favorit' : '☆ Favorit');
  const heardBtn = h('button', { class: 'btn heard', 'aria-pressed': String(heard.has(s.id)), onclick: () => markHeard(s.id) },
    heard.has(s.id) ? '✓ Gehört' : 'Als gehört markieren');

  const actions = h('div', { class: 'actions' }, favBtn, heardBtn);
  if (s.audio.length) {
    const offline = isOfflineAvailable(s);
    actions.append(h('button', {
      class: 'btn', disabled: offline,
      onclick: async e => {
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Speichere …';
        const ok = await cacheSongs([s]);
        toast(ok ? 'MP3 offline gespeichert' : 'Speichern fehlgeschlagen – bist du online?');
        render();
      },
    }, offline ? '✓ MP3 offline gespeichert' : '⬇ MP3 offline speichern'));
  }
  if (!s.audio.length && s.youtube.length) {
    actions.append(h('a', { class: 'btn', href: `https://www.youtube.com/watch?v=${s.youtube[0]}`, target: '_blank', rel: 'noopener' }, 'Auf YouTube öffnen'));
  }
  for (const d of s.documents ?? []) {
    actions.append(h('a', { class: 'btn', href: d.url, target: '_blank', rel: 'noopener' }, '📄 ' + d.label));
  }
  actions.append(h('a', { class: 'btn', href: s.url, target: '_blank', rel: 'noopener' }, 'Offizielle Seite'));

  view.replaceChildren(h('section', { class: 'detail' },
    h('a', { class: 'back', href: '#/' }, '← Zurück zur Liste'),
    h('div', { class: 'meta' }, `${s.id} · ${catName(s.category)}`),
    h('h2', {}, s.title),
    h('p', { class: 'by' }, s.artist),
    media,
    actions,
    desc,
    s.links.length ? [h('h3', {}, 'Links'), h('ul', { class: 'links' }, s.links.map(l => h('li', {}, h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label))))] : null,
    h('div', { class: 'nav-row' },
      prev ? h('a', { class: 'btn', href: '#/song/' + prev.id }, '← ' + prev.id) : h('span'),
      next ? h('a', { class: 'btn primary', href: '#/song/' + next.id }, next.id + ' →') : h('span'),
    ),
  ));
  window.scrollTo(0, 0);
}

// Gespeichertes MP3 bevorzugt aus dem Cache abspielen
async function useCachedAudio(audio, url) {
  if (!cachedAudio.has(url)) return;
  const res = await caches.match(url, { cacheName: AUDIO_CACHE });
  if (!res || res.type === 'opaque') return; // undurchsichtige Antworten liefert der Service Worker aus
  const blob = await res.blob();
  if (!audio.isConnected) return;
  currentObjectUrl = URL.createObjectURL(blob);
  audio.src = currentObjectUrl;
}

// ---------- Aktionen ----------
function toggleFav(id) {
  favs.has(id) ? favs.delete(id) : favs.add(id);
  save();
  render(true);
}

function markHeard(id, value) {
  const on = value ?? !heard.has(id);
  on ? heard.add(id) : heard.delete(id);
  save();
  if (value === undefined) render(true);
}

async function cacheSongs(songs, onProgress) {
  if (!('caches' in window)) return false;
  const cache = await caches.open(AUDIO_CACHE);
  const urls = songs.flatMap(s => s.audio).filter(u => !cachedAudio.has(u));
  let ok = 0, done = 0;
  for (const url of urls) {
    try {
      let res;
      try { res = await fetch(url, { mode: 'cors' }); } catch { res = null; }
      if (!res || !res.ok) res = await fetch(url, { mode: 'no-cors' });
      if (res.ok || res.type === 'opaque') { await cache.put(url, res); cachedAudio.add(url); ok++; }
    } catch {}
    onProgress?.(++done, urls.length);
  }
  return ok === urls.length;
}

async function cacheMany(songs, label) {
  const withAudio = songs.filter(s => s.audio.length && !isOfflineAvailable(s));
  if (!withAudio.length) { toast('Alle MP3s sind bereits offline gespeichert'); return; }
  if (!navigator.onLine) { toast('Dafür wird eine Internetverbindung benötigt'); return; }
  await requestPersistence();
  const ok = await cacheSongs(withAudio, (d, n) => toast(`${label}: ${d} / ${n} MP3s gespeichert …`, 60000));
  toast(ok ? `${label}: fertig, alles offline verfügbar` : `${label}: einige MP3s konnten nicht gespeichert werden`, 4000);
  render(true);
}

async function requestPersistence() {
  try { await navigator.storage?.persist?.(); } catch {}
}

async function shareFavs() {
  const list = data.songs.filter(s => favs.has(s.id));
  if (!list.length) { toast('Noch keine Favoriten markiert'); return; }
  const text = 'Meine Favoriten beim St. Pauli Song Contest:\n' +
    list.map(s => `★ ${s.id} – ${s.title} – ${s.artist}`).join('\n');
  if (navigator.share) {
    try { await navigator.share({ title: 'SPSC Favoriten', text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Favoriten in die Zwischenablage kopiert'); }
  catch { prompt('Favoriten kopieren:', text); }
}

async function updateData() {
  if (!navigator.onLine) { toast('Keine Internetverbindung'); return; }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    await loadData();
    toast(`Song-Liste aktualisiert (${data.songs.length} Songs, Stand ${fmtDate(data.updated)})`, 4000);
    render();
  } catch { toast('Aktualisieren fehlgeschlagen'); }
}

const fmtDate = iso => new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function renderAbout() {
  const node = $('#about-tpl').content.cloneNode(true);
  node.querySelector('#about-sources').replaceChildren(...data.source.map(u => h('li', {}, h('a', { href: u, target: '_blank', rel: 'noopener' }, u))));
  node.querySelector('#about-updated').textContent = fmtDate(data.updated);
  view.replaceChildren(node);
  window.scrollTo(0, 0);
}

// ---------- Routing ----------
function go(hash) { if (location.hash !== hash) location.hash = hash; }

let lastListScroll = 0;
function render(keepScroll) {
  const y = window.scrollY;
  const m = location.hash.match(/^#\/song\/(\w+)/);
  if (m) {
    renderDetail(m[1]);
  } else if (location.hash === '#/about') {
    renderAbout();
  } else {
    renderList();
  }
  if (keepScroll) window.scrollTo(0, y);
}

let prevHash = location.hash;
window.addEventListener('hashchange', () => {
  const wasList = !/^#\/(song|about)/.test(prevHash);
  if (wasList) lastListScroll = window.scrollY;
  prevHash = location.hash;
  render();
  if (!/^#\/(song|about)/.test(location.hash)) window.scrollTo(0, lastListScroll);
});

// ---------- UI-Verdrahtung ----------
function wireUi() {
  const q = $('#q');
  q.value = state.q;
  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = q.value; save(); if (/^#\/song/.test(location.hash)) go('#/'); else renderList(); }, 120);
  });
  for (const [id, key] of [['#f-fav', 'fav'], ['#f-unheard', 'unheard'], ['#f-offline', 'offline']]) {
    $(id).addEventListener('click', () => { state[key] = !state[key]; save(); go('#/'); renderList(); });
  }

  const menu = $('#menu'), btn = $('#menu-btn');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!menu.contains(e.target)) close(); });
  menu.addEventListener('click', async e => {
    const action = e.target.dataset.action;
    if (!action) return;
    close();
    if (action === 'share') shareFavs();
    if (action === 'cache-favs') cacheMany(data.songs.filter(s => favs.has(s.id)), 'Favoriten');
    if (action === 'cache-all') {
      const n = data.songs.filter(s => s.audio.length && !isOfflineAvailable(s)).length;
      if (confirm(`${n} MP3s herunterladen? Das sind ca. ${Math.round(n * 6.5 / 100) / 10} GB – am besten im WLAN.`)) cacheMany(data.songs, 'Alle Songs');
    }
    if (action === 'clear-audio') {
      if (confirm('Alle offline gespeicherten MP3s löschen? Favoriten bleiben erhalten.')) {
        await caches.delete(AUDIO_CACHE); cachedAudio.clear(); toast('Offline-MP3s gelöscht'); render(true);
      }
    }
    if (action === 'update') updateData();
    if (action === 'about') go('#/about');
  });

  const net = $('#net');
  const updateNet = () => { net.hidden = navigator.onLine; };
  window.addEventListener('online', () => { updateNet(); render(true); });
  window.addEventListener('offline', () => { updateNet(); render(true); });
  updateNet();
}

// ---------- Start ----------
(async function init() {
  wireUi();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try {
    await Promise.all([loadData(), refreshCachedAudio().catch(() => {})]);
    render();
  } catch (e) {
    view.replaceChildren(h('p', { class: 'empty' }, 'Die Song-Liste konnte nicht geladen werden. Öffne die App einmal mit Internetverbindung.'));
  }
})();
