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
* **Local Network IP:** `192.168.1.102`
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
  * Active Tunnel URL: `https://kidney-bruce-hybrid-subsidiary.trycloudflare.com`

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
* **Format:** Framework7 v8 (Bundle local offline) + Vanilla JavaScript, HTML5, CSS3.
* **Mobile-First UX:**
  * Native Tabbar inferior (Alarma, Mi Rutina, Mapa de Recorrido).
  * Auto-tema: Material Design en Android, iOS en iPhone.
  * Pull-to-refresh táctil en la pantalla principal para refrescar el tráfico en vivo con un deslizamiento del pulgar.
  * Selector de ubicación con Popup nativo de Framework7 + Leaflet + OpenStreetMap.
* **Service Worker (`public/sw.js`):** Cache offline v2 incluyendo assets locales de Framework7, intercepta push events y entrega notificaciones sonoras con vibración.

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

---

## 5. User Preferences & Operating Rules
* **Language:** Always respond to the user in **Spanish** (*"Responde siempre en español"*).
* **Code Integrity:** Maintain documentation integrity; preserve existing comments and docstrings.
* **Verification:** Always test commands and verify endpoints before declaring a deployment complete.
* **Business Vision:** The user envisions scaling this app into a freemium business with a reverse trial (Mapbox for free tier, Google Routes API for premium subscribers). Refer to [esquema_de_negocio.md](file:///c:/Node.js/Alerta-Trafico/esquema_de_negocio.md).
