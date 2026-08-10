const $ = (s) => document.querySelector(s);
const dot = $('#dot');
const statusEl = $('#status');
const btn = $('#btn');
const overlay = $('#overlay');
const ovTitle = $('#ovTitle');
const ovText = $('#ovText');
const ovBtn = $('#ovBtn');
const ovSkip = $('#ovSkip');
const ovSteps = $('#ovSteps');
const ovHint = $('#ovHint');
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

function showOverlay({ title, text, btnText, btnAction, steps = false, hint = '' }) {
  ovTitle.textContent = title;
  ovText.textContent = text;
  ovBtn.textContent = btnText;
  ovBtn.onclick = btnAction || (() => {});
  ovSteps.classList.toggle('hidden', !steps);
  ovHint.textContent = hint;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
  try { localStorage.setItem('sa_skip_install', '1'); } catch {}
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

function iosShare() {
  if (navigator.share) {
    navigator
      .share({ title: 'SismoAlert Colombia', url: location.href })
      .catch(() => {});
    ovHint.textContent = 'En el panel que se abrio elige "Agregar a pantalla de inicio".';
  } else {
    ovSteps.classList.remove('hidden');
  }
}

function handleInstallFlow() {
  if (isStandalone) return;

  if (isIOS) {
    iosHelpCard.classList.remove('hidden');
    const skipped = (() => { try { return localStorage.getItem('sa_skip_install') === '1'; } catch { return false; } })();
    if (!skipped) {
      showOverlay({
        title: 'Instala la app',
        text: 'En iPhone, las alertas solo llegan si la app esta en la pantalla de inicio. Toca el boton y elige "Agregar a pantalla de inicio".',
        btnText: 'Abrir menu Compartir',
        btnAction: iosShare
      });
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
    iosShare();
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