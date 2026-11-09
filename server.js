const express = require('express');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');

// --- 1. Inicializar VAPID Keys ---
function getOrGenerateVapidKeys() {
  if (fs.existsSync(VAPID_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
    } catch (e) {
      console.error('Error leyendo vapid.json, regenerando...', e);
    }
  }
  const vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2), 'utf8');
  console.log('✅ Claves VAPID generadas exitosamente.');
  return vapidKeys;
}

const vapidKeys = getOrGenerateVapidKeys();
webpush.setVapidDetails(
  'mailto:soporte@alerta-trafico.local',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// --- 2. Gestión de Configuración ---
const defaultConfig = {
  origin: 'Mi Casa',
  destination: 'Mi Trabajo',
  originCoords: null,          // { lat: number, lng: number }
  destinationCoords: null,     // { lat: number, lng: number }
  targetArrivalTime: '08:00', // Formato HH:mm
  bufferMinutes: 10,           // Margen para subir al carro / estacionar
  monitoringWindowMinutes: 90, // Monitorear desde 90 min antes
  googleMapsApiKey: '',        // Si está vacía, opera en modo simulación
  enabled: true,
  lastNotificationDate: null,
  lastCheck: null
};

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf8');
    return { ...defaultConfig };
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Error al leer config.json:', err);
    return { ...defaultConfig };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// --- 3. Gestión de Suscripciones Push ---
function readSubscriptions() {
  if (!fs.existsSync(SUBS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveSubscriptions(subs) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), 'utf8');
}

// --- 4. Servicio de Consulta de Tráfico y Caché Inteligente ---
let trafficCache = {
  timestamp: 0,
  key: '',
  data: null
};

async function fetchCommuteTraffic(origin, destination, apiKey, originCoords = null, destinationCoords = null, forceRefresh = false) {
  const originParam = originCoords ? `${originCoords.lat},${originCoords.lng}` : origin;
  const destParam = destinationCoords ? `${destinationCoords.lat},${destinationCoords.lng}` : destination;
  const cacheKey = `${originParam}->${destParam}`;

  const now = Date.now();
  // Caché en memoria de 2 minutos para evitar consultas duplicadas si se refresca la UI
  if (!forceRefresh && trafficCache.key === cacheKey && (now - trafficCache.timestamp) < 2 * 60 * 1000) {
    return { ...trafficCache.data, fromCache: true };
  }

  // Si no hay API key o se solicita simulación:
  if (!apiKey || apiKey.trim() === '') {
    const randomVariation = Math.floor(Math.random() * 9) - 4; // -4 a +4 minutos
    const durationMinutes = Math.max(15, 38 + randomVariation);
    const durationSeconds = durationMinutes * 60;
    const simResult = {
      success: true,
      isSimulation: true,
      origin: origin || 'Ubicación Origen',
      destination: destination || 'Ubicación Destino',
      originCoords,
      destinationCoords,
      durationMinutes,
      durationSeconds,
      durationText: `${durationMinutes} min`,
      distanceText: '18.5 km',
      trafficSummary: 'Tráfico moderado (Simulado - Pendiente configurar Google Maps API Key)'
    };
    trafficCache = { timestamp: now, key: cacheKey, data: simResult };
    return simResult;
  }

  // Intentar primero con la moderna Google Routes API (computeRoutes) con tráfico en tiempo real
  try {
    const routesUrl = 'https://routes.googleapis.com/directions/v2:computeRoutes';
    
    // Preparar el cuerpo según si tenemos coordenadas exactas o nombres de dirección
    const originPayload = originCoords 
      ? { location: { latLng: { latitude: originCoords.lat, longitude: originCoords.lng } } }
      : { address: origin };
      
    const destinationPayload = destinationCoords 
      ? { location: { latLng: { latitude: destinationCoords.lat, longitude: destinationCoords.lng } } }
      : { address: destination };

    console.log(`🌐 [Google Routes API] Consultando tráfico en vivo: ${originParam} ➔ ${destParam}`);
    
    const routesResp = await fetch(routesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey.trim(),
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.localizedValues,routes.description'
      },
      body: JSON.stringify({
        origin: originPayload,
        destination: destinationPayload,
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE'
      })
    });

    const routesData = await routesResp.json();

    if (routesResp.ok && routesData.routes && routesData.routes.length > 0) {
      const route = routesData.routes[0];
      // El formato de duration en Routes API suele ser "1845s"
      const durationSeconds = route.duration ? parseInt(route.duration.replace('s', ''), 10) : 1800;
      const durationMinutes = Math.ceil(durationSeconds / 60);
      const distanceKm = route.distanceMeters ? (route.distanceMeters / 1000).toFixed(1) + ' km' : 'Desconocida';
      const durationText = route.localizedValues?.duration?.text || `${durationMinutes} min`;

      const liveResult = {
        success: true,
        isSimulation: false,
        origin,
        destination,
        originCoords,
        destinationCoords,
        durationMinutes,
        durationSeconds,
        durationText,
        distanceText: route.localizedValues?.distance?.text || distanceKm,
        trafficSummary: 'Tráfico en vivo (Google Routes API)'
      };

      trafficCache = { timestamp: now, key: cacheKey, data: liveResult };
      return liveResult;
    } else {
      console.log(`ℹ️ [Google Routes API no disponible o error: ${routesData.error?.message || 'status ' + routesResp.status}]. Probando Distance Matrix fallback...`);
    }
  } catch (errRoutes) {
    console.warn('⚠️ Error al consultar Routes API, intentando Distance Matrix API:', errRoutes.message);
  }

  // Fallback a Google Maps Distance Matrix API
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', originParam);
    url.searchParams.set('destinations', destParam);
    url.searchParams.set('departure_time', 'now');
    url.searchParams.set('traffic_model', 'best_guess');
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('key', apiKey.trim());

    console.log(`🌐 [Google Maps Distance Matrix] Consulta de tráfico de respaldo: ${originParam} ➔ ${destParam}`);
    const resp = await fetch(url.toString());
    const data = await resp.json();

    if (data.status !== 'OK') {
      return {
        success: false,
        isSimulation: false,
        error: `Error de Google Maps: ${data.status} - ${data.error_message || ''}`
      };
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') {
      return {
        success: false,
        isSimulation: false,
        error: `No se encontró ruta válida: ${element?.status || 'SIN_ELEMENTO'}`
      };
    }

    const durationObj = element.duration_in_traffic || element.duration;
    const durationSeconds = durationObj.value;
    const durationMinutes = Math.ceil(durationSeconds / 60);

    const liveResult = {
      success: true,
      isSimulation: false,
      origin: data.origin_addresses?.[0] || origin,
      destination: data.destination_addresses?.[0] || destination,
      originCoords,
      destinationCoords,
      durationMinutes,
      durationSeconds,
      durationText: durationObj.text,
      distanceText: element.distance?.text || 'Desconocida',
      trafficSummary: element.duration_in_traffic ? 'Tráfico en vivo (Google Maps)' : 'Estimación estándar'
    };

    trafficCache = { timestamp: now, key: cacheKey, data: liveResult };
    return liveResult;
  } catch (err) {
    return {
      success: false,
      isSimulation: false,
      error: `Error de conexión con Google Maps: ${err.message}`
    };
  }
}

