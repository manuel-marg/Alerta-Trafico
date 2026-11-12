// Lógica del cliente PWA, Web Push, Multi-usuario y Mapa OpenStreetMap (Leaflet)

let swRegistration = null;
let currentConfig = null;
let lastCheckData = null;
let currentUser = null;

// Coordenadas guardadas
let originCoords = null;
let destinationCoords = null;
let isRouteEditorManuallyOpen = false;
let homeRedirectTimer = null;
let deferredInstallPrompt = null;

// Estado del modal de mapa
let leafletMap = null;
let currentMarker = null;
let currentPickerTarget = 'origin'; // 'origin' o 'destination'
let selectedPinData = { lat: null, lng: null, address: '' };

function hasValidCoords(coords) {
  return Boolean(
    coords &&
    coords.lat !== null && coords.lat !== undefined &&
    coords.lng !== null && coords.lng !== undefined &&
    Number.isFinite(Number(coords.lat)) &&
    Number.isFinite(Number(coords.lng))
  );
}

function hasBothLocationsConfigured() {
  return hasValidCoords(originCoords) && hasValidCoords(destinationCoords);
}

function renderRouteEditorVisibility() {
  const editorCard = document.getElementById('route-editor-card');
  const editorHeader = document.getElementById('route-editor-header');
  const previewTrigger = document.getElementById('route-preview-trigger');
  const chevron = document.getElementById('route-preview-chevron');
  if (!editorCard) return;

  if (!currentUser) {
    editorCard.style.display = 'none';
    if (editorHeader) editorHeader.style.display = 'none';
    if (previewTrigger) {
      previewTrigger.classList.remove('active');
      previewTrigger.setAttribute('aria-expanded', 'false');
    }
    if (chevron) chevron.textContent = 'edit';
    return;
  }

  const bothConfigured = hasBothLocationsConfigured();

  if (!bothConfigured) {
    editorCard.style.display = 'block';
    if (editorHeader) editorHeader.style.display = 'none';
    if (previewTrigger) {
      previewTrigger.classList.remove('active');
      previewTrigger.setAttribute('aria-expanded', 'true');
    }
    if (chevron) chevron.textContent = 'edit';
    return;
  }

  if (isRouteEditorManuallyOpen) {
    editorCard.style.display = 'block';
    if (editorHeader) editorHeader.style.display = 'flex';
    if (previewTrigger) {
      previewTrigger.classList.add('active');
      previewTrigger.setAttribute('aria-expanded', 'true');
    }
    if (chevron) chevron.textContent = 'expand_less';
  } else {
    editorCard.style.display = 'none';
    if (editorHeader) editorHeader.style.display = 'none';
    if (previewTrigger) {
      previewTrigger.classList.remove('active');
      previewTrigger.setAttribute('aria-expanded', 'false');
    }
    if (chevron) chevron.textContent = 'edit';
  }
}

function toggleRouteEditor(forceOpen = null) {
  if (!hasBothLocationsConfigured()) {
    isRouteEditorManuallyOpen = false;
    renderRouteEditorVisibility();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  isRouteEditorManuallyOpen = forceOpen !== null ? Boolean(forceOpen) : !isRouteEditorManuallyOpen;
  renderRouteEditorVisibility();

  if (isRouteEditorManuallyOpen) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Helper para convertir la clave VAPID de Base64 a Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// --- Sistema de Notificaciones Toastify-Pro (Tema Blanco / Claro) ---
const Toast = (() => {
  const ICONS = {
    success: '<svg viewBox="0 0 24 24"><path d="m5 13 4 4 10-11"/></svg>',
    error: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    warning: '<svg viewBox="0 0 24 24"><path d="M12 7v6"/><circle cx="12" cy="17" r="0.5"/></svg>',
    info: '<svg viewBox="0 0 24 24"><path d="M12 11v6"/><circle cx="12" cy="7" r="0.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 9-6 6m0-6 6 6m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
  };

  const COLORS = {
    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
    loading: '#8b93a7'
  };

  const POSITIONS = ['top-right', 'top-left', 'top-center', 'bottom-right', 'bottom-left', 'bottom-center'];
  const containers = {};

  const defaults = {
    type: 'info',
    title: '',
    message: '',
    duration: 3800,
    position: 'top-right',
    theme: 'light',
    closable: true,
    progress: true,
    pauseOnHover: true,
    maxVisible: 3,
    icon: null,
    action: null,
    onClose: null
  };

  function getContainer(position, theme) {
    const key = `${position}|${theme}`;
    if (containers[key] && document.body.contains(containers[key])) return containers[key];
    const c = document.createElement('div');
    c.className = `tst-container tst-${position}${theme === 'light' ? ' tst-light' : ''}`;
    document.body.appendChild(c);
    containers[key] = c;
    return c;
  }

  class ToastInstance {
    constructor(opts) {
      this.o = Object.assign({}, defaults, opts);
      if (!POSITIONS.includes(this.o.position)) this.o.position = 'top-right';

      this.container = getContainer(this.o.position, this.o.theme);
      this._trimStack();

      this.el = document.createElement('div');
      this.el.className = 'tst';
      this.el.setAttribute('role', this.o.type === 'error' ? 'alert' : 'status');
      this.el.style.setProperty('--tst-accent', COLORS[this.o.type] || COLORS.info);
      this._render();
      this.container.appendChild(this.el);

      requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.add('tst-in')));

      this._startTimer();
      this._bindEvents();
    }

    _render() {
      const o = this.o;
      const iconHtml = o.type === 'loading'
        ? '<div class="tst-spin"></div>'
        : (o.icon || ICONS[o.type] || ICONS.info);

      this.el.innerHTML = `
        <div class="tst-icon">${iconHtml}</div>
        <div class="tst-body">
          ${o.title ? '<p class="tst-title"></p>' : ''}
          <p class="tst-msg"></p>
          ${o.action ? '<button type="button" class="tst-action"></button>' : ''}
        </div>
        ${o.closable ? `<button type="button" class="tst-close" aria-label="Cerrar">${ICONS.close}</button>` : ''}
        ${(o.progress && o.duration > 0) ? '<div class="tst-bar"></div>' : ''}`;

      if (o.title) this.el.querySelector('.tst-title').textContent = o.title;
      this.el.querySelector('.tst-msg').textContent = o.message;
      if (o.action) this.el.querySelector('.tst-action').textContent = o.action.label || 'OK';

      this.bar = this.el.querySelector('.tst-bar');
    }

    _bindEvents() {
      const closeBtn = this.el.querySelector('.tst-close');
      if (closeBtn) closeBtn.addEventListener('click', () => this.close());

      const actionBtn = this.el.querySelector('.tst-action');
      if (actionBtn) {
        actionBtn.addEventListener('click', () => {
          if (typeof this.o.action.onClick === 'function') this.o.action.onClick(this);
          this.close();
        });
      }

      if (this.o.pauseOnHover && this.o.duration > 0) {
        this.el.addEventListener('mouseenter', () => this._pause());
        this.el.addEventListener('mouseleave', () => this._resume());
      }

      let startX = null;
      this.el.addEventListener('pointerdown', (e) => { startX = e.clientX; });
      this.el.addEventListener('pointerup', (e) => {
        if (startX !== null && e.clientX - startX > 60) this.close();
        startX = null;
      });
    }

    _startTimer() {
      if (this.o.duration <= 0) return;
      this.remaining = this.o.duration;
      this._tick();
    }

    _tick() {
      this.startedAt = Date.now();
      this.timer = setTimeout(() => this.close(), this.remaining);
      if (this.bar) {
        this.bar.style.transition = 'none';
        this.bar.style.transform = `scaleX(${this.remaining / this.o.duration})`;
        void this.bar.offsetWidth;
        requestAnimationFrame(() => {
          if (!this.bar) return;
          this.bar.style.transition = `transform ${this.remaining}ms linear`;
          this.bar.style.transform = 'scaleX(0)';
        });
      }
    }

    _pause() {
      if (!this.timer) return;
      clearTimeout(this.timer);
      this.timer = null;
      this.remaining -= Date.now() - this.startedAt;
      if (this.bar) {
        const ratio = Math.max(this.remaining, 0) / this.o.duration;
        this.bar.style.transition = 'none';
        this.bar.style.transform = `scaleX(${ratio})`;
      }
    }

    _resume() {
      if (this.timer || this.remaining === undefined || this.o.duration <= 0) return;
      if (this.remaining <= 0) return this.close();
      this._tick();
    }

    _trimStack() {
      const toasts = this.container.querySelectorAll('.tst:not(.tst-out)');
      const excess = toasts.length - (this.o.maxVisible - 1);
      for (let i = 0; i < excess; i++) {
        const inst = toasts[i]._tst;
        if (inst) inst.close();
        else toasts[i].remove();
      }
    }

    update(opts) {
      clearTimeout(this.timer);
      this.timer = null;
      Object.assign(this.o, opts);
      this.el.style.setProperty('--tst-accent', COLORS[this.o.type] || COLORS.info);
      this._render();
      this._bindEvents();
      this._startTimer();
      return this;
    }

    close() {
      if (this._closing) return;
      this._closing = true;
      clearTimeout(this.timer);
      this.el.classList.remove('tst-in');
      this.el.classList.add('tst-out');
      const done = () => {
        this.el.remove();
        if (typeof this.o.onClose === 'function') this.o.onClose(this);
      };
      this.el.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 400);
    }
  }

  return {
    show(opts = {}) {
      const t = new ToastInstance(opts);
      t.el._tst = t;
      return t;
    },
    success(message, opts = {}) { return this.show({ ...opts, type: 'success', message }); },
    error(message, opts = {}) { return this.show({ ...opts, type: 'error', message }); },
    warning(message, opts = {}) { return this.show({ ...opts, type: 'warning', message }); },
    info(message, opts = {}) { return this.show({ ...opts, type: 'info', message }); },
    loading(message, opts = {}) {
      return this.show({ ...opts, type: 'loading', message, duration: 0, closable: false, progress: false });
    },
    clear() {
      document.querySelectorAll('.tst').forEach(el => (el._tst ? el._tst.close() : el.remove()));
    }
  };
})();

