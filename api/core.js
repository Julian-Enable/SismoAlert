import { config } from '../src/config.js';
import { fetchUsgs, fetchEmsc, fetchSgc } from '../src/feeds.js';
import colombia from '../src/colombia.js';

const COLOMBIA_RINGS = colombia.features[0].geometry.coordinates;
const CARIBBEAN = { minLat: 11.0, maxLat: 14.0, minLon: -82.4, maxLon: -71.5 };
const PACIFIC = { minLat: 1.3, maxLat: 8.0, minLon: -82.5, maxLon: -75.5 };

function pointInRings(lon, lat) {
  for (const ring of COLOMBIA_RINGS) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

export function getConfig() {
  return config;
}

export async function fetchAllFeeds(includeSgc = false) {
  const fetches = [fetchUsgs(), fetchEmsc()];
  if (includeSgc && config.SGC_API_URL) fetches.push(fetchSgc(config.SGC_API_URL));
  const results = await Promise.allSettled(fetches);
  const all = [];
  const errors = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
    else errors.push(String(r.reason?.message || r.reason));
  }
  return { events: all, errors };
}

export function inRegion(e, cfg) {
  if (e.mag !== null && e.mag !== undefined && e.mag >= 6.0) {
    return e.lat >= cfg.MIN_LAT && e.lat <= cfg.MAX_LAT && e.lon >= cfg.MIN_LON && e.lon <= cfg.MAX_LON;
  }
  if (pointInRings(e.lon, e.lat)) return true;
  if (e.lat >= CARIBBEAN.minLat && e.lat <= CARIBBEAN.maxLat && e.lon >= CARIBBEAN.minLon && e.lon <= CARIBBEAN.maxLon) return true;
  if (e.lat >= PACIFIC.minLat && e.lat <= PACIFIC.maxLat && e.lon >= PACIFIC.minLon && e.lon <= PACIFIC.maxLon) return true;
  return false;
}

export function qualifies(e, cfg) {
  if (e.mag === null || e.mag === undefined) return false;
  return inRegion(e, cfg) && e.mag >= cfg.MIN_MAG;
}

export async function runTick(state, cfg, { includeSgc = false, freshMs = 90 * 60 * 1000 } = {}) {
  const { events: all, errors } = await fetchAllFeeds(includeSgc);
  const seen = { ...state.seen };
  const events = [...state.events];
  const alerts = [];
  const now = Date.now();
  const seenIds = new Set();
  const repeats = [];
  const limitSeen = now - 7 * 24 * 3600 * 1000;
  const trace = { all: all.length, region: 0, display: 0, inserted: 0, feedErr: errors };

  for (const e of all) {
    if (!inRegion(e, cfg)) continue;
    trace.region++;
    if (e.mag === null || e.mag === undefined) continue;
    if (e.mag < cfg.MIN_DISPLAY_MAG) continue;
    trace.display++;

    const prev = seen[e.id];
    const isNew = !prev;
    const upgraded = !isNew && e.mag - (prev.mag ?? 0) >= 0.5;

    if (!isNew && !upgraded) continue;
    seen[e.id] = { mag: e.mag, time: e.time };

    const event = { ...e, upgraded, status: upgraded ? 'actualizado' : 'nuevo', prevMag: prev?.mag, alertTime: now };
    if (!seenIds.has(e.id)) {
      seenIds.add(e.id);
      events.unshift(event);
      trace.inserted++;
      if (events.length > 200) events.length = 200;
    }
    if (e.mag >= cfg.MIN_MAG && now - e.time <= freshMs) {
      alerts.push({ ...event, alertTime: now });
      if (e.mag >= cfg.RESEND_MIN_MAG) {
        repeats.push({ id: e.id, sends: cfg.RESEND_TIMES - 1, n: 1, nextAt: now + cfg.RESEND_INTERVAL_MS });
      }
    }
  }

  for (const id of Object.keys(seen)) {
    if (seen[id].time && seen[id].time < limitSeen) delete seen[id];
  }

  events.sort((a, b) => b.time - a.time);

  const pending = new Map((state.pending || []).map((p) => [p.id, p]));
  for (const r of repeats) pending.set(r.id, r);

  return {
    next: { seen, events, subs: state.subs, pending: Array.from(pending.values()) },
    alerts,
    trace
  };
}

export function dueRepeats(state, cfg) {
  const now = Date.now();
  const due = [];
  const pending = [];
  for (const p of state.pending || []) {
    if (p.sends > 0) {
      if (now >= p.nextAt) {
        const ev = (state.events || []).find((e) => e.id === p.id);
        if (ev) due.push({ event: ev, repeat: p.n });
        const left = p.sends - 1;
        if (left > 0) pending.push({ ...p, sends: left, n: (p.n || 1) + 1, nextAt: now + cfg.RESEND_INTERVAL_MS });
      } else {
        pending.push(p);
      }
    }
  }
  return { due, pending };
}

export function markTestEvent(state, { mag = 5.0, place = 'Bogota (SIMULACRO)' } = {}) {
  const now = Date.now();
  const event = {
    id: `test:${now}`,
    source: 'TEST',
    time: now,
    mag,
    lat: 4.7,
    lon: -74.1,
    depth: 30,
    place,
    url: '/',
    status: 'nuevo',
    alertTime: now
  };
  const next = {
    seen: { ...state.seen, [event.id]: { mag, time: now } },
    events: [event, ...state.events].slice(0, 200),
    subs: state.subs
  };
  return { next, event };
}