import { getConfig } from './core.js';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export default async function handler(req, res) {
  const cfg = getConfig();
  if (!cfg.CRON_SECRET || req.query?.secret !== cfg.CRON_SECRET) {
    return res.status(403).json({ error: 'Secreto invalido' });
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const report = {
      redisUrl: url,
      redisConfigured: !!(url && token),
      redisUp: false,
      keys: {}
    };
    if (url && token) {
      const auth = 'Bearer ' + token;
      const ping = await fetch(url + '/ping', { headers: { Authorization: auth } });
      report.redisUp = ping.ok;
      for (const k of ['seen', 'events', 'subs']) {
        const r = await fetch(url + '/get/' + k, { headers: { Authorization: auth } });
        let raw = '';
        if (r.ok) {
          const data = await r.json();
          raw = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
        } else {
          raw = 'HTTP ' + r.status;
        }
        report.keys[k] = { len: raw.length, preview: raw.slice(0, 120) };
      }
    }
    res.status(200).json(report);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}