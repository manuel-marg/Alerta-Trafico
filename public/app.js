// Lógica del cliente PWA, Web Push y Mapa OpenStreetMap (Leaflet)

let swRegistration = null;
let currentConfig = null;
let lastCheckData = null;

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

// --- 1. Inicialización de Service Worker y Web Push ---
async function initServiceWorker() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    updatePushBadge('error', 'Push no soportado');
    document.getElementById('push-activation-card').style.display = 'none';
    return;
  }

  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    console.log('✅ Service Worker registrado con éxito:', swRegistration.scope);

    const subscription = await swRegistration.pushManager.getSubscription();
    if (subscription && Notification.permission === 'granted') {
      updatePushBadge('active', 'Push Activo');
      document.getElementById('push-activation-card').style.display = 'none';
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
    } else {
      updatePushBadge('pending', 'Push Inactivo');
      document.getElementById('push-activation-card').style.display = 'flex';
    }
  } catch (err) {
    console.error('Error registrando el Service Worker:', err);
    updatePushBadge('error', 'Error Push');
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
    showToast('🎉 ¡Notificaciones Push activadas con éxito!');
  } catch (err) {
    console.error('Error suscribiendo al usuario:', err);
    showToast('❌ Error activando las notificaciones');
  }
}

// --- 2. Leaflet & OpenStreetMap (Mapa Gratuito y Open Source) ---
function initLeafletMap() {
  if (leafletMap) return;

  // Centro por defecto
  const defaultLat = 10.4900;
  const defaultLng = -66.8600;

  leafletMap = L.map('map-container').setView([defaultLat, defaultLng], 13);

  // Tiles de OpenStreetMap (100% libre, sin API Keys ni tarjetas)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(leafletMap);

  // Al hacer clic en el mapa, mover o colocar el pin
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

// Obtener dirección legible gratis mediante OpenStreetMap Nominatim
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
      // Limpiar nombre corto (calle, barrio o nombre principal)
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

// Buscador de lugares en el mapa con Nominatim
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

// Abrir el modal de selección de mapa
function openMapModal(target) {
  currentPickerTarget = target;
  const modal = document.getElementById('map-modal');
  const title = document.getElementById('modal-map-title');
  const searchInput = document.getElementById('map-search-input');
  document.getElementById('map-search-results').style.display = 'none';
  searchInput.value = '';

  if (target === 'origin') {
    title.textContent = '🏠 Seleccionar Ubicación de Casa (Origen)';
  } else {
    title.textContent = '🏢 Seleccionar Ubicación del Trabajo (Destino)';
  }

  modal.style.display = 'flex';

  setTimeout(() => {
    initLeafletMap();
    leafletMap.invalidateSize();

    // Si ya tiene coordenadas previas, enfocar allí
    const existingCoords = target === 'origin' ? originCoords : destinationCoords;
    const existingText = document.getElementById(target === 'origin' ? 'input-origin' : 'input-destination').value;

    if (existingCoords && existingCoords.lat && existingCoords.lng) {
      leafletMap.setView([existingCoords.lat, existingCoords.lng], 16);
      setPinOnMap(existingCoords.lat, existingCoords.lng);
      selectedPinData.address = existingText || '';
      document.getElementById('pin-address-text').textContent = `📍 ${selectedPinData.address || 'Ubicación actual guardada'}`;
    } else if (navigator.geolocation) {
      // Intentar centrar en la ubicación del usuario si no tiene coords
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          leafletMap.setView([pos.coords.latitude, pos.coords.longitude], 14);
        },
        () => {},
        { timeout: 5000 }
      );
    }
  }, 120);
}

function closeMapModal() {
  document.getElementById('map-modal').style.display = 'none';
}

