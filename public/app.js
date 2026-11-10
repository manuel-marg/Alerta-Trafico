// ==============================================================
// Alerta-Tráfico: Framework7 PWA Client Logic
// Web Push, Google Routes API & OpenStreetMap (Leaflet)
// ==============================================================

// 1. Inicialización de Framework7
const app = new Framework7({
  el: '#app',
  name: 'Alerta-Tráfico',
  theme: 'auto', // Detecta automáticamente iOS en iPhone y MD en Android
  darkMode: true,
  touch: {
    tapHold: true,
    activeState: true
  }
});

let swRegistration = null;
let currentConfig = null;
let lastCheckData = null;

// Coordenadas guardadas
let originCoords = null;
let destinationCoords = null;

// Estado del mapa de selección de pin
let leafletMap = null;
let currentMarker = null;
let currentPickerTarget = 'origin'; // 'origin' o 'destination'
let selectedPinData = { lat: null, lng: null, address: '' };

// Estado del mapa de recorrido general (Tab 3)
let overviewMap = null;
let overviewRouteLayer = null;

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

// Mostrar Toast nativo de Framework7
function showToast(message) {
  app.toast.create({
    text: message,
    position: 'top',
    closeTimeout: 3500
  }).open();
}

// --- 2. Inicialización de Service Worker y Web Push ---
async function initServiceWorker() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    updatePushBadge('error', 'Push no soportado');
    const pushCard = document.getElementById('push-activation-card');
    if (pushCard) pushCard.style.display = 'none';
    return;
  }

  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    console.log('✅ Service Worker registrado con éxito:', swRegistration.scope);

    const subscription = await swRegistration.pushManager.getSubscription();
    const pushCard = document.getElementById('push-activation-card');

    if (subscription && Notification.permission === 'granted') {
      updatePushBadge('active', 'Push Activo');
      if (pushCard) pushCard.style.display = 'none';
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
    } else {
      updatePushBadge('pending', 'Push Inactivo');
      if (pushCard) pushCard.style.display = 'block';
    }
  } catch (err) {
    console.error('Error registrando el Service Worker:', err);
    updatePushBadge('error', 'Error Push');
  }
}

function updatePushBadge(status, label) {
  const badge = document.getElementById('badge-push');
  const text = document.getElementById('badge-push-text');
  if (!badge || !text) return;

  badge.className = 'status-pill';

  if (status === 'active') {
    badge.classList.add('status-green');
  } else if (status === 'pending') {
    badge.classList.add('status-yellow');
  } else {
    badge.classList.add('status-red');
  }
  text.textContent = label;
}

async function subscribeUserToPush() {
  if (!swRegistration) {
    showToast('❌ El Service Worker aún no está listo');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('⚠️ Permiso de notificaciones denegado en el navegador');
      updatePushBadge('error', 'Denegado');
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
    const pushCard = document.getElementById('push-activation-card');
    if (pushCard) pushCard.style.display = 'none';
    showToast('🎉 ¡Notificaciones Push activadas con éxito!');
  } catch (err) {
    console.error('Error suscribiendo al usuario:', err);
    showToast('❌ Error activando las notificaciones');
  }
}

// --- 3. Selector de Pin en Leaflet (Popup Modal) ---
function initLeafletMap() {
  if (leafletMap) return;

  const defaultLat = 10.4900;
  const defaultLng = -66.8600;

  leafletMap = L.map('leaflet-map-container', { zoomControl: false }).setView([defaultLat, defaultLng], 13);
  L.control.zoom({ position: 'topright' }).addTo(leafletMap);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
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
    const resp = await fetch(url, { headers: { 'Accept-Language': 'es' } });
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
      resultsContainer.innerHTML = '<div class="search-result-item" style="color: #94a3b8;">No se encontraron resultados. Prueba hacer zoom y tocar directo el mapa.</div>';
      return;
    }

    resultsContainer.innerHTML = '';
    items.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.textContent = item.display_name;
      div.addEventListener('click', async () => {
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        resultsContainer.style.display = 'none';
        leafletMap.setView([lat, lng], 16);
        setPinOnMap(lat, lng);
        selectedPinData.address = item.display_name.split(',').slice(0, 3).join(',').trim();
        document.getElementById('pin-address-text').textContent = `📍 ${selectedPinData.address}`;
      });
      resultsContainer.appendChild(div);
    });
  } catch (err) {
    resultsContainer.innerHTML = '<div class="search-result-item" style="color: #fb7185;">Error al buscar en el mapa</div>';
  }
}

