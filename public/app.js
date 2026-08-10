const $ = (s) => document.querySelector(s);
const dot = $('#dot');
const statusEl = $('#status');
const btn = $('#btn');
const hint = $('#hint');

let reg = null;
let sub = null;
let vapidKey = null;

function urlBase64ToUint8Array(base64) {
  const pad = base64.replace(/=+$/, '');
  const raw = atob(pad.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function setStatus(msg, ok = false) {
  statusEl.textContent = msg;
  dot.className = ok ? 'dot on' : 'dot';
}

function updateUI() {
  const active = !!sub;
  btn.textContent = active ? 'Desactivar alertas' : 'Activar alertas';
  btn.classList.toggle('off', active);
  btn.disabled = false;
  if (active) {
    setStatus('Alertas activadas. Recibiras un aviso al instante cuando se detecte un sismo.', true);
  } else {
    setStatus('Sin alertas activas.');
  }
}

async function loadEvents() {
  try {
    const r = await fetch('/api/events');
    const { events } = await r.json();
    const box = $('#events');
    const info = $('#feedinfo');
    info.textContent = events.length ? 'Eventos recientes en la region:' : 'Sin eventos recientes registrados.';
    box.innerHTML = '';
    if (!events.length) {
      box.innerHTML = '<p class="hint">Aun no hay eventos registrados. Cuando ocurra uno, aparecera aqui.</p>';
    }
    events.forEach((e) => {
      const d = new Date(e.time);
      const el = document.createElement('div');
      el.className = 'ev';
      const mag = e.mag !== null && e.mag !== undefined ? e.mag.toFixed(1) : 'n/d';
      const tag = e.status === 'actualizado' ? '<span class="tag updated">ACTUALIZADO</span>' : '';
      const test = e.source === 'TEST' ? '<span class="tag test">SIMULACRO</span>' : '';
      el.innerHTML =
        `<div><span class="mag">M${mag}</span>${tag}${test} <span class="place">${e.place || '?'}</span></div>` +
        `<div class="meta">${d.toLocaleString('es-CO', { timeZone: 'America/Bogota' })} | ${e.source} | prof. ${e.depth ?? 'n/d'} km</div>`;
      box.appendChild(el);
    });
  } catch {}
}

async function enable() {
  setStatus('Pidiendo permiso...');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    setStatus('Permiso denegado. Permite las notificaciones en los ajustes del navegador.');
    return;
  }
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey)
    });
  } catch (err) {
    if (err.name === 'NotSupportedError') {
      setStatus('Sin soporte en este navegador. En iPhone: abre en Safari, instala la app y pulsa de nuevo.');
      return;
    }
    throw err;
  }
  const r = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() })
  });
  if (r.ok) updateUI();
}

async function disable() {
  if (sub) {
    await fetch('/api/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
    await sub.unsubscribe();
  }
  sub = null;
  updateUI();
}

btn.addEventListener('click', () => (sub ? disable() : enable()));

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadEvents();
});

(async () => {
  try {
    const cfg = await (await fetch('/api/config')).json();
    vapidKey = cfg.vapidPublicKey;

    if (!('serviceWorker' in navigator)) {
      setStatus('Tu navegador no soporta notificaciones push.');
      return;
    }
    if (!('PushManager' in window) || !('Notification' in window)) {
      setStatus('Tu navegador no soporta notificaciones push.');
      return;
    }

    reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    sub = await reg.pushManager.getSubscription();
    updateUI();

    if (!vapidKey) {
      setStatus('Servidor sin llaves VAPID configuradas. Notifica al administrador.');
      btn.disabled = true;
    } else if (Notification.permission === 'blocked') {
      setStatus('Notificaciones bloqueadas en el navegador. Habilitalas en los ajustes.');
    }

    loadEvents();
  } catch (err) {
    setStatus('Error al preparar las alertas: ' + (err && err.message));
  }
})();