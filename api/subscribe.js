import { getState, saveState } from './store.js';

function parseSub(body) {
  const s = body?.subscription || body;
  if (!s || typeof s.endpoint !== 'string' || !s.keys?.p256dh || !s.keys?.auth) return null;
  return {
    endpoint: s.endpoint,
    expirationTime: s.expirationTime ?? null,
    keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const state = await getState();

  if (req.method === 'POST') {
    const body = await readBody(req);
    const sub = parseSub(body);
    if (!sub) return res.status(400).json({ error: 'Suscripcion invalida' });
    const subs = state.subs.filter((s) => s.endpoint !== sub.endpoint);
    subs.push(sub);
    await saveState({ ...state, subs });
    return res.status(201).json({ ok: true, total: subs.length });
  }

  if (req.method === 'DELETE') {
    const body = await readBody(req);
    if (body.endpoint) {
      await saveState({ ...state, subs: state.subs.filter((s) => s.endpoint !== body.endpoint) });
    }
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Metodo no permitido' });
}