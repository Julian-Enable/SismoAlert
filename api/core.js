import { config } from '../src/config.js';
import { fetchUsgs, fetchEmsc, fetchSgc } from '../src/feeds.js';

export function getConfig() {
  return config;
}

export async function fetchAllFeeds(includeSgc = false) {
  const fetches = [fetchUsgs(), fetchEmsc()];
  if (includeSgc && config.SGC_API_URL) fetches.push(fetchSgc(config.SGC_API_URL));
  const results = await Promise.allSettled(fetches);
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }
  return all;
}

export function inRegion(e, cfg) {
  return e.lat >= cfg.MIN_LAT && e.lat <= cfg.MAX_LAT && e.lon >= cfg.MIN_LON && e.lon <= cfg.MAX_LON;
}

export function qualifies(e, cfg) {
  if (e.mag === null || e.mag === undefined) return false;
  return inRegion(e, cfg) && e.mag >= cfg.MIN_MAG;
}

export async function runTick(state, cfg, { includeSgc = false, freshMs = 90 * 60 * 1000 } = {}) {
  const all = await fetchAllFeeds(includeSgc);
  const seen = { ...state.seen };
  const events = [...state.events];
  const alerts = [];
  const now = Date.now();
  const seenIds = new Set();

  for (const e of all) {
    if (!qualifies(e, cfg)) continue;
    const fresh = now - e.time <= freshMs;
    const prev = seen[e.id];
    const isNew = !prev;
    const upgraded = !isNew && e.mag - (prev.mag ?? 0) >= 0.5;

    if (!isNew && !upgraded) continue;
    seen[e.id] = { mag: e.mag, time: e.time };

    const event = { ...e, upgraded, status: upgraded ? 'actualizado' : 'nuevo', prevMag: prev?.mag, alertTime: now };
    if (!seenIds.has(e.id)) {
      seenIds.add(e.id);
      events.unshift(event);
      if (events.length > 200) events.length = 200;
    }
    if (fresh) alerts.push({ ...event, alertTime: now });
  }

  return { next: { seen, events, subs: state.subs }, alerts };
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