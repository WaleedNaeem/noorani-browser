// Noorani Browser — blocklist engine
//
// Loads the bundled muslim-curated list plus any cached lists from the
// user's data dir (notably StevenBlack's porn+gambling hosts file) and
// resolves lookups in O(1) against a single combined Set per active
// category config. All I/O is synchronous and cheap — the module is
// called once at boot and whenever settings change; the hot path is
// pure in-memory Set.has() lookups.

const fs   = require('fs');
const path = require('path');
const { net } = require('electron');

const STEVENBLACK_URL =
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/gambling-porn/hosts';
const STEVENBLACK_FILENAME = 'stevenblack.json';
const STEVENBLACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days

const MUSLIM_CURATED_PATH =
  path.join(__dirname, 'blocklists', 'muslim-curated.json');

const RAMADAN_LIST_PATH =
  path.join(__dirname, 'blocklists', 'ramadan.json');

// Hostname helpers ---------------------------------------------------------

// Canonicalise a hostname: lowercase, strip a single leading "www.". We
// match on exact hostname OR any parent domain — so "ads.binance.com"
// hits the "binance.com" entry without needing a wildcard.
function canonHost(h) {
  if (!h) return '';
  let s = String(h).toLowerCase().trim();
  if (s.startsWith('www.')) s = s.slice(4);
  // Strip trailing dot
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

// Given a hostname like "a.b.binance.com", yield each suffix ancestor:
//   "a.b.binance.com", "b.binance.com", "binance.com", "com"
function* hostAncestors(host) {
  let h = canonHost(host);
  while (h) {
    yield h;
    const i = h.indexOf('.');
    if (i < 0) return;
    h = h.slice(i + 1);
  }
}

// Category → Set<domain> map. Categories we know about; unknown category
// names are ignored at lookup time.
//
// 'ramadan' is a synthetic category built at request time from the bundled
// ramadan.json + user customDomains, based on which subcategories the user
// has toggled on. It's added to combinedSet only when Ramadan is current
// AND the current time is between Fajr and Maghrib — see main.js.
const KNOWN_CATEGORIES = Object.freeze([
  'riba', 'crypto', 'gambling', 'dating', 'adult', 'stevenblack', 'ramadan'
]);

const RAMADAN_SUBCATEGORIES = Object.freeze([
  'foodDelivery', 'recipes', 'entertainment', 'social'
]);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function readJSON(p) {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('[noorani/blocklist] read failed', p, err.message);
    return null;
  }
}

// Reads the bundled muslim-curated list (baked into the repo so the app
// is useful without network access) and the cached StevenBlack list
// (downloaded async on first boot). Returns { categories, totalDomains,
// perCategory }.
function loadBlocklists(dataDir) {
  const byCategory = {};
  for (const c of KNOWN_CATEGORIES) byCategory[c] = new Set();

  // 1) Muslim-curated (bundled)
  const curated = readJSON(MUSLIM_CURATED_PATH);
  if (curated && curated.categories) {
    for (const [cat, arr] of Object.entries(curated.categories)) {
      if (!byCategory[cat]) continue;   // skip unknown categories in the file
      for (const raw of arr || []) {
        const host = canonHost(String(raw).split('/')[0]);
        if (host && !host.startsWith('//')) byCategory[cat].add(host);
      }
    }
  }

  // 2) StevenBlack cache (downloaded)
  const sbPath = path.join(dataDir, 'blocklists', STEVENBLACK_FILENAME);
  const sb = readJSON(sbPath);
  if (sb && Array.isArray(sb.domains)) {
    for (const d of sb.domains) {
      const h = canonHost(d);
      if (h) byCategory.stevenblack.add(h);
    }
  }

  const perCategory = {};
  let total = 0;
  for (const [c, set] of Object.entries(byCategory)) {
    perCategory[c] = set.size;
    total += set.size;
  }

  return {
    categories:    byCategory,
    perCategory,
    totalDomains:  total,
    stevenblack: {
      loaded:     !!sb,
      count:      sb && Array.isArray(sb.domains) ? sb.domains.length : 0,
      updatedAt:  sb && sb.updatedAt ? sb.updatedAt : null
    }
  };
}

// Build a single combined Set for quick O(1) ancestor lookups against
// whichever categories are currently active. Rebuilt only when settings
// change, not per-request.
function buildCombinedSet(loaded, activeCategories) {
  const set = new Set();
  for (const cat of activeCategories) {
    const src = loaded.categories[cat];
    if (!src) continue;
    for (const d of src) set.add(d);
  }
  return set;
}

// Map settings.features to the flat list of category names we should
// enforce. Kept here (not in main.js) so the logic lives next to the
// blocklist shapes it depends on.
function activeCategoriesFromSettings(settings) {
  const cs = (settings && settings.features && settings.features.contentSafety) || {};
  const pr = (settings && settings.features && settings.features.privacy)       || {};
  const out = new Set();

  if (cs.halalFilter)         { out.add('adult'); out.add('gambling'); out.add('stevenblack'); }
  if (pr.blockCryptoGambling) { out.add('crypto'); out.add('gambling'); out.add('stevenblack'); }
  if (pr.blockRibaAds)        { out.add('riba'); }
  if (cs.familySafeMode) {
    out.add('adult'); out.add('gambling'); out.add('crypto');
    out.add('riba');  out.add('dating');   out.add('stevenblack');
  }
  return [...out];
}

