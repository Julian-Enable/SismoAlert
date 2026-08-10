import { getConfig, runTick, dueRepeats } from './core.js';
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
    let state = await getState();
    const { next, alerts } = await runTick(state, cfg);
    let stale = [];
    for (const alert of alerts) {
      stale = stale.concat(await broadcast(alert, next.subs));
    }
    const { due, pending } = dueRepeats(next, cfg);
    next.pending = pending;
    for (const r of due) {
      stale = stale.concat(await broadcast({ ...r.event }, next.subs, { repeat: r.repeat }));
    }
    if (stale.length) {
      next.subs = next.subs.filter((s) => !stale.includes(s.endpoint));
    }
next.stats = {
        lastTick: Date.now(),
        lastAlerts: alerts.length,
        lastRepeats: due.length,
        subs: next.subs.length,
        events: next.events.length,
        seen: Object.keys(next.seen).length
      };
    await saveState(next);
    res.status(200).json({ ok: true, alerts: alerts.length, repeats: due.length, pending: pending.length, subs: next.subs.length, events: next.events.length });
  } catch (err) {
    try {
      const st = await getState();
      await saveState({ ...st, stats: { ...(st.stats || {}), lastTick: Date.now(), lastError: String(err?.message || err) } });
    } catch {}
    res.status(500).json({ error: err.message });
  }
}