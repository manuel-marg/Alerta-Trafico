---
name: deploy-android-termux
description: Procedural workflow for deploying, updating, and managing the Alerta-Tráfico Node.js application and Cloudflare tunnel on an Android phone running Termux over SSH.
---

# Deploy & Manage on Android Termux

This skill provides step-by-step procedures for managing the production environment on the secondary Android phone.

## Target Machine Specifications
* **IP:** `192.168.1.102`
* **Port:** `8022`
* **User:** `u0_a141`
* **Password:** `24674967`
* **Repository Path:** `~/Alerta-Trafico`
* **Log Path:** `~/server.log`

---

## Standard Procedures

### 1. Synchronize Code from Git & Restart Server
Run the following script via Paramiko or SSH client:
```python
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.102', port=8022, username='u0_a141', password='24674967', banner_timeout=30)

commands = [
    # 1. Pull latest changes from main
    'cd ~/Alerta-Trafico && git pull origin main',
    # 2. Terminate running node instance (watchdog auto-relaunches with flags)
    'pkill -f "server.js" || true',
]

for cmd in commands:
    stdin, stdout, stderr = ssh.exec_command(cmd)
    stdout.channel.recv_exit_status()

# Verify process
stdin, stdout, stderr = ssh.exec_command('ps aux | grep "server.js"')
print(stdout.read().decode('utf-8', errors='replace'))
ssh.close()
```

### 2. Ensuring 24/7 Phone Wake Lock & Auto-Start
On Termux, ensure the Android CPU does not enter deep sleep:
```bash
termux-wake-lock
```

Auto-start configurations installed:
* **Interactive startup:** `~/.bashrc` automatically runs `bash ~/start.sh` if `node server.js` is not active.
* **Boot-time startup:** `~/.termux/boot/start-alerta.sh` is configured to run at Android startup (requires Termux:Boot add-on).

### 3. Cloudflare Quick Tunnel Management
If the tunnel terminates or restarts:
```bash
# Check if running
pgrep -f cloudflared

# Launch new quick tunnel
nohup cloudflared tunnel --url http://localhost:3000 </dev/null >~/tunnel.log 2>&1 &

# Read the newly assigned URL
grep -o "https://[a-zA-Z0-9.-]*\.trycloudflare\.com" ~/tunnel.log | tail -n 1
```

### 4. Reading Live Server Logs
```bash
tail -n 50 ~/server.log
```
