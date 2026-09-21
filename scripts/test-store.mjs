// Prueba la migracion del estado: con solo las claves viejas en Redis, getState debe
// recuperarlas (sobre todo las suscripciones) y saveState debe escribir la clave unica.
process.env.KV_REST_API_URL = 'https://fake.upstash.io';
process.env.KV_REST_API_TOKEN = 'token-falso';

const db = {
  seen: JSON.stringify({ 'usgs:a': { mag: 4.2, time: 1 } }),
  events: JSON.stringify([{ id: 'usgs:a', mag: 4.2, time: 1 }]),
  subs: JSON.stringify([{ endpoint: 'https://push/1', keys: { p256dh: 'x', auth: 'y' } }]),
  pending: JSON.stringify([]),
  stats: JSON.stringify({ lastTick: 1 })
};
const escrituras = [];

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const mGet = u.match(/\/get\/(.+)$/);
  const mSet = u.match(/\/set\/(.+)$/);
  if (mSet) {
    escrituras.push(mSet[1]);
    db[mSet[1]] = opts.body;
    return { ok: true, status: 200, json: async () => ({ result: 'OK' }) };
  }
  if (mGet) return { ok: true, status: 200, json: async () => ({ result: db[mGet[1]] ?? null }) };
  throw new Error('URL inesperada: ' + u);
};

const { getState, saveState } = await import('../api/store.js');

let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${label}${extra ? ' -> ' + extra : ''}`);
  if (!cond) fails++;
};

const s1 = await getState();
check('migracion: conserva las suscripciones', s1.subs.length === 1, `subs=${s1.subs.length}`);
check('migracion: conserva el historial', s1.events.length === 1);
check('migracion: conserva seen', Object.keys(s1.seen).length === 1);
check('migracion: alerted arranca vacio', Array.isArray(s1.alerted) && s1.alerted.length === 0);

await saveState({ ...s1, alerted: [{ time: 1, lat: 4, lon: -74, mag: 5, at: Date.now() }] });
check('guarda en una sola clave', escrituras.length === 1 && escrituras[0] === 'state', JSON.stringify(escrituras));

const s2 = await getState();
check('relectura: usa la clave nueva', s2.alerted.length === 1);
check('relectura: mantiene las suscripciones', s2.subs.length === 1);

console.log(fails ? `\n${fails} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(fails ? 1 : 0);