function formatTime12h(timeStr) {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) {
    return '--:--';
  }
  const [rawH, rawM] = timeStr.split(':');
  const h = Number(rawH);
  const m = Number(rawM);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return timeStr;

  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  const paddedMin = String(m).padStart(2, '0');
  return `${hour12}:${paddedMin} ${period}`;
}

// Mostrar Toast (compatible con string u objeto de opciones)
function showToast(msgOrOpts, type = 'info', extraOpts = {}) {
  if (msgOrOpts && typeof msgOrOpts === 'object') {
    return Toast.show(msgOrOpts);
  }
  const cleanMsg = String(msgOrOpts || '').replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF⇅]+\s*/u, '').trim();
  return Toast.show({ type, message: cleanMsg, ...extraOpts });
}

// --- 1. Autenticación y Gestión de Sesión Multi-usuario ---
async function checkAuthStatus() {
  try {
    const resp = await fetch('/api/auth/me');
    const data = await resp.json();

    const btnUserAvatar = document.getElementById('btn-user-avatar');
    const btnOpenLogin = document.getElementById('btn-open-login');
    const userDropdown = document.getElementById('user-dropdown');

    if (data.loggedIn && data.user) {
      currentUser = data.user;
      const initial = (currentUser.name || currentUser.email || 'U').charAt(0).toUpperCase();

      const dropAvatar = document.getElementById('dropdown-avatar-initial');
      if (dropAvatar) dropAvatar.textContent = initial;

      const dropName = document.getElementById('dropdown-user-name');
      if (dropName) dropName.textContent = currentUser.name || 'Usuario';

      const dropEmail = document.getElementById('dropdown-user-email');
      if (dropEmail) dropEmail.textContent = currentUser.email || '';

      if (btnUserAvatar) btnUserAvatar.style.display = 'flex';
      if (btnOpenLogin) btnOpenLogin.style.display = 'none';
      if (userDropdown) userDropdown.style.display = 'none';
      closeAuthModal();

      await loadConfig();
      await checkTrafficNow();
      await syncPushSubscriptionIfGranted();
    } else {
      currentUser = null;
      isRouteEditorManuallyOpen = false;
      renderRouteEditorVisibility();
      if (btnUserAvatar) btnUserAvatar.style.display = 'none';
      if (btnOpenLogin) btnOpenLogin.style.display = 'inline-flex';
      if (userDropdown) userDropdown.style.display = 'none';
      // Abrir modal de autenticación si no ha iniciado sesión
      showAuthModal('login');
    }
  } catch (err) {
    console.error('Error verificando sesión:', err);
  }
}

function showAuthModal(defaultTab = 'login') {
  const modal = document.getElementById('auth-modal');
  modal.style.display = 'flex';
  switchAuthTab(defaultTab);
  clearAuthError();
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  modal.style.display = 'none';
  clearAuthError();
}

function switchAuthTab(tab) {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');
  const title = document.getElementById('auth-modal-title');

  clearAuthError();

  if (tab === 'register') {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    formRegister.style.display = 'flex';
    formLogin.style.display = 'none';
    title.textContent = 'Crear Nueva Cuenta';
  } else {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    formLogin.style.display = 'flex';
    formRegister.style.display = 'none';
    title.textContent = 'Iniciar Sesión';
  }
}

function showAuthError(msg) {
  const box = document.getElementById('auth-error-box');
  box.textContent = msg;
  box.style.display = 'block';
}