function openMapModal(target) {
  currentPickerTarget = target;
  const title = document.getElementById('modal-map-title');
  const searchInput = document.getElementById('map-search-input');
  document.getElementById('map-search-results').style.display = 'none';
  searchInput.value = '';

  if (target === 'origin') {
    title.textContent = '🏠 Ubicación de Casa (Partida)';
  } else {
    title.textContent = '🏢 Ubicación del Trabajo (Llegada)';
  }

  app.popup.open('#map-picker-popup');

  setTimeout(() => {
    initLeafletMap();
    leafletMap.invalidateSize();

    const existingCoords = target === 'origin' ? originCoords : destinationCoords;
    const existingText = document.getElementById(target === 'origin' ? 'input-origin' : 'input-destination').value;

    if (existingCoords && existingCoords.lat && existingCoords.lng) {
      leafletMap.setView([existingCoords.lat, existingCoords.lng], 16);
      setPinOnMap(existingCoords.lat, existingCoords.lng);
      selectedPinData.address = existingText || '';
      document.getElementById('pin-address-text').textContent = `📍 ${selectedPinData.address || 'Ubicación fijada'}`;
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          leafletMap.setView([pos.coords.latitude, pos.coords.longitude], 14);
        },
        () => {},
        { timeout: 5000 }
      );
    }
  }, 250);
}

function closeMapModal() {
  app.popup.close('#map-picker-popup');
}

function confirmPinSelection() {
  if (!selectedPinData.lat || !selectedPinData.lng) {
    showToast('⚠️ Primero toca el mapa para fijar un pin');
    return;
  }

  if (currentPickerTarget === 'origin') {
    originCoords = { lat: selectedPinData.lat, lng: selectedPinData.lng };
    const input = document.getElementById('input-origin');
    if (selectedPinData.address) input.value = selectedPinData.address;
    renderCoordsPreview('origin');
  } else {
    destinationCoords = { lat: selectedPinData.lat, lng: selectedPinData.lng };
    const input = document.getElementById('input-destination');
    if (selectedPinData.address) input.value = selectedPinData.address;
    renderCoordsPreview('destination');
  }

  closeMapModal();
  showToast('📍 Ubicación fijada con éxito');
  updateOverviewMapMarkers();
}

function renderCoordsPreview(target) {
  if (target === 'origin') {
    const preview = document.getElementById('origin-coords-preview');
    if (originCoords) {
      preview.textContent = `📍 Coordenadas: ${originCoords.lat}, ${originCoords.lng}`;
      preview.style.display = 'inline-block';
    } else {
      preview.style.display = 'none';
    }
  } else {
    const preview = document.getElementById('dest-coords-preview');
    if (destinationCoords) {
      preview.textContent = `📍 Coordenadas: ${destinationCoords.lat}, ${destinationCoords.lng}`;
      preview.style.display = 'inline-block';
    } else {
      preview.style.display = 'none';
    }
  }
}

// --- 4. Visor de Ruta General (Tab 3) ---
function initOverviewMap() {
  if (overviewMap) {
    overviewMap.invalidateSize();
    updateOverviewMapMarkers();
    return;
  }

  const defaultLat = originCoords ? originCoords.lat : 10.4900;
  const defaultLng = originCoords ? originCoords.lng : -66.8600;

  overviewMap = L.map('route-overview-map', { zoomControl: false }).setView([defaultLat, defaultLng], 12);
  L.control.zoom({ position: 'topright' }).addTo(overviewMap);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(overviewMap);

  updateOverviewMapMarkers();
}

