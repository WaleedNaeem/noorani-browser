// One-shot build script — transforms raw downloads into bundled data.
// Run with: node lib/quran-data/_build.js
// Produces: surahs.json, quran-uthmani.json, quran-en-sahih.json, quran-en-pickthall.json
// Data attribution:
//   - Uthmani Arabic + Sahih International: risan/quran-json (MIT) — ultimately Tanzil.net / quranenc.com
//   - Pickthall: alquran.cloud API — ultimately Tanzil.net

const fs = require('fs');
const path = require('path');

const here = __dirname;
const risan = JSON.parse(fs.readFileSync(path.join(here, '_risan-quran-en.json'), 'utf8'));
const pick  = JSON.parse(fs.readFileSync(path.join(here, '_pickthall.json'), 'utf8'));
const sahihCross = JSON.parse(fs.readFileSync(path.join(here, '_sahih-alquran-cloud.json'), 'utf8'));

if (!Array.isArray(risan) || risan.length !== 114) {
  throw new Error(`risan surah count wrong: got ${risan.length}`);
}
if (!pick || !pick.data || !Array.isArray(pick.data.surahs) || pick.data.surahs.length !== 114) {
  throw new Error(`pickthall surah count wrong`);
}
if (!sahihCross || !sahihCross.data || sahihCross.data.surahs.length !== 114) {
  throw new Error(`sahih cross-check surah count wrong`);
}

// surahs.json — canonical metadata
const surahs = risan.map((s) => ({
  number: s.id,
  arabic: s.name,
  transliteration: s.transliteration,
  meaning: s.translation || null,
  type: s.type, // "meccan" | "medinan"
  verseCount: s.total_verses,
}));

// Cross-check verseCount against Pickthall surah.ayahs.length
for (let i = 0; i < 114; i++) {
  const vCountRisan = surahs[i].verseCount;
  const vCountPick  = pick.data.surahs[i].ayahs.length;
  if (vCountRisan !== vCountPick) {
    throw new Error(`Surah ${i + 1} verse count mismatch: risan=${vCountRisan} pickthall=${vCountPick}`);
  }
}

// quran-uthmani.json — Arabic only
const uthmani = {};
let totalArabic = 0;
for (const s of risan) {
  uthmani[s.id] = {
    verses: s.verses.map((v) => ({ n: v.id, text: v.text })),
  };
  totalArabic += s.verses.length;
}

// quran-en-sahih.json — built from risan's translation field
const sahih = {};
let totalSahih = 0;
for (const s of risan) {
  sahih[s.id] = {
    verses: s.verses.map((v) => ({ n: v.id, text: v.translation })),
  };
  totalSahih += s.verses.length;
}

// quran-en-pickthall.json — from alquran.cloud
const pickthall = {};
let totalPick = 0;
for (const s of pick.data.surahs) {
  pickthall[s.number] = {
    verses: s.ayahs.map((a) => ({ n: a.numberInSurah, text: a.text })),
  };
  totalPick += s.ayahs.length;
}

// Sanity — canonical 6236 verse count
const EXPECTED = 6236;
console.log(`Arabic verses: ${totalArabic} (expected ${EXPECTED})`);
console.log(`Sahih verses:  ${totalSahih} (expected ${EXPECTED})`);
console.log(`Pickthall verses: ${totalPick} (expected ${EXPECTED})`);
if (totalArabic !== EXPECTED) throw new Error(`Arabic verse count wrong`);
if (totalSahih  !== EXPECTED) throw new Error(`Sahih verse count wrong`);
if (totalPick   !== EXPECTED) throw new Error(`Pickthall verse count wrong`);

// Al-Fatihah spot check
if (uthmani[1].verses.length !== 7) throw new Error('Al-Fatihah should have 7 verses');
if (sahih[1].verses.length  !== 7) throw new Error('Al-Fatihah Sahih should have 7 verses');
if (pickthall[1].verses.length !== 7) throw new Error('Al-Fatihah Pickthall should have 7 verses');

// At-Tawbah spot check — surah 9 exists
if (uthmani[9].verses.length !== 129) throw new Error(`Surah 9 should have 129 verses, got ${uthmani[9].verses.length}`);

// Ayat al-Kursi spot check — 2:255 exists in all three
if (!uthmani[2].verses.find((v) => v.n === 255)) throw new Error('Missing 2:255 in Arabic');
if (!sahih[2].verses.find((v) => v.n === 255)) throw new Error('Missing 2:255 in Sahih');
if (!pickthall[2].verses.find((v) => v.n === 255)) throw new Error('Missing 2:255 in Pickthall');

// Write outputs
const out = (name, data) => {
  const p = path.join(here, name);
  fs.writeFileSync(p, JSON.stringify(data));
  const size = fs.statSync(p).size;
  console.log(`  wrote ${name}: ${(size / 1024).toFixed(1)} KB`);
};
out('surahs.json', surahs);
out('quran-uthmani.json', uthmani);
out('quran-en-sahih.json', sahih);
out('quran-en-pickthall.json', pickthall);

console.log('OK — all 6236 verses verified across three sources.');
