import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const IS_REDIS = !!(
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
  (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
);
const DEV_FILE = join(process.cwd(), 'data', 'kv.json');

let redis = null;

async function getRedis() {
  if (!redis) {
    const { Redis } = await import('@upstash/redis');
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
    });
  }
  return redis;
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

export async function getState() {
  if (IS_REDIS) {
    const r = await getRedis();
    const [seen, events, subs] = await Promise.all([
      r.get('seen'),
      r.get('events'),
      r.get('subs')
    ]);
    return {
      seen: safeParse(seen, {}),
      events: safeParse(events, []),
      subs: safeParse(subs, [])
    };
  }
  return readDev();
}

export async function saveState(state) {
  const next = { seen: state.seen || {}, events: state.events || [], subs: state.subs || [] };
  if (IS_REDIS) {
    const r = await getRedis();
    await Promise.all([
      r.set('seen', JSON.stringify(next.seen)),
      r.set('events', JSON.stringify(next.events)),
      r.set('subs', JSON.stringify(next.subs))
    ]);
  } else {
    writeDev(next);
  }
}