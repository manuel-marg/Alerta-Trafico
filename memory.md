# 🧠 Project Memory: Alerta-Tráfico

> **Persistent Long-Term Memory & Episodic Journal for AI Agents**  
> *Last Updated: November 2026*  
> *Primary Repository: https://github.com/manuel-marg/Alerta-Trafico.git*

---

## 1. Project Identity & Purpose
* **Name:** Alerta-Tráfico (Automated Morning Commute Alarm PWA)
* **Goal:** A dynamic, self-hosted progressive web app (PWA) that calculates the exact minute a user must leave home based on real-time traffic conditions, arrival deadline, and a personal preparation buffer.
* **Equation:**
  $$\text{Hora de Salida} = \text{Hora Deseada de Llegada} - \text{Tráfico en Tiempo Real} - \text{Margen de Preparación}$$
* **Core Philosophy:** 100% self-hosted, $0 ongoing operational cost, battery-efficient on personal phones, decoupled server architecture.

---

## 2. Infrastructure & Live Environments

### Host Node (Production Server)
* **Device:** Secondary Android Phone running Termux.
* **Local Network IP:** `192.168.1.210` (Static / IP Fija configurada)
* **SSH Port:** `8022` (Termux non-standard port)
* **SSH Credentials:**
  * User: `u0_a141`
  * Password: `24674967`
* **Process Persistence:**
  * Runs via: `nohup node server.js </dev/null >~/server.log 2>&1 &`
  * Android Doze mode disabled via: `termux-wake-lock`
* **Public Tunneling:**
  * Tool: Cloudflare Quick Tunnel (`cloudflared` binary on Termux).
  * Exposes port `3000` to global HTTPS without port forwarding or public IP requirements.
  * Active Tunnel URL: `https://alertatrafico.dpdns.org` (Named Tunnel `alerta` vinculado con Cloudflare DNS)

### Development Node (Local Machine)
* **OS:** Windows
* **Working Directory:** `C:\Node.js\Alerta-Trafico`
* **Port:** `3000`
* **Remote Git:** `https://github.com/manuel-marg/Alerta-Trafico.git` (branch: `main`)

---

## 3. Architecture & Technical Decisions

### Backend (`server.js`)
* **Runtime:** Node.js (Express), pure CommonJS (`require`).
* **Zero Native Binaries:** All dependencies (`express`, `web-push`) are pure JavaScript to ensure seamless binary-free compatibility across ARM Android (Termux) and Windows.
* **Adaptive Polling Engine (Quota Saver):**
  * Afternoon / Night: **0 calls** (engine sleeps).
  * Morning window (>30 min before departure): 1 call every 15 minutes.
  * Approaching window (15–30 min before departure): 1 call every 5 minutes.
  * Final critical window (<15 min before departure): 1 call every 2 minutes.
  * Once the Web Push notification fires: Polling terminates until the next day.
* **Dual Traffic Providers:**
  1. Primary: **Google Routes API** (`POST https://routes.googleapis.com/directions/v2:computeRoutes` with `routingPreference: "TRAFFIC_AWARE"` and localized values).
  2. Fallback: **Google Maps Distance Matrix API** (`GET https://maps.googleapis.com/maps/api/distancematrix/json`).
  3. Simulation Mode: Active when no Google API Key is provided.

### Frontend (`public/`)
* **Format:** Pure Vanilla JavaScript, HTML5, CSS3 (No framework or heavy bundlers).
* **Service Worker (`public/sw.js`):** Intercepts push events, delivers native OS vibration, sounds, and interactive notifications.
* **Map Pin Selector:**
  * Integrated with **Leaflet.js** and **OpenStreetMap (Nominatim)**.
  * Avoids consuming Google Maps Geocoding / Places API quota for coordinate picking.

---

## 4. Key Gotchas, Bugs Encountered & Solutions

