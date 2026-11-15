try {
  require('dotenv').config({ quiet: true });
} catch (e) {}

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const webpush = require('web-push');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
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
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const PUSH_ICON_URL = '/icons/android-chrome-192x192.png';

// Gestión de clave de acceso del panel /admin
function getAdminKeyInfo(logIfGenerated = false) {
  if (process.env.ADMIN_KEY && process.env.ADMIN_KEY.trim()) {
    return { key: process.env.ADMIN_KEY.trim(), source: 'env' };
  }

  if (fs.existsSync(ADMIN_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));
      if (data && typeof data.adminKey === 'string' && data.adminKey.trim()) {
        return { key: data.adminKey.trim(), source: 'file' };
      }
    } catch (e) {
      console.error('Error leyendo admin.json, regenerando...', e);
    }
  }

  const generatedKey = 'adm-' + crypto.randomBytes(6).toString('hex');
  try {
    fs.writeFileSync(
      ADMIN_FILE,
      JSON.stringify({ adminKey: generatedKey, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
    if (logIfGenerated) {
      console.log(`🔐 [Admin] Clave de acceso generada automáticamente en data/admin.json: ${generatedKey}`);
    }
  } catch (e) {
    console.error('No se pudo guardar data/admin.json:', e.message);
  }
  return { key: generatedKey, source: 'file' };
}

function safeCompareStrings(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a || '')).digest();
  const hashB = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

const adminKeyBootstrap = getAdminKeyInfo(true);

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

function getAdminSessionToken(req) {
  const cookies = parseCookies(req);
  if (cookies.alerta_admin_session) return cookies.alerta_admin_session;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.substring(7).trim();
  }
  return null;
}

function adminRequired(req, res, next) {
  const token = getAdminSessionToken(req);
  if (!token || !db.verifyAdminSession(token)) {
    return res.status(401).json({ error: 'Acceso restringido. Ingresa la clave de administrador.' });
  }
  req.adminToken = token;
  next();
}

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string') return cfIp.trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

const adminLoginAttempts = new Map(); // ip -> { count, resetAt }

// --- 3. Servicio de Consulta de Tráfico y Caché Inteligente ---
const trafficCache = new Map(); // key -> { timestamp, data }

async function fetchCommuteTraffic(
  origin,
  destination,
  apiKey,
  originCoords = null,
  destinationCoords = null,
  forceRefresh = false,
  usageMeta = null
) {
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

  const recordUsage = (entry) => {
    if (!usageMeta || !usageMeta.userId) return;
    try {
      db.logApiUsage({
        userId: usageMeta.userId,
        source: usageMeta.source || 'cron',
        usedSystemKey: usageMeta.usedSystemKey !== undefined ? usageMeta.usedSystemKey : true,
        ...entry
      });
    } catch (e) {
      console.error('Error registrando uso de Google API:', e.message);
    }
  };

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

      recordUsage({
        provider: 'routes_api',
        success: true,
        statusCode: routesResp.status,
        durationMinutes
      });

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
      const errMsg = routesData.error?.message || `HTTP ${routesResp.status}`;
      recordUsage({
        provider: 'routes_api',
        success: false,
        statusCode: routesResp.status,
        errorMessage: errMsg
      });
      console.log(`ℹ️ [Routes API no disponible: ${errMsg}]. Probando Distance Matrix...`);
    }
  } catch (errRoutes) {
    recordUsage({
      provider: 'routes_api',
      success: false,
      statusCode: 0,
      errorMessage: errRoutes.message
    });
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
      const errMsg = `${data.status} - ${data.error_message || ''}`.trim();
      recordUsage({
        provider: 'distance_matrix',
        success: false,
        statusCode: resp.status,
        errorMessage: errMsg
      });
      return {
        success: false,
        isSimulation: false,
        error: `Error de Google Maps: ${data.status} - ${data.error_message || ''}`
      };
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') {
      const errMsg = element?.status || 'SIN_ELEMENTO';
      recordUsage({
        provider: 'distance_matrix',
        success: false,
        statusCode: resp.status,
        errorMessage: errMsg
      });
      return {
        success: false,
        isSimulation: false,
        error: `No se encontró ruta válida: ${errMsg}`
      };
    }

    const durationObj = element.duration_in_traffic || element.duration;
    const durationSeconds = durationObj.value;
    const durationMinutes = Math.ceil(durationSeconds / 60);

    recordUsage({
      provider: 'distance_matrix',
      success: true,
      statusCode: resp.status,
      durationMinutes
    });

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
    recordUsage({
      provider: 'distance_matrix',
      success: false,
      statusCode: 0,
      errorMessage: err.message
    });
    return {
      success: false,
      isSimulation: false,
      error: `Error de conexión con Google Maps: ${err.message}`
    };
  }
}

