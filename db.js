const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const db = new DatabaseSync(DB_PATH);

// Activar WAL (Write-Ahead Logging) y claves foráneas para rendimiento y confiabilidad
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Crear tablas
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE COLLATE NOCASE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_config (
      user_id TEXT PRIMARY KEY,
      origin TEXT DEFAULT 'Mi Casa',
      destination TEXT DEFAULT 'Mi Trabajo',
      origin_coords_json TEXT,
      dest_coords_json TEXT,
      target_arrival_time TEXT DEFAULT '08:00',
      buffer_minutes INTEGER DEFAULT 10,
      monitoring_window_minutes INTEGER DEFAULT 90,
      google_maps_api_key TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      last_notification_date TEXT,
      last_check_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT,
      auth TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'cron',
      success INTEGER NOT NULL DEFAULT 1,
      status_code INTEGER DEFAULT 200,
      duration_minutes INTEGER,
      used_system_key INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_api_usage_user_created ON api_usage_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage_logs(created_at);
  `);

  migrateLegacyDataIfPresent();
}

// Contraseña segura con scrypt nativo
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, storedHash) {
  const hash = hashPassword(password, salt);
  const hashBuffer = Buffer.from(hash, 'hex');
  const storedBuffer = Buffer.from(storedHash, 'hex');
  if (hashBuffer.length !== storedBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, storedBuffer);
}

// --- Gestión de Usuarios ---
function createUser(email, password, name) {
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName = (name || trimmedEmail.split('@')[0]).trim();
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

  const stmt = db.prepare(`
    INSERT INTO users (id, email, password_hash, salt, name)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(id, trimmedEmail, passwordHash, salt, trimmedName);

  // Inicializar configuración por defecto para el nuevo usuario
  const configStmt = db.prepare(`
    INSERT INTO user_config (user_id)
    VALUES (?)
  `);
  configStmt.run(id);

  return { id, email: trimmedEmail, name: trimmedName };
}

function verifyUser(email, password) {
  const trimmedEmail = email.trim().toLowerCase();
  const stmt = db.prepare(`
    SELECT id, email, password_hash, salt, name FROM users WHERE email = ?
  `);
  const user = stmt.get(trimmedEmail);
  if (!user) return null;

  if (verifyPassword(password, user.salt, user.password_hash)) {
    return { id: user.id, email: user.email, name: user.name };
  }
  return null;
}

function getUserById(id) {
  const stmt = db.prepare(`SELECT id, email, name, created_at FROM users WHERE id = ?`);
  return stmt.get(id) || null;
}

function getUserByEmail(email) {
  const stmt = db.prepare(`SELECT id, email, name FROM users WHERE email = ?`);
  return stmt.get(email.trim().toLowerCase()) || null;
}

// --- Sesiones ---
function createSession(userId, daysValid = 30) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + daysValid * 24 * 60 * 60 * 1000).toISOString();

  const stmt = db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (?, ?, ?)
  `);
  stmt.run(token, userId, expiresAt);
  return token;
}

function getUserBySession(token) {
  if (!token) return null;
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    SELECT u.id, u.email, u.name
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > ?
  `);
  return stmt.get(token, now) || null;
}

function deleteSession(token) {
  if (!token) return;
  const stmt = db.prepare(`DELETE FROM sessions WHERE token = ?`);
  stmt.run(token);
}

// --- Configuración por Usuario ---
const defaultConfig = {
  origin: 'Mi Casa',
  destination: 'Mi Trabajo',
  originCoords: null,
  destinationCoords: null,
  targetArrivalTime: '08:00',
  bufferMinutes: 10,
  monitoringWindowMinutes: 90,
  googleMapsApiKey: '',
  enabled: true,
  lastNotificationDate: null,
  lastCheck: null
};