function clearAuthError() {
  const box = document.getElementById('auth-error-box');
  box.style.display = 'none';
  box.textContent = '';
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  clearAuthError();

  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await resp.json();

    if (resp.ok && data.success) {
      Toast.success(`¡Bienvenido de nuevo, ${data.user.name}!`, { title: 'Sesión iniciada' });
      document.getElementById('form-login').reset();
      await checkAuthStatus();
    } else {
      showAuthError(data.error || 'Credenciales inválidas.');
    }
  } catch (err) {
    showAuthError('Error de red al conectar con el servidor.');
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  clearAuthError();

  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;

  try {
    const resp = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await resp.json();

    if (resp.ok && data.success) {
      Toast.success(`Tu cuenta fue creada. ¡Bienvenido, ${data.user.name}!`, { title: 'Cuenta creada' });
      document.getElementById('form-register').reset();
      await checkAuthStatus();
    } else {
      showAuthError(data.error || 'No se pudo crear la cuenta.');
    }
  } catch (err) {
    showAuthError('Error de red al conectar con el servidor.');
  }
}

async function handleLogout() {
  try {
    const userDropdown = document.getElementById('user-dropdown');
    if (userDropdown) userDropdown.style.display = 'none';
    await fetch('/api/auth/logout', { method: 'POST' });
    originCoords = null;
    destinationCoords = null;
    currentConfig = null;
    currentUser = null;
    isRouteEditorManuallyOpen = false;
    document.getElementById('input-origin').value = '';
    document.getElementById('input-destination').value = '';
    renderCoordsPreview('origin');
    renderCoordsPreview('destination');
    renderRouteEditorVisibility();
    Toast.info('Has cerrado sesión correctamente.', { title: 'Sesión cerrada' });
    await checkAuthStatus();
  } catch (err) {
    Toast.error('No se pudo cerrar sesión.', { title: 'Error' });
  }
}

// --- 2. Inicialización de Service Worker, Instalación PWA y Web Push ---
function isRunningStandalone() {
  return Boolean(
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://')
  );
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function updatePwaInstallState(installed) {
  const badge = document.getElementById('badge-pwa');
  const badgeText = document.getElementById('badge-pwa-text');
  const installWrap = document.getElementById('pwa-install-container');

  if (badge && badgeText) {
    badge.className = 'badge';
    if (installed) {
      badge.classList.add('badge-green');
      badgeText.textContent = 'Aplicación instalada';
    } else {
      badge.classList.add('badge-yellow');
      badgeText.textContent = 'Aplicación sin instalar';
    }
  }

  if (installWrap) {
    installWrap.style.display = installed ? 'none' : 'block';
  }
}

async function refreshPwaInstallStatus() {
  if (isRunningStandalone()) {
    updatePwaInstallState(true);
    return;
  }

  if (deferredInstallPrompt) {
    updatePwaInstallState(false);
    return;
  }

  if ('getInstalledRelatedApps' in navigator) {
    try {
      const relatedApps = await navigator.getInstalledRelatedApps();
      if (Array.isArray(relatedApps) && relatedApps.length > 0) {
        updatePwaInstallState(true);
        return;
      }
    } catch (e) {}
  }

  updatePwaInstallState(false);
}

function openPwaGuideModal(isIos) {
  const modal = document.getElementById('pwa-ios-modal');
  const intro = document.getElementById('pwa-guide-intro');
  const steps = document.getElementById('pwa-guide-steps');
  if (!modal || !intro || !steps) return;

  if (isIos) {
    intro.textContent = 'En iPhone o iPad sigue estos 2 pasos en Safari para instalar la aplicación:';
    steps.innerHTML = `
      <div class="pwa-guide-step">
        <span class="material-symbols-outlined pwa-step-icon">ios_share</span>
        <span>Pulsa el botón <strong>Compartir</strong> en la barra inferior de Safari.</span>
      </div>
      <div class="pwa-guide-step">
        <span class="material-symbols-outlined pwa-step-icon">add_box</span>
        <span>Elige <strong>Agregar a pantalla de inicio</strong> y toca <strong>Agregar</strong>.</span>
      </div>`;
  } else {
    intro.textContent = 'Si el navegador no mostró el aviso automático, instálala manualmente así:';
    steps.innerHTML = `
      <div class="pwa-guide-step">
        <span class="material-symbols-outlined pwa-step-icon">more_vert</span>
        <span>Abre el menú de tu navegador en la barra superior o inferior.</span>
      </div>
      <div class="pwa-guide-step">
        <span class="material-symbols-outlined pwa-step-icon">download</span>
        <span>Pulsa <strong>Instalar aplicación</strong> o <strong>Agregar a pantalla principal</strong>.</span>
      </div>`;
  }

  modal.style.display = 'flex';
}

function closePwaGuideModal() {
  const modal = document.getElementById('pwa-ios-modal');
  if (modal) modal.style.display = 'none';
}

async function handlePwaInstallClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (outcome === 'accepted') {
      Toast.info('Instalando la aplicación en tu teléfono...', {
        title: 'Instalación iniciada',
        duration: 3000
      });
    } else {
      Toast.warning('Puedes intentarlo de nuevo cuando quieras desde este botón.', {
        title: 'Instalación cancelada'
      });
    }
    return;
  }

  if (isRunningStandalone()) {
    updatePwaInstallState(true);
    Toast.success('Ya estás usando la aplicación instalada.', { title: 'Aplicación instalada' });
    return;
  }

  openPwaGuideModal(isIosDevice());
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updatePwaInstallState(false);
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updatePwaInstallState(true);
  closePwaGuideModal();
  Toast.success('La aplicación se instaló correctamente en tu teléfono.', {
    title: 'Aplicación instalada'
  });
});

async function initServiceWorker() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    updatePushBadge('error', 'Push no soportado');
    document.getElementById('push-activation-card').style.display = 'none';
    return;
  }

  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    await swRegistration.update();
    console.log('✅ Service Worker registrado con éxito:', swRegistration.scope);
    await syncPushSubscriptionIfGranted();
  } catch (err) {
    console.error('Error registrando el Service Worker:', err);
    updatePushBadge('error', 'Error Push');
  }
}

async function syncPushSubscriptionIfGranted() {
  if (!swRegistration) return;
  try {
    const subscription = await swRegistration.pushManager.getSubscription();
    if (subscription && Notification.permission === 'granted') {
      updatePushBadge('active', 'Push Activo');
      document.getElementById('push-activation-card').style.display = 'none';
      if (currentUser) {
        await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription)
        });
      }
    } else {
      updatePushBadge('pending', 'Push Inactivo');
      document.getElementById('push-activation-card').style.display = 'flex';
    }
  } catch (e) {
    console.error('Error sincronizando push:', e);
  }
}

function updatePushBadge(status, label) {
  const badge = document.getElementById('badge-push');
  const text = document.getElementById('badge-push-text');
  badge.className = 'badge';

  if (status === 'active') {
    badge.classList.add('badge-green');
  } else if (status === 'pending') {
    badge.classList.add('badge-yellow');
  } else {
    badge.classList.add('badge-red');
  }
  text.textContent = label;
}

