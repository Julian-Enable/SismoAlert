import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function loadEnv() {
  const env = {};
  const file = join(ROOT, '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = { ...process.env, ...loadEnv() };

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  ROOT,
  PORT: num(env.PORT, 3000),
  POLL_INTERVAL_MS: num(env.POLL_INTERVAL_MS, 20000),
  MIN_MAG: num(env.MIN_MAG, 4.0),
  MIN_DISPLAY_MAG: num(env.MIN_DISPLAY_MAG, 0),
  MIN_LAT: num(env.MIN_LAT, -6),
  MAX_LAT: num(env.MAX_LAT, 15),
  MIN_LON: num(env.MIN_LON, -85),
  MAX_LON: num(env.MAX_LON, -65),
  VAPID_SUBJECT: env.VAPID_SUBJECT || 'mailto:sismoalert@localhost',
  VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY || '',
  CRON_SECRET: env.CRON_SECRET || '',
  TEST_ALERT: (env.TEST_ALERT || '1') === '1',
  SGC_API_URL: env.SGC_API_URL || '',
  RESEND_MIN_MAG: num(env.RESEND_MIN_MAG, 6.5),
  RESEND_TIMES: num(env.RESEND_TIMES, 3),
  RESEND_INTERVAL_MS: num(env.RESEND_INTERVAL_MS, 65000)
};