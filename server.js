const express = require('express');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.get('/manifest.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), {
  maxAge: '30d',
  immutable: true
}));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PUSH_ICON_URL = '/icons/android-chrome-192x192.png';

// Clave maestra global de Google Maps API (compartida para todos los usuarios registrados)
function getSystemGoogleMapsApiKey() {
  if (process.env.GOOGLE_MAPS_API_KEY && process.env.GOOGLE_MAPS_API_KEY.trim()) {
    return process.env.GOOGLE_MAPS_API_KEY.trim();
  }
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (cfg.googleMapsApiKey && cfg.googleMapsApiKey.trim()) {
        return cfg.googleMapsApiKey.trim();
      }
    } catch (e) {}
  }
  try {
    const row = db.db.prepare("SELECT google_maps_api_key FROM user_config WHERE length(google_maps_api_key) > 10 LIMIT 1").get();
    if (row && row.google_maps_api_key) {
      return row.google_maps_api_key.trim();
    }
  } catch (e) {}
  return '';
}

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

// --- 2. Utilidad de Cookies y Middleware de Autenticación (Sin dependencias externas) ---
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const name = parts.shift().trim();
      const value = decodeURIComponent(parts.join('='));
      if (name) list[name] = value;
    });
  }
  return list;
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  if (cookies.alerta_session) return cookies.alerta_session;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.substring(7).trim();
  }
  return null;
}

function authRequired(req, res, next) {
  const token = getSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No autorizado. Por favor inicia sesión.' });
  }
  const user = db.getUserBySession(token);
  if (!user) {
    return res.status(401).json({ error: 'Sesión expirada o inválida.' });
  }
  req.user = user;
  req.sessionToken = token;
  next();
}

function authOptional(req, res, next) {
  const token = getSessionToken(req);
  if (token) {
    req.user = db.getUserBySession(token);
    req.sessionToken = token;
  }
  next();
}

// --- 3. Servicio de Consulta de Tráfico y Caché Inteligente ---
const trafficCache = new Map(); // key -> { timestamp, data }

async function fetchCommuteTraffic(origin, destination, apiKey, originCoords = null, destinationCoords = null, forceRefresh = false) {
  const originParam = originCoords ? `${originCoords.lat},${originCoords.lng}` : origin;
  const destParam = destinationCoords ? `${destinationCoords.lat},${destinationCoords.lng}` : destination;
  const cacheKey = `${originParam}->${destParam}`;

  const now = Date.now();
  const cached = trafficCache.get(cacheKey);
  const hasKey = Boolean(apiKey && apiKey.trim());
  if (!forceRefresh && cached && (now - cached.timestamp) < 2 * 60 * 1000 && !(cached.data.isSimulation && hasKey)) {
    return { ...cached.data, fromCache: true };
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
      trafficSummary: 'Tráfico moderado (Simulado - Configura tu Google Maps API Key para tiempo real)'
    };
    trafficCache.set(cacheKey, { timestamp: now, data: simResult });
    return simResult;
  }

  // 1. Intentar con Google Routes API (computeRoutes) con tráfico en vivo
  try {
    const routesUrl = 'https://routes.googleapis.com/directions/v2:computeRoutes';
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

      trafficCache.set(cacheKey, { timestamp: now, data: liveResult });
      return liveResult;
    } else {
      console.log(`ℹ️ [Routes API no disponible: ${routesData.error?.message || routesResp.status}]. Probando Distance Matrix...`);
    }
  } catch (errRoutes) {
    console.warn('⚠️ Error consultando Routes API, probando Distance Matrix API:', errRoutes.message);
  }

  // 2. Fallback a Google Maps Distance Matrix API
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', originParam);
    url.searchParams.set('destinations', destParam);
    url.searchParams.set('departure_time', 'now');
    url.searchParams.set('traffic_model', 'best_guess');
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('key', apiKey.trim());

    console.log(`🌐 [Distance Matrix API] Consulta de respaldo: ${originParam} ➔ ${destParam}`);
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

    trafficCache.set(cacheKey, { timestamp: now, data: liveResult });
    return liveResult;
  } catch (err) {
    return {
      success: false,
      isSimulation: false,
      error: `Error de conexión con Google Maps: ${err.message}`
    };
  }
}