async function subscribeUserToPush() {
  if (!currentUser) {
    Toast.warning('Inicia sesión para activar las notificaciones en tu cuenta.', { title: 'Sesión requerida' });
    showAuthModal('login');
    return;
  }

  if (!swRegistration) {
    Toast.error('El Service Worker aún no está listo. Recarga la página.', { title: 'Push no disponible' });
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      Toast.warning('Permiso de notificaciones denegado en el navegador.', { title: 'Permiso denegado' });
      updatePushBadge('error', 'Permiso Denegado');
      return;
    }

    const respKey = await fetch('/api/vapid-public-key');
    const { publicKey } = await respKey.json();
    const convertedKey = urlBase64ToUint8Array(publicKey);

    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedKey
    });

    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    updatePushBadge('active', 'Push Activo');
    document.getElementById('push-activation-card').style.display = 'none';
    Toast.success('Notificaciones Push activadas para tu cuenta.', { title: 'Alertas activadas' });
  } catch (err) {
    console.error('Error suscribiendo al usuario:', err);
    Toast.error('No se pudieron activar las notificaciones.', { title: 'Error de Push' });
  }
}

// --- 3. Leaflet & OpenStreetMap (Mapa Gratuito y Open Source) ---
function initLeafletMap() {
  if (leafletMap) return;

  const defaultLat = 10.4900;
  const defaultLng = -66.8600;

  leafletMap = L.map('map-container').setView([defaultLat, defaultLng], 13);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(leafletMap);

  leafletMap.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    setPinOnMap(lat, lng);
    await reverseGeocode(lat, lng);
  });
}

function setPinOnMap(lat, lng) {
  selectedPinData.lat = Number(lat.toFixed(6));
  selectedPinData.lng = Number(lng.toFixed(6));

  if (!currentMarker) {
    currentMarker = L.marker([lat, lng], { draggable: true }).addTo(leafletMap);
    currentMarker.on('dragend', async (e) => {
      const pos = e.target.getLatLng();
      setPinOnMap(pos.lat, pos.lng);
      await reverseGeocode(pos.lat, pos.lng);
    });
  } else {
    currentMarker.setLatLng([lat, lng]);
  }

  document.getElementById('pin-coords-text').textContent = `Coordenadas: ${selectedPinData.lat}, ${selectedPinData.lng}`;
}

async function reverseGeocode(lat, lng) {
  const addressText = document.getElementById('pin-address-text');
  addressText.textContent = 'Buscando nombre de la calle/zona...';

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'Accept-Language': 'es' }
    });
    const data = await resp.json();

    if (data && data.display_name) {
      const parts = data.display_name.split(',');
      const shortAddress = parts.slice(0, 3).join(',').trim();
      selectedPinData.address = shortAddress || data.display_name;
      addressText.textContent = `📍 ${selectedPinData.address}`;
    } else {
      selectedPinData.address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      addressText.textContent = `📍 Ubicación fijada (${selectedPinData.address})`;
    }
  } catch (err) {
    selectedPinData.address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    addressText.textContent = `📍 Ubicación fijada (${selectedPinData.address})`;
  }
}

async function searchPlaces(query) {
  const resultsContainer = document.getElementById('map-search-results');
  if (!query || query.trim().length < 3) {
    resultsContainer.style.display = 'none';
    return;
  }

  resultsContainer.innerHTML = '<div class="search-result-item" style="color: #94a3b8;">Buscando ubicaciones...</div>';
  resultsContainer.style.display = 'block';

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;
    const resp = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    const items = await resp.json();

    if (!items || items.length === 0) {
      resultsContainer.innerHTML = '<div class="search-result-item" style="color: #94a3b8;">No se encontraron resultados. Prueba hacer zoom y clic directo en el mapa.</div>';
      return;
    }

    resultsContainer.innerHTML = '';
    items.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.innerHTML = `<strong>${item.name || item.display_name.split(',')[0]}</strong><br><small style="color: #94a3b8;">${item.display_name}</small>`;
      div.addEventListener('click', async () => {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        resultsContainer.style.display = 'none';
        leafletMap.setView([lat, lon], 17);
        setPinOnMap(lat, lon);
        const parts = item.display_name.split(',');
        selectedPinData.address = parts.slice(0, 3).join(',').trim();
        document.getElementById('pin-address-text').textContent = `📍 ${selectedPinData.address}`;
      });
      resultsContainer.appendChild(div);
    });
  } catch (e) {
    resultsContainer.innerHTML = '<div class="search-result-item" style="color: #f87171;">Error al buscar.</div>';
  }
}

function openMapModal(target) {
  currentPickerTarget = target;
  const modal = document.getElementById('map-modal');
  const title = document.getElementById('modal-map-title');
  const addressText = document.getElementById('pin-address-text');
  const coordsText = document.getElementById('pin-coords-text');

  if (target === 'origin') {
    title.innerHTML = '<span class="material-symbols-outlined" style="vertical-align: middle; color: #1a73e8; font-size: 22px;">home_pin</span> Fijar Punto de Partida (Casa)';
  } else {
    title.innerHTML = '<span class="material-symbols-outlined" style="vertical-align: middle; color: #d93025; font-size: 22px;">pin_drop</span> Fijar Destino (Oficina / Trabajo)';
  }

  modal.style.display = 'flex';
  setTimeout(() => {
    initLeafletMap();
    leafletMap.invalidateSize();

    let targetCoords = target === 'origin' ? originCoords : destinationCoords;
    if (hasValidCoords(targetCoords)) {
      leafletMap.setView([targetCoords.lat, targetCoords.lng], 16);
      setPinOnMap(targetCoords.lat, targetCoords.lng);
      const existingAddress = target === 'origin' 
        ? document.getElementById('input-origin').value 
        : document.getElementById('input-destination').value;
      if (existingAddress) {
        selectedPinData.address = existingAddress;
        addressText.innerHTML = `<span class="material-symbols-outlined" style="vertical-align: middle; font-size: 16px; margin-right: 4px;">pin_drop</span> ${existingAddress}`;
      }
    } else {
      selectedPinData = { lat: null, lng: null, address: '' };
      if (currentMarker && leafletMap) {
        leafletMap.removeLayer(currentMarker);
        currentMarker = null;
      }
      coordsText.textContent = 'Coordenadas: --';
      addressText.textContent = 'Haz clic en el mapa o busca arriba para colocar el pin...';
    }
  }, 100);
}

function closeMapModal() {
  document.getElementById('map-modal').style.display = 'none';
  document.getElementById('map-search-results').style.display = 'none';
  document.getElementById('map-search-input').value = '';
}

