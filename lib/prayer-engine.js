// Noorani Browser — prayer engine
//
// Pure-function wrapper around adhan-js. All time-of-day math lives here so
// main.js stays clean and this module can be unit-tested in isolation.

const adhan = require('adhan');

const KAABA = Object.freeze({ lat: 21.4225, lng: 39.8262 });

const PRAYER_ORDER = Object.freeze(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);

// Friendly labels for the UI. Keep out of settings so the renderer controls presentation.
const PRAYER_LABELS = Object.freeze({
  fajr:    'Fajr',
  sunrise: 'Sunrise',
  dhuhr:   'Dhuhr',
  asr:     'Asr',
  maghrib: 'Maghrib',
  isha:    'Isha'
});

// Named map of settings.calculationMethod → factory that returns an
// adhan CalculationParameters instance. Jafari isn't a first-class adhan
// method, so we build it from Other() per the standard Qum-institute values
// (Fajr 16°, Isha 14°, no Maghrib angle).
const METHOD_FACTORIES = Object.freeze({
  Karachi:               () => adhan.CalculationMethod.Karachi(),
  MWL:                   () => adhan.CalculationMethod.MuslimWorldLeague(),
  Egyptian:              () => adhan.CalculationMethod.Egyptian(),
  UmmAlQura:             () => adhan.CalculationMethod.UmmAlQura(),
  ISNA:                  () => adhan.CalculationMethod.NorthAmerica(),
  Tehran:                () => adhan.CalculationMethod.Tehran(),
  MoonsightingCommittee: () => adhan.CalculationMethod.MoonsightingCommittee(),
  Jafari: () => {
    const p = adhan.CalculationMethod.Other();
    p.fajrAngle = 16;
    p.ishaAngle = 14;
    return p;
  }
});

function buildParams(methodKey, asrMethod, offsets) {
  const factory = METHOD_FACTORIES[methodKey] || METHOD_FACTORIES.Karachi;
  const params = factory();
  params.madhab = asrMethod === 'Hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
  const o = offsets || {};
  params.adjustments = {
    fajr:    Number(o.fajr)    || 0,
    sunrise: 0,
    dhuhr:   Number(o.dhuhr)   || 0,
    asr:     Number(o.asr)     || 0,
    maghrib: Number(o.maghrib) || 0,
    isha:    Number(o.isha)    || 0
  };
  return params;
}

function calculatePrayerTimes(lat, lng, date, methodKey, asrMethod, offsets) {
  const coords = new adhan.Coordinates(lat, lng);
  const d = date ? new Date(date) : new Date();
  const params = buildParams(methodKey, asrMethod, offsets);
  const t = new adhan.PrayerTimes(coords, d, params);
  return {
    fajr:    t.fajr,
    sunrise: t.sunrise,
    dhuhr:   t.dhuhr,
    asr:     t.asr,
    maghrib: t.maghrib,
    isha:    t.isha
  };
}

// Returns the next upcoming prayer strictly after `now`. If every prayer
// for today has passed, returns tomorrow's Fajr so the caller never gets null.
function getNextPrayer(lat, lng, methodKey, asrMethod, offsets, now) {
  const current = now ? new Date(now) : new Date();
  const todayTimes = calculatePrayerTimes(
    lat, lng, current, methodKey, asrMethod, offsets
  );
  for (const name of PRAYER_ORDER) {
    if (todayTimes[name] > current) {
      return {
        prayerName:   name,
        label:        PRAYER_LABELS[name],
        time:         todayTimes[name],
        minutesUntil: Math.max(0, Math.round((todayTimes[name] - current) / 60000))
      };
    }
  }
  // Past isha — roll to tomorrow's Fajr
  const tomorrow = new Date(current);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowTimes = calculatePrayerTimes(
    lat, lng, tomorrow, methodKey, asrMethod, offsets
  );
  return {
    prayerName:   'fajr',
    label:        PRAYER_LABELS.fajr,
    time:         tomorrowTimes.fajr,
    minutesUntil: Math.max(0, Math.round((tomorrowTimes.fajr - current) / 60000))
  };
}

// Great-circle bearing from (lat, lng) to the Kaaba. Returns bearing in
// degrees (0–360, clockwise from true north) plus a compass abbreviation.
function calculateQibla(lat, lng) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const phi1 = toRad(lat);
  const phi2 = toRad(KAABA.lat);
  const dlam = toRad(KAABA.lng - lng);
  const y = Math.sin(dlam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlam);
  let bearing = toDeg(Math.atan2(y, x));
  bearing = (bearing + 360) % 360;
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  const compass = dirs[Math.round(bearing / 45) % 8];
  return {
    bearing: Math.round(bearing * 10) / 10,
    compass
  };
}

// Intl-based Hijri conversion — available in every modern Chromium/Node
// without extra deps. `adjustment` is a +/- day shift applied before the
// conversion (some communities see dates 1-2 days off the calculated value).
function getHijriDate(gregDate, adjustment) {
  const d = gregDate ? new Date(gregDate) : new Date();
  if (Number.isFinite(adjustment)) {
    d.setDate(d.getDate() + Math.round(adjustment));
  }
  const parts = new Intl.DateTimeFormat('en-TN-u-ca-islamic', {
    day: 'numeric', month: 'long', year: 'numeric'
  }).formatToParts(d);
  let day = '', month = '', year = '';
  for (const p of parts) {
    if (p.type === 'day')   day   = p.value;
    if (p.type === 'month') month = p.value;
    if (p.type === 'year')  year  = p.value.replace(/\D/g, '');
  }
  return {
    day:       parseInt(day, 10) || 0,
    month,
    monthName: month,
    year:      parseInt(year, 10) || 0,
    formatted: `${parseInt(day, 10) || 0} ${month} ${parseInt(year, 10) || 0}`
  };
}

module.exports = {
  KAABA,
  PRAYER_ORDER,
  PRAYER_LABELS,
  METHOD_FACTORIES,
  calculatePrayerTimes,
  getNextPrayer,
  calculateQibla,
  getHijriDate
};
