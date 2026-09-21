import { runTick, getConfig, isSameQuake } from '../api/core.js';

const cfg = getConfig();
const now = Date.now();
const minute = (t) => new Date(Math.floor(t / 60000) * 60000).toISOString().slice(0, 16).replace('T', ' ');

let feeds = { usgs: [], emsc: [], sgc: [] };

globalThis.fetch = async (url) => {
  const u = String(url);
  let body;
  if (u.includes('earthquake.usgs.gov')) body = { features: feeds.usgs };
  else if (u.includes('seismicportal.eu')) body = { features: feeds.emsc };
  else if (u.includes('archive.sgc.gov.co')) body = { features: feeds.sgc };
  else throw new Error('URL inesperada: ' + u);
  return { ok: true, status: 200, json: async () => body };
};

const global = (id, time, mag, lat, lon) => ({
  id,
  properties: { time, mag, place: `${id} zona`, url: 'https://x/' + id },
  geometry: { coordinates: [lon, lat, 30] }
});
const sgc = (id, time, mag, lat, lon, status = 'automatic') => ({
  id,
  properties: { mag, place: 'Chaparral - Tolima, Colombia', utcTime: minute(time), status },
  geometry: { coordinates: [lat, lon, 30] } // el SGC invierte el orden
});

// Alineado al minuto para que la prueba no dependa del segundo en que se ejecuta.
const T = Math.floor((now - 3 * 60 * 1000) / 60000) * 60000; // sismo hace ~3 minutos
let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${label}${extra ? ' -> ' + extra : ''}`);
  if (!cond) fails++;
};

// --- Caso 1: el SGC llega primero y avisa ---
feeds = { usgs: [], emsc: [], sgc: [sgc('SGC2026aaa', T, 4.5, 3.85, -75.63)] };
let r = await runTick({ seen: {}, events: [], subs: [], pending: [], alerted: [] }, cfg);
check('1. el SGC dispara 1 aviso', r.alerts.length === 1, `alerts=${r.alerts.length} fuente=${r.alerts[0]?.source}`);
check('1. fuente = SGC', r.alerts[0]?.source === 'SGC');
check('1. 1 fila en el historial', r.next.events.length === 1);
let state = r.next;

// --- Caso 2: 30 min despues llegan USGS y EMSC con el mismo sismo: no debe repetir ---
feeds = {
  usgs: [global('us1', T + 6000, 4.7, 3.88, -75.7)],
  emsc: [global('em1', T - 4000, 4.6, 3.9, -75.5)],
  sgc: [sgc('SGC2026aaa', T, 4.5, 3.85, -75.63, 'manual')]
};
r = await runTick(state, cfg);
check('2. USGS/EMSC tardios no repiten aviso', r.alerts.length === 0, `alerts=${r.alerts.length} deduped=${r.trace.deduped}`);
check('2. sigue 1 sola fila', r.next.events.length === 1, `filas=${r.next.events.length}`);
check('2. la fila conserva al SGC como fuente', r.next.events[0].source === 'SGC', r.next.events[0].source);
check('2. la fila lista las 3 redes', (r.next.events[0].sources || []).length === 3, JSON.stringify(r.next.events[0].sources));
state = r.next;

// --- Caso 3: una red corrige la magnitud medio grado arriba: si avisa ---
feeds = { usgs: [global('us2', T + 6000, 5.3, 3.88, -75.7)], emsc: [], sgc: [] };
r = await runTick(state, cfg);
check('3. correccion de M5.3 si avisa', r.alerts.length === 1 && r.alerts[0].status === 'actualizado', `alerts=${r.alerts.length}`);
check('3. no crea fila nueva', r.next.events.length === 1, `filas=${r.next.events.length}`);
state = r.next;

// --- Caso 4: un sismo distinto y lejano si es un aviso aparte ---
feeds = { usgs: [global('us3', T + 6000, 5.0, 10.5, -73.2)], emsc: [], sgc: [] };
r = await runTick(state, cfg);
check('4. sismo distinto avisa aparte', r.alerts.length === 1 && r.next.events.length === 2, `alerts=${r.alerts.length} filas=${r.next.events.length}`);

// --- Caso 5: umbrales de isSameQuake con los datos reales medidos ---
const A = { time: T, lat: 3.85, lon: -75.63 };
check('5. par real USGS/EMSC (6 s, 51 km) = mismo', isSameQuake(A, { time: T + 6000, lat: 4.31, lon: -75.63 }));
check('5. hora truncada al minuto (59 s) = mismo', isSameQuake(A, { time: T + 59000, lat: 3.85, lon: -75.63 }));
check('5. sismo distinto (60 s, 481 km) = distinto', !isSameQuake(A, { time: T + 60000, lat: 8.18, lon: -75.63 }));
check('5. replica del enjambre a 80 s = distinto', !isSameQuake(A, { time: T + 80000, lat: 3.85, lon: -75.63 }));

// --- Caso 6: sismo viejo del feed no debe avisar ---
feeds = { usgs: [], emsc: [], sgc: [sgc('SGC2026old', now - 5 * 3600 * 1000, 5.5, 4.2, -76.1)] };
r = await runTick({ seen: {}, events: [], subs: [], pending: [], alerted: [] }, cfg);
check('6. sismo de hace 5 h no avisa', r.alerts.length === 0, `alerts=${r.alerts.length}`);

// --- Caso 7: compacta las filas duplicadas que dejo la version anterior ---
feeds = { usgs: [], emsc: [], sgc: [] };
const legado = {
  seen: { 'usgs:v1': { mag: 4.5, time: T }, 'emsc:v1': { mag: 4.5, time: T } },
  events: [
    { id: 'usgs:v1', source: 'USGS', time: T + 2000, mag: 4.5, lat: 3.88, lon: -75.7, place: 'USGS zona', alertTime: T + 9e5 },
    { id: 'emsc:v1', source: 'EMSC', time: T, mag: 4.5, lat: 3.85, lon: -75.63, place: 'Colombia', alertTime: T + 6e5 }
  ],
  subs: [],
  pending: [],
  alerted: []
};
r = await runTick(legado, cfg);
check('7. compacta filas viejas duplicadas', r.next.events.length === 1, `filas=${r.next.events.length} compacted=${r.trace.compacted}`);
check('7. junta las redes de las filas viejas', (r.next.events[0].sources || []).slice().sort().join('+') === 'EMSC+USGS', JSON.stringify(r.next.events[0].sources));
check('7. conserva el primer aviso', r.next.events[0].alertTime === T + 6e5, String(r.next.events[0].alertTime - T));
check('7. compactar no dispara avisos', r.alerts.length === 0, `alerts=${r.alerts.length}`);

console.log(fails ? `\n${fails} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(fails ? 1 : 0);
