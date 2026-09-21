import { config } from '../src/config.js';
import { fetchUsgs, fetchEmsc, fetchSgc } from '../src/feeds.js';
import colombia from '../src/colombia.js';

const COLOMBIA_RINGS = colombia.features[0].geometry.coordinates;
const CARIBBEAN = { minLat: 11.0, maxLat: 14.0, minLon: -82.4, maxLon: -71.5 };
const PACIFIC = { minLat: 1.3, maxLat: 8.0, minLon: -82.5, maxLon: -75.5 };

// El SGC es la red local: llega primero y su solucion manda sobre las globales.
const SOURCE_RANK = { SGC: 3, USGS: 2, EMSC: 1, TEST: 0 };

// Dos soluciones son del mismo sismo si coinciden en tiempo y epicentro.
// Calibrado con el historial: los pares USGS/EMSC reales quedaron en <=6 s y <=51 km,
// y el sismo distinto mas cercano en tiempo (60 s) estaba a 481 km. La ventana de 75 s
// cubre los 60 s que puede perder el SGC al truncar la hora al minuto mas el desfase
// entre redes; conviene no alargarla porque en un enjambre (Chaparral) dos replicas
// distintas caen casi en el mismo epicentro y solo el tiempo las separa.
const SAME_QUAKE_MS = 75 * 1000;
const SAME_QUAKE_KM = 150;
const ALERTED_TTL_MS = 12 * 3600 * 1000;

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

function distKm(aLat, aLon, bLat, bLon) {
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Une dos filas del mismo sismo: manda la solucion de la red de mayor rango, se
// juntan las redes que lo reportaron y se conserva el primer aviso, que es la
// marca honesta de cuando lo detectamos.
function mergeRow(twin, row) {
  const sources = Array.from(
    new Set([...(twin.sources || [twin.source]), ...(row.sources || [row.source])])
  ).filter(Boolean);
  const alertTime = Math.min(twin.alertTime ?? Infinity, row.alertTime ?? Infinity);
  const better = (SOURCE_RANK[row.source] ?? 0) >= (SOURCE_RANK[twin.source] ?? 0);
  const base = better ? { ...twin, ...row } : { ...twin };
  return {
    ...base,
    sources,
    alertTime: Number.isFinite(alertTime) ? alertTime : Date.now(),
    status: twin.status || base.status
  };
}

export function isSameQuake(a, b) {
  if (!a || !b) return false;
  if (Math.abs(a.time - b.time) > SAME_QUAKE_MS) return false;
  return distKm(a.lat, a.lon, b.lat, b.lon) <= SAME_QUAKE_KM;
}

export function getConfig() {
  return config;
}

export async function fetchAllFeeds(includeSgc = config.USE_SGC) {
  const fetches = [fetchUsgs(), fetchEmsc()];
  if (includeSgc) fetches.push(fetchSgc(config.SGC_FEED_URL));
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

export async function runTick(state, cfg, { includeSgc = cfg.USE_SGC, freshMs = 90 * 60 * 1000 } = {}) {
  const { events: all, errors } = await fetchAllFeeds(includeSgc);
  const seen = { ...state.seen };
  const alerts = [];
  const now = Date.now();
  const repeats = [];
  const limitSeen = now - 7 * 24 * 3600 * 1000;
  const bySource = {};
  const trace = { all: all.length, region: 0, display: 0, inserted: 0, merged: 0, compacted: 0, deduped: 0, bySource, feedErr: errors };
  for (const e of all) bySource[e.source] = (bySource[e.source] || 0) + 1;

  // Compacta el historial guardado: la version anterior creaba una fila por red,
  // asi que puede traer varias filas del mismo sismo. Tambien vale de red de
  // seguridad si alguna vez se cuela un duplicado.
  const events = [];
  for (const row of state.events || []) {
    const twinIdx = events.findIndex((x) => isSameQuake(x, row));
    if (twinIdx === -1) {
      events.push({ ...row, sources: row.sources || [row.source] });
      continue;
    }
    events[twinIdx] = mergeRow(events[twinIdx], row);
    trace.compacted++;
  }

  // Sismos ya avisados, para no repetir cuando otra red publica el mismo evento mas tarde.
  const alerted = (state.alerted || []).filter((a) => now - (a.at || 0) < ALERTED_TTL_MS);

  // El SGC primero: si el mismo sismo llega por varias redes, la fila la manda la red local.
  const candidates = all
    .slice()
    .sort((a, b) => (SOURCE_RANK[b.source] ?? 0) - (SOURCE_RANK[a.source] ?? 0) || b.time - a.time);

  for (const e of candidates) {
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

    // Una sola fila por sismo fisico: se queda la de la fuente de mayor rango.
    const twinIdx = events.findIndex((x) => isSameQuake(x, e));
    if (twinIdx === -1) {
      events.unshift({ ...event, sources: [e.source] });
      trace.inserted++;
    } else {
      events[twinIdx] = mergeRow(events[twinIdx], { ...event, sources: [e.source] });
      trace.merged++;
    }

    if (e.mag >= cfg.MIN_MAG && now - e.time <= freshMs) {
      const already = alerted.find((a) => isSameQuake(a, e));
      if (already && e.mag < (already.mag ?? 0) + 0.5) {
        trace.deduped++;
        continue;
      }
      let alert;
      if (already) {
        // Otra red lo subio medio grado o mas: vale avisar la correccion.
        alert = { ...event, upgraded: true, status: 'actualizado', prevMag: already.mag, alertTime: now };
        already.mag = e.mag;
        already.at = now;
      } else {
        alerted.push({ time: e.time, lat: e.lat, lon: e.lon, mag: e.mag, source: e.source, at: now });
        alert = { ...event, alertTime: now };
      }
      alerts.push(alert);
      if (e.mag >= cfg.RESEND_MIN_MAG) {
        repeats.push({ id: e.id, event: alert, sends: cfg.RESEND_TIMES - 1, n: 1, nextAt: now + cfg.RESEND_INTERVAL_MS });
      }
    }
  }

  for (const id of Object.keys(seen)) {
    if (seen[id].time && seen[id].time < limitSeen) delete seen[id];
  }

  // Primero ordenar y despues recortar: al reves se descartaban los sismos mas
  // recientes cuando un tick trae mas de 200 eventos (el SGC solo aporta ~340).
  events.sort((a, b) => b.time - a.time);
  if (events.length > 200) events.length = 200;

  const pending = new Map((state.pending || []).map((p) => [p.id, p]));
  for (const r of repeats) pending.set(r.id, r);

  return {
    next: { seen, events, subs: state.subs, pending: Array.from(pending.values()), alerted },
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
        const ev = p.event || (state.events || []).find((e) => e.id === p.id);
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
    subs: state.subs,
    alerted: state.alerted || []
  };
  return { next, event };
}