// --- 5. Envío de Notificaciones Web Push ---
async function broadcastPush(payload) {
  const subscriptions = readSubscriptions();
  if (subscriptions.length === 0) {
    console.log('⚠️ No hay dispositivos suscritos a Web Push para enviar la alerta.');
    return { sent: 0, total: 0 };
  }

  let sent = 0;
  const activeSubs = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent++;
      activeSubs.push(sub);
    } catch (err) {
      console.error(`Error enviando push (Status: ${err.statusCode}):`, err.message);
      // Si el código es 410 (Gone) o 404 (Not Found), la suscripción caducó y la descartamos
      if (err.statusCode !== 410 && err.statusCode !== 404) {
        activeSubs.push(sub);
      }
    }
  }

  saveSubscriptions(activeSubs);
  return { sent, total: subscriptions.length };
}

// --- 6. Motor de Chequeo y Salida Dinámica ---
function getNextTripSchedule(targetArrivalTimeStr, bufferMinutes, durationMinutes, windowMinutes) {
  const now = new Date();
  const [targetH, targetM] = targetArrivalTimeStr.split(':').map(Number);
  
  // Hora de llegada calculada para hoy
  let targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetH, targetM, 0, 0);
  let isForTomorrow = false;

  // Si la hora de llegada de hoy ya pasó (o estamos a menos de 5 minutos de que pase), 
  // el próximo viaje objetivo es MAÑANA a la misma hora
  if (now.getTime() >= targetDate.getTime()) {
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, targetH, targetM, 0, 0);
    isForTomorrow = true;
  }

  const totalTripMinutes = durationMinutes + bufferMinutes;
  const departureDate = new Date(targetDate.getTime() - totalTripMinutes * 60 * 1000);

  const msUntilArrival = targetDate.getTime() - now.getTime();
  const minutesUntilArrival = Math.round(msUntilArrival / (1000 * 60));

  const msUntilDeparture = departureDate.getTime() - now.getTime();
  const minutesUntilDeparture = Math.round(msUntilDeparture / (1000 * 60));

  // Ventana de monitoreo: por ejemplo, desde 90 min antes de la llegada
  const inWindow = minutesUntilArrival > 0 && minutesUntilArrival <= windowMinutes;

  // Solo debe salir ya si estamos en la ventana activa de salida Y ya se cumplió la hora de partir
  const mustLeaveNow = inWindow && minutesUntilDeparture <= 0;

  return {
    targetDate,
    departureDate,
    isForTomorrow,
    minutesUntilArrival,
    minutesUntilDeparture,
    inWindow,
    mustLeaveNow,
    departureTimeFormatted: departureDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    targetTimeFormatted: targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
}

