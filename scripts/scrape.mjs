// Lädt die Song-Auswahl des St. Pauli Song Contests von fcstpauli.com
// und schreibt alle Songs inkl. Detailinfos nach app/songs.json.
//
//   node scripts/scrape.mjs              -> live von fcstpauli.com laden
//   node scripts/scrape.mjs --local DIR  -> HTML-Dateien aus DIR lesen (zum Testen)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const BASE = 'https://www.fcstpauli.com/spsc/der-st-pauli-song-contest-deine-stimme-wird-gebraucht';
const OUT = path.resolve('app/songs.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const PAGES = ['song-auswahl', 'song-auswahl-2'];

// Kategorie anhand des Präfixes der Song-Nummer
const CATEGORIES = {
  S: { id: 'S', name: 'Bereits bestehende Songs', short: 'Bestehend', source: `${BASE}/song-auswahl` },
  N: { id: 'N', name: 'Neu erstellte Songs (ohne KI)', short: 'Neu', source: `${BASE}/song-auswahl-2` },
  K: { id: 'K', name: 'Neu erstellte Songs (mit KI)', short: 'Neu mit KI', source: `${BASE}/song-auswahl-2` },
};

const args = process.argv.slice(2);
const localDir = args[0] === '--local' ? args[1] : null;
// --save-raw DIR: bereinigten Seiteninhalt zur Kontrolle ablegen
const rawDir = args.includes('--save-raw') ? args[args.indexOf('--save-raw') + 1] : null;

async function saveRaw(name, html) {
  if (!rawDir) return;
  let a = html.indexOf('<h1'), b = html.indexOf('Themen aus der Gemeinschaft');
  const main = html.slice(a < 0 ? 0 : a, b < 0 ? undefined : b)
    .replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/ (class|style|data-[\w-]+)="[^"]*"/g, '');
  await mkdir(rawDir, { recursive: true });
  await writeFile(path.join(rawDir, name + '.html'), main);
}