function formatUserConfig(row) {
  if (!row) return { ...defaultConfig };
  let originCoords = null;
  let destinationCoords = null;
  let lastCheck = null;

  try {
    if (row.origin_coords_json) originCoords = JSON.parse(row.origin_coords_json);
  } catch (e) {}

  try {
    if (row.dest_coords_json) destinationCoords = JSON.parse(row.dest_coords_json);
  } catch (e) {}

  try {
    if (row.last_check_json) lastCheck = JSON.parse(row.last_check_json);
  } catch (e) {}

  return {
    origin: row.origin || 'Mi Casa',
    destination: row.destination || 'Mi Trabajo',
    originCoords,
    destinationCoords,
    targetArrivalTime: row.target_arrival_time || '08:00',
    bufferMinutes: row.buffer_minutes !== null ? Number(row.buffer_minutes) : 10,
    monitoringWindowMinutes: row.monitoring_window_minutes !== null ? Number(row.monitoring_window_minutes) : 90,
    googleMapsApiKey: row.google_maps_api_key || '',
    enabled: Boolean(row.enabled),
    lastNotificationDate: row.last_notification_date || null,
    lastCheck
  };
}

function getUserConfig(userId) {
  const stmt = db.prepare(`SELECT * FROM user_config WHERE user_id = ?`);
  const row = stmt.get(userId);
  if (!row) {
    const userExists = db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(userId);
    if (userExists) {
      db.prepare(`INSERT OR IGNORE INTO user_config (user_id) VALUES (?)`).run(userId);
    }
    return { ...defaultConfig };
  }
  return formatUserConfig(row);
}

function saveUserConfig(userId, newCfg) {
  const userExists = db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(userId);
  if (!userExists) return null;

  const current = getUserConfig(userId);
  const merged = { ...current, ...newCfg };

  const originCoordsJson = merged.originCoords ? JSON.stringify(merged.originCoords) : null;
  const destCoordsJson = merged.destinationCoords ? JSON.stringify(merged.destinationCoords) : null;
  const lastCheckJson = merged.lastCheck ? JSON.stringify(merged.lastCheck) : null;

  const stmt = db.prepare(`
    INSERT INTO user_config (
      user_id, origin, destination, origin_coords_json, dest_coords_json,
      target_arrival_time, buffer_minutes, monitoring_window_minutes,
      google_maps_api_key, enabled, last_notification_date, last_check_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      origin = excluded.origin,
      destination = excluded.destination,
      origin_coords_json = excluded.origin_coords_json,
      dest_coords_json = excluded.dest_coords_json,
      target_arrival_time = excluded.target_arrival_time,
      buffer_minutes = excluded.buffer_minutes,
      monitoring_window_minutes = excluded.monitoring_window_minutes,
      google_maps_api_key = excluded.google_maps_api_key,
      enabled = excluded.enabled,
      last_notification_date = excluded.last_notification_date,
      last_check_json = excluded.last_check_json,
      updated_at = CURRENT_TIMESTAMP
  `);

  stmt.run(
    userId,
    merged.origin,
    merged.destination,
    originCoordsJson,
    destCoordsJson,
    merged.targetArrivalTime,
    merged.bufferMinutes,
    merged.monitoringWindowMinutes,
    merged.googleMapsApiKey,
    merged.enabled ? 1 : 0,
    merged.lastNotificationDate,
    lastCheckJson
  );

  return merged;
}

function getAllActiveUsersForMonitoring() {
  const stmt = db.prepare(`
    SELECT uc.*, u.email, u.name
    FROM user_config uc
    JOIN users u ON uc.user_id = u.id
    WHERE uc.enabled = 1
  `);
  const rows = stmt.all();
  return rows.map(row => ({
    userId: row.user_id,
    userEmail: row.email,
    userName: row.name,
    config: formatUserConfig(row)
  }));
}

// --- Suscripciones Web Push por Usuario ---
function addSubscription(userId, subscription) {
  if (!subscription || !subscription.endpoint) return;
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const p256dh = subscription.keys?.p256dh || null;
  const auth = subscription.keys?.auth || null;

  const stmt = db.prepare(`
    INSERT INTO subscriptions (id, user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth
  `);
  stmt.run(id, userId, subscription.endpoint, p256dh, auth);
}

function getUserSubscriptions(userId) {
  const stmt = db.prepare(`SELECT endpoint, p256dh, auth FROM subscriptions WHERE user_id = ?`);
  const rows = stmt.all(userId);
  return rows.map(r => ({
    endpoint: r.endpoint,
    keys: {
      p256dh: r.p256dh,
      auth: r.auth
    }
  }));
}

function removeSubscription(endpoint) {
  if (!endpoint) return;
  const stmt = db.prepare(`DELETE FROM subscriptions WHERE endpoint = ?`);
  stmt.run(endpoint);
}

function removeStaleSubscriptions(endpoints) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) return;
  for (const ep of endpoints) {
    removeSubscription(ep);
  }
}