function updateOverviewMapMarkers() {
  if (!overviewMap) return;
  if (overviewRouteLayer) {
    overviewMap.removeLayer(overviewRouteLayer);
  }

  const group = L.featureGroup();

  if (originCoords && originCoords.lat) {
    L.marker([originCoords.lat, originCoords.lng])
      .bindPopup(`<b>🏠 Partida:</b><br>${currentConfig?.origin || 'Mi Casa'}`)
      .addTo(group);
  }

  if (destinationCoords && destinationCoords.lat) {
    L.marker([destinationCoords.lat, destinationCoords.lng])
      .bindPopup(`<b>🏢 Llegada:</b><br>${currentConfig?.destination || 'Mi Trabajo'}`)
      .addTo(group);
  }

  if (originCoords && destinationCoords) {
    L.polyline([
      [originCoords.lat, originCoords.lng],
      [destinationCoords.lat, destinationCoords.lng]
    ], {
      color: '#3b82f6',
      weight: 4,
      opacity: 0.85,
      dashArray: '8, 8'
    }).addTo(group);
  }

  group.addTo(overviewMap);
  overviewRouteLayer = group;

  if (originCoords && destinationCoords) {
    overviewMap.fitBounds(group.getBounds(), { padding: [50, 50] });
  }

  const summary = document.getElementById('map-route-summary-title');
  if (summary && currentConfig) {
    summary.textContent = `${currentConfig.origin?.split(',')[0] || 'Casa'} ➔ ${currentConfig.destination?.split(',')[0] || 'Trabajo'}`;
  }
}

// --- 5. Lógica del Dashboard y Estado de Tráfico ---
async function loadConfig() {
  try {
    const resp = await fetch('/api/config');
    currentConfig = await resp.json();

    document.getElementById('input-origin').value = currentConfig.origin || '';
    document.getElementById('input-destination').value = currentConfig.destination || '';
    document.getElementById('input-target-time').value = currentConfig.targetArrivalTime || '08:00';
    document.getElementById('input-buffer').value = currentConfig.bufferMinutes !== undefined ? currentConfig.bufferMinutes : 10;
    document.getElementById('input-window').value = currentConfig.monitoringWindowMinutes || 90;

    originCoords = currentConfig.originCoords || null;
    destinationCoords = currentConfig.destinationCoords || null;
    renderCoordsPreview('origin');
    renderCoordsPreview('destination');

    const badgeApi = document.getElementById('badge-api');
    const badgeApiText = document.getElementById('badge-api-text');
    if (badgeApi && badgeApiText) {
      badgeApi.className = 'status-pill';
      if (currentConfig.hasApiKey) {
        badgeApi.classList.add('status-green');
        badgeApiText.textContent = 'Google Maps';
      } else {
        badgeApi.classList.add('status-yellow');
        badgeApiText.textContent = 'Simulación';
      }
    }

    document.getElementById('display-origin').textContent = currentConfig.origin || 'Sin configurar';
    document.getElementById('display-destination').textContent = currentConfig.destination || 'Sin configurar';
    document.getElementById('stat-arrival-target').textContent = currentConfig.targetArrivalTime || '--:--';
    document.getElementById('stat-buffer').textContent = `${currentConfig.bufferMinutes || 0} min`;

    if (currentConfig.lastCheck) {
      renderDashboard(currentConfig.lastCheck);
    }
  } catch (err) {
    console.error('Error cargando configuración:', err);
  }
}

