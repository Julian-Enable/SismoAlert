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
    return JSON.parse(await r.text());
  };
  const trySet = async () => {
    const d = await pipeline([['SET', 'lock_tick', mine, 'NX', 'EX', String(ttlSec)]]);
    return d && d[0] === 'OK';
  };
  if (await trySet()) return true;
  const g = await fetch(`${REST_URL}/get/lock_tick`, { headers: authH });
  const gd = await g.json();
  const heldSince = typeof gd?.result === 'string' ? Number(gd.result) : NaN;
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
    return { seen: {}, events: [], subs: [] };
  }
}

function writeDev(state) {
  mkdirSync(dirname(DEV_FILE), { recursive: true });
  writeFileSync(DEV_FILE, JSON.stringify(state));
}

export async function getState() {
  if (IS_REDIS) {
    const [seen, events, subs, pending, stats] = await Promise.all([
      kvGet('seen'),
      kvGet('events'),
      kvGet('subs'),
      kvGet('pending'),
      kvGet('stats')
    ]);
    return {
      seen: safeParse(seen, {}),
      events: safeParse(events, []),
      subs: safeParse(subs, []),
      pending: safeParse(pending, []),
      stats: safeParse(stats, null)
    };
  }
  return readDev();
}

export async function saveState(state) {
  const next = {
    seen: state.seen || {},
    events: state.events || [],
    subs: state.subs || [],
    pending: state.pending || [],
    stats: state.stats || null
  };
  if (IS_REDIS) {
    await Promise.all([
      kvSet('seen', JSON.stringify(next.seen)),
      kvSet('events', JSON.stringify(next.events)),
      kvSet('subs', JSON.stringify(next.subs)),
      kvSet('pending', JSON.stringify(next.pending)),
      kvSet('stats', JSON.stringify(next.stats))
    ]);
  } else {
    writeDev(next);
  }
}