// --- Migración Automática de Datos Previos (si existen) ---
function migrateLegacyDataIfPresent() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) return; // Ya hay usuarios registrados

  const legacyConfigFile = path.join(DATA_DIR, 'config.json');
  const legacySubsFile = path.join(DATA_DIR, 'subscriptions.json');

  let legacyConfig = null;
  if (fs.existsSync(legacyConfigFile)) {
    try {
      legacyConfig = JSON.parse(fs.readFileSync(legacyConfigFile, 'utf8'));
    } catch (e) {}
  }

  // Crear usuario inicial 'admin@alerta.local' con contraseña 'admin123'
  // para que no se pierda la configuración actual que el usuario ya ajustó
  const defaultUser = createUser('admin@alerta.local', 'admin123', 'Manuel');
  console.log(`📦 [Migración] Usuario inicial creado: ${defaultUser.email} (pass: admin123)`);

  if (legacyConfig) {
    saveUserConfig(defaultUser.id, legacyConfig);
    console.log('📦 [Migración] Configuración previa migrada a SQLite exitosamente.');
  }

  if (fs.existsSync(legacySubsFile)) {
    try {
      const subs = JSON.parse(fs.readFileSync(legacySubsFile, 'utf8'));
      if (Array.isArray(subs)) {
        for (const sub of subs) {
          addSubscription(defaultUser.id, sub);
        }
        console.log(`📦 [Migración] ${subs.length} suscripciones Web Push migradas a SQLite.`);
      }
    } catch (e) {}
  }
}

// --- Sesiones de Administrador ---
function createAdminSession(hoursValid = 24) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + hoursValid * 60 * 60 * 1000).toISOString();
  const token = crypto.randomBytes(32).toString('hex');

  // Limpiar sesiones de admin expiradas para mantener la tabla pequeña
  db.prepare(`DELETE FROM admin_sessions WHERE expires_at <= ?`).run(now.toISOString());

  db.prepare(`
    INSERT INTO admin_sessions (token, created_at, expires_at)
    VALUES (?, ?, ?)
  `).run(token, now.toISOString(), expiresAt);

  return token;
}

function verifyAdminSession(token) {
  if (!token) return false;
  const nowIso = new Date().toISOString();
  const row = db.prepare(`
    SELECT token FROM admin_sessions WHERE token = ? AND expires_at > ?
  `).get(token, nowIso);
  return Boolean(row);
}

function deleteAdminSession(token) {
  if (!token) return;
  db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(token);
}