// Variable para rastrear la última vez que el servidor consultó formalmente la API
let lastApiQueryTimestamp = 0;

async function evaluateCommuteCheck(forceQuery = false) {
  const config = readConfig();
  if (!config.enabled) return null;

  // Si no ha configurado origen o destino, avisar estado pendiente
  if (!config.origin || !config.destination) {
    config.lastCheck = {
      timestamp: new Date().toISOString(),
      pendingConfig: true,
      statusMessage: 'Configura tu punto de partida y llegada para comenzar.'
    };
    saveConfig(config);
    return config.lastCheck;
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const buffer = config.bufferMinutes || 0;
  const windowMinutes = config.monitoringWindowMinutes || 90;

  // Estimación previa para calcular si estamos en la ventana sin gastar API
  const baselineDuration = trafficCache.data?.durationMinutes || 35;
  const tentativeSchedule = getNextTripSchedule(config.targetArrivalTime, buffer, baselineDuration, windowMinutes);

  // REGLA 1 DE AHORRO: Si el viaje es para mañana o ya pasó, CERO consultas a la API de Google
  const isOutsideWindow = tentativeSchedule.isForTomorrow || !tentativeSchedule.inWindow;
  
  // REGLA 2 DE AHORRO: Si ya te avisó hoy ("Sal ya"), se apagan las consultas por el resto del día
  const alreadyNotifiedToday = config.lastNotificationDate === todayStr;

  let shouldQueryApi = false;

  if (forceQuery) {
    shouldQueryApi = true;
  } else if (!isOutsideWindow && !alreadyNotifiedToday) {
    // REGLA 3: SONDEO ADAPTATIVO (Adaptive Polling) en la mañana
    const minutesToDeparture = tentativeSchedule.minutesUntilDeparture;
    const msSinceLastQuery = Date.now() - lastApiQueryTimestamp;

    if (minutesToDeparture > 35) {
      // Fase Lejana: Solo 1 consulta cada 15 minutos
      shouldQueryApi = msSinceLastQuery >= 15 * 60 * 1000;
    } else if (minutesToDeparture > 15) {
      // Fase Intermedia: 1 consulta cada 5 minutos
      shouldQueryApi = msSinceLastQuery >= 5 * 60 * 1000;
    } else {
      // Fase Crítica (muy cerca de la salida): 1 consulta cada 2 minutos
      shouldQueryApi = msSinceLastQuery >= 2 * 60 * 1000;
    }
  }

  let trafficResult = null;

  if (shouldQueryApi) {
    trafficResult = await fetchCommuteTraffic(
      config.origin,
      config.destination,
      config.googleMapsApiKey,
      config.originCoords,
      config.destinationCoords,
      forceQuery
    );
    lastApiQueryTimestamp = Date.now();
  } else {
    // Si no es necesario consultar a Google, reutilizamos el último valor conocido
    trafficResult = trafficCache.data || {
      success: true,
      isSimulation: !Boolean(config.googleMapsApiKey),
      origin: config.origin,
      destination: config.destination,
      originCoords: config.originCoords,
      destinationCoords: config.destinationCoords,
      durationMinutes: baselineDuration,
      durationSeconds: baselineDuration * 60,
      durationText: `${baselineDuration} min`,
      distanceText: 'Calculando...',
      trafficSummary: 'Modo reposo (Consumo optimizado de API: 0 consultas)'
    };
  }

  const finalDuration = trafficResult.success ? trafficResult.durationMinutes : baselineDuration;
  const schedule = getNextTripSchedule(config.targetArrivalTime, buffer, finalDuration, windowMinutes);

  let statusMessage = '';
  if (!trafficResult.success) {
    statusMessage = trafficResult.error;
  } else if (alreadyNotifiedToday) {
    statusMessage = `✅ Alerta de hoy ya entregada. Descansando hasta mañana (0 consultas a Google).`;
  } else if (schedule.isForTomorrow) {
    statusMessage = `Jornada de hoy completada. Próxima salida programada para mañana a las ${schedule.departureTimeFormatted}.`;
  } else if (schedule.mustLeaveNow) {
    statusMessage = `¡DEBES SALIR YA! Tráfico: ${trafficResult.durationText}. Margen: ${buffer}m. Llegada meta: ${config.targetArrivalTime}.`;
  } else if (schedule.inWindow) {
    statusMessage = `Monitoreo matutino activo. Faltan ${schedule.minutesUntilDeparture} min para salir.`;
  } else {
    statusMessage = `En espera. Tu salida de hoy está programada para las ${schedule.departureTimeFormatted}.`;
  }

  // Disparar Web Push SOLO si:
  // 1. Debe salir ahora
  // 2. Es un viaje de HOY (no de mañana)
  // 3. No se ha enviado la notificación hoy
  if (schedule.mustLeaveNow && !schedule.isForTomorrow && !alreadyNotifiedToday) {
    console.log(`🚨 DISPARANDO ALERTA MATUTINA PUSH: ${statusMessage}`);
    await broadcastPush({
      title: '🚗 ¡Hora de salir hacia el trabajo!',
      body: `El tráfico hoy es de ${trafficResult.durationText} (+${buffer}m de margen). Sal ahora para llegar a las ${config.targetArrivalTime}.`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'commute-alert-today',
      url: '/'
    });

    config.lastNotificationDate = todayStr;
  }

  config.lastCheck = {
    timestamp: new Date().toISOString(),
    pendingConfig: false,
    trafficResult,
    schedule,
    statusMessage
  };
  saveConfig(config);

  return config.lastCheck;
}

// Bucle periódico cada 60 segundos
setInterval(async () => {
  try {
    await evaluateCommuteCheck();
  } catch (e) {
    console.error('Error en ciclo de evaluación periódica:', e);
  }
}, 60 * 1000);

// --- 7. Rutas API REST ---

// Obtener clave pública VAPID
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// Guardar suscripción Web Push
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Suscripción inválida' });
  }

  const subscriptions = readSubscriptions();
  const exists = subscriptions.some(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    subscriptions.push(subscription);
    saveSubscriptions(subscriptions);
    console.log('✅ Nuevo dispositivo registrado para Web Push.');
  }

  res.status(201).json({ success: true, count: subscriptions.length });
});

