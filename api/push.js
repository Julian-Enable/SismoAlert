import webpush from 'web-push';
import { getConfig } from './core.js';

let initialized = false;

function init() {
  if (initialized) return;
  const cfg = getConfig();
  if (cfg.VAPID_PUBLIC_KEY && cfg.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(cfg.VAPID_SUBJECT, cfg.VAPID_PUBLIC_KEY, cfg.VAPID_PRIVATE_KEY);
  }
  initialized = true;
}

function buildNotification(e) {
  const place = e.place || 'Colombia';
  const title = e.upgraded
    ? `SISMO ACTUALIZADO M${e.mag} - ${place}`
    : `SISMO M${e.mag} - ${place}`;
  const body = `MAGNITUD ${e.mag} en ${place}. Fuente: ${e.source} | Prof. ${e.depth ?? 'n/d'} km | ${new Date(e.time).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}. Agarrate ya.`;
  return { title, body, tag: e.id, url: e.url || '/' };
}

export async function broadcast(event, subs) {
  const cfg = getConfig();
  if (!cfg.VAPID_PUBLIC_KEY || !cfg.VAPID_PRIVATE_KEY) return [];
  init();
  if (!subs.length) return [];
  const payload = JSON.stringify(buildNotification(event));
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(sub, payload, { urgency: 'high', TTL: 60 })
    )
  );
  const stale = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const code = r.reason?.statusCode;
      if (code === 404 || code === 410) stale.push(subs[i].endpoint);
    }
  });
  return stale;
}