// --- Registro y Métricas de Consumo de Google API ---
function logApiUsage({
  userId,
  provider,
  source = 'cron',
  success = true,
  statusCode = 200,
  durationMinutes = null,
  usedSystemKey = true,
  errorMessage = null
}) {
  if (!userId) return;
  const userExists = db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(userId);
  if (!userExists) return;

  const stmt = db.prepare(`
    INSERT INTO api_usage_logs (
      user_id, provider, source, success, status_code,
      duration_minutes, used_system_key, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    userId,
    provider,
    source,
    success ? 1 : 0,
    statusCode != null ? Number(statusCode) : null,
    durationMinutes != null ? Number(durationMinutes) : null,
    usedSystemKey ? 1 : 0,
    errorMessage ? String(errorMessage).slice(0, 240) : null,
    new Date().toISOString()
  );
}

function toLocalDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getAdminDashboardData() {
  const now = new Date();
  const startOfTodayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
  const startOfMonthIso = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
  const start14DaysDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13, 0, 0, 0, 0);
  const start14DaysIso = start14DaysDate.toISOString();

  const userRows = db.prepare(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.created_at,
      uc.origin,
      uc.destination,
      uc.origin_coords_json,
      uc.dest_coords_json,
      uc.target_arrival_time,
      uc.buffer_minutes,
      uc.monitoring_window_minutes,
      uc.google_maps_api_key,
      uc.enabled,
      uc.last_notification_date,
      uc.last_check_json,
      (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id = u.id) AS push_count,
      (SELECT COUNT(*) FROM sessions sess WHERE sess.user_id = u.id AND sess.expires_at > ?) AS active_sessions_count
    FROM users u
    LEFT JOIN user_config uc ON uc.user_id = u.id
    ORDER BY u.created_at DESC
  `).all(now.toISOString());

  const usageByUserRows = db.prepare(`
    SELECT
      user_id,
      COUNT(*) AS total,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS month,
      SUM(CASE WHEN source = 'cron' THEN 1 ELSE 0 END) AS cron_total,
      SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) AS manual_total,
      SUM(CASE WHEN provider = 'routes_api' THEN 1 ELSE 0 END) AS routes_total,
      SUM(CASE WHEN provider = 'distance_matrix' THEN 1 ELSE 0 END) AS matrix_total,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS error_total,
      SUM(CASE WHEN used_system_key = 1 AND created_at >= ? THEN 1 ELSE 0 END) AS system_key_month,
      MAX(created_at) AS last_call_at
    FROM api_usage_logs
    GROUP BY user_id
  `).all(startOfTodayIso, startOfMonthIso, startOfMonthIso);

  const usageMap = new Map();
  for (const row of usageByUserRows) {
    usageMap.set(row.user_id, row);
  }

  let activeMonitoringUsers = 0;
  let usersWithPush = 0;
  let requestsToday = 0;
  let requestsMonth = 0;
  let requestsTotal = 0;
  let routesApiTotal = 0;
  let distanceMatrixTotal = 0;
  let failedRequestsTotal = 0;
  let systemKeyRequestsMonth = 0;

  const users = userRows.map(row => {
    const uUsage = usageMap.get(row.id) || {};
    const today = Number(uUsage.today || 0);
    const month = Number(uUsage.month || 0);
    const total = Number(uUsage.total || 0);
    const cronTotal = Number(uUsage.cron_total || 0);
    const manualTotal = Number(uUsage.manual_total || 0);
    const routesTotal = Number(uUsage.routes_total || 0);
    const matrixTotal = Number(uUsage.matrix_total || 0);
    const errorTotal = Number(uUsage.error_total || 0);
    const systemKeyMonth = Number(uUsage.system_key_month || 0);

    const enabled = row.enabled !== null ? Boolean(row.enabled) : true;
    const pushDevicesCount = Number(row.push_count || 0);
    const hasOwnApiKey = Boolean(row.google_maps_api_key && row.google_maps_api_key.trim().length > 0);
    const hasRouteConfigured = Boolean(row.origin_coords_json && row.dest_coords_json);

    let lastCheckTimestamp = null;
    let lastStatusMessage = null;
    let lastDurationText = null;
    if (row.last_check_json) {
      try {
        const parsed = JSON.parse(row.last_check_json);
        lastCheckTimestamp = parsed.timestamp || null;
        lastStatusMessage = parsed.statusMessage || null;
        lastDurationText = parsed.trafficResult?.durationText || null;
      } catch (e) {}
    }

    if (enabled) activeMonitoringUsers++;
    if (pushDevicesCount > 0) usersWithPush++;

    requestsToday += today;
    requestsMonth += month;
    requestsTotal += total;
    routesApiTotal += routesTotal;
    distanceMatrixTotal += matrixTotal;
    failedRequestsTotal += errorTotal;
    systemKeyRequestsMonth += systemKeyMonth;

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      enabled,
      origin: row.origin || 'Mi Casa',
      destination: row.destination || 'Mi Trabajo',
      hasRouteConfigured,
      targetArrivalTime: row.target_arrival_time || '08:00',
      bufferMinutes: row.buffer_minutes !== null ? Number(row.buffer_minutes) : 10,
      monitoringWindowMinutes: row.monitoring_window_minutes !== null ? Number(row.monitoring_window_minutes) : 90,
      hasOwnApiKey,
      pushDevicesCount,
      activeSessionsCount: Number(row.active_sessions_count || 0),
      lastNotificationDate: row.last_notification_date || null,
      lastCheckTimestamp,
      lastStatusMessage,
      lastDurationText,
      apiUsage: {
        today,
        month,
        total,
        cronTotal,
        manualTotal,
        routesTotal,
        matrixTotal,
        errorTotal,
        systemKeyMonth,
        lastCallAt: uUsage.last_call_at || null
      }
    };
  });

  // Construir serie de los últimos 14 días en hora local
  const dailyMap = new Map();
  for (let i = 0; i < 14; i++) {
    const d = new Date(start14DaysDate.getFullYear(), start14DaysDate.getMonth(), start14DaysDate.getDate() + i);
    const key = toLocalDateKey(d);
    dailyMap.set(key, { date: key, total: 0, success: 0, failed: 0 });
  }

  const recent14Rows = db.prepare(`
    SELECT created_at, success
    FROM api_usage_logs
    WHERE created_at >= ?
  `).all(start14DaysIso);

  for (const r of recent14Rows) {
    const key = toLocalDateKey(new Date(r.created_at));
    const bucket = dailyMap.get(key);
    if (bucket) {
      bucket.total += 1;
      if (r.success) bucket.success += 1;
      else bucket.failed += 1;
    }
  }

  // Últimas 30 peticiones globales
  const recentLogs = db.prepare(`
    SELECT
      l.id,
      l.user_id,
      u.name AS user_name,
      u.email AS user_email,
      l.provider,
      l.source,
      l.success,
      l.status_code,
      l.duration_minutes,
      l.used_system_key,
      l.error_message,
      l.created_at
    FROM api_usage_logs l
    JOIN users u ON u.id = l.user_id
    ORDER BY l.id DESC
    LIMIT 30
  `).all().map(r => ({
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    provider: r.provider,
    source: r.source,
    success: Boolean(r.success),
    statusCode: r.status_code,
    durationMinutes: r.duration_minutes,
    usedSystemKey: Boolean(r.used_system_key),
    errorMessage: r.error_message,
    createdAt: r.created_at
  }));

  return {
    summary: {
      totalUsers: users.length,
      activeMonitoringUsers,
      pausedUsers: users.length - activeMonitoringUsers,
      usersWithPush,
      requestsToday,
      requestsMonth,
      requestsTotal,
      routesApiTotal,
      distanceMatrixTotal,
      failedRequestsTotal,
      systemKeyRequestsMonth
    },
    dailyChart: Array.from(dailyMap.values()),
    users,
    recentLogs
  };
}