// --- 3.1 Servicio de Clima en Origen con Open-Meteo (Cero costos, sin API key) ---
const weatherCache = new Map(); // key -> { timestamp, data }

function getWeatherInterpretation(wmoCode) {
  // Códigos estándar WMO Weather Interpretation (WW)
  // https://open-meteo.com/en/docs
  if (wmoCode === 0) return { text: 'Cielo despejado', icon: 'wb_sunny', isRain: false };
  if ([1, 2, 3].includes(wmoCode)) return { text: 'Parcialmente nublado', icon: 'partly_cloudy_day', isRain: false };
  if ([45, 48].includes(wmoCode)) return { text: 'Niebla matutina', icon: 'foggy', isRain: false };
  if ([51, 53, 55].includes(wmoCode)) return { text: 'Llovizna ligera', icon: 'rainy', isRain: true };
  if ([56, 57].includes(wmoCode)) return { text: 'Llovizna helada', icon: 'weather_mix', isRain: true };
  if ([61, 63, 65].includes(wmoCode)) return { text: 'Lluvia', icon: 'rainy', isRain: true };
  if ([66, 67].includes(wmoCode)) return { text: 'Lluvia helada', icon: 'weather_mix', isRain: true };
  if ([71, 73, 75, 77].includes(wmoCode)) return { text: 'Nevada', icon: 'ac_unit', isRain: true };
  if ([80, 81, 82].includes(wmoCode)) return { text: 'Chubascos', icon: 'rainy_heavy', isRain: true };
  if ([85, 86].includes(wmoCode)) return { text: 'Chubascos de nieve', icon: 'ac_unit', isRain: true };
  if ([95, 96, 99].includes(wmoCode)) return { text: 'Tormenta eléctrica', icon: 'thunderstorm', isRain: true };
  return { text: 'Nublado', icon: 'cloud', isRain: false };
}