| Issue / Symptom | Root Cause | Verified Solution |
| :--- | :--- | :--- |
| **`ngrok.com` connection failure** | Venezuelan ISPs (CANTV/Movistar/Digitel) actively sever TLS handshakes (`ECONNRESET`) to ngrok. | Replaced ngrok with **Cloudflare Quick Tunnels (`cloudflared`)**, which works unrestricted globally. |
| **Windows CP1252 Unicode crash** | Python scripts printing Termux emojis (e.g. 🚀, ✅) failed on Windows `charmap` codec. | Always configure stdout encoding to UTF-8 (`sys.stdout.reconfigure(encoding='utf-8')`) or handle decode with `errors='replace'`. |
| **Paramiko SSH hanging on `nohup`** | SSH subshell kept stdout/stderr file descriptors open indefinitely. | Always redirect all streams explicitly: `nohup node server.js </dev/null >~/server.log 2>&1 &`. |
| **Phone `npm install` timeout** | Termux on older Android phones suffered DNS/TCP timeouts reaching `registry.npmjs.org`. | Compressed local Windows `node_modules` into `node_modules.tar.gz` and transferred directly via Paramiko SFTP. |
| **Git pull conflict on phone** | `data/config.json` was locally modified on the phone by app runtime. | Always run `git checkout data/config.json && git pull origin main` before restarting the server. |
| **Exposure of private data / keys** | `data/config.json` and `data/vapid.json` contained coordinates and keys. | Untracked `data/*.json` from Git, added them to `.gitignore`, and created `data/config.example.json` as a safe template. |
| **Google Cloud API mismatch** | Directions API was not listed standalone in Google Cloud Console. | Google consolidated Directions API into **Routes API** (`computeRoutes`). Backend was updated with native Routes API payload. |
| **Dominio y Túnel Permanente ($0)** | Túneles temporales `trycloudflare.com` cambiaban de URL en cada reinicio. | Se configuró dominio gratuito `alertatrafico.dpdns.org` en DigitalPlat y Cloudflare con Named Tunnel permanente (`cloudflared tunnel run alerta`). |
| **Arquitectura Multi-usuario en Teléfono** | La aplicación solo soportaba un único usuario global en `config.json`. | Se implementó base de datos SQLite nativa (`node:sqlite`) con tablas de usuarios, sesiones, rutas aisladas y suscripciones Web Push por usuario. Se migraron automáticamente los datos previos al usuario inicial `admin@alerta.local` (clave `admin123`). |
| **Diseño y Tema Claro (Light Theme)** | El tema oscuro original no era del agrado visual del usuario. | Se rediseñó completamente la interfaz a un tema claro moderno y limpio (Slate/White/Blue) con tarjetas elevadas, tipografía nítida y caché v3 de Service Worker. |
| **Diseño Material 3 Google Maps** | Se requería que la interfaz se pareciera visualmente a la app de Google Maps móvil (colores, tipografía, botones y selectores de ruta). | Se implementó el sistema visual fiel a Google Maps: tarjeta flotante de ruta con indicador de punto azul, línea punteada, pin rojo de destino y botón de intercambio (`⇅`); tipografía Google Sans/Roboto; botón de acción principal teal/azul en píldora (`border-radius: 24px`); Bottom Sheet con indicador de transporte y tiempo en verde Google (`#188038`); y avatares de cuenta. |
| **Android Termux Low Memory Killer (LMK) & Watchdog 24/7** | El teléfono tiene 891MB de RAM total (<30MB libres). Durante la noche, Android mató el proceso `node` con señal `Terminated` (OOM), dejando Cloudflare con error `502 Bad Gateway`. | 1) Se restringió la memoria de Node a 64MB (`--max-old-space-size=64 --optimize_for_size`). 2) Se implementó un supervisor en segundo plano (`watchdog.sh`) que vigila `node` y `cloudflared` cada 5 segundos y los resucita automáticamente si Android los termina. Probado y verificado con éxito. |
| **Responsividad Header Móvil (iPhone 16)** | En pantallas móviles (393px ancho), el píldora con nombre de usuario ocupaba demasiado espacio horizontal y chocaba con el título y las insignias de estado. | Se rediseñó el header al estilo Google Maps: avatar circular compacto (32-36px con inicial) en la esquina superior derecha que despliega un popover con información y botón para cerrar sesión; e insignias de estado (Push y Modo API) movidas a una sub-fila inferior limpia y separada. Se optimizaron las tarjetas de estadísticas a 3 columnas compactas. |
| **Selectores Horizontales de Tiempo (Segmented Control CodePen / Material 3)** | Los campos numéricos estándar para margen de salida y ventana de monitoreo previo resultaban poco intuitivos y propensos a confusión (ej. escribir 90). | Se implementaron barras horizontales segmentadas tipo píldora (`5 min`, `10 min`, `15 min`, `30 min`, `1 hora`) con estado activo en Google Blue, microinteracciones suaves, badges de confirmación y textos explicativos dinámicos. En el backend se ajustó el cálculo para que la ventana inteligente vigile anticipadamente respecto a la hora de salida estimada sin importar la duración del trayecto. |
| **Integración de Google Material Symbols** | Los emojis del sistema daban una apariencia inconsistente según el sistema operativo o navegador móvil. | Se enlazó la librería oficial `Material Symbols Outlined` de Google Fonts y se reemplazaron todos los emojis del sistema por iconos vectoriales nativos de Google: `my_location` (en el botón GPS), `search`, `home_pin`, `pin_drop`, `directions_car`, `sensors`, `notifications_active`, `alarm`, `swap_vert`, `save`, `logout` y `check`. |
| **Menú Móvil Inferior Fijo (Bottom Navigation Bar)** | Toda la interfaz en una sola pantalla larga requería scroll constante para ajustar horarios o forzar el cálculo de tráfico. | Se implementó una barra de navegación inferior fija (`uiCookies` & Material 3): pestaña izquierda **Inicio** (caja de ruta y tarjeta de resumen de viaje), botón central **Actualizar** (centrado al nivel de la barra con `margin: 0`, 46px, con animación de giro para recalcular tráfico en vivo al instante), y pestaña derecha **Ajustes** (tarjeta de horarios y márgenes). |
| **Autoguardado Directo en SQLite por Usuario (`F5` Persistence)** | Al seleccionar pines en el mapa, invertir la ruta o cambiar ajustes en barra, los datos solo quedaban en memoria del DOM del navegador hasta pulsar "Guardar" en la pestaña Ajustes; refrescar con F5 perdía los cambios. | Se creó `saveConfigPartial()` en [public/app.js](file:///c:/Node.js/Alerta-Trafico/public/app.js) que envía `POST /api/config` inmediatamente a la tabla `user_config` de SQLite cuando el usuario confirma un pin en el mapa, invierte la ruta, edita texto manualmente o toca las barras de margen/monitoreo. Además se corrigió `cacheKey` en [server.js](file:///c:/Node.js/Alerta-Trafico/server.js) para alinear las coordenadas en caché. |
| **API Key Compartida del Sistema para Usuarios Nuevos** | Al registrarse nuevos usuarios en multiusuario, su columna `google_maps_api_key` se inicializaba vacía (`""`), forzando el estado amarillo "Modo Simulación" aunque la clave maestra de Google Maps existiera en `config.json`. | Se agregó `getSystemGoogleMapsApiKey()` en [server.js](file:///c:/Node.js/Alerta-Trafico/server.js) (resolviendo env var, `data/config.json`, o admin SQLite) como respaldo global automático en `evaluateUserCommute` y `/api/config`, y se sanitizó la respuesta JSON para no exponer la clave cruda al frontend. |
| **Navbar Superior Fijo Estilo App Móvil** | El encabezado parecía una tarjeta flotante (`div` con bordes redondeados) en lugar de una barra de navegación nativa integrada. | Se promovió `<header class="top-navbar">` fuera de `.container` en [public/index.html](file:///c:/Node.js/Alerta-Trafico/public/index.html) con diseño edge-to-edge (`position: sticky; top: 0`), fondo translúcido difuminado (`backdrop-filter: blur(12px)`), línea inferior limpia y soporte `safe-area-inset-top`, enmarcando simétricamente la app junto con el Bottom Nav inferior. |
| **Fuentes e Iconos Self-Hosted (`/fonts/`)** | Las fuentes de Google Fonts y la fuente variable de Material Symbols (4.0 MB) se descargaban desde servidores externos (`fonts.googleapis.com` / `fonts.gstatic.com`), añadiendo latencia y peso excesivo en conexiones lentas. | Se descargaron y alojaron localmente en [public/fonts/](file:///c:/Node.js/Alerta-Trafico/public/fonts/) `Google Sans`, `Roboto` (latin/latin-ext) y `Material Symbols Outlined` estática (`317 KB`, 12.7x más ligera que la variante de 4.0 MB), servidas con `maxAge: '30d', immutable: true` en [server.js](file:///c:/Node.js/Alerta-Trafico/server.js) y cacheadas en `alerta-trafico-v14` en [public/sw.js](file:///c:/Node.js/Alerta-Trafico/public/sw.js). |

---

## 5. User Preferences & Operating Rules
* **Language:** Always respond to the user in **Spanish** (*"Responde siempre en español"*).
* **Code Integrity:** Maintain documentation integrity; preserve existing comments and docstrings.
* **Verification:** Always test commands and verify endpoints before declaring a deployment complete.
* **Business Vision:** The user envisions scaling this app into a freemium business with a reverse trial (Mapbox for free tier, Google Routes API for premium subscribers). Refer to [esquema_de_negocio.md](file:///c:/Node.js/Alerta-Trafico/esquema_de_negocio.md).