// --- 4. Envío de Notificaciones Web Push a un Usuario ---
async function sendUserPush(userId, payload) {
  const subscriptions = db.getUserSubscriptions(userId);
  if (subscriptions.length === 0) {
    return { sent: 0, total: 0 };
  }

  let sent = 0;
  const staleEndpoints = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent++;
    } catch (err) {
      console.error(`Error enviando push a usuario ${userId} (${err.statusCode}):`, err.message);
      if (err.statusCode === 410 || err.statusCode === 404) {
        staleEndpoints.push(sub.endpoint);
      }
    }
  }

  if (staleEndpoints.length > 0) {
    db.removeStaleSubscriptions(staleEndpoints);
  }

  return { sent, total: subscriptions.length };
}

// --- 5. Cálculo de Horarios Dinámicos ---
function getNextTripSchedule(targetArrivalTimeStr, bufferMinutes, durationMinutes, windowMinutes) {
  const now = new Date();
  const [targetH, targetM] = (targetArrivalTimeStr || '08:00').split(':').map(Number);
  
  let targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetH, targetM, 0, 0);
  let isForTomorrow = false;

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

  // La ventana de monitoreo inteligente vigila desde 'windowMinutes' antes de la salida estimada:
  const effectiveWindowBeforeArrival = Math.max(windowMinutes, totalTripMinutes + windowMinutes);
  const inWindow = minutesUntilArrival > 0 && minutesUntilArrival <= effectiveWindowBeforeArrival;
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

// Mapa para controlar la frecuencia de sondeo adaptativo por usuario
const userLastQueryTimes = new Map();