async function fetchRouteWeather(coords, forceRefresh = false) {
  if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') {
    return null;
  }

  const lat = Number(coords.lat.toFixed(2));
  const lng = Number(coords.lng.toFixed(2));
  const cacheKey = `${lat},${lng}`;
  const now = Date.now();

  const cached = weatherCache.get(cacheKey);
  // Caché de 30 minutos para evitar consultas redundantes
  if (!forceRefresh && cached && (now - cached.timestamp) < 30 * 60 * 1000) {
    return { ...cached.data, fromCache: true };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code&hourly=precipitation_probability&timezone=auto&forecast_days=1`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return cached ? cached.data : null;
    }

    const json = await res.json();
    const temp = Math.round(json.current?.temperature_2m ?? 22);
    const wmoCode = json.current?.weather_code ?? 0;
    const currentPrecip = json.current?.precipitation ?? 0;
    const currentHour = new Date().getHours();
    const hourlyProbs = json.hourly?.precipitation_probability || [];
    const rainProb = hourlyProbs[currentHour] ?? 0;

    const interp = getWeatherInterpretation(wmoCode);
    const isRaining = currentPrecip > 0.1 || interp.isRain || rainProb >= 40;

    let textSummary = '';
    if (currentPrecip > 0.1 || (interp.isRain && rainProb >= 40)) {
      textSummary = `${interp.text} (${temp}°C, ${rainProb}% lluvia) ☔`;
    } else if (rainProb >= 40) {
      textSummary = `${temp}°C · ${rainProb}% prob. de lluvia ☔`;
    } else {
      textSummary = `${temp}°C · ${interp.text}`;
    }

    const weatherData = {
      success: true,
      temp,
      wmoCode,
      weatherDesc: interp.text,
      icon: interp.icon,
      isRaining,
      rainProb,
      currentPrecip,
      textSummary,
      updatedAt: new Date().toISOString()
    };

    weatherCache.set(cacheKey, { timestamp: now, data: weatherData });
    return weatherData;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('⚠️ [Open-Meteo] No se pudo obtener clima (no bloqueante):', err.message);
    return cached ? cached.data : null;
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

// --- 5. Cálculo de Horarios Dinámicos y Formateo ---
function formatTime12h(timeStr) {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) {
    return timeStr || '--:--';
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

function formatDateTo12h(dateObj) {
  if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '--:--';
  const h = dateObj.getHours();
  const m = dateObj.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  const paddedMin = String(m).padStart(2, '0');
  return `${hour12}:${paddedMin} ${period}`;
}

function getNextTripSchedule(targetArrivalTimeStr, bufferMinutes, durationMinutes, windowMinutes, now = new Date()) {
  const [targetH, targetM] = (targetArrivalTimeStr || '08:00').split(':').map(Number);
  
  const currentDay = now.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  const isWeekday = currentDay >= 1 && currentDay <= 5;

  let targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetH, targetM, 0, 0);
  let isToday = false;
  let isForTomorrow = false;
  let isWeekend = (currentDay === 0 || currentDay === 6);

  if (isWeekday && now.getTime() < targetDate.getTime()) {
    // Hoy es día laborable (Lunes a Viernes) y aún no ha pasado la hora meta
    isToday = true;
    isForTomorrow = false;
  } else {
    // Si ya pasó la hora de hoy o hoy es fin de semana, buscamos el próximo día laborable (Lunes a Viernes)
    let daysToAdd = 1;
    let candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToAdd, targetH, targetM, 0, 0);
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      daysToAdd++;
      candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToAdd, targetH, targetM, 0, 0);
    }
    targetDate = candidate;
    isToday = false;

    // Verificar si ese próximo día laborable es exactamente mañana
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    isForTomorrow = (
      targetDate.getFullYear() === tomorrow.getFullYear() &&
      targetDate.getMonth() === tomorrow.getMonth() &&
      targetDate.getDate() === tomorrow.getDate()
    );

    // Si hoy es viernes y ya pasó la hora de viaje, o si hoy es sábado o domingo: estamos en fin de semana
    if (currentDay === 5 || currentDay === 6 || currentDay === 0) {
      isWeekend = true;
    }
  }

  const totalTripMinutes = durationMinutes + bufferMinutes;
  const departureDate = new Date(targetDate.getTime() - totalTripMinutes * 60 * 1000);

  const msUntilArrival = targetDate.getTime() - now.getTime();
  const minutesUntilArrival = Math.round(msUntilArrival / (1000 * 60));

  const msUntilDeparture = departureDate.getTime() - now.getTime();
  const minutesUntilDeparture = Math.round(msUntilDeparture / (1000 * 60));

  // La ventana de monitoreo inteligente vigila desde 'windowMinutes' antes de la salida estimada,
  // y ÚNICAMENTE puede estar activa si el viaje está programado para HOY (lunes a viernes).
  const effectiveWindowBeforeArrival = Math.max(windowMinutes, totalTripMinutes + windowMinutes);
  const inWindow = isToday && minutesUntilArrival > 0 && minutesUntilArrival <= effectiveWindowBeforeArrival;
  const mustLeaveNow = isToday && inWindow && minutesUntilDeparture <= 0;

  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const targetDayName = dayNames[targetDate.getDay()];

  return {
    targetDate,
    departureDate,
    isToday,
    isForTomorrow,
    isWeekend,
    targetDayName,
    minutesUntilArrival,
    minutesUntilDeparture,
    inWindow,
    mustLeaveNow,
    departureTimeFormatted: formatDateTo12h(departureDate),
    targetTimeFormatted: formatDateTo12h(targetDate)
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

  const isOutsideWindow = !tentativeSchedule.isToday || !tentativeSchedule.inWindow;
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

  const userHasOwnKey = Boolean(config.googleMapsApiKey && config.googleMapsApiKey.trim());
  const effectiveApiKey = userHasOwnKey ? config.googleMapsApiKey.trim() : getSystemGoogleMapsApiKey();

  let trafficResult = null;
  if (shouldQueryApi) {
    trafficResult = await fetchCommuteTraffic(
      config.origin,
      config.destination,
      effectiveApiKey,
      config.originCoords,
      config.destinationCoords,
      forceQuery,
      {
        userId,
        source: forceQuery ? 'manual' : 'cron',
        usedSystemKey: !userHasOwnKey
      }
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
      trafficSummary: 'En espera hasta la hora programada'
    };
  }

  const finalDuration = trafficResult.success ? trafficResult.durationMinutes : baselineDuration;
  const schedule = getNextTripSchedule(config.targetArrivalTime, buffer, finalDuration, windowMinutes);

  // Clima en vivo en el punto de partida (Open-Meteo)
  const coordsForWeather = config.originCoords || (trafficResult && trafficResult.originCoords);
  const weather = await fetchRouteWeather(coordsForWeather, forceQuery);

  let notifiedTodayFlag = alreadyNotifiedToday;
  let statusMessage = '';
  if (!trafficResult.success) {
    statusMessage = trafficResult.error;
  } else if (alreadyNotifiedToday && schedule.isToday) {
    statusMessage = 'Alerta de hoy ya entregada. ¡Buen viaje!';
  } else if (schedule.isWeekend) {
    if (now.getDay() === 0) {
      statusMessage = `Descansando el fin de semana. Próxima salida programada para mañana lunes a las ${schedule.departureTimeFormatted}.`;
    } else {
      statusMessage = `Descansando el fin de semana. Próxima salida programada para el lunes a las ${schedule.departureTimeFormatted}.`;
    }
  } else if (schedule.isForTomorrow) {
    statusMessage = `Descansando hasta mañana. Próxima salida programada para las ${schedule.departureTimeFormatted}.`;
  } else if (schedule.mustLeaveNow) {
    statusMessage = `¡DEBES SALIR YA! Tráfico: ${trafficResult.durationText}. Margen: ${buffer}m. Llegada meta: ${formatTime12h(config.targetArrivalTime)}.`;
  } else if (schedule.inWindow) {
    statusMessage = `Monitoreo matutino activo. Faltan ${schedule.minutesUntilDeparture} min para salir.`;
  } else {
    statusMessage = `En espera. Tu salida de hoy está programada para las ${schedule.departureTimeFormatted}.`;
  }

  // Disparar alarma si corresponde (estrictamente de lunes a viernes en el día actual)
  if (schedule.isToday && schedule.mustLeaveNow && !alreadyNotifiedToday) {
    console.log(`🚨 [Alerta] Disparando notificación matutina a usuario ${userId}: ${statusMessage}`);

    const originParam = config.originCoords ? `${config.originCoords.lat},${config.originCoords.lng}` : (config.origin || '');
    const destParam = config.destinationCoords ? `${config.destinationCoords.lat},${config.destinationCoords.lng}` : (config.destination || '');
    const mapsUrl = (originParam && destParam)
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originParam)}&destination=${encodeURIComponent(destParam)}&travelmode=driving`
      : 'https://www.google.com/maps';

    const notificationLines = [
      `🎯 Llegada meta: ${formatTime12h(config.targetArrivalTime)}`,
      `⏱️ Duración de ruta: ${trafficResult.durationText}`
    ];
    if (weather && weather.textSummary) {
      notificationLines.push(`🌦️ Clima: ${weather.textSummary}`);
    }
    notificationLines.push(`🛡️ Margen de seguridad: ${buffer} min`);
    notificationLines.push(`👉 ¡Sal ahora para llegar puntual!`);

    const notificationBody = notificationLines.join('\n');

    await sendUserPush(userId, {
      title: '🚦 ¡Alerta de Salida Matutina!',
      body: notificationBody,
      icon: PUSH_ICON_URL,
      badge: PUSH_ICON_URL,
      tag: 'commute-alert-today',
      url: '/',
      mapsUrl,
      actions: [
        { action: 'open_maps', title: '🗺️ Abrir Maps' },
        { action: 'open_app', title: '📱 Ver Detalles' }
      ]
    });

    db.saveUserConfig(userId, { lastNotificationDate: todayStr });
    notifiedTodayFlag = true;
    statusMessage = 'Alerta de hoy ya entregada. ¡Buen viaje!';
  }

  const lastCheck = {
    timestamp: new Date().toISOString(),
    pendingConfig: false,
    alreadyNotifiedToday: Boolean(notifiedTodayFlag),
    trafficResult,
    schedule,
    weather,
    statusMessage
  };

  db.saveUserConfig(userId, { lastCheck });
  return lastCheck;
}