function getAdminUserDetails(userId) {
  const user = getUserById(userId);
  if (!user) return null;

  const cfg = getUserConfig(userId);
  const { googleMapsApiKey, ...safeConfig } = cfg;
  const hasOwnApiKey = Boolean(googleMapsApiKey && googleMapsApiKey.trim());
  const maskedOwnApiKey = hasOwnApiKey
    ? googleMapsApiKey.trim().substring(0, 6) + '...' + googleMapsApiKey.trim().slice(-4)
    : '';

  const pushDevicesCount = db.prepare(`SELECT COUNT(*) AS count FROM subscriptions WHERE user_id = ?`).get(userId).count;
  const activeSessionsCount = db.prepare(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND expires_at > ?`).get(userId, new Date().toISOString()).count;

  const logs = db.prepare(`
    SELECT id, provider, source, success, status_code, duration_minutes, used_system_key, error_message, created_at
    FROM api_usage_logs
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 50
  `).all(userId).map(r => ({
    id: r.id,
    provider: r.provider,
    source: r.source,
    success: Boolean(r.success),
    statusCode: r.status_code,
    durationMinutes: r.duration_minutes,
    usedSystemKey: Boolean(r.used_system_key),
    errorMessage: r.error_message,
    createdAt: r.created_at
  }));

  return {
    user,
    config: {
      ...safeConfig,
      hasOwnApiKey,
      maskedOwnApiKey
    },
    pushDevicesCount,
    activeSessionsCount,
    logs
  };
}

function setUserEnabled(userId, enabled) {
  const user = getUserById(userId);
  if (!user) return null;
  return saveUserConfig(userId, { enabled: Boolean(enabled) });
}

function deleteUserById(userId) {
  const stmt = db.prepare(`DELETE FROM users WHERE id = ?`);
  const result = stmt.run(userId);
  return result.changes > 0;
}

// Inicializar de inmediato al importar
initDb();

module.exports = {
  db,
  DB_PATH,
  initDb,
  createUser,
  verifyUser,
  getUserById,
  getUserByEmail,
  createSession,
  getUserBySession,
  deleteSession,
  getUserConfig,
  saveUserConfig,
  getAllActiveUsersForMonitoring,
  addSubscription,
  getUserSubscriptions,
  removeSubscription,
  removeStaleSubscriptions,
  createAdminSession,
  verifyAdminSession,
  deleteAdminSession,
  logApiUsage,
  getAdminDashboardData,
  getAdminUserDetails,
  setUserEnabled,
  deleteUserById
};