async function evaluateUserCommute(userId, forceQuery = false) {
  const config = db.getUserConfig(userId);
  if (!config.enabled) return null;

  if (!config.origin || !config.destination) {
    config.lastCheck = {
      timestamp: new Date().toISOString(),
      pendingConfig: true,
      statusMessage: 'Configura tu punto de partida y llegada para comenzar.'
    };
    db.saveUserConfig(userId, { lastCheck: config.lastCheck });
    return config.lastCheck;
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const buffer = config.bufferMinutes || 0;
  const windowMinutes = config.monitoringWindowMinutes || 90;

  const originParam = config.originCoords ? `${config.originCoords.lat},${config.originCoords.lng}` : config.origin;
  const destParam = config.destinationCoords ? `${config.destinationCoords.lat},${config.destinationCoords.lng}` : config.destination;
  const cacheKey = `${originParam}->${destParam}`;
  const cachedData = trafficCache.get(cacheKey)?.data;
  const baselineDuration = cachedData?.durationMinutes || 35;
  const tentativeSchedule = getNextTripSchedule(config.targetArrivalTime, buffer, baselineDuration, windowMinutes);

  const isOutsideWindow = tentativeSchedule.isForTomorrow || !tentativeSchedule.inWindow;
  const alreadyNotifiedToday = config.lastNotificationDate === todayStr;

  let shouldQueryApi = false;
  const lastUserQuery = userLastQueryTimes.get(userId) || 0;
  const msSinceLast = Date.now() - lastUserQuery;

  if (forceQuery) {
    shouldQueryApi = true;
  } else if (!isOutsideWindow && !alreadyNotifiedToday) {
    const minutesToDeparture = tentativeSchedule.minutesUntilDeparture;
    if (minutesToDeparture > 35) {
      shouldQueryApi = msSinceLast >= 15 * 60 * 1000;
    } else if (minutesToDeparture > 15) {
      shouldQueryApi = msSinceLast >= 5 * 60 * 1000;
    } else {
      shouldQueryApi = msSinceLast >= 2 * 60 * 1000;
    }
  }

  const effectiveApiKey = (config.googleMapsApiKey && config.googleMapsApiKey.trim()) || getSystemGoogleMapsApiKey();

  let trafficResult = null;
  if (shouldQueryApi) {
    trafficResult = await fetchCommuteTraffic(
      config.origin,
      config.destination,
      effectiveApiKey,
      config.originCoords,
      config.destinationCoords,
      forceQuery
    );
    userLastQueryTimes.set(userId, Date.now());
  } else {
    trafficResult = cachedData || {
      success: true,
      isSimulation: !Boolean(effectiveApiKey),
      origin: config.origin,
      destination: config.destination,
      originCoords: config.originCoords,
      destinationCoords: config.destinationCoords,
      durationMinutes: baselineDuration,
      durationSeconds: baselineDuration * 60,
      durationText: `${baselineDuration} min`,
      distanceText: 'Calculando...',
      trafficSummary: 'Modo reposo (Consumo optimizado: 0 consultas de cuota)'
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

  // Disparar alarma si corresponde
  if (schedule.mustLeaveNow && !schedule.isForTomorrow && !alreadyNotifiedToday) {
    console.log(`🚨 [Alerta] Disparando notificación matutina a usuario ${userId}: ${statusMessage}`);
    await sendUserPush(userId, {
      title: '🚗 ¡Hora de salir hacia tu destino!',
      body: `El tráfico hoy es de ${trafficResult.durationText} (+${buffer}m de margen). Sal ahora para llegar a las ${config.targetArrivalTime}.`,
      icon: PUSH_ICON_URL,
      badge: PUSH_ICON_URL,
      tag: 'commute-alert-today',
      url: '/'
    });

    db.saveUserConfig(userId, { lastNotificationDate: todayStr });
  }

  const lastCheck = {
    timestamp: new Date().toISOString(),
    pendingConfig: false,
    trafficResult,
    schedule,
    statusMessage
  };

  db.saveUserConfig(userId, { lastCheck });
  return lastCheck;
}

// Bucle Periódico Multiusuario (cada 60 segundos recorre los usuarios activos)
setInterval(async () => {
  try {
    const activeUsers = db.getAllActiveUsersForMonitoring();
    for (const item of activeUsers) {
      await evaluateUserCommute(item.userId, false);
    }
  } catch (err) {
    console.error('Error en ciclo periódico multiusuario:', err);
  }
}, 60 * 1000);

// --- 6. Rutas de Autenticación Multiusuario ---

// Registrarse
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Por favor ingresa un correo electrónico válido.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  const existing = db.getUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'Ya existe una cuenta registrada con este correo.' });
  }

  try {
    const user = db.createUser(email, password, name);
    const token = db.createSession(user.id);

    // Guardar cookie de sesión
    res.setHeader('Set-Cookie', `alerta_session=${token}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`);
    return res.status(201).json({
      success: true,
      user,
      token,
      message: 'Cuenta creada exitosamente.'
    });
  } catch (e) {
    console.error('Error creando usuario:', e);
    return res.status(500).json({ error: 'Error interno al registrar el usuario.' });
  }
});

// Iniciar sesión
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Correo y contraseña requeridos.' });
  }

  const user = db.verifyUser(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Credenciales inválidas. Verifica tu correo o contraseña.' });
  }

  const token = db.createSession(user.id);
  res.setHeader('Set-Cookie', `alerta_session=${token}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`);
  res.json({
    success: true,
    user,
    token,
    message: `¡Bienvenido de nuevo, ${user.name}!`
  });
});

// Estado de sesión actual
app.get('/api/auth/me', authOptional, (req, res) => {
  if (!req.user) {
    return res.json({ loggedIn: false });
  }
  res.json({
    loggedIn: true,
    user: req.user
  });
});

