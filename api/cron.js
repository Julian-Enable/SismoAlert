import { getConfig, runTick } from './core.js';
import { getState, saveState } from './store.js';
import { broadcast } from './push.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const cfg = getConfig();
  if (!cfg.CRON_SECRET || req.query?.secret !== cfg.CRON_SECRET) {
    return res.status(403).json({ error: 'Secreto invalido' });
  }

  try {
    const state = await getState();
    const { next, alerts } = await runTick(state, cfg);
    let stale = [];
    for (const alert of alerts) {
      stale = stale.concat(await broadcast(alert, next.subs));
    }
    if (stale.length) {
      next.subs = next.subs.filter((s) => !stale.includes(s.endpoint));
    }
    await saveState(next);
    res.status(200).json({ ok: true, alerts: alerts.length, subs: next.subs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}