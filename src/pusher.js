import webpush from 'web-push';

export function createPusher({ store, config, log = console }) {
  const ready = !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
  if (!ready) log.warn('[pusher] faltan VAPID keys, push deshabilitado');
  else webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);

  return {
    ready,
    async send(event) {
      if (!ready) return;
      const subs = store.listSubscriptions();
      if (subs.length === 0) return;
      const title = event.upgraded
        ? `SISMO ACTUALIZADO M${event.mag} - ${event.place}`
        : `SISMO M${event.mag} - ${event.place}`;
      const body = `Fuente: ${event.source} | Profundidad: ${event.depth ?? 'n/d'} km | ${new Date(event.time).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;
      const payload = JSON.stringify({ title, body, tag: event.id, url: event.url || '/' });
      const results = await Promise.allSettled(
        subs.map((sub) => webpush.sendNotification(sub, payload))
      );
      const stale = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') return;
        const s = r.reason?.statusCode;
        if (s === 404 || s === 410) stale.push(subs[i].endpoint);
        else log.warn(`[pusher] ${s} ${r.reason?.body || r.reason?.message}`);
      });
      if (stale.length) {
        stale.forEach((ep) => store.removeSubscription(ep));
        store.persist();
        log.info(`[pusher] limpieza de ${stale.length} suscripciones obsoletas`);
      }
    }
  };
}