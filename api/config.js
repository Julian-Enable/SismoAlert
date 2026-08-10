import { getConfig } from './core.js';

export default function handler(req, res) {
  const cfg = getConfig();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    vapidPublicKey: cfg.VAPID_PUBLIC_KEY,
    minMag: cfg.MIN_MAG,
    pushReady: !!(cfg.VAPID_PUBLIC_KEY && cfg.VAPID_PRIVATE_KEY)
  });
}