async function checkTrafficNow(force = false) {
  try {
    document.getElementById('hero-last-check').textContent = 'Consultando tráfico en vivo...';
    const resp = await fetch(`/api/traffic-check${force ? '?force=true' : ''}`);
    const data = await resp.json();

    if (data.success && data.check) {
      lastCheckData = data.check;
      renderDashboard(data.check);
      document.getElementById('hero-last-check').textContent = `Actualizado ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
  } catch (err) {
    console.error('Error consultando tráfico:', err);
    document.getElementById('hero-last-check').textContent = 'Error al actualizar';
  }
}

function renderDashboard(check) {
  const alertBox = document.getElementById('alert-status-box');
  const alertIcon = document.getElementById('alert-status-icon');
  const alertText = document.getElementById('alert-status-text');
  const departureDisplay = document.getElementById('big-departure-time');
  const countdownText = document.getElementById('countdown-text');
  const statTraffic = document.getElementById('stat-traffic-duration');
  const mapRouteDuration = document.getElementById('map-route-duration-badge');

  if (!check) return;

  if (check.pendingConfig) {
    alertBox.className = 'mobile-alert-banner alert-waiting';
    alertIcon.textContent = '⚙️';
    alertText.textContent = 'Faltan datos de origen o destino. Configura tu rutina en la pestaña Mi Rutina.';
    departureDisplay.textContent = '--:--';
    countdownText.textContent = 'Pendiente configurar ruta';
    statTraffic.textContent = '-- min';
    return;
  }

  const { trafficResult, schedule } = check;

  if (!trafficResult || !trafficResult.success) {
    alertBox.className = 'mobile-alert-banner alert-leave-now';
    alertIcon.textContent = '⚠️';
    alertText.textContent = trafficResult?.error || 'No se pudo obtener información del tráfico.';
    departureDisplay.textContent = '--:--';
    return;
  }

  statTraffic.textContent = trafficResult.durationText;
  if (mapRouteDuration) {
    mapRouteDuration.textContent = `${trafficResult.durationText} de viaje`;
  }

  if (!schedule) return;

  departureDisplay.textContent = schedule.departureTimeFormatted;

  function formatMinutes(min) {
    if (min < 60) return `${min} minutos`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h} h ${m} min`;
  }

  // CASO 1: Ya pasó la hora de llegada de hoy -> El próximo viaje es MAÑANA
  if (schedule.isForTomorrow) {
    alertBox.className = 'mobile-alert-banner alert-night';
    alertIcon.textContent = '🌙';
    alertText.textContent = `Jornada de hoy completada. Próxima llegada meta: Mañana a las ${currentConfig?.targetArrivalTime || '08:00'}.`;
    countdownText.textContent = `Próxima salida mañana a las ${schedule.departureTimeFormatted} (faltan ${formatMinutes(schedule.minutesUntilDeparture)})`;
    return;
  }

  // CASO 2: Es hoy y ya es hora crítica de salir
  if (schedule.mustLeaveNow) {
    alertBox.className = 'mobile-alert-banner alert-leave-now';
    alertIcon.textContent = '🚨';
    alertText.textContent = `¡DEBES SALIR YA! El tráfico actual es de ${trafficResult.durationText}.`;
    countdownText.textContent = '⚠️ Ventana crítica de salida activa para llegar puntual.';
    return;
  }

  // CASO 3: Es hoy y estamos en la ventana de monitoreo matutino
  if (schedule.inWindow) {
    alertBox.className = 'mobile-alert-banner alert-normal';
    alertIcon.textContent = '🟢';
    alertText.textContent = `Monitoreo matutino activo. Tráfico en vivo: ${trafficResult.durationText}.`;
    countdownText.textContent = `Te quedan aproximadamente ${formatMinutes(schedule.minutesUntilDeparture)} para salir.`;
    return;
  }

  // CASO 4: Es hoy pero antes de la ventana de monitoreo
  alertBox.className = 'mobile-alert-banner alert-waiting';
  alertIcon.textContent = '⏳';
  alertText.textContent = `En espera. Tu salida de hoy está prevista para las ${schedule.departureTimeFormatted}.`;
  countdownText.textContent = `Faltan ${formatMinutes(schedule.minutesUntilDeparture)} para la salida.`;
}

async function triggerTestNotification() {
  try {
    showToast('Enviando notificación push de prueba...');
    const resp = await fetch('/api/test-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '🚗 Prueba de Alerta de Tráfico',
        body: '¡Esta es una notificación push de prueba! Tu teléfono está listo para avisarte en la mañana.'
      })
    });
    const result = await resp.json();
    if (result.sentTo > 0) {
      showToast(`✅ Alerta enviada a ${result.sentTo} dispositivo(s)`);
    } else {
      showToast('⚠️ No hay dispositivos suscritos. Activa el Push primero.');
    }
  } catch (err) {
    showToast('❌ Error al enviar notificación');
  }
}

