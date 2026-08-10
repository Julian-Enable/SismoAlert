import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function createStore(file) {
  let data = { seen: {}, events: [], subscriptions: [] };

  if (existsSync(file)) {
    try {
      data = { ...data, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch {}
  }

  let dirty = false;
  let timer = null;

  function persistNow() {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
    dirty = false;
  }

  function persist() {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(persistNow, 2000);
  }

  return {
    markSeen(id, mag, time) {
      const prev = data.seen[id];
      data.seen[id] = { mag, time: time || Date.now() };
      if (!prev) return { isNew: true, upgraded: false };
      const upgraded = mag - (prev.mag ?? 0) >= 0.5;
      return { isNew: false, upgraded, prevMag: prev.mag };
    },
    addEvent(ev) {
      data.events.unshift(ev);
      if (data.events.length > 500) data.events.length = 500;
    },
    recent(n) {
      return data.events.slice(0, n);
    },
    addSubscription(sub) {
      const idx = data.subscriptions.findIndex((s) => s.endpoint === sub.endpoint);
      if (idx >= 0) data.subscriptions[idx] = sub;
      else data.subscriptions.push(sub);
    },
    removeSubscription(endpoint) {
      data.subscriptions = data.subscriptions.filter((s) => s.endpoint !== endpoint);
    },
    listSubscriptions() {
      return data.subscriptions;
    },
    countSubscriptions() {
      return data.subscriptions.length;
    },
    persist
  };
}

export function dbPath(root) {
  return join(root, 'data', 'db.json');
}