async function load(slug) {
  if (localDir) {
    for (const p of [path.join(localDir, `${slug}.html`), path.join(localDir, 'sample', `${slug}.html`)]) {
      if (existsSync(p)) return readFile(p, 'utf8');
    }
    return null;
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${BASE}/${slug}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9' } });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt === 4) { console.warn(`! ${slug}: ${err.message}`); return null; }
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const text = html => decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();

const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function youtubeId(url) {
  const m = decode(url).match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// Listen-Seiten: <li><a href="...">S0001, Titel - Interpret</a></li>
// Jedes <li> einzeln auswerten – teils steht Text auch außerhalb des Links ("…Sparre</a>r")
function parseList(html) {
  const items = [];
  for (const [, li] of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)) {
    const m = text(li).match(/^([SNK])(\d{3,})\s*,\s*([\s\S]+)$/);
    if (!m) continue;
    const href = li.match(/<a\b[^>]*href="([^"]+)"/);
    items.push({ id: m[1] + m[2], prefix: m[1], label: m[3].replace(/\s+/g, ' ').trim(), href: href ? decode(href[1]) : null });
  }
  return items;
}

// Den Inhalt eines <div> ab Position start (zeigt auf "<div") inkl. verschachtelter Divs
function balancedDiv(html, start) {
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}

function paragraphs(html) {
  const out = [];
  for (const [, inner] of html.matchAll(/<(?:p|h[3-6]|li)\b[^>]*>([\s\S]*?)<\/(?:p|h[3-6]|li)>/g)) {
    const t = text(inner);
    if (t) out.push(t);
  }
  if (!out.length) { const t = text(html); if (t) out.push(t); }
  return out;
}

function parseDetail(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  let start = h1 ? h1.index : 0;
  let end = html.indexOf('Themen aus der Gemeinschaft', start);
  if (end < 0) end = html.length;
  end = html.lastIndexOf('<h2', end);
  const main = html.slice(start, end > start ? end : undefined);

  const detail = { heading: h1 ? text(h1[1]) : null, artist: null, description: [], sections: [], audio: [], youtube: [], documents: [], links: [] };

  // Abschnitte: <h2>Überschrift</h2><div>Inhalt</div>
  const h2re = /<h2[^>]*>([\s\S]*?)<\/h2>/g;
  let m, first = true;
  while ((m = h2re.exec(main))) {
    const heading = text(m[1]);
    const divStart = main.indexOf('<div', h2re.lastIndex);
    if (divStart < 0) continue;
    const block = balancedDiv(main, divStart);
    const paras = paragraphs(block);
    if (first) { detail.artist = heading; detail.description = paras; first = false; }
    else detail.sections.push({ heading, paragraphs: paras });
  }
  // Einreichungen nur als Text (z. B. Songtext ohne Audio) haben keine <h2>-Abschnitte
  if (first) {
    const h1Text = detail.heading ? norm(detail.heading) : '';
    detail.description = paragraphs(main.slice(h1 ? h1[0].length : 0))
      .filter(p => !/^[SNK]\d{3,}$/.test(p) && !h1Text.includes(norm(p)) && p !== 'Sharing Icon');
  }
  // Beschriftungen von Datei-Downloads ("pdf 1.0Mb", "K0011 Songtext") gehören nicht zur Beschreibung
  const noise = p => /^(pdf|docx?|txt)\s+[\d.,]+\s*[km]?b$/i.test(p) || /^[SNK]\d{3,}\s+Songtext$/i.test(p);
  detail.description = detail.description.filter(p => !noise(p));
  for (const sec of detail.sections) sec.paragraphs = sec.paragraphs.filter(p => !noise(p));

  // Angehängte Dokumente (z. B. Songtext als PDF)
  for (const [, href] of main.matchAll(/<a\b[^>]*href="(https?:[^"]+\/uploads\/documents\/[^"]+)"/g)) {
    const url = decode(href);
    const ext = (url.match(/\.(\w+)(?:\?|$)/) || [, 'Datei'])[1].toUpperCase();
    if (!detail.documents.some(d => d.url === url)) detail.documents.push({ url, label: `Songtext / Dokument (${ext})` });
  }

  for (const [, src] of main.matchAll(/<(?:audio|source)\b[^>]*\bsrc="([^"]+)"/g)) {
    const url = decode(src);
    if (!detail.audio.includes(url)) detail.audio.push(url);
  }
  for (const [, src] of main.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const id = youtubeId(src);
    if (id && !detail.youtube.includes(id)) detail.youtube.push(id);
  }
  // Weitere Links in der Beschreibung (z. B. Songtext, Bandcamp, Instagram)
  for (const [, href, label] of main.matchAll(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = decode(href);
    if (youtubeId(url) || /fcstpauli\.com/.test(url)) continue;
    if (!detail.links.some(l => l.url === url)) detail.links.push({ url, label: text(label) || url });
  }
  return detail;
}

// "Titel - Interpret" aufteilen; bekannter Interpret (aus der Detailseite) hat Vorrang
const SEPARATORS = [' - ', ' – ', ' — '];
function splitLabel(label, artist) {
  if (artist) {
    for (const sep of [...SEPARATORS, '_', ' _ ', ' -', '- ', ' ']) {
      const suffix = sep + artist;
      if (label.toLowerCase().endsWith(suffix.toLowerCase())) return { title: label.slice(0, -suffix.length).trim(), artist };
    }
  }
  // Am letzten Trenner teilen (z. B. "St. Pauli ’Til I Die - Swearing At Motorists")
  for (const sep of SEPARATORS) {
    const i = label.lastIndexOf(sep);
    if (i <= 0) continue;
    const title = label.slice(0, i).trim(), listArtist = label.slice(i + sep.length).trim();
    if (!artist) return { title, artist: listArtist };
    const a = norm(artist), b = norm(listArtist);
    if (a.includes(b) || b.includes(a)) return { title, artist };
  }
  return { title: label, artist: artist || '' };
}

function siteName(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const known = { 'bandcamp.com': 'Bandcamp', 'spotify.com': 'Spotify', 'soundcloud.com': 'SoundCloud', 'apple.com': 'Apple Music', 'deezer.com': 'Deezer' };
  const hit = Object.keys(known).find(k => host === k || host.endsWith('.' + k));
  return hit ? `Auf ${known[hit]} anhören` : host;
}

// Prüft per oEmbed, ob YouTube das Einbetten erlaubt (401 = Einbetten gesperrt, 400/404 = nicht verfügbar)
async function youtubeStatus(id) {
  if (localDir) return 'ok';
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`, { headers: { 'User-Agent': UA } });
    if (res.ok) return 'ok';
    if (res.status === 401 || res.status === 403) return 'no-embed';
    if (res.status === 400 || res.status === 404) return 'unavailable';
  } catch {}
  return 'ok';
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

async function main() {
  const previous = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : null;
  const prevById = new Map((previous?.songs ?? []).map(s => [s.id, s]));

  const items = [];
  for (const slug of PAGES) {
    const html = await load(slug);
    if (!html) throw new Error(`Seite ${slug} konnte nicht geladen werden`);
    await saveRaw(slug, html);
    const list = parseList(html);
    console.log(`${slug}: ${list.length} Songs`);
    items.push(...list.map(it => ({ ...it, page: `${BASE}/${slug}` })));
  }
  if (!items.length) throw new Error('Keine Songs gefunden – hat sich die Seitenstruktur geändert?');

  let failed = 0;
  const songs = await pool(items, 4, async (it, i) => {
    const isDetail = /fcstpauli\.com\/spsc\//.test(it.href ?? '');
    let detail = null;
    if (isDetail) {
      const slug = it.href.replace(/[?#].*$/, '').split('/').filter(Boolean).pop();
      const html = await load(slug);
      if (html) { detail = parseDetail(html); await saveRaw(slug, html); }
      else failed++;
    }
    const prev = prevById.get(it.id);
    if (isDetail && !detail && prev) return prev; // Fehler beim Laden: alte Daten behalten

    const { title, artist } = splitLabel(it.label, detail?.artist);
    const yt = [...new Set([it.href && youtubeId(it.href), ...(detail?.youtube ?? [])].filter(Boolean))];
    // Link der Liste auf andere Seiten (z. B. Bandcamp) als Anhör-Link übernehmen
    const links = [...(detail?.links ?? [])];
    if (it.href && !isDetail && !youtubeId(it.href)) links.unshift({ url: it.href, label: siteName(it.href) });
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${items.length}`);
    return {
      id: it.id,
      category: it.prefix,
      title,
      artist,
      description: detail?.description ?? [],
      sections: detail?.sections ?? [],
      audio: detail?.audio ?? [],
      youtube: yt,
      documents: detail?.documents ?? [],
      links,
      url: isDetail ? it.href : it.page,
    };
  });

  // Einbettbarkeit der YouTube-Videos prüfen
  const ytIds = [...new Set(songs.flatMap(s => s.youtube))];
  const ytStatus = new Map(await pool(ytIds, 4, async id => [id, await youtubeStatus(id)]));
  for (const s of songs) {
    s.youtubeBlocked = s.youtube.filter(id => ytStatus.get(id) !== 'ok');
    s.youtubeUnavailable = s.youtube.filter(id => ytStatus.get(id) === 'unavailable');
  }
  console.log(`YouTube: ${ytIds.length} Videos, ${[...ytStatus.values()].filter(v => v === 'no-embed').length} nicht einbettbar, ` +
    `${[...ytStatus.values()].filter(v => v === 'unavailable').length} nicht verfügbar`);

  const data = {
    updated: new Date().toISOString(),
    source: PAGES.map(p => `${BASE}/${p}`),
    categories: Object.values(CATEGORIES),
    songs,
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');

  const count = c => songs.filter(s => s.category === c).length;
  console.log(`Fertig: ${songs.length} Songs (S ${count('S')}, N ${count('N')}, K ${count('K')}), ` +
    `${songs.filter(s => s.audio.length).length} mit MP3, ${songs.filter(s => !s.audio.length && s.youtube.length).length} nur YouTube, ` +
    `${songs.filter(s => !s.audio.length && !s.youtube.length).length} ohne Medien, ${failed} Detailseiten fehlgeschlagen`);
}

main().catch(err => { console.error(err); process.exit(1); });