// Guardar cambios parciales o completos directamente en la base de datos SQLite del usuario
async function saveConfigPartial(payload, customToastMsg = null) {
  if (!currentUser) {
    Toast.warning('Inicia sesión para guardar tu configuración.', { title: 'Sesión requerida' });
    showAuthModal('login');
    return false;
  }

  try {
    const resp = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data.config) currentConfig = data.config;

      if (payload.origin !== undefined) {
        document.getElementById('display-origin').textContent = payload.origin || 'Sin configurar';
      }
      if (payload.destination !== undefined) {
        document.getElementById('display-destination').textContent = payload.destination || 'Sin configurar';
      }
      if (payload.targetArrivalTime !== undefined) {
        document.getElementById('stat-arrival-target').textContent = formatTime12h(payload.targetArrivalTime);
      }
      if (payload.bufferMinutes !== undefined) {
        document.getElementById('stat-buffer').textContent = `${payload.bufferMinutes} min`;
      }

      if (customToastMsg) {
        showToast(customToastMsg, 'success');
      }

      // Recalcular ruta en vivo automáticamente cuando cambia origen, destino u horario
      const curOrigin = document.getElementById('input-origin').value;
      const curDest = document.getElementById('input-destination').value;
      if (curOrigin && curDest) {
        await checkTrafficNow(true);
      }
      return true;
    } else {
      Toast.error('Error al guardar en la base de datos.', { title: 'No se pudo guardar' });
      return false;
    }
  } catch (err) {
    console.error('Error guardando configuración:', err);
    Toast.error('Error de conexión al guardar los cambios.', { title: 'Sin conexión' });
    return false;
  }
}

async function confirmPinSelection() {
  if (!selectedPinData.lat || !selectedPinData.lng) {
    Toast.warning('Haz clic en el mapa para colocar el pin primero.', { title: 'Falta ubicación' });
    return;
  }

  const hadBothBefore = hasBothLocationsConfigured();
  const payload = {};
  if (currentPickerTarget === 'origin') {
    originCoords = { lat: selectedPinData.lat, lng: selectedPinData.lng };
    const input = document.getElementById('input-origin');
    if (selectedPinData.address) input.value = selectedPinData.address;
    renderCoordsPreview('origin');
    payload.origin = input.value;
    payload.originCoords = originCoords;
  } else {
    destinationCoords = { lat: selectedPinData.lat, lng: selectedPinData.lng };
    const input = document.getElementById('input-destination');
    if (selectedPinData.address) input.value = selectedPinData.address;
    renderCoordsPreview('destination');
    payload.destination = input.value;
    payload.destinationCoords = destinationCoords;
  }

  closeMapModal();

  const hasBothNow = hasBothLocationsConfigured();
  let toastOpts = { type: 'success', title: 'Ubicación actualizada', message: 'Ubicación guardada en tu cuenta.' };
  if (!hadBothBefore && hasBothNow) {
    isRouteEditorManuallyOpen = false;
    toastOpts = { type: 'success', title: 'Ruta configurada', message: 'Pulsa tu ruta abajo cuando quieras editarla.' };
  }
  renderRouteEditorVisibility();

  await saveConfigPartial(payload, toastOpts);
}

function renderCoordsPreview(target) {
  if (target === 'origin') {
    const preview = document.getElementById('origin-coords-preview');
    if (originCoords) {
      preview.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px; margin-right: 4px;">pin_drop</span> Coordenadas: ${originCoords.lat}, ${originCoords.lng}`;
      preview.style.display = 'inline-flex';
    } else {
      preview.style.display = 'none';
    }
  } else {
    const preview = document.getElementById('dest-coords-preview');
    if (destinationCoords) {
      preview.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px; margin-right: 4px;">pin_drop</span> Coordenadas: ${destinationCoords.lat}, ${destinationCoords.lng}`;
      preview.style.display = 'inline-flex';
    } else {
      preview.style.display = 'none';
    }
  }
}

// Textos descriptivos dinámicos estilo CodePen / Material 3
const BUFFER_HINTS = {
  5: 'Te avisará 5 minutos antes de la salida calculada. Ideal si estás listo y tu vehículo está en la puerta.',
  10: 'Te avisará 10 minutos antes de la salida calculada. Tiempo justo para tomar llaves, bajar y arrancar.',
  15: 'Te avisará 15 minutos antes de la salida calculada. Margen cómodo para empacar o buscar estacionamiento.',
  30: 'Te avisará 30 minutos antes de la salida calculada. Excelente si requieres preparativos adicionales.',
  60: 'Te avisará 1 hora antes de la salida calculada. Máxima antelación para rutinas largas de mañana.'
};

const WINDOW_HINTS = {
  5: 'El sistema revisará el tráfico en tiempo real 5 minutos antes de tu hora de salida estimada.',
  10: 'El sistema revisará el tráfico en tiempo real 10 minutos antes de tu hora de salida estimada.',
  15: 'Sondeo activo de Google Maps comenzando 15 minutos antes de la partida estimada.',
  30: 'Sondeo adaptativo inteligente vigilando el tráfico desde 30 minutos antes de salir.',
  60: 'Vigilancia continua y adaptativa desde 1 hora antes para detectar atascos tempranos.'
};

function setupSegmentedControl(containerId, hiddenInputId, badgeId, hintId, hintsMap, configFieldKey = null) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const hiddenInput = document.getElementById(hiddenInputId);
  const badge = document.getElementById(badgeId);
  const hintEl = document.getElementById(hintId);
  const buttons = container.querySelectorAll('.segmented-btn');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = Number(btn.getAttribute('data-value'));
      hiddenInput.value = val;
      if (badge) {
        badge.textContent = `${btn.textContent} antes`;
      }
      if (hintEl && hintsMap && hintsMap[val]) {
        hintEl.textContent = hintsMap[val];
      }
      if (configFieldKey && currentUser) {
        saveConfigPartial({ [configFieldKey]: val });
      }
    });
  });
}

function setSegmentedValue(containerId, hiddenInputId, badgeId, hintId, val, hintsMap) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const hiddenInput = document.getElementById(hiddenInputId);
  const badge = document.getElementById(badgeId);
  const hintEl = document.getElementById(hintId);
  const buttons = container.querySelectorAll('.segmented-btn');

  let numericVal = Number(val);
  const availableVals = Array.from(buttons).map(b => Number(b.getAttribute('data-value')));
  if (!availableVals.includes(numericVal)) {
    if (numericVal >= 60) numericVal = 60;
    else if (numericVal >= 30) numericVal = 30;
    else if (numericVal >= 15) numericVal = 15;
    else if (numericVal >= 10) numericVal = 10;
    else numericVal = 5;
  }

  hiddenInput.value = numericVal;
  buttons.forEach(btn => {
    if (Number(btn.getAttribute('data-value')) === numericVal) {
      btn.classList.add('active');
      if (badge) badge.textContent = `${btn.textContent} antes`;
      if (hintEl && hintsMap && hintsMap[numericVal]) {
        hintEl.textContent = hintsMap[numericVal];
      }
    } else {
      btn.classList.remove('active');
    }
  });
}