// Bucle Periódico Multiusuario (cada 60 segundos recorre los usuarios activos)
setInterval(async () => {
  try {
    const now = new Date();
    const currentDay = now.getDay();
    // Fines de semana (0 = Domingo, 6 = Sábado): descanso absoluto, sin consultas automáticas de cron
    if (currentDay === 0 || currentDay === 6) {
      return;
    }

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
  const cfg = db.getUserConfig(req.user.id);

  const originParam = cfg.originCoords ? `${cfg.originCoords.lat},${cfg.originCoords.lng}` : (cfg.origin || '');
  const destParam = cfg.destinationCoords ? `${cfg.destinationCoords.lat},${cfg.destinationCoords.lng}` : (cfg.destination || '');
  const mapsUrl = (originParam && destParam)
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originParam)}&destination=${encodeURIComponent(destParam)}&travelmode=driving`
    : 'https://www.google.com/maps';

  const weather = await fetchRouteWeather(cfg.originCoords, true);
  const bodyLines = [
    `🎯 Llegada meta: ${formatTime12h(cfg.targetArrivalTime || '08:00')}`,
    `⏱️ Duración de ruta: 35 min (estimado)`
  ];
  if (weather && weather.textSummary) {
    bodyLines.push(`🌦️ Clima: ${weather.textSummary}`);
  }
  bodyLines.push(`🛡️ Margen de seguridad: ${cfg.bufferMinutes !== undefined ? cfg.bufferMinutes : 10} min`);
  bodyLines.push(`👉 ¡Sal ahora para llegar puntual!`);

  const defaultBody = bodyLines.join('\n');

  const result = await sendUserPush(req.user.id, {
    title: title || '🚦 ¡Alerta de Salida Matutina! (Prueba)',
    body: body || defaultBody,
    icon: PUSH_ICON_URL,
    badge: PUSH_ICON_URL,
    tag: 'test-notification',
    url: '/',
    mapsUrl,
    actions: [
      { action: 'open_maps', title: '🗺️ Abrir Maps' },
      { action: 'open_app', title: '📱 Ver Detalles' }
    ]
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

// --- 8. Rutas del Panel de Administración (/admin) ---

app.get('/api/admin/me', (req, res) => {
  const token = getAdminSessionToken(req);
  const authenticated = Boolean(token && db.verifyAdminSession(token));
  const keyInfo = getAdminKeyInfo(false);
  res.json({
    authenticated,
    keySource: keyInfo.source
  });
});

app.post('/api/admin/login', (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();
  const attempt = adminLoginAttempts.get(ip);

  if (attempt && now < attempt.resetAt && attempt.count >= 8) {
    const waitMin = Math.ceil((attempt.resetAt - now) / 60000);
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Intenta de nuevo en ${waitMin} minuto(s).`
    });
  }

  const { accessKey } = req.body || {};
  if (!accessKey || typeof accessKey !== 'string') {
    return res.status(400).json({ error: 'Ingresa la clave de acceso.' });
  }

  const keyInfo = getAdminKeyInfo(false);
  if (!safeCompareStrings(accessKey.trim(), keyInfo.key)) {
    const currentCount = attempt && now < attempt.resetAt ? attempt.count + 1 : 1;
    adminLoginAttempts.set(ip, {
      count: currentCount,
      resetAt: attempt && now < attempt.resetAt ? attempt.resetAt : now + 15 * 60 * 1000
    });
    return res.status(401).json({ error: 'Clave de acceso incorrecta.' });
  }

  adminLoginAttempts.delete(ip);
  const token = db.createAdminSession(24);
  res.setHeader(
    'Set-Cookie',
    `alerta_admin_session=${token}; Path=/; Max-Age=86400; SameSite=Strict; HttpOnly`
  );

  res.json({
    success: true,
    keySource: keyInfo.source,
    message: 'Acceso concedido al panel de administración.'
  });
});