// Cerrar sesión
app.post('/api/auth/logout', authOptional, (req, res) => {
  if (req.sessionToken) {
    db.deleteSession(req.sessionToken);
  }
  res.setHeader('Set-Cookie', 'alerta_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly');
  res.json({ success: true, message: 'Sesión cerrada correctamente.' });
});

// --- 7. Rutas de la Aplicación (Protegidas por Usuario) ---

// Clave pública VAPID
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// Suscripción Web Push individual
app.post('/api/subscribe', authRequired, (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Suscripción inválida' });
  }

  db.addSubscription(req.user.id, subscription);
  const userSubs = db.getUserSubscriptions(req.user.id);
  res.status(201).json({ success: true, count: userSubs.length });
});

// Desuscribir
app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) {
    db.removeSubscription(endpoint);
  }
  res.json({ success: true });
});

// Enviar notificación de prueba al usuario actual
app.post('/api/test-notification', authRequired, async (req, res) => {
  const { title, body } = req.body || {};
  const result = await sendUserPush(req.user.id, {
    title: title || '🔔 Prueba de Notificación - Alerta Tráfico',
    body: body || `¡Hola ${req.user.name}! Las notificaciones Web Push están activas para tu cuenta.`,
    icon: PUSH_ICON_URL,
    badge: PUSH_ICON_URL,
    tag: 'test-notification',
    url: '/'
  });

  res.json({
    success: true,
    sentTo: result.sent,
    totalDevices: result.total
  });
});

// Leer configuración del usuario
app.get('/api/config', authRequired, (req, res) => {
  const cfg = db.getUserConfig(req.user.id);
  const effectiveKey = (cfg.googleMapsApiKey && cfg.googleMapsApiKey.trim()) || getSystemGoogleMapsApiKey();
  const maskedKey = effectiveKey
    ? effectiveKey.substring(0, 6) + '...' + effectiveKey.slice(-4)
    : '';

  const { googleMapsApiKey, ...safeCfg } = cfg;
  res.json({
    ...safeCfg,
    hasApiKey: Boolean(effectiveKey),
    maskedApiKey: maskedKey
  });
});

// Actualizar configuración del usuario
app.post('/api/config', authRequired, (req, res) => {
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

  const updates = {};
  if (origin !== undefined) updates.origin = origin;
  if (destination !== undefined) updates.destination = destination;
  if (originCoords !== undefined) updates.originCoords = originCoords;
  if (destinationCoords !== undefined) updates.destinationCoords = destinationCoords;
  if (targetArrivalTime !== undefined) updates.targetArrivalTime = targetArrivalTime;
  if (bufferMinutes !== undefined) updates.bufferMinutes = Number(bufferMinutes) || 0;
  if (monitoringWindowMinutes !== undefined) updates.monitoringWindowMinutes = Number(monitoringWindowMinutes) || 60;
  if (enabled !== undefined) updates.enabled = Boolean(enabled);
  if (googleMapsApiKey !== undefined) updates.googleMapsApiKey = googleMapsApiKey.trim();

  const saved = db.saveUserConfig(req.user.id, updates);
  const effectiveKey = (saved.googleMapsApiKey && saved.googleMapsApiKey.trim()) || getSystemGoogleMapsApiKey();
  const { googleMapsApiKey: _omitKey, ...safeSaved } = saved;
  res.json({ success: true, config: { ...safeSaved, hasApiKey: Boolean(effectiveKey) } });
});

// Consultar tráfico actual del usuario al instante
app.get('/api/traffic-check', authRequired, async (req, res) => {
  const force = req.query.force === 'true';
  const check = await evaluateUserCommute(req.user.id, force);
  res.json({ success: true, check });
});

// Resetear estado de alerta de hoy para el usuario
app.post('/api/reset-today', authRequired, (req, res) => {
  db.saveUserConfig(req.user.id, { lastNotificationDate: null });
  res.json({ success: true, message: 'Estado diario reiniciado para tu cuenta.' });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Servidor Alerta Tráfico PWA iniciado en el puerto ${PORT}`);
  console.log(`🔗 Abre en tu navegador: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
