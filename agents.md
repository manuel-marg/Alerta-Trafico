# 🤖 AGENTS.md: AI Agent System Guidelines

> **Universal Configuration & Instruction Guide for AI Coding Agents**  
> *Workspace: Alerta-Tráfico*

---

## 1. Overview & System Mission
**Alerta-Tráfico** is a lightweight, zero-cost, self-hosted Progressive Web App (PWA) designed to provide dynamic morning commute alarms using real-time traffic data from Google Maps (Routes API) and Web Push notifications.

As an AI agent operating in this repository, your objective is to preserve the project's zero-dependency overhead, high resilience, and compatibility with low-resource environments (specifically Android Termux).

---

## 2. Workspace Structure
```
Alerta-Trafico/
├── server.js               # Core Express backend, Web Push logic & Adaptive Polling Engine
├── package.json            # Node.js dependencies (express, web-push)
├── memory.md               # Dynamic episodic memory & long-term facts for AI agents
├── agents.md               # This agent instruction & role specification file
├── skills.md               # Quick index of specialized procedural skills
├── esquema_de_negocio.md   # Commercial strategy, unit economics & freemium roadmap
├── data/                   # Persistent application storage
│   ├── config.json         # User settings (origin, destination, target time, buffer, API key)
│   ├── subscriptions.json  # Web Push subscription endpoints
│   └── vapid.json          # Generated public/private VAPID keypair
├── public/                 # Static PWA frontend assets
│   ├── index.html          # Main application dashboard
│   ├── styles.css          # Modern dark-mode responsive design
│   ├── app.js              # PWA logic, Leaflet map picker & API communication
│   ├── sw.js               # Service Worker handling background Web Push notifications
│   ├── manifest.json       # Web App Manifest for mobile installation
│   └── icons/              # PWA icons (192x192, 512x512)
└── skills/                 # Procedural skill workflows (SKILL.md)
    ├── deploy-android-termux/
    └── traffic-engine-optimization/
```

---

## 3. Essential Commands

### Local Development (Windows)
* **Install dependencies:** `npm install`
* **Start backend server:** `node server.js`
* **Health check:** `curl http://localhost:3000/api/config`

### Deployment & Synchronization (Android Phone via Termux)
* **Target Host:** `192.168.1.102` (Port `8022`, User: `u0_a141`)
* **Deploy latest code to phone:**
  ```bash
  cd ~/Alerta-Trafico && git pull origin main
  pkill -f "server.js" || true
  ```
* **Verify phone status:**
  ```bash
  ps aux | grep "server.js"
  tail -n 25 ~/server.log
  ```
* **Cloudflare Tunnel Status:**
  `curl -I https://kidney-bruce-hybrid-subsidiary.trycloudflare.com/api/config`

---

## 4. Coding Conventions & Architectural Constraints

1. **Zero Heavy Build Tools:**
   * Do NOT introduce Webpack, Vite, React, Next.js, or TypeScript unless explicitly requested by the user. The app relies on standard Vanilla JS, CSS3, and HTML5 to keep deployment lightweight and instantaneous.
2. **Pure JavaScript Backend Dependencies:**
   * Do not add packages that require C++ native compilation (`node-gyp`), as they frequently fail to compile on ARM Android Termux environments without root.
3. **Adaptive Quota Protection:**
   * Never implement unthrottled or continuous polling loops to Google APIs. Always adhere to the adaptive window algorithm (sleeping at night, progressive intervals in the morning).
4. **Resilience & Safe Stream Redirection:**
   * When executing background processes on the remote Android host over SSH, always redirect stdin, stdout, and stderr (`</dev/null >~/server.log 2>&1 &`) to prevent SSH hanging.

---

## 5. Agent Specialized Roles

When tackling tasks in this repository, adopt one of the following personas:

### 👷 Role 1: DevOps & Android Termux Specialist
* **Responsibilities:** Managing SSH sessions, Termux battery management (`termux-wake-lock`), Cloudflare tunnels, Git sync, and systemd/nohup execution.
* **Skill to activate:** `skills/deploy-android-termux/SKILL.md`

### 🗺️ Role 2: Traffic Engine & API Specialist
* **Responsibilities:** Optimizing Google Routes API payloads (`TRAFFIC_AWARE`), fallback logic (Distance Matrix), quota calculations, and future Mapbox integrations.
* **Skill to activate:** `skills/traffic-engine-optimization/SKILL.md`

### 📱 Role 3: PWA & Push Notification Specialist
* **Responsibilities:** Service worker lifecycle, Web Push VAPID payload delivery, mobile responsiveness, Leaflet pin-drop UX, and local storage caching.

---

## 6. Memory & Knowledge Maintenance
* After resolving a non-trivial bug, discovering an environmental quirk, or modifying system configuration, the agent **MUST** update [`memory.md`](file:///c:/Node.js/Alerta-Trafico/memory.md).
* Keep entries in `memory.md` concise, structured, and factual.