app.post('/api/admin/logout', (req, res) => {
  const token = getAdminSessionToken(req);
  if (token) {
    db.deleteAdminSession(token);
  }
  res.setHeader('Set-Cookie', 'alerta_admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict; HttpOnly');
  res.json({ success: true });
});

app.get('/api/admin/dashboard', adminRequired, (req, res) => {
  try {
    const data = db.getAdminDashboardData();
    const sysKey = getSystemGoogleMapsApiKey();
    const maskedSystemKey = sysKey
      ? sysKey.substring(0, 6) + '...' + sysKey.slice(-4)
      : '';

    let dbSizeKb = 0;
    try {
      if (fs.existsSync(db.DB_PATH)) {
        dbSizeKb = Math.round(fs.statSync(db.DB_PATH).size / 1024);
      }
    } catch (e) {}

    const mem = process.memoryUsage();
    const keyInfo = getAdminKeyInfo(false);

    res.json({
      success: true,
      ...data,
      systemInfo: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryRssMb: Number((mem.rss / (1024 * 1024)).toFixed(1)),
        memoryHeapMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
        dbSizeKb,
        trafficCacheEntries: trafficCache.size,
        hasSystemApiKey: Boolean(sysKey),
        maskedSystemKey,
        adminKeySource: keyInfo.source
      }
    });
  } catch (err) {
    console.error('Error cargando dashboard admin:', err);
    res.status(500).json({ error: 'Error obteniendo métricas del sistema.' });
  }
});