function confirmPinSelection() {
  if (!selectedPinData.lat || !selectedPinData.lng) {
    showToast('⚠️ Primero haz clic en el mapa para fijar un pin');
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
  showToast('📍 Ubicación fijada en el mapa con éxito');
}

function renderCoordsPreview(target) {
  if (target === 'origin') {
    const preview = document.getElementById('origin-coords-preview');
    if (originCoords) {
      preview.textContent = `📍 Coordenadas fijadas: ${originCoords.lat}, ${originCoords.lng}`;
      preview.style.display = 'inline-flex';
    } else {
      preview.style.display = 'none';
    }
  } else {
    const preview = document.getElementById('dest-coords-preview');
    if (destinationCoords) {
      preview.textContent = `📍 Coordenadas fijadas: ${destinationCoords.lat}, ${destinationCoords.lng}`;
      preview.style.display = 'inline-flex';
    } else {
      preview.style.display = 'none';
    }
  }
}

// --- 3. Cargar y Guardar Configuración ---
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
  try {
    document.getElementById('hero-last-check').textContent = 'Consultando...';
    const resp = await fetch(`/api/traffic-check${force ? '?force=true' : ''}`);
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
  const alertBox = document.getElementById('alert-status-box');
  const alertIcon = document.getElementById('alert-status-icon');
  const alertText = document.getElementById('alert-status-text');
  const departureDisplay = document.getElementById('big-departure-time');
  const countdownText = document.getElementById('countdown-text');
  const statTraffic = document.getElementById('stat-traffic-duration');

  if (!check) return;

  if (check.pendingConfig) {
    alertBox.className = 'alert-banner alert-waiting';
    alertIcon.textContent = '⚙️';
    alertText.textContent = 'Faltan datos de origen o destino. Configura tus ubicaciones abajo.';
    departureDisplay.textContent = '--:--';
    countdownText.textContent = 'Pendiente configurar ruta';
    statTraffic.textContent = '-- min';
    return;
  }

  const { trafficResult, schedule } = check;

  if (!trafficResult || !trafficResult.success) {
    alertBox.className = 'alert-banner alert-leave-now';
    alertIcon.textContent = '⚠️';
    alertText.textContent = trafficResult?.error || 'No se pudo obtener información del tráfico.';
    departureDisplay.textContent = '--:--';
    return;
  }

  statTraffic.textContent = trafficResult.durationText;

  if (!schedule) return;

  departureDisplay.textContent = schedule.departureTimeFormatted;

  function formatMinutes(min) {
    if (min < 60) return `${min} minutos`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h} hora${h > 1 ? 's' : ''} y ${m} min`;
  }

  // CASO 1: Ya pasó la hora de llegada de hoy -> El próximo viaje es MAÑANA
  if (schedule.isForTomorrow) {
    alertBox.className = 'alert-banner alert-night';
    alertIcon.textContent = '🌙';
    alertText.textContent = `Jornada de hoy completada. Próxima llegada meta: Mañana a las ${currentConfig?.targetArrivalTime || '08:00'}.`;
    countdownText.textContent = `Próxima salida mañana a las ${schedule.departureTimeFormatted} (faltan ${formatMinutes(schedule.minutesUntilDeparture)}).`;
    countdownText.style.color = '#93c5fd';
    return;
  }

  // CASO 2: Es hoy y ya es hora crítica de salir
  if (schedule.mustLeaveNow) {
    alertBox.className = 'alert-banner alert-leave-now';
    alertIcon.textContent = '🚨';
    alertText.textContent = `¡DEBES SALIR YA! El tráfico actual es de ${trafficResult.durationText}.`;
    countdownText.textContent = '⚠️ Ya estás en la ventana crítica de salida para llegar puntual.';
    countdownText.style.color = '#fca5a5';
    return;
  }

  // CASO 3: Es hoy y estamos en la ventana de monitoreo matutino
  if (schedule.inWindow) {
    alertBox.className = 'alert-banner alert-normal';
    alertIcon.textContent = '🟢';
    alertText.textContent = `Monitoreo matutino activo. Tráfico actual: ${trafficResult.durationText}.`;
    countdownText.textContent = `Te quedan aproximadamente ${formatMinutes(schedule.minutesUntilDeparture)} para salir.`;
    countdownText.style.color = '#6ee7b7';
    return;
  }

  // CASO 4: Es hoy pero antes de la ventana de monitoreo
  alertBox.className = 'alert-banner alert-waiting';
  alertIcon.textContent = '⏳';
  alertText.textContent = `En espera. Tu salida de hoy está prevista para las ${schedule.departureTimeFormatted}.`;
  countdownText.textContent = `Faltan ${formatMinutes(schedule.minutesUntilDeparture)} para la salida.`;
  countdownText.style.color = '#fde68a';
}

async function triggerTestNotification() {
  try {
    showToast('Enviando notificación de prueba...');
    const resp = await fetch('/api/test-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '🚗 Prueba de Alerta de Tráfico',
        body: '¡Esta es una notificación push de prueba! Tu navegador está listo para avisarte en la mañana.'
      })
    });
    const result = await resp.json();
    if (result.sentTo > 0) {
      showToast(`✅ Notificación enviada a ${result.sentTo} dispositivo(s)`);
    } else {
      showToast('⚠️ No hay dispositivos suscritos. Haz clic en "Activar Notificaciones" primero.');
    }
  } catch (err) {
    showToast('❌ Error al enviar la notificación de prueba');
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
      showToast('💾 Configuración guardada correctamente con tus ubicaciones');
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
  try {
    const resp = await fetch('/api/reset-today', { method: 'POST' });
    const data = await resp.json();
    showToast(`🔄 ${data.message}`);
    await checkTrafficNow();
  } catch (e) {
    showToast('Error al reiniciar');
  }
}

// --- 4. Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
  await initServiceWorker();
  await loadConfig();
  await checkTrafficNow();

  // Botón activar push
  document.getElementById('btn-enable-push').addEventListener('click', subscribeUserToPush);

  // Botón probar notificación
  document.getElementById('btn-test-notification').addEventListener('click', triggerTestNotification);

  // Botón refrescar ahora (fuerza consulta en vivo)
  document.getElementById('btn-refresh-now').addEventListener('click', () => checkTrafficNow(true));

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

  // Cerrar modal al hacer clic en el fondo oscuro
  document.getElementById('map-modal').addEventListener('click', (e) => {
    if (e.target.id === 'map-modal') {
      closeMapModal();
    }
  });

  // Formulario configuración
  document.getElementById('config-form').addEventListener('submit', handleConfigSubmit);

  // Desplegable de guía (si existe)
  const guideToggle = document.getElementById('guide-toggle');
  const guideContent = document.getElementById('guide-content');
  const guideChevron = document.getElementById('guide-chevron');

  if (guideToggle && guideContent && guideChevron) {
    guideToggle.addEventListener('click', () => {
      const isHidden = guideContent.style.display === 'none';
      guideContent.style.display = isHidden ? 'block' : 'none';
      guideChevron.textContent = isHidden ? '▲' : '▼';
    });
  }

  // Chequeo periódico cada 30 segundos en la vista abierta
  setInterval(() => {
    checkTrafficNow();
  }, 30 * 1000);
});
