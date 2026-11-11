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
    db.prepare(`INSERT OR IGNORE INTO user_config (user_id) VALUES (?)`).run(userId);
    return { ...defaultConfig };
  }
  return formatUserConfig(row);
}

function saveUserConfig(userId, newCfg) {
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

// Inicializar de inmediato al importar
initDb();

module.exports = {
  db,
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
  removeStaleSubscriptions
};