// Desuscribir
app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  let subscriptions = readSubscriptions();
  subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
  saveSubscriptions(subscriptions);
  res.json({ success: true, count: subscriptions.length });
});

// Enviar notificación de prueba inmediata
app.post('/api/test-notification', async (req, res) => {
  const { title, body } = req.body || {};
  const result = await broadcastPush({
    title: title || '🔔 Prueba de Notificación de Alerta de Tráfico',
    body: body || '¡Las notificaciones Web Push están funcionando perfectamente en tu dispositivo!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'test-notification',
    url: '/'
  });

  res.json({
    success: true,
    sentTo: result.sent,
    totalDevices: result.total
  });
});

// Leer configuración
app.get('/api/config', (req, res) => {
  const cfg = readConfig();
  // Ocultamos parte de la API key por seguridad visual
  const maskedKey = cfg.googleMapsApiKey 
    ? cfg.googleMapsApiKey.substring(0, 6) + '...' + cfg.googleMapsApiKey.slice(-4)
    : '';
  res.json({
    ...cfg,
    hasApiKey: Boolean(cfg.googleMapsApiKey && cfg.googleMapsApiKey.trim()),
    maskedApiKey: maskedKey
  });
});

// Actualizar configuración
app.post('/api/config', (req, res) => {
  const current = readConfig();
  const {
    origin,
    destination,
    originCoords,
    destinationCoords,
    targetArrivalTime,
    bufferMinutes,
    monitoringWindowMinutes,
    googleMapsApiKey,
    enabled
  } = req.body;

  if (origin !== undefined) current.origin = origin;
  if (destination !== undefined) current.destination = destination;
  if (originCoords !== undefined) current.originCoords = originCoords;
  if (destinationCoords !== undefined) current.destinationCoords = destinationCoords;
  if (targetArrivalTime !== undefined) current.targetArrivalTime = targetArrivalTime;
  if (bufferMinutes !== undefined) current.bufferMinutes = Number(bufferMinutes) || 0;
  if (monitoringWindowMinutes !== undefined) current.monitoringWindowMinutes = Number(monitoringWindowMinutes) || 60;
  if (enabled !== undefined) current.enabled = Boolean(enabled);
  if (googleMapsApiKey !== undefined) current.googleMapsApiKey = googleMapsApiKey.trim();

  saveConfig(current);
  res.json({ success: true, config: current });
});

// Consultar tráfico actual al instante
app.get('/api/traffic-check', async (req, res) => {
  const force = req.query.force === 'true';
  const check = await evaluateCommuteCheck(force);
  res.json({ success: true, check });
});

// Forzar reset de la notificación de hoy para probar de nuevo
app.post('/api/reset-today', (req, res) => {
  const cfg = readConfig();
  cfg.lastNotificationDate = null;
  saveConfig(cfg);
  res.json({ success: true, message: 'Estado diario reiniciado. Puedes volver a recibir la alerta de hoy.' });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Servidor Alerta Tráfico PWA iniciado en el puerto ${PORT}`);
  console.log(`🔗 Abre en tu navegador: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