// Finds which category a matched host belongs to. Used by the blocked
// page to tell the user *why* the site is blocked. Returns the first
// matching category name (categories checked in priority order).
function categoryForHost(loaded, host) {
  const CHECK_ORDER = ['gambling', 'adult', 'crypto', 'riba', 'dating', 'stevenblack', 'ramadan'];
  for (const ancestor of hostAncestors(host)) {
    for (const cat of CHECK_ORDER) {
      const set = loaded.categories[cat];
      if (set && set.has(ancestor)) return cat;
    }
  }
  return null;
}

// Build the ramadan domain Set from the bundled list + user customDomains,
// honoring subcategory toggles. Called from main.js when the Ramadan gate
// is on (userEnabled && currentlyActive && within-fasting-hours).
function loadRamadanDomains(ramadanSettings) {
  const r = ramadanSettings || {};
  const cats = r.categories || {};
  const customs = Array.isArray(r.customDomains) ? r.customDomains : [];
  const out = new Set();

  const bundle = readJSON(RAMADAN_LIST_PATH);
  if (bundle && bundle.subcategories) {
    for (const sub of RAMADAN_SUBCATEGORIES) {
      if (!cats[sub]) continue;
      const arr = bundle.subcategories[sub];
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) {
        const host = canonHost(String(raw).split('/')[0]);
        if (host) out.add(host);
      }
    }
  }
  for (const d of customs) {
    const host = canonHost(String(d));
    if (host) out.add(host);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

// Returns { blocked, category } for a given request URL. Never blocks
// internal schemes (noorani:, data:, blob:, about:, chrome:*, file:,
// localhost/loopback) — those are structural and blocking them would
// brick the chrome.
function isRequestBlocked(url, combinedSet, loaded, allowlistSet) {
  if (!url) return { blocked: false, category: null };

  let parsed;
  try { parsed = new URL(url); }
  catch (_) { return { blocked: false, category: null }; }

  const scheme = (parsed.protocol || '').toLowerCase();
  if (scheme === 'noorani:' || scheme === 'data:' || scheme === 'blob:' ||
      scheme === 'about:'   || scheme === 'file:' ||
      scheme.startsWith('chrome') || scheme === 'devtools:') {
    return { blocked: false, category: null };
  }

  const host = canonHost(parsed.hostname);
  if (!host) return { blocked: false, category: null };
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
      host.startsWith('127.') || host.endsWith('.local')) {
    return { blocked: false, category: null };
  }

  // Allowlist wins.
  if (allowlistSet) {
    for (const a of hostAncestors(host)) {
      if (allowlistSet.has(a)) return { blocked: false, category: null };
    }
  }

  for (const a of hostAncestors(host)) {
    if (combinedSet.has(a)) {
      return { blocked: true, category: categoryForHost(loaded, host) || 'blocked' };
    }
  }
  return { blocked: false, category: null };
}

// ---------------------------------------------------------------------------
// StevenBlack download
// ---------------------------------------------------------------------------

function parseHostsFile(body) {
  const out = [];
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const m = s.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s#]+)/);
    if (!m) continue;
    const h = canonHost(m[1]);
    if (!h || h === '0.0.0.0' || h === 'localhost') continue;
    out.push(h);
  }
  return out;
}

function downloadStevenBlackList(dataDir) {
  return new Promise((resolve) => {
    const req = net.request({ method: 'GET', url: STEVENBLACK_URL });
    req.setHeader('User-Agent', 'NooraniBrowser/1.2 (https://nooraniBrowser.com)');
    let body = '';
    let settled = false;
    const done = (payload) => { if (!settled) { settled = true; resolve(payload); } };

    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return done({ error: 'http-' + res.statusCode });
      }
      res.on('data', (chunk) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const domains = parseHostsFile(body);
          if (!domains.length) return done({ error: 'empty-list' });
          const dir = path.join(dataDir, 'blocklists');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const payload = {
            version:    1,
            source:     STEVENBLACK_URL,
            updatedAt:  new Date().toISOString(),
            count:      domains.length,
            domains
          };
          fs.writeFileSync(
            path.join(dir, STEVENBLACK_FILENAME),
            JSON.stringify(payload),
            'utf-8'
          );
          done({ count: domains.length, updatedAt: payload.updatedAt });
        } catch (err) {
          done({ error: err.message });
        }
      });
    });
    req.on('error', (err) => done({ error: err.message || 'network' }));
    req.end();
    setTimeout(() => done({ error: 'timeout' }), 60000);
  });
}

// Re-downloads the StevenBlack list only if it's missing or older than
// the TTL. Always resolves — never rejects — so callers can fire-and-forget.
async function refreshBlocklistsIfStale(dataDir) {
  const sbPath = path.join(dataDir, 'blocklists', STEVENBLACK_FILENAME);
  let stale = true;
  try {
    const stat = fs.statSync(sbPath);
    stale = (Date.now() - stat.mtimeMs) > STEVENBLACK_MAX_AGE_MS;
  } catch (_) {
    stale = true;   // not present
  }
  if (!stale) return { skipped: true };
  return downloadStevenBlackList(dataDir);
}

module.exports = {
  KNOWN_CATEGORIES,
  RAMADAN_SUBCATEGORIES,
  canonHost,
  hostAncestors,
  loadBlocklists,
  buildCombinedSet,
  activeCategoriesFromSettings,
  categoryForHost,
  isRequestBlocked,
  loadRamadanDomains,
  downloadStevenBlackList,
  refreshBlocklistsIfStale
};
