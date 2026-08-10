import { getConfig } from './core.js';
import { getState } from './store.js';

const candidates = [
  { name: 'KV_REST_API_*', url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN },
  { name: 'UPSTASH_REDIS_REST_*', url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }
];

export default async function handler(req, res) {
  const cfg = getConfig();
  if (!cfg.CRON_SECRET || req.query?.secret !== cfg.CRON_SECRET) {
    return res.status(403).json({ error: 'Secreto invalido' });
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const dbs = [];
    for (const c of candidates) {
      const db = { name: c.name, configured: !!(c.url && c.token), url: c.url || '', ping: false, keys: {} };
      if (c.url && c.token) {
        try {
          const auth = 'Bearer ' + c.token;
          const ping = await fetch(c.url + '/ping', { headers: { Authorization: auth } });
          db.ping = ping.ok;
          for (const k of ['seen', 'events', 'subs']) {
            const r = await fetch(c.url + '/get/' + k, { headers: { Authorization: auth } });
            if (r.ok) {
              const data = await r.json();
              const raw = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
              db.keys[k] = { len: raw.length, preview: raw.slice(0, 80) };
            } else {
              db.keys[k] = { error: 'HTTP ' + r.status };
            }
          }
        } catch (err) {
          db.error = String(err?.message || err);
        }
      }
      dbs.push(db);
    }

    let state = null;
    try {
      state = await getState();
    } catch (err) {
      state = { error: String(err?.message || err) };
    }

    res.status(200).json({
      dbs,
      getState: {
        seenKeys: state.seen ? Object.keys(state.seen).length : 0,
        eventsCount: Array.isArray(state.events) ? state.events.length : 'n/a',
        subsCount: Array.isArray(state.subs) ? state.subs.length : 'n/a',
        seenSample: state.seen ? JSON.stringify(state.seen).slice(0, 100) : null,
        eventsSample: Array.isArray(state.events) ? JSON.stringify(state.events).slice(0, 150) : null
      }
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}