app.get('/api/admin/users/:id', adminRequired, (req, res) => {
  const details = db.getAdminUserDetails(req.params.id);
  if (!details) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }
  res.json({ success: true, ...details });
});

app.patch('/api/admin/users/:id/status', adminRequired, (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Debes indicar enabled (boolean).' });
  }
  const updated = db.setUserEnabled(req.params.id, enabled);
  if (!updated) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }
  res.json({
    success: true,
    enabled: updated.enabled,
    message: updated.enabled ? 'Monitoreo reactivado.' : 'Monitoreo pausado.'
  });
});

app.post('/api/admin/users/:id/test-push', adminRequired, async (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }
  const result = await sendUserPush(user.id, {
    title: '🔔 Mensaje de prueba del Administrador',
    body: `Hola ${user.name}, tus alertas Web Push están funcionando correctamente.`,
    icon: PUSH_ICON_URL,
    badge: PUSH_ICON_URL,
    tag: 'admin-test-push',
    url: '/'
  });
  res.json({
    success: true,
    sentTo: result.sent,
    totalDevices: result.total
  });
});

app.delete('/api/admin/users/:id', adminRequired, (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }
  const deleted = db.deleteUserById(req.params.id);
  if (!deleted) {
    return res.status(500).json({ error: 'No se pudo eliminar el usuario.' });
  }
  userLastQueryTimes.delete(req.params.id);
  res.json({
    success: true,
    message: `Usuario ${user.email} eliminado del sistema.`
  });
});

app.post('/api/admin/change-key', adminRequired, (req, res) => {
  const keyInfo = getAdminKeyInfo(false);
  if (keyInfo.source === 'env') {
    return res.status(400).json({
      error: 'La clave está definida por la variable de entorno ADMIN_KEY. Cámbiala en tu archivo .env o entorno.'
    });
  }

  const { currentKey, newKey } = req.body || {};
  if (!currentKey || !safeCompareStrings(String(currentKey).trim(), keyInfo.key)) {
    return res.status(401).json({ error: 'La clave actual es incorrecta.' });
  }
  if (!newKey || typeof newKey !== 'string' || newKey.trim().length < 6) {
    return res.status(400).json({ error: 'La nueva clave debe tener al menos 6 caracteres.' });
  }

  try {
    fs.writeFileSync(
      ADMIN_FILE,
      JSON.stringify({ adminKey: newKey.trim(), updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
    res.json({ success: true, message: 'Clave de administrador actualizada correctamente.' });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar la nueva clave.' });
  }
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Servidor Alerta Tráfico PWA iniciado en el puerto ${PORT}`);
  console.log(`🔗 Abre en tu navegador: http://localhost:${PORT}`);
  console.log(`🛡️  Panel Admin: http://localhost:${PORT}/admin (origen clave: ${adminKeyBootstrap.source})`);
  console.log(`=======================================================`);
});