// --- 4. Cargar y Guardar Configuración Personal ---
async function loadConfig() {
  if (!currentUser) return;
  try {
    const resp = await fetch('/api/config', { cache: 'no-store' });
    if (!resp.ok) {
      if (resp.status === 401) {
        showAuthModal('login');
      }
      return;
    }
    currentConfig = await resp.json();

    document.getElementById('input-origin').value = currentConfig.origin || '';
    document.getElementById('input-destination').value = currentConfig.destination || '';
    document.getElementById('input-target-time').value = currentConfig.targetArrivalTime || '08:00';

    const savedBuffer = currentConfig.bufferMinutes !== undefined ? currentConfig.bufferMinutes : 10;
    const savedWindow = currentConfig.monitoringWindowMinutes || 30;
    setSegmentedValue('control-buffer', 'input-buffer', 'buffer-val-badge', 'buffer-hint-text', savedBuffer, BUFFER_HINTS);
    setSegmentedValue('control-window', 'input-window', 'window-val-badge', 'window-hint-text', savedWindow, WINDOW_HINTS);

    originCoords = currentConfig.originCoords || null;
    destinationCoords = currentConfig.destinationCoords || null;
    renderCoordsPreview('origin');
    renderCoordsPreview('destination');
    isRouteEditorManuallyOpen = false;
    renderRouteEditorVisibility();

    const badgeApi = document.getElementById('badge-api');
    const badgeApiText = document.getElementById('badge-api-text');
    if (badgeApi && badgeApiText) {
      badgeApi.className = 'badge';
      if (currentConfig.hasApiKey) {
        badgeApi.classList.add('badge-green');
        badgeApiText.textContent = 'Google Maps Satelital';
      } else {
        badgeApi.classList.add('badge-yellow');
        badgeApiText.textContent = 'Modo Simulación';
      }
    }

    document.getElementById('display-origin').textContent = currentConfig.origin || 'Sin configurar';
    document.getElementById('display-destination').textContent = currentConfig.destination || 'Sin configurar';
    document.getElementById('stat-arrival-target').textContent = formatTime12h(currentConfig.targetArrivalTime);
    document.getElementById('stat-buffer').textContent = `${currentConfig.bufferMinutes || 0} min`;
  } catch (err) {
    console.error('Error cargando configuración:', err);
  }
}

