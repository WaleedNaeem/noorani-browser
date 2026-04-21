// Quran data loader. Reads bundled JSON files from lib/quran-data/ lazily on
// first access and holds them in memory for the life of the process. The
// Arabic + Sahih + Pickthall files total ~3.2 MB uncompressed, which is
// cheap to keep in RAM and avoids re-reading 6236 verses on every IPC call.
//
// Sacredness: the bundled Quran text is verbatim from Tanzil.net / quranenc.com
// as packaged by risan/quran-json (MIT). It MUST NOT be modified anywhere in
// this code path — only read and returned as-is.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'quran-data');

const FILES = {
  surahs:         'surahs.json',
  uthmani:        'quran-uthmani.json',
  sahih:          'quran-en-sahih.json',
  pickthall:      'quran-en-pickthall.json',
  dailyVerses:    'daily-verses.json'
};

const EXPECTED_VERSES = 6236;

// Lazy cache — filled on first access, then immutable for the process.
const cache = {};

function readOnce(key) {
  if (cache[key] !== undefined) return cache[key];
  const p = path.join(DATA_DIR, FILES[key]);
  try {
    cache[key] = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (err) {
    console.error(`[noorani][quran-data] failed to load ${FILES[key]}:`, err);
    cache[key] = null;
  }
  return cache[key];
}

function countVerses(byId) {
  if (!byId || typeof byId !== 'object') return 0;
  let total = 0;
  for (const k of Object.keys(byId)) {
    const v = byId[k];
    if (v && Array.isArray(v.verses)) total += v.verses.length;
  }
  return total;
}

// Called once at boot to assert file integrity. Logs a single line; never
// throws — a broken bundle must not crash the app, but we want visibility.
function assertIntegrity() {
  const arabic = readOnce('uthmani');
  const sahih  = readOnce('sahih');
  const pick   = readOnce('pickthall');
  const surahs = readOnce('surahs');
  const a = countVerses(arabic);
  const s = countVerses(sahih);
  const p = countVerses(pick);
  const ok = a === EXPECTED_VERSES && s === EXPECTED_VERSES && p === EXPECTED_VERSES;
  const surahCount = Array.isArray(surahs) ? surahs.length : 0;
  console.log(
    `[noorani][quran-data] integrity: ${ok ? 'OK' : 'FAIL'} — ` +
    `arabic=${a} sahih=${s} pickthall=${p} surahs=${surahCount} ` +
    `(expected verses=${EXPECTED_VERSES}, surahs=114)`
  );
  return ok;
}

function getSurahList() {
  return readOnce('surahs') || [];
}

function getSurah(num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n < 1 || n > 114) return null;
  const meta = getSurahList().find((s) => s.number === n);
  if (!meta) return null;
  const arabic = (readOnce('uthmani') || {})[n];
  if (!arabic) return null;
  return {
    ...meta,
    verses: arabic.verses.map((v) => ({ n: v.n, arabic: v.text }))
  };
}

function getTranslation(lang, num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n < 1 || n > 114) return null;
  const key = lang === 'pickthall' ? 'pickthall' : 'sahih';
  const t = (readOnce(key) || {})[n];
  return t ? t.verses.map((v) => ({ n: v.n, text: v.text })) : null;
}

function getVerse(surah, verse) {
  const s = getSurah(surah);
  if (!s) return null;
  const v = s.verses.find((x) => x.n === Number(verse));
  if (!v) return null;
  const sahih = getTranslation('sahih', surah);
  const pick  = getTranslation('pickthall', surah);
  return {
    surah:       s.number,
    surahName:   s.transliteration,
    arabic:      v.arabic,
    sahih:       (sahih || []).find((x) => x.n === v.n)?.text || null,
    pickthall:   (pick  || []).find((x) => x.n === v.n)?.text || null,
    n:           v.n
  };
}

function getDailyVerseRefs() {
  return readOnce('dailyVerses') || [];
}

module.exports = {
  assertIntegrity,
  getSurahList,
  getSurah,
  getTranslation,
  getVerse,
  getDailyVerseRefs,
  EXPECTED_VERSES
};
