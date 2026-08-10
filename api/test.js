import { getConfig, markTestEvent } from './core.js';
import { getState, saveState } from './store.js';
import { broadcast } from './push.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });

  const cfg = getConfig();
  if (!cfg.CRON_SECRET || req.query?.secret !== cfg.CRON_SECRET) {
    return res.status(403).json({ error: 'Secreto invalido' });
  }

  if (req.query?.action === 'cleanup') {
    const state = await getState();
    const events = state.events || [];
    const isTest = (e) => e.source === 'TEST' || String(e.id || '').startsWith('test:');
    const keepEvents = events.filter((e) => !isTest(e));
    const next = {
      seen: state.seen ? { ...state.seen } : {},
      events: keepEvents,
      subs: state.subs,
      pending: (state.pending || []).filter((p) => !String(p.id || '').startsWith('test:'))
    };
    for (const e of events) if (isTest(e)) delete next.seen[e.id];
    await saveState(next);
    return res.status(200).json({ ok: true, removed: events.length - keepEvents.length });
  }

  if (req.query?.action === 'clear_events') {
    const state = await getState();
    await saveState({ ...state, events: [] });
    return res.status(200).json({ ok: true, cleared: true });
  }

  const mag = req.query?.mag ? Number(req.query.mag) : 5.0;
  const place = req.query?.place || 'Bogota (SIMULACRO)';

  const state = await getState();
  const { next, event } = markTestEvent(state, { mag, place });
  const resend = event.mag >= cfg.RESEND_MIN_MAG;
  if (resend) {
    next.pending = [...(next.pending || []), { id: event.id, sends: cfg.RESEND_TIMES - 1, n: 1, nextAt: Date.now() + cfg.RESEND_INTERVAL_MS }];
  }
  const stale = await broadcast(event, next.subs);
  if (stale.length) {
    next.subs = next.subs.filter((s) => !stale.includes(s.endpoint));
  }
  await saveState(next);
  res.status(200).json({ ok: true, sent: next.subs.length, resend, event });
}