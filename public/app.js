const $ = (s) => document.querySelector(s);
const dot = $('#dot');
const badgeDot = $('#badgeDot');
const statusEl = $('#status');
const btn = $('#btn');
const btnText = $('#btnText');
const overlay = $('#overlay');
const ovTitle = $('#ovTitle');
const ovText = $('#ovText');
const ovBtn = $('#ovBtn');
const ovSkip = $('#ovSkip');
const ovHint = $('#ovHint');
const iosVisual = $('#iosVisual');
const iosHelpCard = $('#iosHelpCard');

let reg = null;
let sub = null;
let vapidKey = null;
let deferredPrompt = null;

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = /android/i.test(navigator.userAgent);
const supportsPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64) {
  const pad = base64.replace(/=+$/, '');
  const raw = atob(pad.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const DANGER_TH = 6.0;
const WARN_TH = 5.0;

function magColor(m) {
  if (m === null || m === undefined) return 'var(--muted)';
  if (m >= DANGER_TH) return 'var(--m6)';
  if (m >= WARN_TH) return 'var(--m5)';
  return 'var(--m4)';
}

function agoText(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'ahora mismo';
  const m = Math.floor(s / 60);
  if (m < 60) return 'hace ' + m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return 'hace ' + h + ' h';
  const d = Math.floor(h / 24);
  return 'hace ' + d + ' d';
}

function dateStr(ts) {
  return new Date(ts).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function setStatus(msg, ok = false) {
  statusEl.textContent = msg;
  dot.className = ok ? 'live-dot' : 'live-dot off';
  badgeDot.className = ok ? 'live-dot' : 'live-dot off';
}

function updateUI() {
  const active = !!sub;
  btnText.textContent = active ? 'Desactivar alertas' : 'Activar alertas';
  btn.classList.toggle('off', active);
  btn.disabled = false;
  if (active) {
    setStatus('Alertas activadas: aviso al instante ante un sismo', true);
  } else {
    setStatus('Sin alertas activas');
  }
}

function showOverlay({ title, text, btnText, btnAction, hint = '' }) {
  ovTitle.textContent = title;
  ovText.textContent = text;
  ovBtn.textContent = btnText;
  ovBtn.onclick = btnAction || (() => {});
  ovBtn.classList.toggle('hidden', !btnText);
  ovHint.textContent = hint;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
  try { localStorage.setItem('sa_skip_install', '1'); } catch {}
}

function renderLast(events) {
  const empty = $('#lastEmpty');
  const content = $('#lastContent');
  const ev = events[0];
  if (!ev) {
    empty.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  content.classList.remove('hidden');

  const mag = ev.mag !== null && ev.mag !== undefined ? ev.mag.toFixed(1) : 'n/d';
  const magEl = $('#lastMag');
  magEl.textContent = mag;
  magEl.style.color = magColor(ev.mag);

  const tagEl = $('#lastTag');
  const labels = [];
  if (ev.source === 'TEST') labels.push('SIMULACRO');
  if (ev.status === 'actualizado') labels.push('ACTUALIZADO');
  if (!labels.length) {
    tagEl.style.display = 'none';
  } else {
    tagEl.textContent = labels.join(' · ');
    tagEl.style.display = 'inline-block';
  }

  $('#lastPlace').textContent = ev.place || 'Ubicacion desconocida';

  const meta = $('#lastMeta');
  meta.innerHTML = '';
  const parts = [
    'Prof. ' + (ev.depth ?? 'n/d') + ' km',
    'Fuente ' + (ev.source || 'n/d'),
    ev.lat !== undefined && ev.lon !== undefined ? ev.lat.toFixed(2) + ', ' + ev.lon.toFixed(2) : null,
    dateStr(ev.time)
  ];
  for (const p of parts) {
    if (!p) continue;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = p;
    meta.appendChild(chip);
  }
}

function evItem(e) {
  const mag = e.mag !== null && e.mag !== undefined ? e.mag.toFixed(1) : 'n/d';
  const color = magColor(e.mag);
  const tag = e.status === 'actualizado' ? '<span class="tag updated">ACTU</span> ' : '';
  const test = e.source === 'TEST' ? '<span class="tag test">SIMULACRO</span> ' : '';
  const el = document.createElement('div');
  el.className = 'ev';
  el.innerHTML =
    '<div class="rail" style="background:' + color + '"></div>' +
    '<div><div><span class="mag" style="color:' + color + '">M' + mag + '</span> ' + tag + test +
    '<span class="place">' + (e.place || '?') + '</span></div>' +
    '<div class="meta">' + dateStr(e.time) + ' | ' + (e.source || 'n/d') + '</div></div>' +
    '<div class="ago">' + agoText(e.time) + '</div>';
  return el;
}

async function loadEvents() {
  try {
    const r = await fetch('/api/events');
    const { events } = await r.json();
    const box = $('#events');
    const info = $('#feedinfo');
    renderLast(events);
    info.textContent = events.length ? 'Eventos recientes en la region' : 'Sin eventos recientes';
    box.innerHTML = '';
    if (!events.length) {
      box.innerHTML = '<p class="hint">Aun no hay eventos registrados. Cuando ocurra uno, aparecera aqui.</p>';
      return;
    }
    events.forEach((e) => box.appendChild(evItem(e)));
  } catch {}
}

function handleInstallFlow() {
  if (isStandalone) return;

  if (isIOS) {
    iosHelpCard.classList.remove('hidden');
    const skipped = (() => { try { return localStorage.getItem('sa_skip_install') === '1'; } catch { return false; } })();
    if (!skipped) {
      showOverlay({
        title: 'Instala la app para recibir alertas',
        text: 'Es gratis y toma 20 segundos. En iPhone, las alertas push solo funcionan con la app instalada.',
        btnText: '',
        hint: ''
      });
      iosVisual.classList.remove('hidden');
    }
    return;
  }

  if (isAndroid && deferredPrompt) {
    showOverlay({
      title: 'Instala la app',
      text: 'Instala SismoAlert para recibir las alertas como una app normal.',
      btnText: 'Instalar aplicacion',
      btnAction: async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        hideOverlay();
      }
    });
  }
}

async function enable() {
  if (isIOS && !isStandalone) {
    setStatus('Instala la app siguiendo la guia para poder activar las alertas.');
    handleInstallFlow();
    return;
  }
  setStatus('Pidiendo permiso...');
  try {
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
        setStatus('Sin soporte de push en este navegador. En iPhone: instala la app y pulsa de nuevo.');
        return;
      }
      if (err.name === 'InvalidStateError' || err.name === 'AbortError') {
        sub = await reg.pushManager.getSubscription();
        if (!sub) throw err;
      } else {
        throw err;
      }
    }
    const r = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
    if (!r.ok) {
      setStatus('No se pudo guardar la suscripcion. Reintenta en un momento.');
      return;
    }
    updateUI();
  } catch (err) {
    setStatus('No se pudo activar las alertas: ' + (err && err.message ? err.message : 'error desconocido'));
  }
}

async function disable() {
  try {
    if (sub) {
      await fetch('/api/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint })
      });
      await sub.unsubscribe();
    }
  } catch {}
  sub = null;
  updateUI();
}

btn.addEventListener('click', () => (sub ? disable() : enable()));
ovSkip.addEventListener('click', hideOverlay);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  handleInstallFlow();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadEvents();
});

setInterval(loadEvents, 60000);

(async () => {
  try {
    const cfg = await (await fetch('/api/config')).json();
    vapidKey = cfg.vapidPublicKey;

    if (!supportsPush) {
      setStatus('Tu navegador no soporta notificaciones push.');
      btn.disabled = true;
      if (isIOS && !isStandalone) handleInstallFlow();
      loadEvents();
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

    handleInstallFlow();
    loadEvents();
  } catch (err) {
    setStatus('Error al preparar las alertas: ' + (err && err.message ? err.message : 'error desconocido'));
  }
})();
