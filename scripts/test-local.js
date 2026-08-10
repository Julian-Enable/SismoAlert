import { getState, saveState } from '../api/store.js';
import { getConfig, runTick, markTestEvent } from '../api/core.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const state = await getState();
const cfg = getConfig();

console.log('MIN_MAG:', cfg.MIN_MAG, '| region:', cfg.MIN_LAT, cfg.MAX_LAT, cfg.MIN_LON, cfg.MAX_LON);

const { next, alerts } = await runTick(state, cfg);
await saveState(next);
console.log('Eventos en feeds (region + mag):', alerts.length ? 'ok' : '0');
console.log('Alertas nuevas:', alerts.length, alerts.map((a) => `${a.mag} ${a.place}`).slice(0, 3).join(' | '));
console.log('Eventos en historia:', next.events.length);
const s1 = await getState();
console.log('Persistido (seen):', Object.keys(s1.seen).length, '| (events):', s1.events.length);
const { next: n2, event } = markTestEvent({ seen: s1.seen, events: s1.events, subs: [] }, { mag: 5.0, place: 'Duitama (SIMULACRO)' });
await saveState(n2);
console.log('Simulacro guardado:', event.id);
const s2 = await getState();
console.log('Evento visible en /api/events:', s2.events[0]?.place === 'Duitama (SIMULACRO)');
console.log('PRUEBA OK');