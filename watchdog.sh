#!/data/data/com.termux/files/usr/bin/bash
# Supervisor automático 24/7 para Alerta-Tráfico
# Reinicia automáticamente Node.js o Cloudflared si el sistema Android los suspende o mata por memoria.

termux-wake-lock 2>/dev/null || true

while true; do
  # 1. Supervisar Node.js
  if ! pgrep -f "node.*server.js" >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ Node.js detenido. Reiniciando con optimización de memoria (64MB)..." >> ~/watchdog.log
    cd /data/data/com.termux/files/home/Alerta-Trafico 2>/dev/null || cd ~/Alerta-Trafico
    nohup node --max-old-space-size=64 --optimize_for_size server.js </dev/null >> ~/server.log 2>&1 &
  fi

  # 2. Supervisar Cloudflared Tunnel
  if ! pgrep -f "cloudflared.*tunnel run alerta" >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ Túnel Cloudflared detenido. Reiniciando conexión..." >> ~/watchdog.log
    nohup cloudflared tunnel run alerta </dev/null >> ~/tunnel.log 2>&1 &
  fi

  sleep 5
done
