(() => {
  'use strict';

  const state = {
    authenticated: false,
    keySource: 'file',
    dashboard: null,
    filter: 'all',
    search: '',
    sort: 'month_desc',
    deleteTargetUser: null
  };

  // --- DOM Helpers ---
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString('es-VE');
  }

  function formatTime12h(hhmm) {
    if (!hhmm || !hhmm.includes(':')) return hhmm || '--:--';
    const [hStr, mStr] = hhmm.split(':');
    const h = parseInt(hStr, 10);
    if (Number.isNaN(h)) return hhmm;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${mStr} ${ampm}`;
  }

  function formatDateShort(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-VE', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  function formatRelativeTime(isoStr) {
    if (!isoStr) return 'Sin registros';
    const diffMs = Date.now() - new Date(isoStr).getTime();
    if (Number.isNaN(diffMs)) return '—';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Hace un momento';
    if (mins < 60) return `Hace ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return `Hace ${days} d`;
  }

  function formatUptime(seconds) {
    const s = Number(seconds || 0);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function showToast(message, type = 'info') {
    const container = $('toast-container');
    if (!container) return;

    const iconMap = {
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      info: 'info'
    };

    const el = document.createElement('div');
    el.className = `toast-item ${type}`;
    el.innerHTML = `
      <span class="material-symbols-outlined">${iconMap[type] || 'info'}</span>
      <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.2s ease';
      setTimeout(() => el.remove(), 220);
    }, 3400);
  }

  async function apiFetch(url, options = {}) {
    const resp = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 401 && url !== '/api/admin/login' && url !== '/api/admin/change-key') {
      showLoginScreen();
      throw new Error(data.error || 'Sesión expirada');
    }
    if (!resp.ok) {
      throw new Error(data.error || `Error HTTP ${resp.status}`);
    }
    return data;
  }

  // --- Screen Switching ---
  function showLoginScreen() {
    state.authenticated = false;
    $('admin-dashboard-screen').style.display = 'none';
    $('admin-login-screen').style.display = 'flex';
    setTimeout(() => $('admin-access-key')?.focus(), 50);
  }

  function showDashboardScreen() {
    state.authenticated = true;
    $('admin-login-screen').style.display = 'none';
    $('admin-dashboard-screen').style.display = 'block';
  }

  function openModal(id) {
    const modal = $(id);
    if (modal) modal.style.display = 'flex';
  }

  function closeModal(id) {
    const modal = $(id);
    if (modal) modal.style.display = 'none';
  }

  // --- Auth Flow ---
  async function checkSession() {
    try {
      const me = await apiFetch('/api/admin/me');
      state.keySource = me.keySource || 'file';
      if (me.authenticated) {
        showDashboardScreen();
        await loadDashboard();
      } else {
        showLoginScreen();
      }
    } catch (err) {
      showLoginScreen();
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    const input = $('admin-access-key');
    const errorBox = $('login-error');
    const btn = $('btn-admin-login');
    const accessKey = input.value.trim();

    errorBox.style.display = 'none';
    if (!accessKey) return;

    btn.disabled = true;
    try {
      const res = await apiFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ accessKey })
      });
      state.keySource = res.keySource || state.keySource;
      input.value = '';
      showDashboardScreen();
      await loadDashboard();
      showToast('Bienvenido al panel de administración', 'success');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
      input.focus();
    } finally {
      btn.disabled = false;
    }
  }

  async function handleLogout() {
    try {
      await apiFetch('/api/admin/logout', { method: 'POST' });
    } catch (e) {}
    showLoginScreen();
    showToast('Sesión de administrador cerrada', 'info');
  }

  // --- Load & Render Dashboard ---
  async function loadDashboard() {
    const refreshIcon = $('refresh-icon');
    if (refreshIcon) refreshIcon.classList.add('spinning');

    try {
      const data = await apiFetch('/api/admin/dashboard');
      state.dashboard = data;
      state.keySource = data.systemInfo?.adminKeySource || state.keySource;
      renderAll();
      $('last-updated-time').textContent = new Date().toLocaleTimeString('es-VE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (refreshIcon) refreshIcon.classList.remove('spinning');
    }
  }

  function renderAll() {
    if (!state.dashboard) return;
    renderKPIs();
    renderDailyChart();
    renderSystemInfo();
    renderUsersTable();
    renderRecentLogs();
  }

  function renderKPIs() {
    const s = state.dashboard.summary || {};
    $('kpi-total-users').textContent = formatNumber(s.totalUsers);
    $('kpi-users-meta').textContent = `${formatNumber(s.activeMonitoringUsers)} activos • ${formatNumber(s.usersWithPush)} con Push`;

    $('kpi-requests-today').textContent = formatNumber(s.requestsToday);
    $('kpi-today-meta').textContent = `${formatNumber(s.pausedUsers)} usuario(s) pausado(s)`;

    const monthCount = Number(s.requestsMonth || 0);
    const freeTierLimit = 10000;
    const pct = Math.min(100, (monthCount / freeTierLimit) * 100);
    $('kpi-requests-month').textContent = formatNumber(monthCount);
    $('kpi-month-quota-bar').style.width = `${pct.toFixed(1)}%`;
    $('kpi-month-meta').textContent = `${pct.toFixed(1)}% de 10,000 gratis/mes (${formatNumber(s.systemKeyRequestsMonth)} clave sistema)`;

    $('kpi-requests-total').textContent = formatNumber(s.requestsTotal);
    $('kpi-total-meta').textContent = `Routes: ${formatNumber(s.routesApiTotal)} • Matrix: ${formatNumber(s.distanceMatrixTotal)} • Errores: ${formatNumber(s.failedRequestsTotal)}`;
  }

  function renderDailyChart() {
    const container = $('daily-chart');
    const series = state.dashboard.dailyChart || [];
    const maxVal = Math.max(1, ...series.map((d) => d.total));

    container.innerHTML = series
      .map((day) => {
        const successPct = (day.success / maxVal) * 100;
        const failedPct = (day.failed / maxVal) * 100;
        const [, m, d] = day.date.split('-');
        const label = `${d}/${m}`;
        const title = `${day.date}: ${day.total} peticiones (${day.success} exitosas, ${day.failed} fallidas)`;

        return `
          <div class="chart-col" title="${escapeHtml(title)}">
            <span class="chart-count">${day.total > 0 ? formatNumber(day.total) : ''}</span>
            <div class="chart-bar-track">
              ${day.failed > 0 ? `<div class="chart-bar-failed" style="height: ${failedPct.toFixed(1)}%;"></div>` : ''}
              ${day.success > 0 ? `<div class="chart-bar-success" style="height: ${successPct.toFixed(1)}%;"></div>` : ''}
            </div>
            <span class="chart-day-label">${escapeHtml(label)}</span>
          </div>
        `;
      })
      .join('');
  }

  function renderSystemInfo() {
    const info = state.dashboard.systemInfo || {};
    $('sys-memory').textContent = `${info.memoryRssMb ?? '--'} MB (Heap: ${info.memoryHeapMb ?? '--'} MB)`;
    $('sys-uptime').textContent = formatUptime(info.uptimeSeconds);
    $('sys-db-size').textContent = `${info.dbSizeKb ?? 0} KB`;
    $('sys-cache-size').textContent = `${info.trafficCacheEntries ?? 0} ruta(s)`;
    $('sys-google-key').textContent = info.hasSystemApiKey
      ? `Activa (${info.maskedSystemKey})`
      : 'No configurada (Simulación)';
    $('sys-admin-source').textContent =
      info.adminKeySource === 'env' ? 'Variable ADMIN_KEY (.env)' : 'Archivo data/admin.json';
  }

  function getFilteredAndSortedUsers() {
    const users = state.dashboard?.users || [];
    const q = state.search.trim().toLowerCase();

    const filtered = users.filter((u) => {
      if (state.filter === 'active' && !u.enabled) return false;
      if (state.filter === 'paused' && u.enabled) return false;
      if (state.filter === 'push' && u.pushDevicesCount === 0) return false;
      if (state.filter === 'consuming' && u.apiUsage.total === 0) return false;

      if (q) {
        const haystack = `${u.name} ${u.email} ${u.origin} ${u.destination}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      switch (state.sort) {
        case 'today_desc':
          return b.apiUsage.today - a.apiUsage.today || b.apiUsage.month - a.apiUsage.month;
        case 'total_desc':
          return b.apiUsage.total - a.apiUsage.total;
        case 'newest':
          return new Date(b.createdAt) - new Date(a.createdAt);
        case 'name_asc':
          return a.name.localeCompare(b.name, 'es');
        case 'month_desc':
        default:
          return b.apiUsage.month - a.apiUsage.month || b.apiUsage.total - a.apiUsage.total;
      }
    });
  }

  function renderUsersTable() {
    const tbody = $('users-table-body');
    const empty = $('users-empty-state');
    const table = $('users-table');

    const allUsers = state.dashboard?.users || [];
    const maxMonth = Math.max(1, ...allUsers.map((u) => u.apiUsage.month));
    const list = getFilteredAndSortedUsers();

    if (list.length === 0) {
      table.style.display = 'none';
      empty.style.display = 'block';
      tbody.innerHTML = '';
      return;
    }

    table.style.display = 'table';
    empty.style.display = 'none';

    tbody.innerHTML = list
      .map((u) => {
        const initial = (u.name || u.email || 'U').trim().charAt(0).toUpperCase();
        const barPct = Math.round((u.apiUsage.month / maxMonth) * 100);
        const routeText = u.hasRouteConfigured
          ? `${escapeHtml(u.origin)} ➔ ${escapeHtml(u.destination)}`
          : 'Ruta sin configurar';

        const keyBadge = u.hasOwnApiKey
          ? '<span class="pill-badge pill-blue">Clave Propia</span>'
          : '<span class="pill-badge pill-gray">Clave Sistema</span>';

        const pushBadge =
          u.pushDevicesCount > 0
            ? `<span class="pill-badge pill-green">${u.pushDevicesCount} Push</span>`
            : '<span class="pill-badge pill-orange">Sin Push</span>';

        const statusBadge = u.enabled
          ? '<span class="pill-badge pill-green">Activo</span>'
          : '<span class="pill-badge pill-gray">Pausado</span>';

        const toggleIcon = u.enabled ? 'pause_circle' : 'play_circle';
        const toggleTitle = u.enabled ? 'Pausar monitoreo' : 'Reactivar monitoreo';
        const toggleClass = u.enabled ? 'warn' : 'success';

        return `
          <tr data-user-id="${escapeHtml(u.id)}">
            <td>
              <div class="user-cell">
                <div class="user-avatar">${escapeHtml(initial)}</div>
                <div>
                  <div class="user-name">${escapeHtml(u.name)}</div>
                  <div class="user-email">${escapeHtml(u.email)}</div>
                  <div class="user-created">Registro: ${escapeHtml(formatDateShort(u.createdAt))}</div>
                </div>
              </div>
            </td>
            <td>
              <div class="route-cell">
                <div class="route-path">${routeText}</div>
                <div class="route-badges">
                  <span class="pill-badge pill-gray">Meta ${escapeHtml(formatTime12h(u.targetArrivalTime))}</span>
                  ${pushBadge}
                  ${keyBadge}
                </div>
              </div>
            </td>
            <td>
              <div class="usage-cell">
                <div class="usage-numbers">
                  <span class="usage-stat"><strong>${formatNumber(u.apiUsage.today)}</strong> hoy</span>
                  <span class="usage-stat"><strong>${formatNumber(u.apiUsage.month)}</strong> mes</span>
                  <span class="usage-stat"><strong>${formatNumber(u.apiUsage.total)}</strong> total</span>
                </div>
                <div class="usage-bar-track">
                  <div class="usage-bar-fill" style="width: ${barPct}%;"></div>
                </div>
                <div class="usage-submeta">
                  Auto: ${formatNumber(u.apiUsage.cronTotal)} • Manual: ${formatNumber(u.apiUsage.manualTotal)}
                  ${u.apiUsage.errorTotal > 0 ? `• <span style="color:var(--red)">${u.apiUsage.errorTotal} err</span>` : ''}
                  • ${escapeHtml(formatRelativeTime(u.apiUsage.lastCallAt))}
                </div>
              </div>
            </td>
            <td>${statusBadge}</td>
            <td>
              <div class="actions-cell">
                <button type="button" class="action-chip-btn" data-action="detail" data-id="${escapeHtml(u.id)}" title="Ver detalle y logs">
                  <span class="material-symbols-outlined">visibility</span>
                </button>
                <button type="button" class="action-chip-btn ${toggleClass}" data-action="toggle" data-id="${escapeHtml(u.id)}" data-enabled="${u.enabled}" title="${toggleTitle}">
                  <span class="material-symbols-outlined">${toggleIcon}</span>
                </button>
                <button type="button" class="action-chip-btn" data-action="push" data-id="${escapeHtml(u.id)}" title="Enviar Push de prueba">
                  <span class="material-symbols-outlined">notifications_active</span>
                </button>
                <button type="button" class="action-chip-btn danger" data-action="delete" data-id="${escapeHtml(u.id)}" title="Eliminar usuario">
                  <span class="material-symbols-outlined">delete</span>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function renderRecentLogs() {
    const logs = state.dashboard?.recentLogs || [];
    const tbody = $('recent-logs-body');
    const empty = $('recent-logs-empty');
    const table = $('recent-logs-table');
    $('recent-logs-count').textContent = `${logs.length} registros`;

    if (logs.length === 0) {
      table.style.display = 'none';
      empty.style.display = 'block';
      tbody.innerHTML = '';
      return;
    }

    table.style.display = 'table';
    empty.style.display = 'none';

    tbody.innerHTML = logs
      .map((l) => {
        const providerBadge =
          l.provider === 'routes_api'
            ? '<span class="pill-badge pill-blue">Routes API</span>'
            : '<span class="pill-badge pill-orange">Distance Matrix</span>';

        const sourceBadge =
          l.source === 'manual'
            ? '<span class="pill-badge pill-gray">Manual</span>'
            : '<span class="pill-badge pill-gray">Auto (Cron)</span>';

        const keyBadge = l.usedSystemKey
          ? '<span class="pill-badge pill-gray">Sistema</span>'
          : '<span class="pill-badge pill-blue">Propia</span>';

        const resultBadge = l.success
          ? `<span class="pill-badge pill-green">OK (${l.statusCode})${l.durationMinutes ? ` • ${l.durationMinutes} min` : ''}</span>`
          : `<span class="pill-badge pill-red" title="${escapeHtml(l.errorMessage || '')}">Error (${l.statusCode ?? 0})</span>`;

        return `
          <tr>
            <td>${escapeHtml(formatDateTime(l.createdAt))}</td>
            <td>
              <strong>${escapeHtml(l.userName)}</strong>
              <div class="user-email">${escapeHtml(l.userEmail)}</div>
            </td>
            <td>${providerBadge}</td>
            <td>${sourceBadge}</td>
            <td>${keyBadge}</td>
            <td>${resultBadge}</td>
          </tr>
        `;
      })
      .join('');
  }

  // --- User Actions ---
  async function openUserDetail(userId) {
    $('detail-user-name').textContent = 'Cargando...';
    $('detail-user-email').textContent = '';
    $('user-detail-body').innerHTML = '<p style="color: var(--text-secondary);">Obteniendo información...</p>';
    openModal('user-detail-modal');

    try {
      const data = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`);
      const { user, config, pushDevicesCount, activeSessionsCount, logs } = data;
      $('detail-user-name').textContent = user.name;
      $('detail-user-email').textContent = `${user.email} • ID: ${user.id}`;

      const logsHtml =
        logs.length === 0
          ? '<p style="color: var(--text-secondary); font-size: 0.85rem;">Este usuario aún no tiene peticiones registradas a Google API.</p>'
          : `
            <div class="table-responsive">
              <table class="logs-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Proveedor</th>
                    <th>Origen</th>
                    <th>Clave</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  ${logs
                    .map((l) => {
                      const status = l.success
                        ? `<span class="pill-badge pill-green">OK (${l.durationMinutes ?? '--'} min)</span>`
                        : `<span class="pill-badge pill-red">${escapeHtml(l.errorMessage || `HTTP ${l.statusCode}`)}</span>`;
                      return `
                        <tr>
                          <td>${escapeHtml(formatDateTime(l.createdAt))}</td>
                          <td>${l.provider === 'routes_api' ? 'Routes API' : 'Distance Matrix'}</td>
                          <td>${l.source === 'manual' ? 'Manual' : 'Auto'}</td>
                          <td>${l.usedSystemKey ? 'Sistema' : 'Propia'}</td>
                          <td>${status}</td>
                        </tr>
                      `;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
          `;

      $('user-detail-body').innerHTML = `
        <div class="detail-grid">
          <div class="detail-box">
            <div class="detail-box-label">Ruta configurada</div>
            <div class="detail-box-value">${escapeHtml(config.origin)} ➔ ${escapeHtml(config.destination)}</div>
          </div>
          <div class="detail-box">
            <div class="detail-box-label">Horario y Márgenes</div>
            <div class="detail-box-value">Meta ${escapeHtml(formatTime12h(config.targetArrivalTime))} • Margen ${config.bufferMinutes}m • Ventana ${config.monitoringWindowMinutes}m</div>
          </div>
          <div class="detail-box">
            <div class="detail-box-label">Dispositivos Push y Sesiones</div>
            <div class="detail-box-value">${pushDevicesCount} dispositivo(s) Push • ${activeSessionsCount} sesión(es)</div>
          </div>
          <div class="detail-box">
            <div class="detail-box-label">API Key de Google Maps</div>
            <div class="detail-box-value">${config.hasOwnApiKey ? `Propia (${escapeHtml(config.maskedOwnApiKey)})` : 'Usa clave maestra del sistema'}</div>
          </div>
        </div>
        <div class="detail-logs-title">Últimas ${logs.length} peticiones a Google API</div>
        ${logsHtml}
      `;
    } catch (err) {
      $('user-detail-body').innerHTML = `<div class="inline-alert inline-alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  async function toggleUserStatus(userId, currentEnabled) {
    try {
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !currentEnabled })
      });
      showToast(res.message, 'success');
      await loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function sendTestPush(userId) {
    try {
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/test-push`, {
        method: 'POST'
      });
      if (res.totalDevices === 0) {
        showToast('Este usuario no tiene dispositivos Push suscritos.', 'warning');
      } else {
        showToast(`Push enviado a ${res.sentTo} de ${res.totalDevices} dispositivo(s).`, 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function promptDeleteUser(userId) {
    const user = (state.dashboard?.users || []).find((u) => u.id === userId);
    if (!user) return;
    state.deleteTargetUser = user;
    $('delete-target-name').textContent = user.name;
    $('delete-target-email').textContent = user.email;
    openModal('delete-user-modal');
  }

  async function confirmDeleteUser() {
    if (!state.deleteTargetUser) return;
    const btn = $('btn-confirm-delete-user');
    btn.disabled = true;
    try {
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(state.deleteTargetUser.id)}`, {
        method: 'DELETE'
      });
      closeModal('delete-user-modal');
      state.deleteTargetUser = null;
      showToast(res.message, 'success');
      await loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function openChangeKeyModal() {
    $('change-key-error').style.display = 'none';
    $('change-key-form').reset();
    if (state.keySource === 'env') {
      $('change-key-env-notice').style.display = 'block';
      $('change-key-form').style.display = 'none';
    } else {
      $('change-key-env-notice').style.display = 'none';
      $('change-key-form').style.display = 'block';
    }
    openModal('change-key-modal');
  }

  async function handleChangeKey(e) {
    e.preventDefault();
    const errorBox = $('change-key-error');
    const btn = $('btn-save-new-key');
    const currentKey = $('current-admin-key').value.trim();
    const newKey = $('new-admin-key').value.trim();

    errorBox.style.display = 'none';
    btn.disabled = true;

    try {
      const res = await apiFetch('/api/admin/change-key', {
        method: 'POST',
        body: JSON.stringify({ currentKey, newKey })
      });
      closeModal('change-key-modal');
      showToast(res.message, 'success');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  }

  // --- Event Listeners ---
  document.addEventListener('DOMContentLoaded', () => {
    $('admin-login-form').addEventListener('submit', handleLogin);

    $('btn-toggle-key-visibility').addEventListener('click', () => {
      const input = $('admin-access-key');
      const icon = $('btn-toggle-key-visibility').querySelector('.material-symbols-outlined');
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      icon.textContent = isPassword ? 'visibility_off' : 'visibility';
    });

    $('btn-refresh-dashboard').addEventListener('click', loadDashboard);
    $('btn-admin-logout').addEventListener('click', handleLogout);
    $('btn-open-key-modal').addEventListener('click', openChangeKeyModal);
    $('change-key-form').addEventListener('submit', handleChangeKey);
    $('btn-confirm-delete-user').addEventListener('click', confirmDeleteUser);

    $('user-search-input').addEventListener('input', (e) => {
      state.search = e.target.value;
      renderUsersTable();
    });

    $('user-sort-select').addEventListener('change', (e) => {
      state.sort = e.target.value;
      renderUsersTable();
    });

    $('user-filter-pills').addEventListener('click', (e) => {
      const pill = e.target.closest('.filter-pill');
      if (!pill) return;
      document.querySelectorAll('.filter-pill').forEach((el) => el.classList.remove('active'));
      pill.classList.add('active');
      state.filter = pill.dataset.filter || 'all';
      renderUsersTable();
    });

    $('users-table-body').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'detail') openUserDetail(id);
      else if (action === 'toggle') toggleUserStatus(id, btn.dataset.enabled === 'true');
      else if (action === 'push') sendTestPush(id);
      else if (action === 'delete') promptDeleteUser(id);
    });

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
    });

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.style.display = 'none';
      });
    });

    checkSession();
  });
})();