async function checkTrafficNow(force = false) {
  if (!currentUser) return;
  try {
    document.getElementById('hero-last-check').textContent = 'Consultando...';
    const resp = await fetch(`/api/traffic-check${force ? '?force=true' : ''}`);
    if (!resp.ok) {
      document.getElementById('hero-last-check').textContent = 'Sin datos';
      return;
    }
    const data = await resp.json();

    if (data.success && data.check) {
      lastCheckData = data.check;
      renderDashboard(data.check);
      document.getElementById('hero-last-check').textContent = `Actualizado ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
  } catch (err) {
    console.error('Error consultando tráfico:', err);
    document.getElementById('hero-last-check').textContent = 'Error al actualizar';
  }
}

function renderDashboard(check) {
  if (!check) return;

  const { trafficResult, schedule, statusMessage, pendingConfig, alreadyNotifiedToday } = check;

  const alertBox = document.getElementById('alert-status-box');
  const alertIcon = document.getElementById('alert-status-icon');
  const alertText = document.getElementById('alert-status-text');
  const bigTime = document.getElementById('big-departure-time');
  const countdownText = document.getElementById('countdown-text');
  const statTraffic = document.getElementById('stat-traffic-duration');

  if (pendingConfig) {
    alertBox.className = 'gmaps-alert-banner alert-waiting';
    alertIcon.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">settings</span>';
    alertText.textContent = statusMessage;
    bigTime.textContent = '--:--';
    countdownText.textContent = 'Configura tu ruta en el mapa arriba';
    return;
  }

  if (trafficResult) {
    statTraffic.textContent = trafficResult.durationText || `${trafficResult.durationMinutes} min`;
    document.getElementById('display-origin').textContent = trafficResult.origin || currentConfig?.origin;
    document.getElementById('display-destination').textContent = trafficResult.destination || currentConfig?.destination;

    const statDistance = document.getElementById('stat-distance');
    if (statDistance && trafficResult.distanceText) {
      statDistance.textContent = trafficResult.distanceText;
    }

    const trafficPill = document.getElementById('traffic-pill-tag');
    if (trafficPill) {
      if (trafficResult.isSimulation) {
        trafficPill.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px; margin-right: 4px; color: #e37400;">science</span> Modo Simulación';
        trafficPill.style.background = '#fef7e0';
        trafficPill.style.color = '#e37400';
      } else {
        trafficPill.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px; margin-right: 4px; color: #137333;">sensors</span> Tráfico en vivo';
        trafficPill.style.background = '#e6f4ea';
        trafficPill.style.color = '#137333';
      }
    }
  }

  if (!schedule) {
    alertBox.className = 'gmaps-alert-banner alert-normal';
    alertIcon.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">info</span>';
    alertText.textContent = statusMessage || 'Esperando inicio del monitoreo';
    bigTime.style.color = 'var(--gmaps-blue)';
    return;
  }

  bigTime.textContent = schedule.departureTimeFormatted || '--:--';

  const formatMinutes = (mins) => {
    if (mins < 60) return `${mins} minutos`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  // Si la alerta de hoy ya fue entregada y todavía no pasa la hora objetivo -> Banner Verde (Success)
  if (alreadyNotifiedToday && !schedule.isForTomorrow) {
    alertBox.className = 'gmaps-alert-banner alert-normal';
    alertIcon.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; color: var(--gmaps-green);">check_circle</span>';
    alertText.textContent = 'Alerta de hoy ya entregada. ¡Buen viaje!';
    bigTime.style.color = 'var(--gmaps-green)';
    countdownText.textContent = 'Alarma matutina completada por hoy.';
    countdownText.style.color = 'var(--gmaps-green-dark)';
    return;
  }

  if (schedule.mustLeaveNow) {
    alertBox.className = 'gmaps-alert-banner alert-urgent';
    alertIcon.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; color: var(--gmaps-red);">notification_important</span>';
    alertText.textContent = `¡DEBES SALIR YA! Tráfico pesado detectado.`;
    bigTime.style.color = 'var(--gmaps-red)';
    countdownText.textContent = `¡Sal de inmediato para llegar a tiempo!`;
    countdownText.style.color = 'var(--gmaps-red)';
    return;
  }

  // Si ya pasó la hora objetivo de hoy -> Banner Azul (Info) descansando hasta mañana
  if (schedule.isForTomorrow) {
    alertBox.className = 'gmaps-alert-banner alert-completed';
    alertIcon.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; color: var(--gmaps-blue);">bedtime</span>';
    alertText.textContent = statusMessage;
    bigTime.style.color = 'var(--gmaps-blue)';
    countdownText.textContent = `Próximo monitoreo mañana temprano.`;
    countdownText.style.color = 'var(--gmaps-text-secondary)';
    return;
  }

  if (schedule.inWindow) {
    alertBox.className = 'gmaps-alert-banner alert-normal';
    alertIcon.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; color: var(--gmaps-green);">check_circle</span>';
    alertText.textContent = `Monitoreo matutino activo. Tráfico actual: ${trafficResult.durationText}.`;
    bigTime.style.color = 'var(--gmaps-green)';
    countdownText.textContent = `Te quedan aproximadamente ${formatMinutes(schedule.minutesUntilDeparture)} para salir.`;
    countdownText.style.color = 'var(--gmaps-green-dark)';
    return;
  }

  alertBox.className = 'gmaps-alert-banner alert-waiting';
  alertIcon.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">hourglass_empty</span>';
  alertText.textContent = `En espera. Tu salida de hoy está prevista para las ${schedule.departureTimeFormatted}.`;
  bigTime.style.color = 'var(--gmaps-orange)';
  countdownText.textContent = `Faltan ${formatMinutes(schedule.minutesUntilDeparture)} para la salida.`;
  countdownText.style.color = 'var(--gmaps-orange)';
}

async function triggerTestNotification() {
  if (!currentUser) {
    Toast.warning('Inicia sesión para probar las notificaciones.', { title: 'Sesión requerida' });
    showAuthModal('login');
    return;
  }

  try {
    Toast.info('Enviando notificación de prueba...', { title: 'Prueba de alarma', duration: 2500 });
    const resp = await fetch('/api/test-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '🚗 Prueba de Alerta de Tráfico',
        body: `¡Hola ${currentUser.name}! Las notificaciones push funcionan en tu dispositivo.`
      })
    });
    const result = await resp.json();
    if (result.sentTo > 0) {
      Toast.success(`Notificación enviada a ${result.sentTo} dispositivo(s).`, { title: 'Prueba enviada' });
    } else {
      Toast.warning('No hay dispositivos suscritos. Pulsa "Activar" arriba primero.', { title: 'Sin dispositivos' });
    }
  } catch (err) {
    Toast.error('Error al enviar la notificación de prueba.', { title: 'Error de envío' });
  }
}

async function handleConfigSubmit(e) {
  e.preventDefault();

  if (!currentUser) {
    Toast.warning('Inicia sesión primero para guardar tu configuración.', { title: 'Sesión requerida' });
    showAuthModal('login');
    return;
  }

  const form = e.target;
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  if (submitBtn) submitBtn.disabled = true;

  const origin = document.getElementById('input-origin').value;
  const destination = document.getElementById('input-destination').value;
  const targetArrivalTime = document.getElementById('input-target-time').value;
  const bufferMinutes = document.getElementById('input-buffer').value;
  const monitoringWindowMinutes = document.getElementById('input-window').value;

  const payload = {
    origin,
    destination,
    originCoords,
    destinationCoords,
    targetArrivalTime,
    bufferMinutes,
    monitoringWindowMinutes
  };

  try {
    const resp = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (resp.ok) {
      Toast.success('Tu horario y márgenes fueron actualizados correctamente.', {
        title: 'Configuración de rutina guardada'
      });
      await loadConfig();
      await checkTrafficNow();
      if (homeRedirectTimer) clearTimeout(homeRedirectTimer);
      homeRedirectTimer = setTimeout(() => {
        homeRedirectTimer = null;
        switchView('home', false);
      }, 650);
    } else {
      Toast.error('No se pudo guardar la configuración.', { title: 'Error al guardar' });
    }
  } catch (err) {
    Toast.error('Error de conexión al guardar.', { title: 'Sin conexión' });
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function resetTodayState() {
  if (!currentUser) return;
  try {
    const resp = await fetch('/api/reset-today', { method: 'POST' });
    const data = await resp.json();
    Toast.info(data.message, { title: 'Alerta reiniciada' });
    await checkTrafficNow();
  } catch (e) {
    Toast.error('Error al reiniciar la alerta diaria.', { title: 'Error' });
  }
}

// --- 6. Menú Móvil Inferior (Bottom Navigation Bar) ---
function switchView(target, cancelPendingRedirect = true) {
  if (cancelPendingRedirect && homeRedirectTimer) {
    clearTimeout(homeRedirectTimer);
    homeRedirectTimer = null;
  }

  const tabHome = document.getElementById('tab-nav-home');
  const tabSettings = document.getElementById('tab-nav-settings');
  const viewHome = document.getElementById('view-home');
  const viewSettings = document.getElementById('view-settings');
  if (!tabHome || !tabSettings || !viewHome || !viewSettings) return;

  if (target === 'home') {
    viewHome.style.display = 'flex';
    viewSettings.style.display = 'none';
    tabHome.classList.add('active');
    tabHome.setAttribute('aria-current', 'page');
    tabSettings.classList.remove('active');
    tabSettings.removeAttribute('aria-current');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    viewHome.style.display = 'none';
    viewSettings.style.display = 'flex';
    tabSettings.classList.add('active');
    tabSettings.setAttribute('aria-current', 'page');
    tabHome.classList.remove('active');
    tabHome.removeAttribute('aria-current');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function initBottomNav() {
  const tabHome = document.getElementById('tab-nav-home');
  const tabSettings = document.getElementById('tab-nav-settings');
  const btnQuickRefresh = document.getElementById('btn-quick-refresh');

  if (tabHome && tabSettings) {
    tabHome.addEventListener('click', () => switchView('home'));
    tabSettings.addEventListener('click', () => switchView('settings'));
  }

  if (btnQuickRefresh) {
    btnQuickRefresh.addEventListener('click', async () => {
      switchView('home');
      btnQuickRefresh.classList.add('spinning');
      Toast.info('Calculando tiempo y tráfico actual...', { title: 'Actualizando tráfico', duration: 2500 });
      try {
        await checkTrafficNow(true);
      } finally {
        setTimeout(() => {
          btnQuickRefresh.classList.remove('spinning');
        }, 600);
      }
    });
  }
}

// --- 5. Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
  initBottomNav();
  await refreshPwaInstallStatus();
  if (window.matchMedia) {
    const standaloneMq = window.matchMedia('(display-mode: standalone)');
    if (standaloneMq.addEventListener) {
      standaloneMq.addEventListener('change', refreshPwaInstallStatus);
    }
  }
  await initServiceWorker();
  await checkAuthStatus();

  // Botones de Autenticación y Dropdown Avatar estilo Google Maps
  const btnUserAvatar = document.getElementById('btn-user-avatar');
  const userDropdown = document.getElementById('user-dropdown');

  if (btnUserAvatar && userDropdown) {
    btnUserAvatar.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = userDropdown.style.display === 'flex';
      userDropdown.style.display = isVisible ? 'none' : 'flex';
    });

    document.addEventListener('click', (e) => {
      if (!userDropdown.contains(e.target) && e.target !== btnUserAvatar) {
        userDropdown.style.display = 'none';
      }
    });
  }

  document.getElementById('btn-open-login').addEventListener('click', () => showAuthModal('login'));
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
  document.getElementById('btn-close-auth-modal').addEventListener('click', closeAuthModal);

  document.getElementById('tab-login').addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tab-register').addEventListener('click', () => switchAuthTab('register'));
  document.getElementById('link-to-register').addEventListener('click', (e) => { e.preventDefault(); switchAuthTab('register'); });
  document.getElementById('link-to-login').addEventListener('click', (e) => { e.preventDefault(); switchAuthTab('login'); });

  document.getElementById('form-login').addEventListener('submit', handleLoginSubmit);
  document.getElementById('form-register').addEventListener('submit', handleRegisterSubmit);

  // Cerrar modal al hacer clic en fondo oscuro
  document.getElementById('auth-modal').addEventListener('click', (e) => {
    if (e.target.id === 'auth-modal') {
      closeAuthModal();
    }
  });

  // Botón activar push
  document.getElementById('btn-enable-push').addEventListener('click', subscribeUserToPush);

  // Botón y modal de instalación PWA
  const btnInstallPwa = document.getElementById('btn-install-pwa');
  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', handlePwaInstallClick);
  }
  const btnCloseIosModal = document.getElementById('btn-close-ios-modal');
  if (btnCloseIosModal) {
    btnCloseIosModal.addEventListener('click', closePwaGuideModal);
  }
  const btnOkIosModal = document.getElementById('btn-ok-ios-modal');
  if (btnOkIosModal) {
    btnOkIosModal.addEventListener('click', closePwaGuideModal);
  }
  const pwaIosModal = document.getElementById('pwa-ios-modal');
  if (pwaIosModal) {
    pwaIosModal.addEventListener('click', (e) => {
      if (e.target.id === 'pwa-ios-modal') {
        closePwaGuideModal();
      }
    });
  }

  // Botón probar notificación
  document.getElementById('btn-test-notification').addEventListener('click', triggerTestNotification);

  // Botón refrescar ahora (fuerza consulta en vivo)
  document.getElementById('btn-refresh-now').addEventListener('click', () => checkTrafficNow(true));

  // Botón invertir ruta (Swap estilo Google Maps)
  const btnSwap = document.getElementById('btn-swap-route');
  if (btnSwap) {
    btnSwap.addEventListener('click', async () => {
      const inputOrigin = document.getElementById('input-origin');
      const inputDest = document.getElementById('input-destination');

      const tempVal = inputOrigin.value;
      inputOrigin.value = inputDest.value;
      inputDest.value = tempVal;

      const tempCoords = originCoords;
      originCoords = destinationCoords;
      destinationCoords = tempCoords;

      renderCoordsPreview('origin');
      renderCoordsPreview('destination');

      await saveConfigPartial({
        origin: inputOrigin.value,
        destination: inputDest.value,
        originCoords,
        destinationCoords
      }, {
        type: 'success',
        title: 'Ruta invertida',
        message: 'Origen y destino actualizados en tu cuenta.'
      });
    });
  }

  // Autoguardado inmediato en base de datos al editar campos manualmente
  document.getElementById('input-origin').addEventListener('change', (e) => {
    saveConfigPartial({ origin: e.target.value }, {
      type: 'success',
      title: 'Origen guardado',
      message: 'Punto de partida actualizado.'
    });
  });
  document.getElementById('input-destination').addEventListener('change', (e) => {
    saveConfigPartial({ destination: e.target.value }, {
      type: 'success',
      title: 'Destino guardado',
      message: 'Dirección de destino actualizada.'
    });
  });
  document.getElementById('input-target-time').addEventListener('change', (e) => {
    saveConfigPartial({ targetArrivalTime: e.target.value }, {
      type: 'success',
      title: 'Horario guardado',
      message: 'Hora de llegada objetivo actualizada.'
    });
  });

  // Botón reset diario
  document.getElementById('btn-reset-today').addEventListener('click', resetTodayState);

  // Botones para abrir el selector de mapa
  document.getElementById('btn-pick-origin').addEventListener('click', () => openMapModal('origin'));
  document.getElementById('btn-pick-destination').addEventListener('click', () => openMapModal('destination'));

  // Acciones dentro del modal de mapa
  document.getElementById('btn-close-modal').addEventListener('click', closeMapModal);
  document.getElementById('btn-cancel-pin').addEventListener('click', closeMapModal);
  document.getElementById('btn-confirm-pin').addEventListener('click', confirmPinSelection);

  // Buscador del mapa
  const searchInput = document.getElementById('map-search-input');
  document.getElementById('btn-map-search').addEventListener('click', () => {
    searchPlaces(searchInput.value);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchPlaces(searchInput.value);
    }
  });

  // Botón GPS del mapa
  document.getElementById('btn-map-gps').addEventListener('click', () => {
    if (!navigator.geolocation) {
      Toast.warning('Tu navegador no soporta geolocalización GPS.', { title: 'GPS no disponible' });
      return;
    }
    Toast.info('Buscando señal GPS...', { title: 'Localizando', duration: 2500 });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        leafletMap.setView([latitude, longitude], 17);
        setPinOnMap(latitude, longitude);
        await reverseGeocode(latitude, longitude);
        Toast.success('Ubicación GPS encontrada en el mapa.', { title: 'Ubicación lista' });
      },
      (err) => {
        Toast.error('No se pudo obtener la ubicación GPS (permiso denegado o sin señal).', { title: 'Error de GPS' });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  // Cerrar modal mapa en fondo oscuro
  document.getElementById('map-modal').addEventListener('click', (e) => {
    if (e.target.id === 'map-modal') {
      closeMapModal();
    }
  });

  // Desplegar/ocultar editor de ruta desde la tarjeta inferior y atajos a Ajustes
  const routePreviewTrigger = document.getElementById('route-preview-trigger');
  if (routePreviewTrigger) {
    routePreviewTrigger.addEventListener('click', () => toggleRouteEditor());
  }

  const btnCollapseRoute = document.getElementById('btn-collapse-route');
  if (btnCollapseRoute) {
    btnCollapseRoute.addEventListener('click', () => toggleRouteEditor(false));
  }

  const chipTargetTime = document.getElementById('chip-target-time');
  if (chipTargetTime) {
    chipTargetTime.addEventListener('click', () => switchView('settings'));
  }

  const chipBuffer = document.getElementById('chip-buffer');
  if (chipBuffer) {
    chipBuffer.addEventListener('click', () => switchView('settings'));
  }

  // Selectores de Barra Horizontal (Segmented Controls estilo CodePen / Material 3)
  setupSegmentedControl('control-buffer', 'input-buffer', 'buffer-val-badge', 'buffer-hint-text', BUFFER_HINTS, 'bufferMinutes');
  setupSegmentedControl('control-window', 'input-window', 'window-val-badge', 'window-hint-text', WINDOW_HINTS, 'monitoringWindowMinutes');

  // Formulario configuración
  document.getElementById('config-form').addEventListener('submit', handleConfigSubmit);

  // Chequeo periódico cada 30 segundos
  setInterval(() => {
    checkTrafficNow();
  }, 30 * 1000);
});