async function handleConfigSubmit(e) {
  e.preventDefault();

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
      showToast('💾 Rutina guardada exitosamente');
      await loadConfig();
      await checkTrafficNow(true);
      updateOverviewMapMarkers();
    } else {
      showToast('❌ Error al guardar rutina');
    }
  } catch (err) {
    showToast('❌ Error de conexión al guardar');
  }
}

async function resetTodayState(e) {
  if (e) e.preventDefault();
  try {
    const resp = await fetch('/api/reset-today', { method: 'POST' });
    const data = await resp.json();
    showToast(`🔄 ${data.message}`);
    await checkTrafficNow(true);
  } catch (e) {
    showToast('Error al reiniciar');
  }
}

// --- 6. Inicialización de Eventos ---
document.addEventListener('DOMContentLoaded', async () => {
  await initServiceWorker();
  await loadConfig();
  await checkTrafficNow();

  // Pull to refresh en la vista principal
  const ptr = app.ptr.create({
    el: '#alarm-ptr-content',
    on: {
      refresh: async (ptrEl, done) => {
        await checkTrafficNow(true);
        done();
        showToast('🔄 Tráfico en vivo actualizado');
      }
    }
  });

  // Botón activar push
  const btnPush = document.getElementById('btn-enable-push');
  if (btnPush) btnPush.addEventListener('click', subscribeUserToPush);

  // Botón probar notificación
  document.getElementById('btn-test-notification').addEventListener('click', triggerTestNotification);

  // Botón refrescar ahora
  document.getElementById('btn-refresh-now').addEventListener('click', () => checkTrafficNow(true));

  // Botón reset diario
  document.getElementById('btn-reset-today').addEventListener('click', resetTodayState);

  // Abrir selector de pin
  document.getElementById('btn-pick-origin').addEventListener('click', () => openMapModal('origin'));
  document.getElementById('btn-pick-destination').addEventListener('click', () => openMapModal('destination'));

  // Acciones en el modal de mapa
  document.getElementById('btn-close-modal').addEventListener('click', closeMapModal);
  document.getElementById('btn-cancel-pin').addEventListener('click', closeMapModal);
  document.getElementById('btn-confirm-pin').addEventListener('click', confirmPinSelection);

  // Buscador de mapa
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

  // Botón GPS en el mapa
  document.getElementById('btn-map-gps').addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Navegador sin soporte GPS');
      return;
    }
    showToast('Buscando GPS...');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        leafletMap.setView([latitude, longitude], 17);
        setPinOnMap(latitude, longitude);
        await reverseGeocode(latitude, longitude);
        showToast('📍 Ubicación encontrada');
      },
      () => {
        showToast('No se pudo obtener señal GPS');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  // Tab 3: Inicializar mapa general al hacer clic
  document.getElementById('tab-link-map').addEventListener('click', () => {
    setTimeout(() => {
      initOverviewMap();
    }, 250);
  });

  document.getElementById('btn-recenter-route').addEventListener('click', (e) => {
    e.preventDefault();
    updateOverviewMapMarkers();
  });

  // Formulario configuración
  document.getElementById('config-form').addEventListener('submit', handleConfigSubmit);

  // Chequeo periódico cada 30 segundos
  setInterval(() => {
    checkTrafficNow();
  }, 30 * 1000);
});
