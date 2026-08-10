import { fetchUsgs, fetchEmsc, fetchSgc } from './feeds.js';

export function createPoller({ store, onEvent, config, log = console }) {
  let timer = null;
  let running = false;
  let lastStatus = { ok: false, error: 'iniciando' };

  const inRegion = (e) =>
    e.lat >= config.MIN_LAT && e.lat <= config.MAX_LAT &&
    e.lon >= config.MIN_LON && e.lon <= config.MAX_LON;

  async function tick() {
    if (running) return;
    running = true;
    const feeds = [];
    feeds.push(fetchUsgs());
    feeds.push(fetchEmsc());
    if (config.SGC_API_URL) feeds.push(fetchSgc(config.SGC_API_URL));
    const results = await Promise.allSettled(feeds);
    const all = [];
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value);
      else log.warn(`[poller] ${r.reason?.message}`);
    }
    lastStatus = { ok: results.some((r) => r.status === 'fulfilled'), error: 'ok' };
    for (const e of all) {
      if (!inRegion(e)) continue;
      if (e.mag === null || e.mag === undefined) continue;
      if (e.mag < config.MIN_MAG) continue;
      const fresh = Date.now() - e.time < 90 * 60 * 1000;
      const { isNew, upgraded, prevMag } = store.markSeen(e.id, e.mag, e.time);
      if (isNew || upgraded) {
        store.addEvent({ ...e, status: upgraded ? 'actualizado' : 'nuevo', prevMag, alertTime: Date.now() });
        store.persist();
        if (fresh) onEvent({ ...e, upgraded, prevMag });
      }
    }
    running = false;
  }

  return {
    start() {
      tick();
      timer = setInterval(tick, config.POLL_INTERVAL_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    status() {
      return lastStatus;
    }
  };
}