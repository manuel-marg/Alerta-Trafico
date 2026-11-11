// Lógica del cliente PWA, Web Push, Multi-usuario y Mapa OpenStreetMap (Leaflet)

let swRegistration = null;
let currentConfig = null;
let lastCheckData = null;
let currentUser = null;

// Coordenadas guardadas
let originCoords = null;
let destinationCoords = null;

// Estado del modal de mapa
let leafletMap = null;
let currentMarker = null;
let currentPickerTarget = 'origin'; // 'origin' o 'destination'
let selectedPinData = { lat: null, lng: null, address: '' };

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

// Mostrar Toast
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.innerHTML = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
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

      const avatarInitial = document.getElementById('user-avatar-initial');
      if (avatarInitial) avatarInitial.textContent = initial;

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
      showToast(`👋 ¡Bienvenido, ${data.user.name}!`);
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
      showToast(`🎉 ¡Cuenta creada con éxito! Bienvenido, ${data.user.name}`);
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
    document.getElementById('input-origin').value = '';
    document.getElementById('input-destination').value = '';
    renderCoordsPreview('origin');
    renderCoordsPreview('destination');
    showToast('👋 Sesión cerrada correctamente');
    await checkAuthStatus();
  } catch (err) {
    showToast('Error al cerrar sesión');
  }
}

// --- 2. Inicialización de Service Worker y Web Push ---
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
    showToast('⚠️ Inicia sesión para activar las notificaciones en tu cuenta');
    showAuthModal('login');
    return;
  }

  if (!swRegistration) {
    showToast('❌ El Service Worker aún no está listo');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('⚠️ Permiso de notificaciones denegado en el navegador');
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
    showToast('🎉 ¡Notificaciones Push activadas para tu cuenta!');
  } catch (err) {
    console.error('Error suscribiendo al usuario:', err);
    showToast('❌ Error activando las notificaciones');
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
    if (targetCoords && targetCoords.lat && targetCoords.lng) {
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
    showToast('⚠️ Inicia sesión para guardar tu configuración en tu cuenta');
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
        document.getElementById('stat-arrival-target').textContent = payload.targetArrivalTime || '--:--';
      }
      if (payload.bufferMinutes !== undefined) {
        document.getElementById('stat-buffer').textContent = `${payload.bufferMinutes} min`;
      }

      if (customToastMsg) {
        showToast(customToastMsg);
      }

      // Recalcular ruta en vivo automáticamente cuando cambia origen, destino u horario
      const curOrigin = document.getElementById('input-origin').value;
      const curDest = document.getElementById('input-destination').value;
      if (curOrigin && curDest) {
        await checkTrafficNow(true);
      }
      return true;
    } else {
      showToast('❌ Error al guardar en la base de datos');
      return false;
    }
  } catch (err) {
    console.error('Error guardando configuración:', err);
    showToast('❌ Error de conexión al guardar');
    return false;
  }
}

