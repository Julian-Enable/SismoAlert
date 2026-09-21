import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const IS_REDIS = !!(REST_URL && REST_TOKEN);
const DEV_FILE = join(process.cwd(), 'data', 'kv.json');

function auth() {
  return { Authorization: 'Bearer ' + REST_TOKEN };
}

async function kvGet(key) {
  const r = await fetch(`${REST_URL}/get/${key}`, { headers: auth() });
  if (!r.ok) throw new Error('KV GET ' + r.status);
  const data = await r.json();
  let value = data?.result ?? null;
  if (typeof value === 'string' && value.startsWith('~')) {
    value = Buffer.from(value.slice(1), 'base64').toString('utf8');
  }
  return value;
}

async function kvSet(key, value) {
  const r = await fetch(`${REST_URL}/set/${key}`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'text/plain' },
    body: value
  });
  if (!r.ok) throw new Error('KV SET ' + r.status);
}

export async function tryAcquireTickLock(ttlSec = 55) {
  if (!IS_REDIS) return true;
  const mine = Date.now().toString();
  const authH = auth();
  const pipeline = async (cmds) => {
    const r = await fetch(`${REST_URL}/pipeline`, { method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
    if (!r.ok) throw new Error('KV LOCK ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return r.json();
  };
  const readLock = async () => {
    const r = await fetch(`${REST_URL}/get/lock_tick`, { headers: authH });
    if (!r.ok) throw new Error('KV GET ' + r.status);
    const data = await r.json();
    let value = data?.result ?? null;
    if (typeof value === 'string' && value.startsWith('~')) {
      value = Buffer.from(value.slice(1), 'base64').toString('utf8');
    }
    return value;
  };
  const trySet = async () => {
    await pipeline([['SET', 'lock_tick', mine, 'NX', 'EX', String(ttlSec)]]);
    const now = await readLock();
    return typeof now === 'string' && now === mine;
  };
  if (await trySet()) return true;
  const heldSince = Number(await readLock());
  if (Number.isFinite(heldSince) && heldSince > 0 && Date.now() - heldSince > 45000) {
    await pipeline([['DEL', 'lock_tick']]);
    return trySet();
  }
  return false;
}

export async function forceReleaseTickLock() {
  if (!IS_REDIS) return;
  await fetch(`${REST_URL}/del/lock_tick`, { headers: auth() });
}

function safeParse(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return fallback;
  try {
    const o = JSON.parse(v);
    if (Array.isArray(fallback)) return Array.isArray(o) ? o : fallback;
    if (typeof o === 'object' && o !== null) return o;
    return fallback;
  } catch {
    return fallback;
  }
}

function readDev() {
  try {
    return JSON.parse(readFileSync(DEV_FILE, 'utf8'));
  } catch {
    return { seen: {}, events: [], subs: [], pending: [], alerted: [] };
  }
}

function writeDev(state) {
  mkdirSync(dirname(DEV_FILE), { recursive: true });
  writeFileSync(DEV_FILE, JSON.stringify(state));
}

// Todo el estado vive en una sola clave: antes eran 6 GET + 6 SET por minuto
// (~518k comandos/mes, por encima del tier gratis de Upstash) y una escritura
// parcial podia dejar el estado descuadrado. Ahora son 2 comandos y es atomico.
const STATE_KEY = 'state';
const LEGACY_KEYS = ['seen', 'events', 'subs', 'pending', 'alerted', 'stats'];

function normalize(state) {
  const s = state || {};
  return {
    seen: s.seen && typeof s.seen === 'object' ? s.seen : {},
    events: Array.isArray(s.events) ? s.events : [],
    subs: Array.isArray(s.subs) ? s.subs : [],
    pending: Array.isArray(s.pending) ? s.pending : [],
    alerted: Array.isArray(s.alerted) ? s.alerted : [],
    stats: s.stats || null
  };
}

export async function getState() {
  if (!IS_REDIS) return normalize(readDev());
  const parsed = safeParse(await kvGet(STATE_KEY), null);
  if (parsed) return normalize(parsed);
  // Primer arranque tras el cambio: rescatar el estado de las claves antiguas
  // para no perder las suscripciones ya registradas.
  const [seen, events, subs, pending, alerted, stats] = await Promise.all(LEGACY_KEYS.map(kvGet));
  return normalize({
    seen: safeParse(seen, {}),
    events: safeParse(events, []),
    subs: safeParse(subs, []),
    pending: safeParse(pending, []),
    alerted: safeParse(alerted, []),
    stats: safeParse(stats, null)
  });
}

export async function saveState(state) {
  const next = normalize(state);
  if (IS_REDIS) await kvSet(STATE_KEY, JSON.stringify(next));
  else writeDev(next);
}
