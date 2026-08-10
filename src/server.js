import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { config } from './config.js';
import { createStore, dbPath } from './store.js';
import { createPoller } from './poller.js';
import { createPusher } from './pusher.js';

const store = createStore(dbPath(config.ROOT));
const pusher = createPusher({ store, config });
const poller = createPoller({
  store,
  config,
  onEvent: (e) => {
    if (e.test) console.log('[test-alerta]', e.place, 'M' + e.mag);
    pusher.send(e).catch(() => {});
  }
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

function parseSub(body) {
  const s = body?.subscription || body;
  if (!s || typeof s.endpoint !== 'string' || !s.keys?.p256dh || !s.keys?.auth) return null;
  return { endpoint: s.endpoint, expirationTime: s.expirationTime ?? null, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/health') {
    return sendJson(res, 200, { ok: true, subs: store.countSubscriptions(), feed: poller.status() });
  }

  if (req.method === 'GET' && p === '/api/config') {
    return sendJson(res, 200, {
      vapidPublicKey: config.VAPID_PUBLIC_KEY,
      minMag: config.MIN_MAG,
      pushReady: pusher.ready
    });
  }

  if (req.method === 'GET' && p === '/api/events') {
    return sendJson(res, 200, { events: store.recent(30) });
  }

  if (req.method === 'POST' && p === '/api/subscribe') {
    const sub = parseSub(await readBody(req));
    if (!sub) return sendJson(res, 400, { error: 'Suscripcion invalida' });
    store.addSubscription(sub);
    store.persist();
    console.log(`[subscribe] +1 (total ${store.countSubscriptions()})`);
    return sendJson(res, 201, { ok: true });
  }

  if (req.method === 'DELETE' && p === '/api/subscribe') {
    const body = await readBody(req);
    if (body.endpoint) {
      store.removeSubscription(body.endpoint);
      store.persist();
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/test') {
    if (!config.TEST_ALERT) return sendJson(res, 403, { error: 'Test disabled' });
    const body = await readBody(req);
    const fake = {
      id: `test:${Date.now()}`,
      source: 'TEST',
      time: Date.now(),
      mag: body.mag ?? 5.0,
      lat: 4.7,
      lon: -74.1,
      depth: 30,
      place: body.place ?? 'Bogota (SIMULACRO)',
      url: '/',
      test: true
    };
    store.addEvent({ ...fake, status: 'nuevo', alertTime: Date.now() });
    store.persist();
    pusher.send(fake).catch(() => {});
    return sendJson(res, 200, { ok: true, sent: store.countSubscriptions() });
  }

  const file = p === '/' ? 'index.html' : p.replace(/^\//, '');
  const full = normalize(join(config.ROOT, 'public', file));
  if (!full.startsWith(config.ROOT)) return sendJson(res, 403, { error: 'Forbidden' });
  if (existsSync(full) && statSync(full).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
    return res.end(readFileSync(full));
  }
  sendJson(res, 404, { error: 'No encontrado' });
});

poller.start();
server.listen(config.PORT, () => {
  console.log(`SismoAlert escuchando en http://localhost:${config.PORT}`);
  console.log(`Filtro: M${config.MIN_MAG}+ | region lat ${config.MIN_LAT}..${config.MAX_LAT}, lon ${config.MIN_LON}..${config.MAX_LON}`);
  console.log(pusher.ready ? 'Push activo (VAPID OK)' : 'ADVERTENCIA: sin VAPID keys, push deshabilitado');
});