async function confirmPinSelection() {
  if (!selectedPinData.lat || !selectedPinData.lng) {
    showToast('⚠️ Por favor haz clic en el mapa para colocar el pin primero');
    return;
  }

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
  await saveConfigPartial(payload, '💾 Ubicación guardada en tu cuenta');
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
    document.getElementById('stat-arrival-target').textContent = currentConfig.targetArrivalTime || '--:--';
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

  const { trafficResult, schedule, statusMessage, pendingConfig } = check;

  const alertBox = document.getElementById('alert-status-box');
  const alertIcon = document.getElementById('alert-status-icon');
  const alertText = document.getElementById('alert-status-text');
  const bigTime = document.getElementById('big-departure-time');
  const countdownText = document.getElementById('countdown-text');
  const statTraffic = document.getElementById('stat-traffic-duration');

  if (pendingConfig) {
    alertBox.className = 'alert-banner alert-waiting';
    alertIcon.textContent = '⚙️';
    alertText.textContent = statusMessage;
    bigTime.textContent = '--:--';
    countdownText.textContent = 'Configura tu ruta en el formulario abajo';
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

  if (schedule.mustLeaveNow) {
    alertBox.className = 'gmaps-alert-banner alert-urgent';
    alertIcon.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; color: var(--gmaps-red);">notification_important</span>';
    alertText.textContent = `¡DEBES SALIR YA! Tráfico pesado detectado.`;
    bigTime.style.color = 'var(--gmaps-red)';
    countdownText.textContent = `¡Sal de inmediato para llegar a tiempo!`;
    countdownText.style.color = 'var(--gmaps-red)';
    return;
  }

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
    showToast('⚠️ Inicia sesión para probar las notificaciones de tu cuenta');
    showAuthModal('login');
    return;
  }

  try {
    showToast('Enviando notificación de prueba...');
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
      showToast(`✅ Notificación enviada a ${result.sentTo} dispositivo(s)`);
    } else {
      showToast('⚠️ No hay dispositivos suscritos. Haz clic en "Activar" arriba primero.');
    }
  } catch (err) {
    showToast('❌ Error al enviar la notificación de prueba');
  }
}

async function handleConfigSubmit(e) {
  e.preventDefault();

  if (!currentUser) {
    showToast('⚠️ Por favor inicia sesión primero para guardar tu configuración');
    showAuthModal('login');
    return;
  }

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
      showToast('💾 Configuración guardada correctamente en tu cuenta');
      await loadConfig();
      await checkTrafficNow();
    } else {
      showToast('❌ Error al guardar la configuración');
    }
  } catch (err) {
    showToast('❌ Error de conexión al guardar');
  }
}

async function resetTodayState() {
  if (!currentUser) return;
  try {
    const resp = await fetch('/api/reset-today', { method: 'POST' });
    const data = await resp.json();
    showToast(`🔄 ${data.message}`);
    await checkTrafficNow();
  } catch (e) {
    showToast('Error al reiniciar');
  }
}

// --- 6. Menú Móvil Inferior (Bottom Navigation Bar) ---
function initBottomNav() {
  const tabHome = document.getElementById('tab-nav-home');
  const tabSettings = document.getElementById('tab-nav-settings');
  const viewHome = document.getElementById('view-home');
  const viewSettings = document.getElementById('view-settings');
  const btnQuickRefresh = document.getElementById('btn-quick-refresh');

  function switchView(target) {
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

  if (tabHome && tabSettings) {
    tabHome.addEventListener('click', () => switchView('home'));
    tabSettings.addEventListener('click', () => switchView('settings'));
  }

  if (btnQuickRefresh) {
    btnQuickRefresh.addEventListener('click', async () => {
      switchView('home');
      btnQuickRefresh.classList.add('spinning');
      showToast('🔄 Calculando tiempo y tráfico actual...');
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
      }, '⇅ Ruta invertida y guardada en tu cuenta');
    });
  }

  // Autoguardado inmediato en base de datos al editar campos manualmente
  document.getElementById('input-origin').addEventListener('change', (e) => {
    saveConfigPartial({ origin: e.target.value }, '💾 Punto de partida guardado');
  });
  document.getElementById('input-destination').addEventListener('change', (e) => {
    saveConfigPartial({ destination: e.target.value }, '💾 Destino guardado');
  });
  document.getElementById('input-target-time').addEventListener('change', (e) => {
    saveConfigPartial({ targetArrivalTime: e.target.value }, '💾 Hora de llegada guardada');
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
      showToast('Tu navegador no soporta geolocalización GPS');
      return;
    }
    showToast('Buscando señal GPS...');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        leafletMap.setView([latitude, longitude], 17);
        setPinOnMap(latitude, longitude);
        await reverseGeocode(latitude, longitude);
        showToast('📍 Ubicación GPS encontrada');
      },
      (err) => {
        showToast('No se pudo obtener la ubicación GPS (permiso denegado o sin señal)');
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
