# Quran Data Attribution

The bundled Quran text in this directory is sourced from projects licensed under
permissive/public-domain terms. The text is not modified.

## Files

- **quran-uthmani.json** — Uthmani Arabic script, 6236 verses.
  Source: [risan/quran-json](https://github.com/risan/quran-json) (MIT), which
  derives from the Uthmani text at [quranenc.com](https://quranenc.com/).

- **quran-en-sahih.json** — Sahih International English translation, 6236 verses.
  Source: risan/quran-json, which derives from
  [Tanzil.net en.sahih](https://tanzil.net/trans/en.sahih).

- **quran-en-pickthall.json** — Pickthall English translation, 6236 verses.
  Source: [alquran.cloud](https://alquran.cloud/) API, which derives from
  [Tanzil.net en.pickthall](https://tanzil.net/trans/en.pickthall). Pickthall's
  translation is in the public domain.

- **surahs.json** — 114 surah metadata (Arabic name, transliteration, English
  meaning, type, verse count).
  Source: risan/quran-json.

- **daily-verses.json** — Curated reference list of ~40 widely-quoted verses for
  the "Today's verse" home card.
  Original to this project.

## Integrity

All three Quran text files were verified to contain exactly 6236 verses at
bundle time via `tools/build-quran-data.js`. The build script cross-validates
surah-by-surah verse counts between risan (Sahih) and alquran.cloud (Pickthall)
before writing output.

## Rebuilding

If you need to rebuild the bundled data from the upstream sources, run:

    node tools/build-quran-data.js

after placing the raw downloads (`_risan-quran-en.json`, `_pickthall.json`,
`_sahih-alquran-cloud.json`) in this directory.
