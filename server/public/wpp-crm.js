/* ================================================================
   Veltris WhatsApp CRM - Application Logic
   Depends on: api.js (window._supaGet, _supaPost, _supaPatch)
   ================================================================ */
window.VeltrisWPP = (() => {
  const S = {
    sessions: [],
    activeSessionId: null,
    chats: [],
    activeChatId: null,
    messages: [],
    contacts: {},
    cadences: [],
    activeCadenceId: null,
    agenda: [],
    leads: [],
    stages: ['agendado', 'realizado', 'cancelado'],
    metrics: null,
    connected: false,
    qrCode: null,
    ws: null,
    wsReconnectTimer: null,
    realtimeSub: null,
    pollingInterval: null,
    realtimeInterval: null,
    currentUser: null,
    activeView: 'dashboard',
  };

  function el(id) { return document.getElementById(id); }
  function qs(s, ctx) { return (ctx || document).querySelector(s); }
  function qsa(s, ctx) { return (ctx || document).querySelectorAll(s); }

  function escHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  function formatDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    const now = new Date();
    const diff = now - dt;
    if (diff < 60000) return 'agora';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    if (diff < 172800000) return 'ontem';
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  function formatTime(d) {
    if (!d) return '';
    return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function formatFullDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function initials(n) {
    if (!n) return '?';
    return n.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  }
  function stageColor(stage) {
    const colors = {
      agendado: '#3b82f6',
      realizado: '#22c55e',
      cancelado: '#ef4444',
    };
    return colors[stage] || '#6b7280';
  }
  function stageLabel(stage) {
    const labels = {
      agendado: 'Agendado',
      realizado: 'Realizado',
      cancelado: 'Cancelado',
    };
    return labels[stage] || stage;
  }

  /* ----------------------------- API helpers ----------------------------- */
  async function apiGet(table, params) {
    if (S._serverSessionId) { window._supabaseBlocked = true; return []; }
    try {
      var result = await window._supaGet(table, params);
      return result.data || [];
    } catch (e) {
      return [];
    }
  }
  async function apiPost(table, data) {
    try {
      if (window._supaPost) return await window._supaPost(table, data);
      var h = { 'Content-Type': 'application/json', 'apikey': (window._supabaseKey || ''), 'Prefer': 'return=representation' };
      if (window.api && window.api.token) h['Authorization'] = 'Bearer ' + window.api.token;
      var res = await fetch((window._supabaseUrl || '') + '/rest/v1/' + table, { method: 'POST', headers: h, body: JSON.stringify(data) });
      if (res.status === 401) return null;
      if (!res.ok) return null;
      var json = await res.json();
      return Array.isArray(json) ? json[0] : json;
    } catch (e) { if (typeof console !== 'undefined' && console.error) { console.error('apiPost error'); } return null; }
  }
  async function apiPatch(table, id, data) {
    try {
      return await window._supaPatch(table, 'id=eq.' + encodeURIComponent(id), data);
    } catch (e) { if (typeof console !== 'undefined' && console.error) { console.error('apiPatch error'); } return null; }
  }

  /* ----------------------------- Tab System ----------------------------- */
  function switchTab(tabId) {
    S.activeView = tabId;
    qsa('.wpp-tab-content').forEach(el => el.classList.remove('active'));
    qsa('.wpp-tab-btn').forEach(el => el.classList.remove('active'));
    const content = el('wppTab' + tabId.charAt(0).toUpperCase() + tabId.slice(1));
    const btn = qs(`[data-wpp-tab="${tabId}"]`);
    if (content) content.classList.add('active');
    if (btn) btn.classList.add('active');
    renderCurrentView();
  }

  function initTabs() {
    qsa('[data-wpp-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.wppTab));
    });
  }

  /* ----------------------------- Render Router ----------------------------- */
  function renderCurrentView() {
    switch (S.activeView) {
      case 'whatsapp': renderWhatsapp(); break;
      case 'clientes': renderClientes(); break;
      case 'agenda': renderAgenda(); break;
      case 'metricas': renderMetricas(); break;
      case 'disparos': renderDisparos(); break;
      case 'tags': renderTags(); break;
    }
  }

  /* ============================ CONNECTION ============================ */
  async function loadSessions() {
    if (!window.api || !api.isLoggedIn()) { S.sessions = []; return; }
    // Try to find active server session
    try {
      var companyId = (typeof window._companyMode !== 'undefined' && window._companyMode) ? window._companyMode.id : null;
      var sessUrl = _wppServerUrl + '/sessions' + (companyId ? '?company_id=' + encodeURIComponent(companyId) : '');
      var listResp = await fetch(sessUrl)
      if (listResp.ok) {
        var listData = await listResp.json()
        var filteredSessions = (listData.sessions || []).filter(function(s) { return !companyId || !s.companyId || String(s.companyId) === String(companyId) })
        var activeSrv = filteredSessions.find(function(s) { return s.status === 'connected' }) || filteredSessions.find(function(s) { return s.status !== 'disconnected' })
        if (activeSrv) {
          S._serverSessionId = activeSrv.sessionId
          S.activeSessionId = activeSrv.sessionId
          S.connected = activeSrv.status === 'connected'
          S.sessions = [{ id: activeSrv.sessionId, status: activeSrv.status, phone: activeSrv.phone }]
          saveWppSession(activeSrv.sessionId)
          renderConnectionStatus()
          if (S.connected) {
            startPolling()
            startRealtime()
            loadChats()
          } else {
            startWppServerPoll(activeSrv.sessionId)
          }
          return
        }
      }
    } catch (e) {}
    S.sessions = await apiGet('whatsapp_sessions', S.currentUser ? { user_id: 'eq.' + S.currentUser } : {});
    S.activeSessionId = S.sessions.find(s => s.status === 'connected')?.id || null;
    S.connected = !!S.activeSessionId;
    if (S.activeSessionId) saveWppSession(S.activeSessionId);
    renderConnectionStatus();
    if (S.connected) {
      startPolling();
      startRealtime();
    }
  }

  function renderConnectionStatus() {
    var container = el('wppConnectionStatus');
    if (!container) return;
    var session = S.sessions.find(function (s) { return s.id === S.activeSessionId; }) || S.sessions[0];
    if (S.connected) {
      container.innerHTML =
        '<div class="wpp-connect-card">' +
          '<div class="wpp-connect-status">' +
            '<span class="wpp-status-dot connected"></span>' +
            '<span style="font-size:0.82rem;color:var(--text);font-weight:600">WhatsApp Conectado</span>' +
            (session ? '<span style="font-size:0.68rem;color:var(--text-muted)">' + escHtml(session.phone || session.name || 'WhatsApp') + '</span>' : '') +
          '</div>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="btn btn-outline" onclick="VeltrisWPP.disconnect()" style="font-size:0.72rem">Desconectar</button>' +
          '</div>' +
        '</div>';
    } else {
      var activeSession = S.sessions.find(function (s) { return s.status === 'connecting' || s.status === 'expired'; });
      if (activeSession && activeSession.qr_code) {
        S.qrCode = activeSession.qr_code;
        container.innerHTML =
          '<div class="wpp-connect-card" style="flex-direction:column;align-items:center">' +
            '<div class="wpp-connect-status">' +
              '<span class="wpp-status-dot ' + (activeSession.status === 'expired' ? 'expired' : 'connecting') + '"></span>' +
              '<span style="font-size:0.82rem;color:var(--text);font-weight:600">' +
                (activeSession.status === 'expired' ? 'QR Expirado' : 'Aguardando Leitura...') +
              '</span>' +
            '</div>' +
            '<div class="wpp-qr-container">' +
              '<img src="' + escHtml(activeSession.qr_code) + '" alt="QR Code" />' +
              '<p>Aponte a câmera do WhatsApp para este QR Code</p>' +
            '</div>' +
            '<button class="btn btn-outline" onclick="VeltrisWPP.newSession()" style="font-size:0.75rem">Gerar Novo QR</button>' +
          '</div>';
      } else if (activeSession) {
        var conectandoMsg = S._lastQr ? 'Conectando...' : 'Gerando QR Code...'
        container.innerHTML =
          '<div class="wpp-connect-card" style="flex-direction:column;align-items:center">' +
            '<div class="wpp-connect-status">' +
              '<span class="wpp-status-dot connecting"></span>' +
              '<span style="font-size:0.82rem;color:var(--text);font-weight:600">' + conectandoMsg + '</span>' +
            '</div>' +
            '<button class="btn btn-outline" onclick="VeltrisWPP.newSession()" style="font-size:0.75rem">' + (S._lastQr ? 'Cancelar' : 'Gerar Novo QR') + '</button>' +
          '</div>';
      } else {
        var serverHint = window._wppServerPoll ? '' : '<div style="font-size:0.65rem;color:var(--text-muted);margin-top:6px">Servidor: ' + _wppServerUrl + '</div>';
        container.innerHTML =
          '<div class="wpp-connect-card">' +
            '<div class="wpp-connect-status">' +
              '<span class="wpp-status-dot disconnected"></span>' +
              '<span style="font-size:0.82rem;color:var(--text-muted)">WhatsApp Desconectado</span>' +
            '</div>' +
            '<button class="btn btn-save" onclick="VeltrisWPP.newSession()" style="font-size:0.78rem">Conectar WhatsApp</button>' +
            serverHint +
          '</div>';
      }
    }
  }

  var _wppServerUrl = window.location.port === '3123' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3123' : 'https://server-production-d7c0.up.railway.app'

  function getServerSessionId() {
    return S._serverSessionId || null
  }

  function saveWppSession(sessionId) {
    try { localStorage.setItem('wpp_session_' + (S.currentUser || 'default'), sessionId) } catch (e) {}
  }

  function loadWppSession() {
    try { return localStorage.getItem('wpp_session_' + (S.currentUser || 'default')) } catch (e) { return null }
  }

  function clearWppSession() {
    try { localStorage.removeItem('wpp_session_' + (S.currentUser || 'default')) } catch (e) {}
  }

  async function restoreWppSession() {
    var sid = loadWppSession()
    if (!sid) return false
    try {
      var hResp = await fetch(_wppServerUrl + '/health?sessionId=' + encodeURIComponent(sid))
      if (hResp.ok) {
        var hData = await hResp.json()
        if (hData.connected) {
          S._serverSessionId = sid; S.activeSessionId = sid; S.connected = true
          S.sessions = [{ id: sid, status: 'connected', phone: hData.phone }]
          renderConnectionStatus(); startPolling(); startRealtime(); loadChats()
          return true
        }
        if (hData.status === 'connecting' || hData.status === 'unknown') {
          S._serverSessionId = sid; S.activeSessionId = sid
          S.sessions = [{ id: sid, status: 'connecting' }]
          renderConnectionStatus(); startWppServerPoll(sid)
          return true
        }
      }
    } catch (e) {}
    clearWppSession()
    return false
  }

  async function newSession() {
    if (typeof console !== 'undefined') console.log('newSession() called')
    var sessId = null
    try {
      var connCompanyId = (typeof window._companyMode !== 'undefined' && window._companyMode) ? window._companyMode.id : null;
      var connUrl = _wppServerUrl + '/connect?user_id=' + encodeURIComponent(S.currentUser || '') + (connCompanyId ? '&company_id=' + encodeURIComponent(connCompanyId) : '');
      var resp = await fetch(connUrl)
      if (resp.ok) {
        var data = await resp.json()
        sessId = data.sessionId
      } else {
        var errText = await resp.text().catch(function() { return '' })
        if (typeof console !== 'undefined') console.warn('Server connect failed:', resp.status, errText)
        if (typeof showToast !== 'undefined') showToast('Servidor retornou erro ' + resp.status + '. Verifique o terminal do servidor.')
      }
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('Server connect error:', e.message)
      if (typeof showToast !== 'undefined') showToast('Erro de conexão com servidor: ' + e.message)
    }

    if (sessId) {
      S._serverSessionId = sessId; S.activeSessionId = sessId
      S.sessions = [{ id: sessId, status: 'connecting' }]
      // Don't save to localStorage until connected (avoid overwriting an active session)
      renderConnectionStatus()
      startWppServerPoll(sessId)
      if (typeof showToast !== 'undefined') showToast('Conectando WhatsApp...')
      return
    }

    if (typeof showToast !== 'undefined') showToast('Servidor WhatsApp não encontrado em ' + _wppServerUrl + '. Verifique se o servidor está rodando.')
    renderConnectionStatus()
  }

  function startWppServerPoll(sessionId) {
    if (window._wppServerPoll) clearInterval(window._wppServerPoll)
    var pollCount = 0
    var qrShown = false
    window._wppServerPoll = setInterval(async function () {
      pollCount++
      try {
        var qrResp = await fetch(_wppServerUrl + '/qr?sessionId=' + encodeURIComponent(sessionId))
        if (qrResp.ok) {
          var qrData = await qrResp.json()
          if (qrData.qr_code && qrData.qr_code !== S._lastQr) {
            S._lastQr = qrData.qr_code
            qrShown = true
            S.sessions = [{ id: sessionId, qr_code: qrData.qr_code, status: 'connecting' }]
            renderConnectionStatus()
          } else if (!qrData.qr_code && qrShown) {
            S.sessions = [{ id: sessionId, qr_code: null, status: 'connecting' }]
            renderConnectionStatus()
          }
        }
        // Check health for connected status
        var healthResp = await fetch(_wppServerUrl + '/health?sessionId=' + encodeURIComponent(sessionId))
        if (healthResp.ok) {
          var hData = await healthResp.json()
          if (hData.connected) {
            S.connected = true; S.activeSessionId = sessionId
            saveWppSession(sessionId)
            if (window._wppServerPoll) { clearInterval(window._wppServerPoll); window._wppServerPoll = null }
            renderConnectionStatus(); startPolling(); loadChats()
            return
          }
        }
        // Force stop polling after too many attempts if QR was shown
        if (pollCount > 25 && qrShown) {
          if (window._wppServerPoll) { clearInterval(window._wppServerPoll); window._wppServerPoll = null }
        }
      } catch (e) {}
    }, 5000)
  }

  async function syncServerContacts(sessionId) {
    try {
      var resp = await fetch(_wppServerUrl + '/contacts?sessionId=' + encodeURIComponent(sessionId))
      if (!resp.ok) return
      var data = await resp.json()
      if (!data.contacts || !data.contacts.length) return
      var existing = await apiGet('contacts', {})
      var existingPhones = {}
      ;(existing || []).forEach(function (c) { if (c.phone) existingPhones[c.phone.replace(/\D/g, '')] = c })
      var added = 0
      for (var i = 0; i < data.contacts.length; i++) {
        var c = data.contacts[i]
        var phone = c.phone.replace(/\D/g, '')
        if (existingPhones[phone]) continue
        var lastContacted = c.lastMsgTimestamp ? new Date(c.lastMsgTimestamp * 1000).toISOString() : null
        var r = await apiPost('contacts', {
          name: c.name, phone: c.phone, source: 'whatsapp', stage: 'novo', score: 0, last_contacted_at: lastContacted
        })
        if (r && r.id) { added++; existingPhones[phone] = r }
      }
      if (added && typeof showToast !== 'undefined') showToast(added + ' contato(s) sincronizados do WhatsApp')
      S.leads = await apiGet('contacts', {})
      filterLeads()
    } catch (e) {}
  }

  async function disconnect() {
    var sid = S._serverSessionId || S.activeSessionId
    if (sid) {
      try { await fetch(_wppServerUrl + '/disconnect?sessionId=' + encodeURIComponent(sid), { method: 'POST' }) } catch (e) {}
      try { await apiPatch('whatsapp_sessions', sid, { status: 'disconnected' }) } catch (e) {}
    }
    clearWppSession()
    if (window._wppServerPoll) { clearInterval(window._wppServerPoll); window._wppServerPoll = null }
    S.connected = false;
    S.activeSessionId = null;
    S._serverSessionId = null;
    S.chats = [];
    S.activeChatId = null;
    S.messages = [];
    S._lastQr = null;
    S.sessions = [];
    stopPolling();
    stopRealtime();
    renderConnectionStatus();
    renderChatList();
    renderMessages();
    renderContactPanel();
  }

  /* ============================ CHATS ============================ */
  async function loadChats() {
    if (!S.connected) return;
    // Ensure chat view container exists
    var chatListEl = document.getElementById('wcChatList');
    if (!chatListEl) {
      renderConversasChatView();
      chatListEl = document.getElementById('wcChatList');
    }
    if (chatListEl && !chatListEl.querySelector('.wc-chat-item')) chatListEl.innerHTML = '<div class="wc-loading-bar"><div class="wc-loading-bar-fill"></div></div><div class="wc-loading-text">Carregando conversas...</div>';
    loadLabels()
    // Also load chat-label associations
    if (S._serverSessionId && !S._chatLabels) {
      S._chatLabels = {}
      fetch(_wppServerUrl + '/labels?sessionId=' + encodeURIComponent(S._serverSessionId)).then(function(r){return r.json()}).then(function(d){
        var lbls = d.labels || []
        if (lbls.length) {
          // For each label, we'd need to query chat-labels per chat
          // For now, just mark that we have labels
        }
      }).catch(function(){})
    }
    if (S._serverSessionId) {
      try {
        var resp = await fetch(_wppServerUrl + '/chats?sessionId=' + encodeURIComponent(S._serverSessionId))
        if (resp.ok) {
          var data = await resp.json()
          S.chats = data.chats || []
          // Load contacts from server to get proper names
          var contResp = await fetch(_wppServerUrl + '/contacts?sessionId=' + encodeURIComponent(S._serverSessionId))
          if (contResp.ok) {
            var contData = await contResp.json()
            if (contData.contacts) {
              contData.contacts.forEach(function(ct) {
                var phone = ct.phone
                S.contacts[phone] = { name: ct.name, phone: phone }
                // Also match by chat jid patterns
                if (ct.jid) S.contacts[ct.jid] = { name: ct.name, phone: phone }
              })
            }
          }
          // Load contacts from Supabase contacts table via server
          try {
            var dbContResp = await fetch(_wppServerUrl + '/db-contacts?sessionId=' + encodeURIComponent(S._serverSessionId))
            if (dbContResp.ok) {
              var dbContData = await dbContResp.json()
              if (dbContData.contacts) {
                dbContData.contacts.forEach(function(c) {
                  if (c.name && c.name !== c.phone && !c.name.startsWith('{')) {
                    if (c.phone) S.contacts[c.phone] = { name: c.name, phone: c.phone }
                    // Also try without country code
                    var short = c.phone.replace(/^55/, '')
                    if (short !== c.phone) S.contacts[short] = { name: c.name, phone: c.phone }
                    // Also try with country code
                    var full = '55' + c.phone.replace(/^55/, '')
                    S.contacts[full] = { name: c.name, phone: c.phone }
                    if (c.phone.includes('@')) S.contacts[c.phone.split('@')[0]] = { name: c.name, phone: c.phone }
                  }
                })
              }
            }
          } catch (e) {}
          renderChatList()
          return
        }
      } catch (e) {}
    }
    S.chats = await apiGet('whatsapp_chats', S.currentUser ? { user_id: 'eq.' + S.currentUser, order: 'updated_at.desc' } : { order: 'updated_at.desc' });
    renderChatList();
  }

  async function loadLabels() {
    if (!S._serverSessionId) return
    try {
      var r = await fetch(_wppServerUrl + '/labels?sessionId=' + encodeURIComponent(S._serverSessionId))
      if (r.ok) { var d = await r.json(); S._labels = d.labels || [] }
      // Load chat-label assocs for all chats
      S._chatLabels = {}
      var cr = await fetch(_wppServerUrl + '/chats?sessionId=' + encodeURIComponent(S._serverSessionId))
      if (cr.ok) { var cd = await cr.json(); var chats = cd.chats || []
        for (var ci = 0; ci < chats.length; ci++) {
          var c = chats[ci]; var jid = c.remote_jid || ''
          if (jid) {
            var lr = await fetch(_wppServerUrl + '/chat-labels?sessionId=' + encodeURIComponent(S._serverSessionId) + '&chatId=' + encodeURIComponent(jid))
            if (lr.ok) { var ld = await lr.json(); var lbls = ld.labels || []
              if (lbls.length) { S._chatLabels[jid] = lbls.map(function(l){return l.id}) }
            }
          }
        }
      }
    } catch(e) {}
    renderChatFilter()
  }
  function renderChatFilter() {
    var bar = document.getElementById('wcFilterBar')
    if (!bar) return
    // Collect tags from all contacts
    var allTags = {}
    for (var ci = 0; ci < S.chats.length; ci++) {
      var chat = S.chats[ci]
      if (chat.contact_id && S.contacts[chat.contact_id] && S.contacts[chat.contact_id].tags) {
        for (var t of S.contacts[chat.contact_id].tags) { allTags[t] = (allTags[t] || 0) + 1 }
      }
    }
    var tagNames = Object.keys(allTags).sort()
    var html = '<button class="wc-filter-btn' + (!_wcLabelFilter ? ' active' : '') + '" onclick="VeltrisWPP.setLabelFilter(\'\')">Todas</button>'
    for (var tn of tagNames) {
      html += '<button class="wc-filter-btn' + (_wcLabelFilter === 'tag:' + tn ? ' active' : '') + '" onclick="VeltrisWPP.setLabelFilter(\'tag:' + tn + '\')">' + escHtml(tn) + '</button>'
    }
    bar.innerHTML = html
    bar.style.display = tagNames.length ? '' : 'none'
  }
  function getChatTags(chat) {
    if (chat.contact_id && S.contacts[chat.contact_id]) return S.contacts[chat.contact_id].tags || []
    return []
  }
  function setLabelFilter(labelId) {
    _wcLabelFilter = labelId
    renderChatFilter()
    renderChatList()
  }

  function renderChatList() {
    const container = el('wcChatList');
    if (!container) return;
    // Render filter bar
    renderChatFilter()
    if (S.chats.length === 0) {
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';
      container.style.height = '100%';
      container.style.color = 'var(--text-muted)';
      container.style.fontSize = '0.75rem';
      container.innerHTML = S.connected ? 'Nenhuma conversa encontrada' : 'Conecte o WhatsApp primeiro';
      return;
    }
    container.style.display = '';
    container.style.height = '';
    container.style.color = '';
    var chatsToRender = S.chats
    if (_wcLabelFilter) {
      var filterTag = _wcLabelFilter.replace('tag:', '')
      chatsToRender = S.chats.filter(function(c) {
        var tags = getChatTags(c)
        return tags.includes(filterTag)
      })
    }
    container.innerHTML = chatsToRender.map(c => {
      var chatPhone = (c.remote_jid || '').split('@')[0]
      var contact = S.contacts[c.contact_id] || S.contacts[chatPhone] || S.contacts[c.remote_jid]
      var rawName = c.contact_name || contact?.name || c.remote_jid || '';
      var name = rawName;
      if (!name || name.includes('@') || name.startsWith('{') || name.includes('"low"') || /^\d+$/.test(name.replace(/@[\s\S]+$/, ''))) {
        var phone = (c.remote_jid || rawName || '').split('@')[0].replace('@lid', '').replace('@newsletter', '').replace('@s.whatsapp.net', '')
        var cleanPhone = phone.replace(/^55(\d{2})/, '$1').replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')
        name = cleanPhone !== phone ? cleanPhone : phone
      }
      var lastMsgObj = typeof c.last_message === 'string' ? JSON.parse(c.last_message) : c.last_message
      var lastMsg = lastMsgObj?.text || lastMsgObj || '';
      const unread = c.unread_count || 0;
      const isActive = c.id === S.activeChatId;
      return `<button class="wc-chat-item ${isActive ? 'active' : ''}" onclick="VeltrisWPP.selectChat('${c.id}')">
        <div class="wc-avatar">${initials(name)}</div>
        <div class="wc-chat-info">
          <div class="wc-chat-name">${escHtml(name)}</div>
          <div class="wc-chat-preview">${escHtml(lastMsg.substring(0, 60))}</div>
        </div>
        <div class="wc-chat-meta">
          <div class="wc-chat-time">${formatDate(c.last_message_at)}</div>
          ${unread > 0 ? `<div class="wc-chat-unread">${unread > 99 ? '99+' : unread}</div>` : ''}
        </div>
      </button>`;
    }).join('');
  }

  async function selectChat(chatId) {
    S.activeChatId = chatId;
    S.messages = [];
    _chatShowing = true;
    var listView = el('wcChatListView');
    var chatView = el('wcChatView');
    if (listView) listView.style.display = 'none';
    if (chatView) chatView.style.display = 'flex';
    renderChatList();
    renderMessages();
    await loadMessages(chatId);
    // Mark as read
    if (S.chats.find(c => c.id === chatId && c.unread_count > 0)) {
      if (S._serverSessionId) {
        try { await fetch(_wppServerUrl + '/mark-read', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({chatId}) }) } catch(e) {}
      } else {
        await apiPatch('whatsapp_chats', chatId, { unread_count: 0 });
      }
      const chat = S.chats.find(c => c.id === chatId);
      if (chat) chat.unread_count = 0;
      renderChatList();
    }
  }

  async function loadMessages(chatId) {
    if (!chatId) return;
    var chat = S.chats.find(function(c) { return c.id === chatId })
    if (chat && chat.last_messages && chat.last_messages.length > 0 && S.messages.length === 0) {
      S.messages = chat.last_messages
      renderMessages()
    }
    if (S._serverSessionId) {
      try {
        var resp = await fetch(_wppServerUrl + '/messages?chatId=' + encodeURIComponent(chatId))
        if (resp.ok) {
          var data = await resp.json()
          var newMsgs = data.messages || []
          // Only rebuild if count changed (preserves audio playback)
          if (newMsgs.length !== S.messages.length) {
            S.messages = newMsgs
            renderMessages()
          }
        }
      } catch (e) {}
    } else {
      S.messages = await apiGet('whatsapp_messages', { chat_id: 'eq.' + chatId, order: 'created_at.asc' });
      renderMessages()
    }
  }

  function renderMessages() {
    const container = el('wcMessages');
    const inputArea = el('wcInputArea');
    if (!container) { console.warn('renderMessages: container not found'); return; }
    if (!S.activeChatId) {
      container.style.display = 'flex';
      container.innerHTML = '<div style="margin:auto;text-align:center;color:var(--text-muted);font-size:0.85rem">Selecione uma conversa</div>';
      if (inputArea) inputArea.style.display = 'none';
      return;
    }
    if (inputArea) inputArea.style.display = '';
    const chat = S.chats.find(c => c.id === S.activeChatId);
    const contact = chat ? (S.contacts[chat.contact_id] || {}) : {};
    const name = chat?.contact_name || contact?.name || chat?.remote_jid || 'Desconhecido';
    var avatarEl = el('wcChatAvatar');
    var nameEl = el('wcChatName');
    var statusEl = el('wcChatStatus');
    if (avatarEl) avatarEl.textContent = initials(name);
    if (nameEl) nameEl.textContent = name;
    if (statusEl) statusEl.textContent = contact?.stage ? stageLabel(contact.stage) : 'lead';
    var header = el('wcWindowHeader');
    if (header && !header.querySelector('.wc-ai-btn')) {
      var aiBtn = document.createElement('button');
      aiBtn.className = 'wc-ai-btn';
      aiBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4c0 2-2 3-4 5-2-2-4-3-4-5a4 4 0 0 1 4-4z"/><path d="M12 11v8"/><path d="M8 22h8"/><path d="M10 22v-3"/><path d="M14 22v-3"/><circle cx="12" cy="6" r="1"/></svg> Analisar';
      aiBtn.onclick = function() { if (window.VeltrisWPP.analyzeConversation) window.VeltrisWPP.analyzeConversation(); };
      aiBtn.title = 'Analisar conversa com IA';
      header.appendChild(aiBtn);
    }
    if (S.messages.length === 0) {
      container.style.display = 'flex';
      container.innerHTML = '<div style="margin:auto;text-align:center;color:var(--text-muted);font-size:0.78rem">Nenhuma mensagem ainda. Envie a primeira!</div>';
      return;
    }
    container.style.display = '';
    container.innerHTML = S.messages.map(m => {
      const isSent = m.direction === 'sent' || m.direction === 'outgoing';
      const isPending = m.id && m.id.startsWith('temp_');
      var msgHtml = ''
      if (m.message_type === 'image' && m.media_url) {
        msgHtml += '<div style="margin-bottom:4px"><img src="' + _wppServerUrl + m.media_url + '" style="max-width:240px;max-height:240px;border-radius:8px;display:block" loading="lazy" onclick="window.open(this.src)" /></div>'
      }
      if (m.message_type === 'audio' && m.media_url) {
        var aid = 'ap_' + (m.id || Math.random().toString(36).slice(2,8))
        msgHtml = '<div class="wc-audio-player" onclick="var a=document.getElementById(\'' + aid + '\');if(a.paused){a.play()}else{a.pause()}">' +
          '<button class="wc-audio-play" id="' + aid + '_btn">▶</button>' +
          '<div class="wc-audio-bar-wrap">' +
            '<div class="wc-audio-bar"><div class="wc-audio-bar-fill" id="' + aid + '_fill"></div></div>' +
            '<div class="wc-audio-time" id="' + aid + '_time">0:00</div>' +
          '</div>' +
          '<audio id="' + aid + '" preload="none" src="' + _wppServerUrl + m.media_url + '" style="display:none" ' +
            'onplay="document.getElementById(\'' + aid + '_btn\').textContent=\'⏸\'" ' +
            'onpause="document.getElementById(\'' + aid + '_btn\').textContent=\'▶\'" ' +
            'ontimeupdate="var p=this.currentTime/this.duration*100||0;document.getElementById(\'' + aid + '_fill\').style.width=p+\'%\';var m=Math.floor(this.currentTime/60);var s=Math.floor(this.currentTime%60);document.getElementById(\'' + aid + '_time\').textContent=m+\':\'+(s<10?\'0\':\'\')+s" ' +
            'onended="document.getElementById(\'' + aid + '_btn\').textContent=\'▶\';document.getElementById(\'' + aid + '_fill\').style.width=\'0%\'">' +
        '</div>'
      }
      if (m.message_type !== 'audio' && m.message_type !== 'image') msgHtml += escHtml(m.text || m.content || '')
      return `<div class="wc-msg ${isSent ? 'sent' : 'received'}${isPending ? ' wc-msg-pending' : ''}">
        ${msgHtml}
        <div class="time">${formatTime(m.created_at)}${isPending ? ' · enviando...' : ''}</div>
      </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
    // Log first and last message text for debugging
    if (S.messages.length > 0) console.log('Primeira msg:', S.messages[0]?.text?.substring(0,30), '| Ultima msg:', S.messages[S.messages.length-1]?.text?.substring(0,30));
  }

  async function sendMessage() {
    const input = el('wcMessageInput');
    if (!input || !input.value.trim() || !S.activeChatId || !S.activeSessionId) return;
    const text = input.value.trim();
    input.value = '';
    // Optimistic
    var tempId = 'temp_' + Date.now()
    var tempMsg = { id: tempId, text, direction: 'sent', created_at: new Date().toISOString(), chat_id: S.activeChatId };
    S.messages.push(tempMsg);
    renderMessages();
    // Send via server
    var sentOk = false
    if (S._serverSessionId) {
      try {
        var r = await fetch(_wppServerUrl + '/send-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: S.activeChatId, text: text, sessionId: S._serverSessionId })
        })
        sentOk = r.ok
      } catch (e) {}
    }
    // After send, mark temp message as sent
    if (sentOk) {
      for (var i = 0; i < S.messages.length; i++) {
        if (S.messages[i].id === tempId) {
          S.messages[i].id = 'sent_' + Date.now()
          renderMessages()
          break
        }
      }
      // Load real messages from server to ensure they persist
      setTimeout(function() {
        loadMessages(S.activeChatId)
      }, 3000)
    }
  }

  async function analyzeConversation() {
    if (!S.activeChatId || !S.messages.length) {
      if (typeof showToast === 'function') showToast('Nenhuma mensagem para analisar.');
      return;
    }
    const chat = S.chats.find(c => c.id === S.activeChatId);
    const contact = chat ? (S.contacts[chat.contact_id] || {}) : {};
    const name = chat?.contact_name || contact?.name || chat?.remote_jid || 'Desconhecido';
    if (typeof showToast === 'function') showToast('IA está analisando a conversa...');

    const transcript = S.messages.map(m => {
      const sender = m.direction === 'sent' || m.direction === 'outgoing' ? 'Você' : name;
      return sender + ': ' + (m.text || m.content || '');
    }).join('\n');

    var companyContext = '';
    var companyMode = typeof window._companyMode !== 'undefined' ? window._companyMode : null;
    if (companyMode && (companyMode.descriptionSector || companyMode.description)) {
      companyContext = 'A empresa atua no ramo: ' + (companyMode.descriptionSector || 'não informado') + '. Descrição: ' + (companyMode.description || 'não informada') + '.';
    }

    const systemPrompt = 'Você é um analista de vendas e relacionamento com clientes sênior. ' + companyContext + ' ' +
      'Analise a conversa de WhatsApp abaixo e forneça uma análise detalhada e estratégica em português brasileiro. ' +
      'Sua análise deve conter EXATAMENTE estas seções, separadas por linhas em branco:\n\n' +
      '1. CONTEXTO DA CONVERSA: Resumo do que foi discutido, tom da conversa, e estágio do relacionamento.\n' +
      '2. PONTOS FORTES: O que está sendo bem conduzido na abordagem.\n' +
      '3. PONTOS DE MELHORIA: O que poderia ser melhorado na comunicação ou estratégia.\n' +
      '4. PRÓXIMOS PASSOS SUGERIDOS: Ações concretas e objetivas para avançar o relacionamento ou fechar negócio.\n' +
      '5. ANÁLISE DE INTENÇÃO: Qual parece ser o nível de interesse do lead (Frio/Morno/Quente) e por quê.\n\n' +
      'Seja direto, profissional e baseie sua análise APENAS no conteúdo da conversa. ' +
      'Não use markdown, asteriscos ou formatação especial. Apenas texto puro com seções claras.';

    try {
      var result = null;
      if (typeof callOpenRouter === 'function') {
        result = await callOpenRouter([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Aqui está a transcrição da conversa:\n\n' + transcript }
        ], { maxTokens: 2000, temperature: 0.4 });
      } else {
        if (typeof showToast === 'function') showToast('Função de IA não disponível.');
        return;
      }

      if (!result) {
        if (typeof showToast === 'function') showToast('IA não retornou análise. Tente novamente.');
        return;
      }

      result = result.replace(/```[\s\S]*?```/g, '').trim();
      if (!result) {
        if (typeof showToast === 'function') showToast('Análise vazia. Tente novamente.');
        return;
      }

      var overlay = document.getElementById('wppAnalysisOverlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'wppAnalysisOverlay';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = '<div class="modal" style="max-width:600px;padding:24px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
          '<h3 style="margin:0;font-size:1rem"><i class="fi fi-rr-robot"></i> Análise da conversa</h3>' +
          '<button onclick="this.closest(\'.modal-overlay\').style.display=\'none\'" style="background:none;border:none;color:var(--text-muted);font-size:1.2rem;cursor:pointer;padding:4px">&times;</button>' +
          '</div>' +
          '<div id="wppAnalysisContent" style="font-size:0.85rem;line-height:1.6;color:var(--text);white-space:pre-wrap;max-height:60vh;overflow-y:auto;padding-right:8px"></div>' +
          '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.style.display = 'none'; });
      }

      document.getElementById('wppAnalysisContent').textContent = result;
      overlay.style.display = 'flex';
      if (typeof showToast === 'function') showToast('Análise concluída!');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Erro ao analisar conversa.');
    }
  }

  /* ============================ CONTACT PANEL ============================ */
  async function renderContactPanel() {
    const container = el('wcContactPanel');
    if (!container) return;
    if (!S.activeChatId) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.75rem">Selecione um contato</div>';
      return;
    }
    const chat = S.chats.find(c => c.id === S.activeChatId);
    const contactId = chat?.contact_id;
    const contact = contactId ? S.contacts[contactId] : null;
    // Fetch fresh
    let contactData = contact;
    if (contactId) {
      const fresh = await apiGet('contacts', { id: 'eq.' + contactId });
      if (fresh && fresh.length > 0) {
        contactData = fresh[0];
        S.contacts[contactId] = contactData;
      }
    }
    if (!contactData) {
      // Try creating contact from chat info
      const newContact = await apiPost('contacts', {
        name: chat?.contact_name || chat?.remote_jid || 'Contato',
        phone: chat?.remote_jid || '',
        source: 'whatsapp',
        stage: 'novo',
        score: 0,
      });
      if (newContact) {
        S.contacts[newContact.id] = newContact;
        if (chat) chat.contact_id = newContact.id;
        contactData = newContact;
      }
    }
    if (!contactData) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.75rem">Sem dados do contato</div>';
      return;
    }
    const tags = contactData.tags || [];
    const tagsHtml = tags.length > 0 ? tags.map(t => `<span class="wc-tag" style="background:hsla(var(--accent-h),var(--accent-s),55%,0.12);color:var(--accent)">${escHtml(t)}</span>`).join('') : '<span style="font-size:0.65rem;color:var(--text-muted)">Nenhuma tag</span>';
    container.innerHTML = `
      <div class="wc-panel">
        <div class="wc-panel-section">
          <h4>Contato</h4>
          <div class="wc-panel-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
            ${escHtml(contactData.name || 'â€”')}
          </div>
          <div class="wc-panel-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.8 12.8 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.8 12.8 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            ${escHtml(contactData.phone || 'â€”')}
          </div>
        </div>
        <div class="wc-panel-section">
          <h4>Funil</h4>
          <div style="display:flex;align-items:center;gap:8px">
            <select id="wcContactStage" onchange="VeltrisWPP.updateContactStage(this.value)" class="wc-lead-select">
              ${S.stages.map(s => `<option value="${s}" ${contactData.stage === s ? 'selected' : ''}>${stageLabel(s)}</option>`).join('')}
            </select>
            <span style="font-size:0.65rem;color:var(--text-muted)">Score: ${contactData.score || 0}</span>
          </div>
          <div class="wc-score-bar"><div class="wc-score-fill" style="width:${Math.min((contactData.score || 0) * 10, 100)}%"></div></div>
        </div>
        <div class="wc-panel-section">
          <h4>Tags</h4>
          <div class="wc-tags">${tagsHtml}</div>
          <div style="margin-top:6px;display:flex;gap:4px">
            <input id="wcNewTag" placeholder="Nova tag" style="flex:1;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:0.72rem;outline:none;font-family:inherit" onkeydown="if(event.key==='Enter')VeltrisWPP.addTag()" />
            <button class="btn btn-outline" onclick="VeltrisWPP.addTag()" style="font-size:0.65rem;padding:4px 10px">+</button>
          </div>
        </div>
        <div class="wc-panel-section">
          <h4>ObservaÃ§Ãµes</h4>
          <textarea class="wc-notes-textarea" id="wcContactNotes" onchange="VeltrisWPP.saveNotes(this.value)">${escHtml(contactData.notes || '')}</textarea>
        </div>
        <div class="wc-panel-section">
          <h4>Insight IA</h4>
          <div class="wc-ai-insight" id="wcAiInsight">
            ${contactData.ai_insight || 'Analise mensagens para gerar insights...'}
          </div>
        </div>
        <div class="wc-panel-section">
          <h4>Atividade</h4>
          <div id="wcActivityLog">
            ${contactData.last_contacted_at ? `<div class="wc-activity-item"><span class="wc-activity-dot"></span><div><div>Ãšltimo contato</div><div class="wc-activity-time">${formatFullDate(contactData.last_contacted_at)}</div></div></div>` : '<span style="font-size:0.65rem;color:var(--text-muted)">Sem atividade registrada</span>'}
          </div>
        </div>
        <button class="btn btn-outline" onclick="VeltrisWPP.generateAiInsight()" style="width:100%;font-size:0.72rem;margin-top:8px">Gerar Insight IA</button>
      </div>`;
  }

  async function updateContactStage(stage) {
    const chat = S.chats.find(c => c.id === S.activeChatId);
    const contactId = chat?.contact_id;
    if (!contactId) return;
    await apiPatch('contacts', contactId, { stage });
    if (S.contacts[contactId]) S.contacts[contactId].stage = stage;
  }

  async function addTag() {
    const input = el('wcNewTag');
    if (!input || !input.value.trim()) return;
    const tag = input.value.trim().toLowerCase();
    input.value = '';
    const chat = S.chats.find(c => c.id === S.activeChatId);
    const contactId = chat?.contact_id;
    if (!contactId) return;
    const contact = S.contacts[contactId];
    const tags = [...(contact?.tags || []), tag];
    await apiPatch('contacts', contactId, { tags });
    if (S.contacts[contactId]) S.contacts[contactId].tags = tags;
    renderContactPanel();
  }

  async function saveNotes(notes) {
    const chat = S.chats.find(c => c.id === S.activeChatId);
    const contactId = chat?.contact_id;
    if (!contactId) return;
    await apiPatch('contacts', contactId, { notes });
    if (S.contacts[contactId]) S.contacts[contactId].notes = notes;
  }

  async function generateAiInsight() {
    const chat = S.chats.find(c => c.id === S.activeChatId);
    const contactId = chat?.contact_id;
    if (!contactId) return;
    const contact = S.contacts[contactId];
    const msgs = S.messages.slice(-20);
    const conversation = msgs.map(m => `${m.direction === 'sent' ? 'Eu' : 'Cliente'}: ${m.text || m.content}`).join('\n');
    const prompt = `Analise esta conversa comercial e dÃª um insight em portuguÃªs (mÃ¡ximo 3 linhas) sobre o lead:\nNome: ${contact?.name}\nEstÃ¡gio: ${contact?.stage}\n\nConversa:\n${conversation}\n\nInsight:`;
    try {
      const insightEl = el('wcAiInsight');
      if (insightEl) insightEl.textContent = 'Gerando insight...';
      const resp = await fetch('https://dwkjynmelculfzumoreg.supabase.co/functions/v1/analise-ia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': (window._supabaseKey || '') },
        body: JSON.stringify({ prompt }),
      });
      const data = await resp.json();
      const insight = data?.text || data?.result || data?.insight || 'NÃ£o foi possÃ­vel gerar insight';
      await apiPatch('contacts', contactId, { ai_insight: insight });
      if (S.contacts[contactId]) S.contacts[contactId].ai_insight = insight;
      if (insightEl) insightEl.textContent = insight;
    } catch (e) {
      const fallback = 'Conecte uma funÃ§Ã£o Edge Supabase para insights automÃ¡ticos';
      if (el('wcAiInsight')) el('wcAiInsight').textContent = fallback;
    }
  }

  /* ============================ WHATSAPP TAB ============================ */
  function updateSyncStatus(msg) {
    var el = document.getElementById('wppSyncStatus')
    if (!el) {
      el = document.createElement('div')
      el.id = 'wppSyncStatus'
      el.style.cssText = 'text-align:center;padding:6px 12px;font-size:0.65rem;color:var(--text-muted)'
      var dash = document.getElementById('wppDashboard')
      if (dash) dash.after(el)
      else {
        var cs = document.getElementById('wppConnectionStatus')
        if (cs) cs.after(el)
      }
    }
    el.textContent = msg || ''
    el.style.display = msg ? 'block' : 'none'
  }
  // Start periodic sync status update
  function startSyncMonitor() {
    if (window._syncMonInt) clearInterval(window._syncMonInt)
    var syncCount = 0
    window._syncMonInt = setInterval(async function() {
      syncCount++
      if (syncCount % 6 !== 0) return // only run every 6th iteration (~every 30s)
      if (!S._serverSessionId) return
      try {
        var r = await fetch(_wppServerUrl + '/debug')
        if (r.ok) {
          var d = await r.json()
          if (d.chats !== undefined) updateSyncStatus(d.chats + ' conversas · ' + d.messages + ' mensagens')
        }
      } catch(e) {}
    }, 5000)
  }

  async function renderWhatsapp() {
    await loadSessions();
    renderConnectionStatus();
    if (!S.connected) {
      const conv = el('wppConversas');
      if (conv) conv.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)">Conecte o WhatsApp para ver conversas</div>';
      return;
    }
    renderConversasChatView();
  }

  /* ============================ MÉTRICAS TAB ============================ */
  async function renderMetricas() {
    const container = el('wppMetricas');
    if (!container) return;
    const contacts = await apiGet('contacts', {});
    const list = Array.isArray(contacts) ? contacts : [];
    const total = list.length;
    const agendados = list.filter(c => c.stage === 'agendado').length;
    const realizados = list.filter(c => c.stage === 'realizado').length;
    const cancelados = list.filter(c => c.stage === 'cancelado').length;
    const pctAgendados = total > 0 ? Math.round((agendados / total) * 100) : 0;
    const pctRealizados = agendados > 0 ? Math.round((realizados / agendados) * 100) : 0;
    const pctCancelados = agendados > 0 ? Math.round((cancelados / agendados) * 100) : 0;
    container.innerHTML = `
      <div class="wc-metrics-grid">
        <div class="wc-metric-card">
          <div class="wc-metric-icon sky"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
          <div class="label">Total Contatos</div>
          <div class="value">${total}</div>
        </div>
        <div class="wc-metric-card">
          <div class="wc-metric-icon orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
          <div class="label">Agendados</div>
          <div class="value">${agendados}</div>
        </div>
        <div class="wc-metric-card">
          <div class="wc-metric-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
          <div class="label">Realizados</div>
          <div class="value">${realizados}</div>
        </div>
        <div class="wc-metric-card">
          <div class="wc-metric-icon rose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
          <div class="label">Cancelados</div>
          <div class="value">${cancelados}</div>
        </div>
      </div>
      <div class="wc-funnel-card">
        <h3>Funil de Conversao</h3>
        <div class="wc-funnel-stage">
          <div class="stage-header"><span class="name">Total Contatos</span><span class="count">${total} 100%</span></div>
          <div class="wc-funnel-bar"><div class="wc-funnel-fill" style="width:100%;background:var(--accent)"></div></div>
        </div>
        <div class="wc-funnel-stage">
          <div class="stage-header"><span class="name">Agendados</span><span class="count">${agendados} ${pctAgendados}%</span></div>
          <div class="wc-funnel-bar"><div class="wc-funnel-fill" style="width:${pctAgendados}%;background:#3b82f6"></div></div>
        </div>
        <div class="wc-funnel-stage">
          <div class="stage-header"><span class="name">Realizados</span><span class="count">${realizados} ${pctRealizados}%</span></div>
          <div class="wc-funnel-bar"><div class="wc-funnel-fill" style="width:${pctRealizados}%;background:#22c55e"></div></div>
        </div>
        <div class="wc-funnel-stage">
          <div class="stage-header"><span class="name">Cancelados</span><span class="count">${cancelados} ${pctCancelados}%</span></div>
          <div class="wc-funnel-bar"><div class="wc-funnel-fill" style="width:${pctCancelados}%;background:#ef4444"></div></div>
        </div>
      </div>`;
  }

  /* ============================ DISPAROS TAB ============================ */
  var _disparoContacts = [];

  async function renderDisparos() {
    const container = el('wppDisparos');
    if (!container) return;
    var contacts;
    if (S._serverSessionId) {
      try {
        var resp = await fetch(_wppServerUrl + '/db-contacts?sessionId=' + encodeURIComponent(S._serverSessionId));
        if (resp.ok) { var data = await resp.json(); contacts = data.contacts || []; }
      } catch (e) {}
    }
    if (!contacts) contacts = await apiGet('contacts', {});
    _disparoContacts = Array.isArray(contacts) ? contacts.filter(c => c.phone) : [];
    var allContacts = Array.isArray(contacts) ? contacts : [];
    loadSavedTags();
    var tags = [...new Set([..._savedTags, ...allContacts.flatMap(c => c.tags || [])])].sort();
    container.innerHTML = `
      <div class="wc-disparo-card">
        <div class="wc-disparo-section">
          <h4>Selecionar Contatos</h4>
          <div class="wc-disparo-mode">
            <label class="wc-radio-label"><input type="radio" name="dispMode" value="tag" checked onchange="VeltrisWPP.onDisparoModeChange()"> Por Tag</label>
            <label class="wc-radio-label"><input type="radio" name="dispMode" value="individual" onchange="VeltrisWPP.onDisparoModeChange()"> Individual</label>
          </div>
          <div id="dispTagSection">
            <div class="cs-wrap" style="position:relative;min-width:200px">
              <div class="cs-trigger" id="dispTagTrigger" onclick="VeltrisWPP.toggleDispTagDrop(event)">
                <span id="dispTagSelected">Todas as tags</span>
                <span class="cs-arrow">▾</span>
              </div>
              <div class="cs-drop" id="dispTagDrop">
                <div class="cs-opt" data-value="" onclick="VeltrisWPP.selectDispTag('')">Todas as tags</div>
                ${tags.map(t => `<div class="cs-opt" data-value="${t}" onclick="VeltrisWPP.selectDispTag('${t}')">${escHtml(t)}</div>`).join('')}
              </div>
            </div>
          </div>
          <div id="dispIndividualSection" style="display:none">
            <input id="dispSearch" class="wc-disparo-input" placeholder="Buscar contato..." oninput="VeltrisWPP.onDisparoSearch()" />
            <div class="wc-disparo-list" id="dispContactList"></div>
          </div>
        </div>
        <div class="wc-disparo-section">
          <h4>Mensagem <span class="wc-disparo-hint">Use {nome} para personalizar</span></h4>
          <textarea id="dispMessage" class="wc-disparo-textarea" placeholder="Digite a mensagem para disparo..."></textarea>
        </div>
        <div class="wc-disparo-footer">
          <span id="dispCount" class="wc-disparo-count">0 contatos selecionados</span>
          <button class="btn btn-save" onclick="VeltrisWPP.enviarDisparo()" id="dispSendBtn">Enviar Disparo</button>
        </div>
        <div id="dispProgress" class="wc-disparo-progress" style="display:none">
          <div class="wc-disparo-bar"><div class="wc-disparo-fill" id="dispProgressFill"></div></div>
          <span id="dispProgressText" class="wc-disparo-pct">0%</span>
        </div>
        <div id="dispResult" class="wc-disparo-result" style="display:none"></div>
      </div>`;
    onDisparoFilterChange();
  }

  var _disparoTagValue = '';

  function getDisparoContacts() {
    var mode = document.querySelector('[name="dispMode"]:checked');
    if (!mode) return [];
    if (mode.value === 'tag') {
      if (!_disparoTagValue) return _disparoContacts;
      return _disparoContacts.filter(c => (c.tags || []).includes(_disparoTagValue));
    } else {
      var checks = qsa('.disp-contact-cb:checked');
      return Array.from(checks).map(cb => _disparoContacts.find(c => String(c.id) === cb.value)).filter(Boolean);
    }
  }

  function updateDisparoCount() {
    var count = el('dispCount');
    var filtered = getDisparoContacts();
    if (count) count.textContent = filtered.length + ' contato(s) selecionado(s)';
    return filtered;
  }

  function closeTagDrop(dropId) {
    var drop = el(dropId);
    if (drop) drop.classList.remove('visible');
  }

  function toggleDispTagDrop(e) {
    if (e) e.stopPropagation();
    var drop = el('dispTagDrop');
    if (!drop) return;
    closeTagDrop('dispTagDrop');
    drop.classList.toggle('visible');
    if (drop.classList.contains('visible')) {
      setTimeout(function() { document.addEventListener('click', closeDispTagDrop); }, 10);
    }
  }
  function closeDispTagDrop() {
    closeTagDrop('dispTagDrop');
    document.removeEventListener('click', closeDispTagDrop);
  }
  function selectDispTag(value) {
    _disparoTagValue = value;
    var label = value || 'Todas as tags';
    el('dispTagSelected').textContent = label;
    closeDispTagDrop();
    updateDisparoCount();
  }

  function onDisparoModeChange() {
    var mode = document.querySelector('[name="dispMode"]:checked');
    if (!mode) return;
    var tagSec = el('dispTagSection');
    var indSec = el('dispIndividualSection');
    if (mode.value === 'tag') {
      if (tagSec) tagSec.style.display = '';
      if (indSec) indSec.style.display = 'none';
    } else {
      if (tagSec) tagSec.style.display = 'none';
      if (indSec) indSec.style.display = '';
      renderDisparoContactList();
    }
    updateDisparoCount();
  }

  function onDisparoFilterChange() {
    updateDisparoCount();
  }

  function onDisparoSearch() {
    renderDisparoContactList();
  }

  function renderDisparoContactList() {
    var list = el('dispContactList');
    if (!list) return;
    var q = (el('dispSearch')?.value || '').toLowerCase();
    var filtered = _disparoContacts.filter(c => {
      if (!q) return true;
      return (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
    });
    list.innerHTML = filtered.map(c => `
      <label class="wc-disparo-item">
        <input type="checkbox" class="disp-contact-cb" value="${c.id}" onchange="VeltrisWPP.updateDisparoCount()" />
        <span class="wc-disparo-item-name">${escHtml(c.name || '—')}</span>
        <span class="wc-disparo-item-phone">${escHtml(c.phone || '')}</span>
      </label>
    `).join('') || '<div class="wc-disparo-empty">Nenhum contato encontrado</div>';
  }

  async function enviarDisparo() {
    var btn = el('dispSendBtn');
    var progress = el('dispProgress');
    var fill = el('dispProgressFill');
    var pctText = el('dispProgressText');
    var result = el('dispResult');
    if (!btn || !progress) return;
    var message = el('dispMessage')?.value?.trim();
    if (!message) { alert('Digite uma mensagem'); return; }
    var contacts = getDisparoContacts();
    if (contacts.length === 0) { alert('Selecione pelo menos um contato'); return; }
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    progress.style.display = 'flex';
    result.style.display = 'none';
    var sent = 0, failed = 0;
    var total = contacts.length;
    for (var i = 0; i < total; i++) {
      var c = contacts[i];
      var personalized = message.replace(/\{nome\}/g, c.name || '');
      try {
        if (S._serverSessionId) {
          var targetChatId = c.remote_jid || c.phone;
          if (targetChatId && targetChatId.indexOf('@') < 0) targetChatId = targetChatId + '@s.whatsapp.net';
          var resp = await fetch(_wppServerUrl + '/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: targetChatId, text: personalized, sessionId: S._serverSessionId })
          });
          if (resp.ok) sent++; else failed++;
        } else {
          var payload = {
            chat_id: S.activeChatId || 'bulk',
            session_id: S.activeSessionId,
            text: personalized,
            direction: 'sent',
            status: 'queued',
          };
          var res = await apiPost('whatsapp_messages', payload);
          if (res) sent++; else failed++;
        }
      } catch (e) { failed++; }
      var pct = Math.round(((i + 1) / total) * 100);
      if (fill) fill.style.width = pct + '%';
      if (pctText) pctText.textContent = pct + '%';
    }
    btn.disabled = false;
    btn.textContent = 'Enviar Disparo';
    result.style.display = '';
    result.innerHTML = '<div class="wc-disparo-result-msg ' + (failed === 0 ? 'success' : 'warning') + '">' +
      '<strong>' + sent + '</strong> enviada(s)' +
      (failed > 0 ? ', <strong>' + failed + '</strong> falha(s)' : ' com sucesso') +
      '</div>';
  }

  /* ============================ TAGS TAB ============================ */
  var _tagsContactList = [];
  var _savedTags = [];
  var _linkTagValue = '';

  function loadSavedTags() {
    try {
      var data = localStorage.getItem('veltris_saved_tags');
      _savedTags = data ? JSON.parse(data) : [];
    } catch (e) { _savedTags = []; }
  }

  function saveSavedTags() {
    try { localStorage.setItem('veltris_saved_tags', JSON.stringify(_savedTags)); } catch (e) {}
  }

  async function renderTags() {
    const container = el('wppTags');
    if (!container) return;
    loadSavedTags();
    var contacts;
    if (S._serverSessionId) {
      try {
        var resp = await fetch(_wppServerUrl + '/db-contacts?sessionId=' + encodeURIComponent(S._serverSessionId));
        if (resp.ok) { var data = await resp.json(); contacts = data.contacts || []; }
      } catch (e) {}
    }
    if (!contacts || !contacts.length) contacts = await apiGet('contacts', {});
    _tagsContactList = Array.isArray(contacts) ? contacts : [];
    var contactTags = [...new Set(_tagsContactList.flatMap(c => c.tags || []))];
    contactTags.forEach(function(t) {
      if (!_savedTags.includes(t)) _savedTags.push(t);
    });
    saveSavedTags();
    _savedTags.sort();
    container.innerHTML = `
      <div class="wc-tags-card">
        <div class="wc-tags-section">
          <h4>Gerenciar Tags</h4>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <input id="newTagInput" class="wc-disparo-input" placeholder="Nome da nova tag..." style="flex:1" onkeydown="if(event.key==='Enter')VeltrisWPP.createTag()" />
            <button class="btn btn-save" onclick="VeltrisWPP.createTag()" style="font-size:0.72rem;white-space:nowrap">+ Criar</button>
          </div>
          <div id="savedTagsList" class="wc-tags-existing"></div>
        </div>
        <div class="wc-tags-section" style="border-top:1px solid var(--border);padding-top:16px">
          <h4>Vincular Contatos</h4>
          <div style="display:flex;gap:8px;margin-bottom:10px;align-items:flex-end">
            <div style="flex:1">
              <label style="font-size:0.65rem;color:var(--text-muted);display:block;margin-bottom:4px">Tag</label>
              <div class="cs-wrap" style="position:relative;min-width:160px">
                <div class="cs-trigger" id="tagLinkTrigger" onclick="VeltrisWPP.toggleLinkTagDrop(event)">
                  <span id="tagLinkSelected">Selecionar tag</span>
                  <span class="cs-arrow">▾</span>
                </div>
                <div class="cs-drop" id="tagLinkDrop">
                  <div class="cs-opt" data-value="" onclick="VeltrisWPP.selectLinkTag('')">Selecionar tag</div>
                  ${_savedTags.map(t => `<div class="cs-opt" data-value="${t}" onclick="VeltrisWPP.selectLinkTag('${t}')">${escHtml(t)}</div>`).join('')}
                </div>
              </div>
            </div>
          </div>
          <input id="tagLinkSearch" class="wc-disparo-input" placeholder="Buscar contato..." oninput="VeltrisWPP.onLinkSearch()" />
          <div class="wc-disparo-list" id="tagLinkContactList"></div>
          <div class="wc-tags-footer" style="margin-top:10px">
            <span id="tagLinkCount" class="wc-disparo-count">0 contatos selecionados</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-save" onclick="VeltrisWPP.linkTagAction('add')" style="font-size:0.72rem">Adicionar</button>
              <button class="btn btn-outline" onclick="VeltrisWPP.linkTagAction('remove')" style="font-size:0.72rem;color:#ef4444">Remover</button>
            </div>
          </div>
          <div id="tagLinkResult" class="wc-disparo-result" style="display:none"></div>
        </div>
      </div>`;
    renderSavedTags();
    renderLinkContactList();
  }

  function renderSavedTags() {
    var list = el('savedTagsList');
    if (!list) return;
    if (_savedTags.length === 0) {
      list.innerHTML = '<span style="font-size:0.75rem;color:var(--text-muted)">Nenhuma tag criada ainda</span>';
      return;
    }
    list.innerHTML = _savedTags.map(t => `
      <span class="wc-tag-existing" onclick="VeltrisWPP.selectLinkTag('${escHtml(t)}')">
        ${escHtml(t)}
        <span class="tag-del-btn" onclick="event.stopPropagation();VeltrisWPP.deleteTag('${escHtml(t)}')" style="margin-left:4px;cursor:pointer;opacity:0.5">&times;</span>
      </span>
    `).join('');
  }

  function createTag() {
    var input = el('newTagInput');
    if (!input || !input.value.trim()) return;
    var tag = input.value.trim().toLowerCase();
    input.value = '';
    if (!_savedTags.includes(tag)) {
      _savedTags.push(tag);
      _savedTags.sort();
      saveSavedTags();
    }
    renderSavedTags();
    rebuildLinkTagDrop();
  }

  function deleteTag(tag) {
    if (!confirm('Remover tag "' + tag + '"?')) return;
    _savedTags = _savedTags.filter(function(t) { return t !== tag; });
    saveSavedTags();
    renderSavedTags();
    rebuildLinkTagDrop();
    _tagsContactList.forEach(function(c) {
      var tags = c.tags || [];
      if (tags.includes(tag)) {
        var newTags = tags.filter(function(t) { return t !== tag; });
        c.tags = newTags;
        apiPatch('contacts', c.id, { tags: newTags });
      }
    });
  }

  function rebuildLinkTagDrop() {
    var drop = el('tagLinkDrop');
    if (!drop) return;
    var selected = el('tagLinkSelected');
    if (selected && _linkTagValue && !_savedTags.includes(_linkTagValue)) {
      _linkTagValue = '';
      selected.textContent = 'Selecionar tag';
    }
    drop.innerHTML = '<div class="cs-opt" data-value="" onclick="VeltrisWPP.selectLinkTag(\'\')">Selecionar tag</div>' +
      _savedTags.map(function(t) {
        return '<div class="cs-opt" data-value="' + escHtml(t) + '" onclick="VeltrisWPP.selectLinkTag(\'' + escHtml(t) + '\')">' + escHtml(t) + '</div>';
      }).join('');
  }

  function toggleLinkTagDrop(e) {
    if (e) e.stopPropagation();
    var drop = el('tagLinkDrop');
    if (!drop) return;
    drop.classList.toggle('visible');
    if (drop.classList.contains('visible')) {
      setTimeout(function() { document.addEventListener('click', closeLinkTagDrop); }, 10);
    }
  }
  function closeLinkTagDrop() {
    var drop = el('tagLinkDrop');
    if (drop) drop.classList.remove('visible');
    document.removeEventListener('click', closeLinkTagDrop);
  }
  function selectLinkTag(value) {
    _linkTagValue = value;
    var label = value || 'Selecionar tag';
    var sel = el('tagLinkSelected');
    if (sel) sel.textContent = label;
    closeLinkTagDrop();
  }

  function onLinkSearch() {
    renderLinkContactList();
  }

  function renderLinkContactList() {
    var list = el('tagLinkContactList');
    if (!list) return;
    if (!_tagsContactList || _tagsContactList.length === 0) {
      list.innerHTML = '<div class="wc-disparo-empty">Nenhum contato encontrado. Verifique se há contatos cadastrados em Clientes.</div>';
      updateLinkCount();
      return;
    }
    var selected = new Set(Array.from(qsa('.link-contact-cb:checked')).map(function(cb) { return cb.value; }));
    var q = (el('tagLinkSearch')?.value || '').toLowerCase();
    var filtered = _tagsContactList.filter(function(c) {
      if (!q) return true;
      return (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
    });
    list.innerHTML = filtered.map(function(c) {
      var hasTag = _linkTagValue && (c.tags || []).includes(_linkTagValue);
      return '<label class="wc-disparo-item" style="' + (hasTag ? 'opacity:0.5' : '') + '">' +
        '<input type="checkbox" class="link-contact-cb" value="' + c.id + '" ' + (selected.has(c.id) ? 'checked' : '') + ' onchange="VeltrisWPP.updateLinkCount()" />' +
        '<span class="wc-disparo-item-name">' + escHtml(c.name || '—') + '</span>' +
        '<span class="wc-disparo-item-phone" style="color:var(--text-dim);font-size:0.65rem">' + ((c.tags || []).includes(_linkTagValue) ? '✓' : '') + '</span>' +
        '</label>';
    }).join('') || '<div class="wc-disparo-empty">Nenhum contato encontrado</div>';
    updateLinkCount();
  }

  function updateLinkCount() {
    var count = el('tagLinkCount');
    var checks = qsa('.link-contact-cb:checked');
    if (count) count.textContent = checks.length + ' contato(s) selecionado(s)';
  }

  async function linkTagAction(action) {
    var result = el('tagLinkResult');
    if (!result) return;
    if (!_linkTagValue) { alert('Selecione uma tag'); return; }
    var checks = qsa('.link-contact-cb:checked');
    if (checks.length === 0) { alert('Selecione pelo menos um contato'); return; }
    result.style.display = 'none';
    var updated = 0, failed = 0;
    for (var i = 0; i < checks.length; i++) {
      var c = _tagsContactList.find(function(ct) { return String(ct.id) === checks[i].value; });
      if (!c) continue;
      var tags = c.tags || [];
      if (action === 'add') {
        if (!tags.includes(_linkTagValue)) tags = [...tags, _linkTagValue];
        else { updated++; continue; }
      } else {
        if (!tags.includes(_linkTagValue)) { updated++; continue; }
        tags = tags.filter(function(t) { return t !== _linkTagValue; });
      }
      try {
        await apiPatch('contacts', c.id, { tags: tags });
        c.tags = tags;
        updated++;
      } catch (e) { failed++; }
    }
    result.style.display = '';
    result.innerHTML = '<div class="wc-disparo-result-msg ' + (failed === 0 ? 'success' : 'warning') + '">' +
      '<strong>' + updated + '</strong> contato(s) atualizado(s)' +
      (failed > 0 ? ', <strong>' + failed + '</strong> falha(s)' : ' com sucesso') +
      '</div>';
    renderLinkContactList();
  }

  /* ============================ CLIENTES TABLE ============================ */
  async function renderClientes() {
    const container = el('wppClientes');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:0.85rem">Carregando contatos...</div>';
    if (S._serverSessionId) {
      try {
        var resp = await fetch(_wppServerUrl + '/db-contacts?sessionId=' + encodeURIComponent(S._serverSessionId))
        if (resp.ok) {
          var data = await resp.json()
          S.leads = data.contacts || []
          console.log('renderClientes: loaded', S.leads.length, 'contacts')
        } else {
          console.warn('renderClientes: fetch failed', resp.status)
        }
      } catch (e) { console.warn('renderClientes: error', e) }
    }
    if (!S.leads || !S.leads.length) { console.warn('renderClientes: fallback to apiGet'); S.leads = await apiGet('contacts', {}); }
    const actionsData = await apiGet('cadence_actions', { order: 'scheduled_at.desc' });
    S.cadence_actions = Array.isArray(actionsData) ? actionsData : [];
    const list = Array.isArray(S.leads) ? S.leads : [];
    container.innerHTML = `
      <div class="wc-lead-toolbar">
        <input id="wcLeadSearch" placeholder="Buscar cliente..." oninput="VeltrisWPP.filterLeads()" />
        <div class="cs-wrap" style="position:relative">
          <div class="cs-trigger" id="wcStageTrigger" onclick="VeltrisWPP.toggleStageDropdown(event)">
            <span id="wcStageSelected">Estágios</span>
            <span class="cs-arrow">▾</span>
          </div>
          <div class="cs-drop" id="wcStageDrop">
            <div class="cs-opt" data-value="" onclick="VeltrisWPP.selectStage('')">Estágios</div>
            ${S.stages.map(s => `<div class="cs-opt" data-value="${s}" onclick="VeltrisWPP.selectStage('${s}')">${stageLabel(s)}</div>`).join('')}
          </div>
        </div>
        <button class="btn btn-outline" onclick="VeltrisWPP.toggleBulkSelect()" style="font-size:0.7rem" id="wcBulkBtn">✏️  Editar em massa</button>
        <button class="btn btn-save" onclick="VeltrisWPP.showAddLeadForm()" style="font-size:0.7rem">+ Novo Cliente</button>
      </div>
      <div id="wcBulkBar" style="display:none;padding:6px 0;gap:6px;align-items:center">
        <span style="font-size:0.7rem;color:var(--text-dim)" id="wcBulkCount">0 selecionados</span>
        <button class="btn btn-save" style="font-size:0.65rem;padding:4px 10px" onclick="VeltrisWPP.bulkEdit()">✏️  Editar selecionados</button>
        <button class="btn btn-outline" style="font-size:0.65rem;padding:4px 10px" onclick="VeltrisWPP.toggleBulkSelect()">Cancelar</button>
      </div>
      <div id="wcAddLeadForm" style="display:none">
        <div class="wc-add-lead">
          <div class="field"><label>Nome</label><input id="wcNewLeadName" placeholder="Nome" /></div>
          <div class="field"><label>Telefone</label><input id="wcNewLeadPhone" placeholder="+5511999999999" /></div>
          <div class="field"><label>Email</label><input id="wcNewLeadEmail" placeholder="email@exemplo.com" /></div>
          <div class="field"><label>Estágio</label>
            <div class="cs-wrap" style="position:relative">
              <div class="cs-trigger" id="wcNewLeadStageTrigger" onclick="VeltrisWPP.toggleNewLeadStage(event)">
                <span id="wcNewLeadStageSelected">${stageLabel(S.stages[0] || 'agendado')}</span>
                <span class="cs-arrow">▾</span>
              </div>
              <div class="cs-drop" id="wcNewLeadStageDrop">
                ${S.stages.map(s => `<div class="cs-opt" data-value="${s}" onclick="VeltrisWPP.selectNewLeadStage('${s}')">${stageLabel(s)}</div>`).join('')}
              </div>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <div class="field" style="flex:1">
              <label>Data</label>
              <div class="cs-wrap" style="position:relative">
                <div class="cs-trigger" id="wcNewLeadDateTrigger" onclick="VeltrisWPP.toggleDatePicker(event)">
                  <span id="wcNewLeadDateSelected">Selecionar data</span>
                  <span class="cs-arrow">▾</span>
                </div>
                <div class="cs-drop wc-date-drop" id="wcNewLeadDateDrop">
                  <div class="wc-date-picker-header">
                    <button class="wc-date-nav" onclick="VeltrisWPP.datePickerMonth(-1)"><i class="fi fi-rr-angle-left"></i></button>
                    <span id="wcDatePickerTitle" class="wc-date-picker-title"></span>
                    <button class="wc-date-nav" onclick="VeltrisWPP.datePickerMonth(1)"><i class="fi fi-rr-angle-right"></i></button>
                  </div>
                  <div class="wc-date-picker-days" id="wcDatePickerDays"></div>
                </div>
              </div>
            </div>
            <div class="field" style="flex:0 0 110px">
              <label>Hora</label>
              <div class="cs-wrap" style="position:relative">
                <div class="cs-trigger" id="wcNewLeadTimeTrigger" onclick="VeltrisWPP.toggleNewLeadTimeDropdown(event)">
                  <span id="wcNewLeadTimeSelected">10:00</span>
                  <span class="cs-arrow">▾</span>
                </div>
                <div class="cs-drop" id="wcNewLeadTimeDrop"></div>
                <input type="hidden" id="wcNewLeadTime" value="10:00" />
              </div>
            </div>
          </div>
          <button class="btn btn-save" onclick="VeltrisWPP.addLead()" style="font-size:0.7rem">Adicionar</button>
          <button class="btn btn-outline" onclick="VeltrisWPP.hideAddLeadForm()" style="font-size:0.7rem">Cancelar</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="wc-clientes-table">
          <thead>
            <tr>
              <th style="text-align:center;width:30px"><input type="checkbox" id="wcBulkAll" onchange="VeltrisWPP.toggleBulkAll(this.checked)" style="accent-color:var(--accent)" /></th>
              <th style="text-align:center">Nome</th>
              <th style="text-align:center">Telefone</th>
              <th style="text-align:center">Estágio</th>
              <th style="text-align:center">Último Contato</th>
              <th style="text-align:center">Último Agendamento</th>
              <th style="text-align:center">Etiquetas</th>
              <th style="text-align:center">WhatsApp</th>
              <th style="text-align:center">Excluir</th>
            </tr>
          </thead>
          <tbody id="wcLeadsBody">${renderClientesRows(list.slice(0, 15))}</tbody>
        </table>
      </div>
      <div id="wcLeadsPagination" style="display:flex;gap:4px;justify-content:center;padding:10px 0;flex-wrap:wrap"></div>`;
    // Hide checkboxes initially
    var tableContainer = document.querySelector('.wc-clientes-table')?.closest('div') || document.querySelector('.wc-clientes-table')?.parentNode
    if (tableContainer) tableContainer.classList.remove('wc-bulk-active')
    renderLeadsPagination()
  }

  function renderLeadsPagination() {
    var data = S._filteredLeads || S.leads || []
    var total = data.length; var perPage = 15; var pages = Math.ceil(total / perPage) || 1; var cur = S._leadsPage || 1
    var el = document.getElementById('wcLeadsPagination'); if (!el) return
    if (pages <= 1) { el.innerHTML = ''; return }
    var h = ''
    if (cur > 1) h += '<button class="btn btn-outline" style="font-size:0.7rem;padding:4px 10px" onclick="VeltrisWPP.goLeadsPage(' + (cur - 1) + ')">‹</button>'
    var startP = Math.max(1, cur - 1)
    var endP = Math.min(pages, startP + 3)
    if (endP - startP < 3) startP = Math.max(1, endP - 3)
    for (var p = startP; p <= endP; p++) h += p === cur ? '<button class="btn btn-save" style="font-size:0.7rem;padding:4px 10px;min-width:32px">' + p + '</button>' : '<button class="btn btn-outline" style="font-size:0.7rem;padding:4px 10px;min-width:32px" onclick="VeltrisWPP.goLeadsPage(' + p + ')">' + p + '</button>'
    if (cur < pages) h += '<button class="btn btn-outline" style="font-size:0.7rem;padding:4px 10px" onclick="VeltrisWPP.goLeadsPage(' + (cur + 1) + ')">›</button>'
    el.innerHTML = h
  }

  function goLeadsPage(page) {
    S._leadsPage = page
    renderLeadsTable()
  }

  function renderLeadsTable() {
    var data = S._filteredLeads || S.leads || []
    var perPage = 15
    var page = S._leadsPage || 1
    var start = (page - 1) * perPage
    var tbody = document.getElementById('wcLeadsBody')
    if (tbody) tbody.innerHTML = renderClientesRows(data.slice(start, start + perPage))
    renderLeadsPagination()
  }

  function getLastAction(contactId) {
    if (!Array.isArray(S.cadence_actions)) return null;
    var actions = S.cadence_actions.filter(function (a) { return a.contact_id === contactId; });
    if (actions.length === 0) return null;
    actions.sort(function (a, b) { return (b.scheduled_at || '').localeCompare(a.scheduled_at || ''); });
    return actions[0].scheduled_at || null;
  }

  function renderClientesRows(leads) {
    if (leads.length === 0) return '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:30px">Nenhum cliente encontrado</td></tr>';
    return leads.map(l => {
      var lastAction = getLastAction(l.id);
      var isSelected = S._bulkSelected && S._bulkSelected[l.id]
      return `
      <tr style="cursor:pointer;text-align:center" onclick="var bar=document.getElementById('wcBulkBar');if(bar&&bar.style.display!=='none'){var cb=this.querySelector('.wc-bulk-cb');if(cb){cb.checked=!cb.checked;VeltrisWPP.updateBulkCount()}}else{VeltrisWPP.selectLead('${l.id}')}">
        <td style="text-align:center"><input type="checkbox" class="wc-bulk-cb" data-id="${l.id}" ${isSelected?'checked':''} onchange="VeltrisWPP.updateBulkCount()" style="accent-color:var(--accent)" onclick="event.stopPropagation()" /></td>
        <td style="text-align:center"><strong>${escHtml(l.name || '—')}</strong></td>
        <td style="text-align:center">${escHtml(l.phone || '—')}</td>
        <td style="text-align:center"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${stageColor(l.stage)};margin-right:6px;vertical-align:middle"></span>${stageLabel(l.stage)}</td>
        <td style="text-align:center">${l.last_contacted_at ? formatFullDate(l.last_contacted_at) : '—'}</td>
        <td style="text-align:center">${lastAction ? formatFullDate(lastAction) : '—'}<button class="btn btn-outline" style="font-size:0.7rem;padding:2px 6px;margin-left:4px;border-radius:4px;vertical-align:middle" onclick="event.stopPropagation();VeltrisWPP.editLead('${l.id}')" title="Editar cliente"><i class="fi fi-rr-pencil"></i></button></td>
        <td style="text-align:center">${(l.tags||[]).map(function(t){return '<span class="wc-tag" style="background:hsla(var(--accent-h),var(--accent-s),55%,0.12);color:var(--accent);font-size:0.55rem;padding:1px 5px;margin:1px;display:inline-block;border-radius:4px">'+escHtml(t)+'</span>'}).join('')||'—'}</td>
        <td style="text-align:center"><button class="btn btn-outline" style="font-size:0.85rem;padding:4px 10px;border-radius:9999px" onclick="event.stopPropagation();VeltrisWPP.openWhatsAppChat('${l.phone}')" title="WhatsApp"><i class="fi fi-rr-comment-alt"></i></button></td>
        <td style="text-align:center"><button class="btn btn-outline" style="font-size:0.85rem;padding:4px 10px;border-radius:9999px;color:var(--red)" onclick="event.stopPropagation();VeltrisWPP.deleteLead('${l.id}')" title="Excluir"><i class="fi fi-rr-trash"></i></button></td>
      </tr>
    `}).join('');
  }

  var _wcStageValue = '';
  var _wcNewLeadStage = S.stages && S.stages.length > 0 ? S.stages[0] : 'agendado';
  var _wcNewLeadDate = '';
  var _wcDatePickerYear = new Date().getFullYear();
  var _wcDatePickerMonth = new Date().getMonth();
  var _wcCalendarSelectedDate = '';

  function toggleStageDropdown(e) {
    if (e) e.stopPropagation();
    var drop = el('wcStageDrop');
    if (!drop) return;
    drop.classList.toggle('visible');
    if (drop.classList.contains('visible')) {
      setTimeout(function () {
        document.addEventListener('click', closeStageDropdown);
      }, 10);
    }
  }
  function closeStageDropdown() {
    var drop = el('wcStageDrop');
    if (drop) drop.classList.remove('visible');
    document.removeEventListener('click', closeStageDropdown);
  }
  function selectStage(value) {
    _wcStageValue = value;
    var label = value ? stageLabel(value) : 'Estágios';
    el('wcStageSelected').textContent = label;
    closeStageDropdown();
    filterLeads();
  }

  function toggleNewLeadStage(e) {
    if (e) e.stopPropagation();
    var drop = el('wcNewLeadStageDrop');
    if (!drop) return;
    drop.classList.toggle('visible');
    if (drop.classList.contains('visible')) {
      setTimeout(function () {
        document.addEventListener('click', closeNewLeadStage);
      }, 10);
    }
  }
  function closeNewLeadStage() {
    var drop = el('wcNewLeadStageDrop');
    if (drop) drop.classList.remove('visible');
    document.removeEventListener('click', closeNewLeadStage);
  }
  function selectNewLeadStage(value) {
    _wcNewLeadStage = value;
    el('wcNewLeadStageSelected').textContent = stageLabel(value);
    closeNewLeadStage();
  }

  function toggleDatePicker(e) {
    if (e) e.stopPropagation();
    var drop = el('wcNewLeadDateDrop');
    if (!drop) return;
    drop.classList.toggle('visible');
    if (drop.classList.contains('visible')) {
      var now = new Date();
      if (!_wcNewLeadDate) {
        _wcDatePickerYear = now.getFullYear();
        _wcDatePickerMonth = now.getMonth();
      }
      renderDatePickerGrid();
      setTimeout(function () {
        document.addEventListener('click', closeDatePicker);
      }, 10);
    }
  }
  function closeDatePicker() {
    var drop = el('wcNewLeadDateDrop');
    if (drop) drop.classList.remove('visible');
    document.removeEventListener('click', closeDatePicker);
  }
  function datePickerMonth(delta) {
    _wcDatePickerMonth += delta;
    if (_wcDatePickerMonth > 11) { _wcDatePickerMonth = 0; _wcDatePickerYear++; }
    if (_wcDatePickerMonth < 0) { _wcDatePickerMonth = 11; _wcDatePickerYear--; }
    renderDatePickerGrid();
  }
  function renderDatePickerGrid() {
    var title = el('wcDatePickerTitle');
    var grid = el('wcDatePickerDays');
    if (!title || !grid) return;
    var monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    var dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    title.textContent = monthNames[_wcDatePickerMonth] + ' ' + _wcDatePickerYear;
    var firstDay = new Date(_wcDatePickerYear, _wcDatePickerMonth, 1).getDay();
    var daysInMonth = new Date(_wcDatePickerYear, _wcDatePickerMonth + 1, 0).getDate();
    var today = new Date();
    var html = '<div class="wc-dp-day-names">' + dayNames.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div><div class="wc-dp-grid">';
    for (var i = 0; i < firstDay; i++) {
      html += '<div class="wc-dp-day empty"></div>';
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = _wcDatePickerYear + '-' + String(_wcDatePickerMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var isToday = _wcDatePickerYear === today.getFullYear() && _wcDatePickerMonth === today.getMonth() && d === today.getDate();
      var isSelected = dateStr === _wcNewLeadDate;
      var cls = 'wc-dp-day';
      if (isToday) cls += ' today';
      if (isSelected) cls += ' selected';
      html += '<div class="' + cls + '" data-date="' + dateStr + '" onclick="VeltrisWPP.selectDatePickerDate(\'' + dateStr + '\')">' + d + '</div>';
    }
    html += '</div>';
    grid.innerHTML = html;
  }
  function selectDatePickerDate(dateStr) {
    _wcNewLeadDate = dateStr;
    var parts = dateStr.split('-');
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    var label = d.toLocaleDateString('pt-BR');
    el('wcNewLeadDateSelected').textContent = label;
    closeDatePicker();
  }

  var _wcTimeOptions = [];
  for (var _hti = 0; _hti <= 23; _hti++) {
    _wcTimeOptions.push(String(_hti).padStart(2, '0') + ':00');
    _wcTimeOptions.push(String(_hti).padStart(2, '0') + ':30');
  }
  var _wcTimeOpen = null;

  function initTimeDropdown(dropId) {
    var drop = el(dropId);
    if (!drop) return;
    drop.innerHTML = _wcTimeOptions.map(function (t) {
      return '<div class="cs-opt" data-value="' + t + '" onclick="VeltrisWPP.selectTime(\'' + t + '\',\'' + dropId + '\')">' + t + '</div>';
    }).join('');
  }

  function toggleNewLeadTimeDropdown(e) {
    if (e) e.stopPropagation();
    closeAllTimeDropdowns();
    _wcTimeOpen = 'wcNewLeadTime';
    var drop = el('wcNewLeadTimeDrop');
    if (!drop) return;
    initTimeDropdown('wcNewLeadTimeDrop');
    drop.classList.add('visible');
    el('wcNewLeadTimeTrigger').classList.add('open');
    setTimeout(function () { document.addEventListener('click', closeAllTimeDropdowns); }, 10);
  }

  function toggleEditLeadTimeDropdown(e) {
    if (e) e.stopPropagation();
    closeAllTimeDropdowns();
    _wcTimeOpen = 'wppEditLeadTime';
    var drop = el('wppEditLeadTimeDrop');
    if (!drop) return;
    initTimeDropdown('wppEditLeadTimeDrop');
    drop.classList.add('visible');
    el('wppEditLeadTimeTrigger').classList.add('open');
    setTimeout(function () { document.addEventListener('click', closeAllTimeDropdowns); }, 10);
  }

  function closeAllTimeDropdowns() {
    var ids = ['wcNewLeadTime', 'wppEditLeadTime'];
    ids.forEach(function (id) {
      var drop = el(id + 'Drop');
      var trigger = el(id + 'Trigger');
      if (drop) drop.classList.remove('visible');
      if (trigger) trigger.classList.remove('open');
    });
    _wcTimeOpen = null;
    document.removeEventListener('click', closeAllTimeDropdowns);
  }

  function selectTime(value, dropId) {
    var prefix = dropId.replace('Drop', '');
    el(prefix + 'Selected').textContent = value;
    el(prefix).value = value;
    var drop = el(dropId);
    if (drop) {
      drop.querySelectorAll('.cs-opt').forEach(function (o) { o.classList.remove('selected'); });
      var opt = drop.querySelector('.cs-opt[data-value="' + value + '"]');
      if (opt) opt.classList.add('selected');
    }
    closeAllTimeDropdowns();
  }

  async function deleteLead(id) {
    if (!confirm('Tem certeza que deseja excluir este cliente?')) return;
    const lead = S.leads.find(l => l.id === id);
    if (!lead) return;
    try {
      if (window._supaDelete) {
        await window._supaDelete('contacts', 'id=eq.' + encodeURIComponent(id));
        if (Array.isArray(S.cadence_actions)) {
          var toDelete = S.cadence_actions.filter(function (a) { return a.contact_id === id; });
          for (var i = 0; i < toDelete.length; i++) {
            await window._supaDelete('cadence_actions', 'id=eq.' + encodeURIComponent(toDelete[i].id));
          }
          S.cadence_actions = S.cadence_actions.filter(function (a) { return a.contact_id !== id; });
        }
      }
      S.leads = S.leads.filter(function (l) { return l.id !== id; });
      filterLeads();
    } catch (e) { if (typeof console !== 'undefined' && console.error) console.error('Erro ao excluir cliente'); }
  }

  function filterLeads() {
    S._leadsPage = 1
    const search = (el('wcLeadSearch')?.value || '').toLowerCase();
    const stage = _wcStageValue;
    const list = Array.isArray(S.leads) ? S.leads : [];
    S._filteredLeads = list.filter(l => {
      if (search && !(l.name || '').toLowerCase().includes(search) && !(l.phone || '').includes(search)) return false;
      if (stage && l.stage !== stage) return false;
      return true;
    });
    renderLeadsTable()
  }

  function showAddLeadForm() {
    const form = el('wcAddLeadForm');
    if (form) form.style.display = '';
  }
  function hideAddLeadForm() {
    const form = el('wcAddLeadForm');
    if (form) form.style.display = 'none';
  }
  async function addLead() {
    const name = el('wcNewLeadName')?.value?.trim();
    const phone = el('wcNewLeadPhone')?.value?.trim();
    const email = el('wcNewLeadEmail')?.value?.trim();
    const stage = _wcNewLeadStage;
    const dateVal = _wcNewLeadDate;
    if (!name) return;
    const res = await apiPost('contacts', { name, phone, email, stage, source: 'manual', score: 0 });
    if (res) {
      S.leads.push(res);
      if (dateVal) {
        var hours = el('wcNewLeadTime')?.value || '10:00';
        var scheduled_at = dateVal + 'T' + hours + ':00';
        const action = await apiPost('cadence_actions', {
          contact_id: res.id,
          contact_name: name,
          scheduled_at: scheduled_at,
          status: 'pending',
          description: 'Novo cliente: ' + name,
        });
        if (action) {
          if (!Array.isArray(S.cadence_actions)) S.cadence_actions = [];
          S.cadence_actions.push(action);
        }
      }
      hideAddLeadForm();
      el('wcNewLeadName').value = '';
      el('wcNewLeadPhone').value = '';
      el('wcNewLeadEmail').value = '';
      _wcNewLeadDate = '';
      el('wcNewLeadDateSelected').textContent = 'Selecionar data';
      filterLeads();
    }
  }

  /* ============================ BULK SELECT ============================ */
  function toggleBulkSelect() {
    var bar = el('wcBulkBar')
    if (!bar) return
    var wasVisible = bar.style.display !== 'none'
    bar.style.display = wasVisible ? 'none' : 'flex'
    if (wasVisible) { S._bulkSelected = {}; var allCb = document.getElementById('wcBulkAll'); if (allCb) allCb.checked = false }
    var tableContainer = document.querySelector('.wc-clientes-table')?.closest('.wc-clientes-table')?.parentNode || document.querySelector('.wc-clientes-table')?.parentNode
    if (tableContainer) {
      if (wasVisible) tableContainer.classList.remove('wc-bulk-active')
      else tableContainer.classList.add('wc-bulk-active')
    }
    updateBulkCount()
    filterLeads()
  }
  function toggleBulkAll(checked) {
    var cbs = qsa('.wc-bulk-cb')
    for (var i = 0; i < cbs.length; i++) cbs[i].checked = checked
    updateBulkCount()
  }
  function updateBulkCount() {
    var cbs = qsa('.wc-bulk-cb:checked')
    var count = cbs.length
    var el = document.getElementById('wcBulkCount')
    if (el) el.textContent = count + ' selecionado(s)'
    if (!S._bulkSelected) S._bulkSelected = {}
    S._bulkSelected = {}
    for (var i = 0; i < cbs.length; i++) { var id = cbs[i].dataset.id; if (id) S._bulkSelected[id] = true }
  }
  function getBulkSelectedIds() {
    return Object.keys(S._bulkSelected || {})
  }
  async function bulkTag() {
    var ids = getBulkSelectedIds()
    if (!ids.length) return
    var tag = prompt('Digite a etiqueta para aplicar aos ' + ids.length + ' contatos:')
    if (!tag) return
    tag = tag.trim().toLowerCase()
    for (var i = 0; i < ids.length; i++) {
      var contact = S.leads.find(function(l) { return l.id === ids[i] })
      if (!contact) continue
      var tags = contact.tags || []
      if (!tags.includes(tag)) {
        tags.push(tag)
        await apiPatch('contacts', ids[i], { tags: tags })
        contact.tags = tags
      }
    }
    filterLeads()
  }
  function bulkEdit() {
    var ids = getBulkSelectedIds()
    if (!ids.length) return
    var overlay = document.getElementById('wcBulkEditOverlay')
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.id = 'wcBulkEditOverlay'
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px'
      overlay.innerHTML = '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px;width:100%;max-width:400px">' +
        '<h3 style="margin:0 0 16px;font-size:1rem;color:var(--text)">Editar ' + ids.length + ' contatos</h3>' +
        '<div class="field"><label>Estágio</label><select id="wcBulkStage" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:inherit">' +
          '<option value="">Manter atual</option>' +
          S.stages.map(function(s) { return '<option value="' + s + '">' + stageLabel(s) + '</option>' }).join('') +
        '</select></div>' +
        '<div class="field"><label>Tag (adicional)</label><input id="wcBulkTag" placeholder="Nova tag..." style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:inherit;box-sizing:border-box" /></div>' +
        '<div class="field"><label>Data último contato</label><input type="date" id="wcBulkDate" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:inherit;box-sizing:border-box" /></div>' +
        '<div class="field"><label>Agendamento</label><input type="date" id="wcBulkSched" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:inherit;box-sizing:border-box" /></div>' +
        '<div style="display:flex;gap:8px;margin-top:16px">' +
          '<button class="btn btn-save" onclick="VeltrisWPP.applyBulkEdit()" style="flex:1">Aplicar</button>' +
          '<button class="btn btn-outline" onclick="this.closest(\'#wcBulkEditOverlay\').remove()" style="flex:1">Cancelar</button>' +
        '</div></div>'
      document.body.appendChild(overlay)
    }
  }
  async function applyBulkEdit() {
    var ids = getBulkSelectedIds()
    if (!ids.length) return
    var stage = el('wcBulkStage')?.value || ''
    var newTag = el('wcBulkTag')?.value?.trim().toLowerCase() || ''
    var lastContact = el('wcBulkDate')?.value || ''
    var schedDate = el('wcBulkSched')?.value || ''
    for (var i = 0; i < ids.length; i++) {
      var contact = S.leads.find(function(l) { return l.id === ids[i] })
      if (!contact) continue
      var updates = {}
      if (stage) updates.stage = stage
      if (newTag) {
        var tags = contact.tags || []
        if (!tags.includes(newTag)) { tags.push(newTag); updates.tags = tags }
      }
      if (lastContact) updates.last_contacted_at = new Date(lastContact).toISOString()
      if (Object.keys(updates).length) await apiPatch('contacts', ids[i], updates)
      if (schedDate) {
        await apiPost('cadence_actions', {
          contact_id: contact.id, contact_name: contact.name,
          scheduled_at: schedDate + 'T10:00:00', status: 'pending',
          description: newTag ? 'Etiqueta: ' + newTag : 'Agendado em massa'
        })
      }
      if (stage) contact.stage = stage
      if (newTag && !(contact.tags||[]).includes(newTag)) { if (!contact.tags) contact.tags = []; contact.tags.push(newTag) }
      if (lastContact) contact.last_contacted_at = new Date(lastContact).toISOString()
    }
    var overlay = document.getElementById('wcBulkEditOverlay')
    if (overlay) overlay.remove()
    filterLeads()
  }
  function editLead(contactId) {
    var lead = S.leads.find(function (l) { return l.id === contactId; });
    if (!lead) return;
    var action = Array.isArray(S.cadence_actions) ? S.cadence_actions.find(function (a) { return a.contact_id === contactId; }) : null;
    var datePart = '', timePart = '10:00';
    if (action && action.scheduled_at) {
      var d = new Date(action.scheduled_at);
      if (!isNaN(d.getTime())) {
        datePart = d.toISOString().split('T')[0];
        timePart = d.toTimeString().slice(0, 5);
      }
    }
    var overlay = document.getElementById('wppEditLeadOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'wppEditLeadOverlay';
      overlay.className = 'modal-overlay';
      overlay.innerHTML = '<div class="modal" style="max-width:440px;padding:24px">' +
        '<h3 style="margin:0 0 16px;font-size:1rem"><i class="fi fi-rr-user-pen"></i> Editar Cliente</h3>' +
        '<div class="settings-field"><label>Nome</label><input type="text" id="wppEditLeadName" /></div>' +
        '<div class="settings-field"><label>Telefone</label><input type="text" id="wppEditLeadPhone" /></div>' +
        '<div class="settings-field"><label>Email</label><input type="text" id="wppEditLeadEmail" /></div>' +
        '<div class="settings-field"><label>Estágio</label><select id="wppEditLeadStage">' +
          S.stages.map(function (s) { return '<option value="' + s + '">' + stageLabel(s) + '</option>'; }).join('') +
        '</select></div>' +
        '<div style="display:flex;gap:8px">' +
          '<div class="settings-field" style="flex:1"><label>Data do agendamento</label><input type="date" id="wppEditLeadDate" /></div>' +
          '<div class="settings-field" style="flex:0 0 110px"><label>Hora</label><div class="cs-wrap" style="position:relative"><div class="cs-trigger" id="wppEditLeadTimeTrigger" onclick="VeltrisWPP.toggleEditLeadTimeDropdown(event)"><span id="wppEditLeadTimeSelected">10:00</span><span class="cs-arrow">▾</span></div><div class="cs-drop" id="wppEditLeadTimeDrop"></div><input type="hidden" id="wppEditLeadTime" value="10:00" /></div></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:16px">' +
          '<button class="btn btn-primary" onclick="VeltrisWPP.saveEditedLead()" style="flex:1">Salvar</button>' +
          '<button class="btn btn-outline" onclick="document.getElementById(\'wppEditLeadOverlay\').style.display=\'none\'" style="flex:1">Cancelar</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.style.display = 'none'; });
    }
    document.getElementById('wppEditLeadName').value = lead.name || '';
    document.getElementById('wppEditLeadPhone').value = lead.phone || '';
    document.getElementById('wppEditLeadEmail').value = lead.email || '';
    document.getElementById('wppEditLeadStage').value = lead.stage || S.stages[0];
    document.getElementById('wppEditLeadDate').value = datePart;
    document.getElementById('wppEditLeadTime').value = timePart;
    document.getElementById('wppEditLeadTimeSelected').textContent = timePart;
    overlay.dataset.contactId = contactId;
    overlay.style.display = 'flex';
  }

  function saveEditedLead() {
    var overlay = document.getElementById('wppEditLeadOverlay');
    if (!overlay) return;
    var contactId = overlay.dataset.contactId;
    var lead = S.leads.find(function (l) { return l.id === contactId; });
    if (!lead) return;
    var name = document.getElementById('wppEditLeadName').value.trim();
    var phone = document.getElementById('wppEditLeadPhone').value.trim();
    var email = document.getElementById('wppEditLeadEmail').value.trim();
    var stage = document.getElementById('wppEditLeadStage').value;
    var dateVal = document.getElementById('wppEditLeadDate').value;
    var timeVal = document.getElementById('wppEditLeadTime').value || '10:00';
    if (!name) { if (typeof showToast === 'function') showToast('Nome é obrigatório'); return; }
    apiPatch('contacts', contactId, { name: name, phone: phone, email: email, stage: stage }).then(function () {
      lead.name = name; lead.phone = phone; lead.email = email; lead.stage = stage;
      if (dateVal) {
        var scheduled_at = dateVal + 'T' + timeVal + ':00';
        var action = Array.isArray(S.cadence_actions) ? S.cadence_actions.find(function (a) { return a.contact_id === contactId; }) : null;
        if (action) {
          apiPatch('cadence_actions', action.id, { scheduled_at: scheduled_at }).then(function () {
            action.scheduled_at = scheduled_at;
            afterEdit();
          }).catch(function () { afterEdit(); });
        } else {
          apiPost('cadence_actions', {
            contact_id: contactId, contact_name: name, scheduled_at: scheduled_at, status: 'pending', description: 'Cliente: ' + name,
          }).then(function (res) {
            if (res) { if (!Array.isArray(S.cadence_actions)) S.cadence_actions = []; S.cadence_actions.push(res); }
            afterEdit();
          }).catch(function () { afterEdit(); });
        }
      } else {
        afterEdit();
      }
    }).catch(function () {
      if (typeof showToast === 'function') showToast('Erro ao salvar cliente.');
    });
    function afterEdit() {
      overlay.style.display = 'none';
      filterLeads();
      if (typeof showToast === 'function') showToast('Cliente atualizado!');
    }
  }

  function selectLead(id) {
    // Open in conversas - find chat for this contact
    const chat = S.chats.find(c => c.contact_id === id);
    if (chat) {
      switchTab('conversas');
      selectChat(chat.id);
    }
  }

  function openWhatsAppChat(phone) {
    if (!phone) return;
    const clean = phone.replace(/\D/g, '');
    window.open(`https://wa.me/55${clean}`, '_blank');
  }

  /* ============================ CADENCES ============================ */
  async function renderCadencias() {
    const container = el('wppCadencias');
    if (!container) return;
    S.cadences = await apiGet('cadences', {});
    const list = Array.isArray(S.cadences) ? S.cadences : [];
    container.innerHTML = `
      <div class="wc-cadence-layout">
        <div class="wc-cadence-list">
          <button class="btn btn-save" onclick="VeltrisWPP.newCadence()" style="font-size:0.72rem;margin-bottom:8px;width:100%">+ Nova CadÃªncia</button>
          ${list.map(c => `
            <button class="wc-cadence-item ${c.id === S.activeCadenceId ? 'active' : ''}" onclick="VeltrisWPP.selectCadence('${c.id}')">
              ${escHtml(c.name || 'Sem nome')}
              ${c.active ? '<div class="sub">Ativa Â· ' + (c.steps?.length || 0) + ' passos</div>' : '<div class="sub">Inativa</div>'}
            </button>
          `).join('') || '<div style="font-size:0.7rem;color:var(--text-muted);padding:10px;text-align:center">Nenhuma cadÃªncia</div>'}
        </div>
        <div class="wc-cadence-editor" id="wcCadenceEditor">
          <div style="padding:30px;text-align:center;color:var(--text-muted);font-size:0.85rem">Selecione ou crie uma cadÃªncia</div>
        </div>
      </div>`;
    if (S.activeCadenceId) renderCadenceEditor();
  }

  function selectCadence(id) {
    S.activeCadenceId = id;
    renderCadencias();
    renderCadenceEditor();
  }

  function renderCadenceEditor() {
    const editor = el('wcCadenceEditor');
    if (!editor) return;
    const cad = Array.isArray(S.cadences) ? S.cadences.find(c => c.id === S.activeCadenceId) : null;
    if (!cad) {
      editor.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:0.85rem">Selecione uma cadÃªncia</div>';
      return;
    }
    const steps = cad.steps || [];
    editor.innerHTML = `
      <div class="wc-cadence-header">
        <input id="wcCadenceName" value="${escHtml(cad.name || '')}" placeholder="Nome da cadÃªncia" onchange="VeltrisWPP.saveCadenceName(this.value)" />
        <div style="display:flex;gap:6px">
          <label style="display:flex;align-items:center;gap:4px;font-size:0.7rem;color:var(--text-dim)">
            <input type="checkbox" ${cad.active ? 'checked' : ''} onchange="VeltrisWPP.toggleCadence(this.checked)" />
            Ativa
          </label>
          <button class="btn btn-outline" onclick="VeltrisWPP.deleteCadence()" style="font-size:0.7rem;color:#ef4444">Excluir</button>
        </div>
      </div>
      <div class="wc-cadence-body">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h3 style="font-size:0.85rem;font-weight:600;color:var(--text);margin:0">Passos da CadÃªncia</h3>
          <button class="btn btn-save" onclick="VeltrisWPP.addStep()" style="font-size:0.7rem">+ Passo</button>
        </div>
        <div id="wcCadenceSteps">
          ${steps.map((s, i) => `
            <div class="wc-step">
              <div class="wc-step-order">${i + 1}</div>
              <div class="wc-step-fields">
                <div class="field-row">
                  <input value="${escHtml(s.type || 'message')}" placeholder="Tipo (message/call)" style="width:100px" onchange="VeltrisWPP.updateStep(${i},'type',this.value)" />
                  <input type="number" value="${s.delay_hours || 0}" placeholder="Delay (h)" style="width:80px" onchange="VeltrisWPP.updateStep(${i},'delay_hours',parseInt(this.value)||0)" />
                  <button class="wc-step-remove" onclick="VeltrisWPP.removeStep(${i})"><i class="fi fi-rr-cross"></i></button>
                </div>
                <div class="field-row">
                  <textarea placeholder="Template da mensagem..." onchange="VeltrisWPP.updateStep(${i},'template',this.value)">${escHtml(s.template || '')}</textarea>
                </div>
              </div>
            </div>
          `).join('') || '<div style="font-size:0.75rem;color:var(--text-muted);padding:10px">Nenhum passo definido</div>'}
        </div>
        ${steps.length > 0 ? `
        <div class="wc-timeline">
          <div class="wc-timeline-bar">
            ${steps.map((s, i) => `<div class="wc-timeline-seg active"></div>`).join('')}
          </div>
          <div class="wc-timeline-labels">
            ${steps.map((s, i) => `<span>${i + 1}. ${s.type || 'msg'} (${s.delay_hours || 0}h)</span>`).join('')}
          </div>
        </div>` : ''}
      </div>`;
  }

  async function newCadence() {
    const res = await apiPost('cadences', { name: 'Nova CadÃªncia', steps: [], active: true });
    if (res) {
      S.cadences.push(res);
      S.activeCadenceId = res.id;
      renderCadencias();
    }
  }

  async function deleteCadence() {
    if (!S.activeCadenceId) return;
      try {
        if (window._supaDelete) {
          await window._supaDelete('cadences', 'id=eq.' + encodeURIComponent(S.activeCadenceId));
        }
      } catch (e) { if (typeof console !== 'undefined' && console.error) console.error('Delete cadence error'); }
  }

  async function saveCadenceName(name) {
    if (!S.activeCadenceId) return;
    await apiPatch('cadences', S.activeCadenceId, { name });
    const cad = S.cadences.find(c => c.id === S.activeCadenceId);
    if (cad) cad.name = name;
  }

  async function toggleCadence(active) {
    if (!S.activeCadenceId) return;
    await apiPatch('cadences', S.activeCadenceId, { active });
    const cad = S.cadences.find(c => c.id === S.activeCadenceId);
    if (cad) cad.active = active;
  }

  async function addStep() {
    if (!S.activeCadenceId) return;
    const cad = S.cadences.find(c => c.id === S.activeCadenceId);
    if (!cad) return;
    const steps = [...(cad.steps || []), { type: 'message', delay_hours: 24, template: '' }];
    await apiPatch('cadences', S.activeCadenceId, { steps });
    cad.steps = steps;
    renderCadenceEditor();
  }

  function removeStep(index) {
    if (!S.activeCadenceId) return;
    const cad = S.cadences.find(c => c.id === S.activeCadenceId);
    if (!cad) return;
    const steps = (cad.steps || []).filter((_, i) => i !== index);
    cad.steps = steps;
    apiPatch('cadences', S.activeCadenceId, { steps });
    renderCadenceEditor();
  }

  async function updateStep(index, field, value) {
    if (!S.activeCadenceId) return;
    const cad = S.cadences.find(c => c.id === S.activeCadenceId);
    if (!cad || !cad.steps) return;
    cad.steps[index] = { ...cad.steps[index], [field]: value };
    await apiPatch('cadences', S.activeCadenceId, { steps: cad.steps });
  }

  /* ============================ AGENDA ============================ */
  function renderAgenda() {
    var container = el('wppAgenda');
    if (!container) return;
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var actions = Array.isArray(S.cadence_actions) ? S.cadence_actions : [];
    container.innerHTML = '';
    var calContainer = document.createElement('div');
    calContainer.className = 'wc-calendar';
    var header = document.createElement('div');
    header.className = 'wc-cal-header';
    header.innerHTML = '<button class="wc-cal-nav" id="calPrev"><i class="fi fi-rr-angle-left"></i></button><span class="wc-cal-title" id="calTitle">' + getMonthName(month) + ' ' + year + '</span><button class="wc-cal-nav" id="calNext"><i class="fi fi-rr-angle-right"></i></button>';
    calContainer.appendChild(header);
    var daysOfWeek = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'SÃ¡b'];
    var dayHeaders = document.createElement('div');
    dayHeaders.className = 'wc-cal-day-names';
    daysOfWeek.forEach(function (d) {
      var el = document.createElement('span');
      el.textContent = d;
      dayHeaders.appendChild(el);
    });
    calContainer.appendChild(dayHeaders);
    var grid = document.createElement('div');
    grid.className = 'wc-cal-grid';
    grid.id = 'wcCalGrid';
    calContainer.appendChild(grid);
    container.appendChild(calContainer);
    var detailPanel = document.createElement('div');
    detailPanel.className = 'wc-cal-detail';
    detailPanel.id = 'wcCalDetail';
    container.appendChild(detailPanel);
    renderCalendarGrid(year, month, actions);
    document.getElementById('calPrev').onclick = function () {
      var dt = getCalendarViewDate();
      dt.setMonth(dt.getMonth() - 1);
      renderCalendarGrid(dt.getFullYear(), dt.getMonth(), actions);
    };
    document.getElementById('calNext').onclick = function () {
      var dt = getCalendarViewDate();
      dt.setMonth(dt.getMonth() + 1);
      renderCalendarGrid(dt.getFullYear(), dt.getMonth(), actions);
    };
    renderAgendaExtremes(actions);
  }

  function renderAgendaExtremes(actions) {
    var container = el('wppAgenda');
    if (!container) return;
    var now = new Date();
    var future = actions.filter(function (a) { return a.scheduled_at && a.scheduled_at.substring(0, 10) >= now.toISOString().substring(0, 10); });
    future.sort(function (a, b) { return (a.scheduled_at || '').localeCompare(b.scheduled_at || ''); });
    var existing = document.getElementById('wcAgendaExtremes');
    if (existing) existing.remove();
    if (future.length === 0) return;
    var nearest = future[0];
    var furthest = future[future.length - 1];
    var panel = document.createElement('div');
    panel.id = 'wcAgendaExtremes';
    panel.className = 'wc-agenda-extremes';
    var nearestDate = nearest.scheduled_at.substring(0, 10);
    var furthestDate = furthest.scheduled_at.substring(0, 10);
    var nearestLabel = new Date(nearestDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    var furthestLabel = new Date(furthestDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    panel.innerHTML =
      '<div class="wc-agenda-extreme-card"><div class="wc-agenda-extreme-header"><i class="fi fi-rr-calendar"></i> Mais Próximo</div><div class="wc-agenda-extreme-name">' + escHtml(nearest.contact_name || 'Contato') + '</div><div class="wc-agenda-extreme-date">' + nearestLabel + '</div></div>' +
      '<div class="wc-agenda-extreme-card"><div class="wc-agenda-extreme-header"><i class="fi fi-rr-calendar"></i> Mais Distante</div><div class="wc-agenda-extreme-name">' + escHtml(furthest.contact_name || 'Contato') + '</div><div class="wc-agenda-extreme-date">' + furthestLabel + '</div></div>';
    container.appendChild(panel);
  }

  function getCalendarViewDate() {
    var title = document.getElementById('calTitle');
    if (!title) return new Date();
    var parts = title.textContent.split(' ');
    var monthNames = ['Janeiro', 'Fevereiro', 'MarÃ§o', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    var month = monthNames.indexOf(parts[0]);
    var year = parseInt(parts[1], 10);
    return new Date(year, month, 1);
  }

  function getMonthName(m) {
    var names = ['Janeiro', 'Fevereiro', 'MarÃ§o', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return names[m];
  }

  function renderCalendarGrid(year, month, actions) {
    var grid = document.getElementById('wcCalGrid');
    var title = document.getElementById('calTitle');
    if (!grid || !title) return;
    title.textContent = getMonthName(month) + ' ' + year;
    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var today = new Date();
    var html = '';
    for (var i = 0; i < firstDay; i++) {
      html += '<div class="wc-cal-day empty"></div>';
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var dayActions = actions.filter(function (a) {
        if (!a.scheduled_at) return false;
        var aDate = a.scheduled_at.substring(0, 10);
        return aDate === dateStr;
      });
      var isToday = year === today.getFullYear() && month === today.getMonth() && d === today.getDate();
      var isSelected = dateStr === _wcCalendarSelectedDate;
      var cls = 'wc-cal-day';
      if (isToday) cls += ' today';
      if (isSelected) cls += ' selected';
      if (dayActions.length > 0) cls += ' has-events';
      html += '<div class="' + cls + '" data-date="' + dateStr + '" onclick="VeltrisWPP.showCalendarDetail(\'' + dateStr + '\')">';
      html += '<span class="wc-cal-day-num">' + d + '</span>';
      if (dayActions.length > 0) {
        html += '<div class="wc-cal-day-events">' + dayActions.slice(0, 3).map(function () { return '<span class="wc-cal-dot"></span>'; }).join('') + '</div>';
      }
      html += '</div>';
    }
    grid.innerHTML = html;
    var detail = document.getElementById('wcCalDetail');
    if (detail) detail.innerHTML = '<div class="wc-cal-detail-hint">Clique em um dia para ver os eventos</div>';
  }

  function showCalendarDetail(dateStr) {
    _wcCalendarSelectedDate = dateStr;
    var grid = document.getElementById('wcCalGrid');
    if (grid) {
      var allDays = grid.querySelectorAll('.wc-cal-day');
      for (var i = 0; i < allDays.length; i++) {
        allDays[i].classList.toggle('selected', allDays[i].getAttribute('data-date') === dateStr);
      }
    }
    var detail = document.getElementById('wcCalDetail');
    if (!detail) return;
    var actions = Array.isArray(S.cadence_actions) ? S.cadence_actions : [];
    var dayActions = actions.filter(function (a) {
      if (!a.scheduled_at) return false;
      return a.scheduled_at.substring(0, 10) === dateStr;
    });
    var parts = dateStr.split('-');
    var dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    var dateLabel = dateObj.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (dayActions.length === 0) {
      detail.innerHTML = '<div class="wc-cal-detail-header">' + dateLabel + '</div><div class="wc-cal-detail-empty">Nenhum evento neste dia</div>';
      return;
    }
    var html = '<div class="wc-cal-detail-header">' + dateLabel + ' â€” ' + dayActions.length + ' evento(s)</div>';
    dayActions.forEach(function (a) {
      var time = a.scheduled_at ? a.scheduled_at.substring(11, 16) : '';
      var statusClass = a.status === 'sent' || a.status === 'done' ? 'sent' : (a.status === 'cancelled' ? 'cancelled' : 'pending');
      var statusLabel = a.status === 'sent' ? 'Enviado' : (a.status === 'done' ? 'Realizado' : (a.status === 'cancelled' ? 'Cancelado' : 'Pendente'));
      var contactName = a.contact_name || a.lead_name || 'Contato';
      html += '<div class="wc-agenda-item">';
      html += '<div class="wc-agenda-icon ' + statusClass + '"><i class="fi ' + (statusClass === 'sent' ? 'fi-rr-check' : (statusClass === 'cancelled' ? 'fi-rr-cross' : 'fi-rr-hourglass')) + '"></i></div>';
      html += '<div class="wc-agenda-info"><div class="name">' + escHtml(contactName) + '</div><div class="desc">' + (a.description || a.message || '') + '</div></div>';
      html += '<div class="wc-agenda-date"><div class="date">' + time + '</div><div class="time">' + statusLabel + '</div></div>';
      html += '</div>';
    });
    detail.innerHTML = html;
  }

  /* ============================ CONVERSAS ============================ */
  async function openContactChat(contactId) {
    const contact = S.contacts[contactId];
    if (!contact) {
      const fresh = await apiGet('contacts', { id: 'eq.' + contactId });
      if (fresh && fresh.length > 0) S.contacts[contactId] = fresh[0];
    }
    // Find or create chat
    let chat = S.chats.find(c => c.contact_id === contactId);
    if (!chat) {
      // Create chat
      const res = await apiPost('whatsapp_chats', Object.assign({
        contact_id: contactId,
        remote_jid: (contact && contact.phone) || '',
        contact_name: (contact && contact.name) || '',
        unread_count: 0,
      }, S.currentUser ? { user_id: S.currentUser } : {}));
      if (res) {
        S.chats.push(res);
        chat = res;
      }
    }
    if (chat) {
      switchTab('whatsapp');
      renderConversasChatView();
      selectChat(chat.id);
    }
  }

  var _wcLabelFilter = ''

  var _chatShowing = false;

  function renderConversasChatView() {
    const container = el('wppConversas');
    if (!container) return;
    _chatShowing = false;
    S.activeChatId = null;
    container.innerHTML = `
      <div class="wc-chat-list-view" id="wcChatListView">
        <div class="wc-search"><input placeholder="Buscar conversa..." oninput="VeltrisWPP.searchChats(this.value)" /></div>
        <div class="wc-list" id="wcChatList"></div>
      </div>
      <div class="wc-chat-view" id="wcChatView" style="display:none">
        <div class="wc-window-header" id="wcWindowHeader">
          <button class="wc-back-btn" onclick="VeltrisWPP.backToChatList()"><i class="fi fi-rr-angle-left"></i></button>
          <div class="wc-avatar" id="wcChatAvatar"></div>
          <div class="wc-info" id="wcChatInfo">
            <div class="name" id="wcChatName"></div>
            <div class="status" id="wcChatStatus"></div>
          </div>
        </div>
        <div class="wc-messages" id="wcMessages"></div>
        <div class="wc-input-area" id="wcInputArea" style="display:none">
          <textarea id="wcMessageInput" placeholder="Digite sua mensagem..." rows="2" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();VeltrisWPP.sendMessage()}"></textarea>
          <button onclick="VeltrisWPP.sendMessage()">Enviar</button>
        </div>
      </div>`;
    renderChatList();
  }

  function backToChatList() {
    _chatShowing = false;
    S.activeChatId = null;
    var listView = el('wcChatListView');
    var chatView = el('wcChatView');
    if (listView) listView.style.display = '';
    if (chatView) chatView.style.display = 'none';
  }

  function searchChats(q) {
    const lower = q.toLowerCase();
    const items = qsa('.wc-chat-item');
    items.forEach(item => {
      const name = (item.querySelector('.wc-chat-name')?.textContent || '').toLowerCase();
      item.style.display = name.includes(lower) ? '' : 'none';
    });
  }

  /* ============================ POLLING & REALTIME ============================ */
  function startPolling() {
    stopPolling();
    S.pollingInterval = setInterval(() => {
      loadChats();
    }, 15000);
  }

  function stopPolling() {
    if (S.pollingInterval) { clearInterval(S.pollingInterval); S.pollingInterval = null; }
  }

  function startRealtime() {
    stopRealtime();
    S.realtimeInterval = setInterval(() => {
      if (!S.activeChatId) return;
      loadMessages(S.activeChatId);
    }, 5000);
  }

  function stopRealtime() {
    if (S.realtimeInterval) { clearInterval(S.realtimeInterval); S.realtimeInterval = null; }
  }

  function getCurrentUserId() {
    var api = window.api;
    if (api && api.getUser && api.getUser()) return api.getUser().id;
    var sess = api && api.companyGetSession && api.companyGetSession();
    if (sess && sess.user) return sess.user.id;
    return null;
  }

  function getCurrentCompanyId() {
    try {
      var api = window.api;
      if (api && api._getCompanyId) return api._getCompanyId();
      var mode = window._companyMode;
      if (mode && mode.id) return mode.id;
    } catch (e) {}
    return null;
  }

  /* ============================ INIT ============================ */
  async function init() {
    S.currentUser = getCurrentUserId();
    initTabs();
    // Try to restore saved session first (persists across page reloads)
    var restored = await restoreWppSession();
    if (!restored) {
      await loadSessions();
    }
    if (S.connected) {
      await loadChats();
    }
    // Render all views
    renderWhatsapp();
    renderClientes();
    renderAgenda();
    // Periodic session refresh — only needs to run once connected
    setInterval(async () => {
      if (!window.api || !api.isLoggedIn()) return;
      if (S.connected && S._serverSessionId) return; // already connected via server, skip
      if (S._serverSessionId) {
        try {
          var hResp = await fetch(_wppServerUrl + '/health?sessionId=' + encodeURIComponent(S._serverSessionId))
          if (hResp.ok) {
            var hData = await hResp.json()
            if (hData.connected && !S.connected) {
              S.connected = true; S.activeSessionId = S._serverSessionId
              renderConnectionStatus(); startPolling(); loadChats()
            }
            return
          }
        } catch (e) {}
      }
      var sessions = await apiGet('whatsapp_sessions', S.currentUser ? { user_id: 'eq.' + S.currentUser } : {});
      if (sessions && sessions.length > 0) {
        var connected = sessions.find(function (s) { return s.status === 'connected'; });
        if (connected && !S.connected) {
          S.connected = true; S.activeSessionId = connected.id
          renderConnectionStatus(); startPolling(); loadChats()
        }
        S.sessions = sessions;
      }
  }, 30000);
  }

  return {
    init,
    newSession,
    disconnect,
    selectChat,
    sendMessage,
    updateContactStage,
    addTag,
    saveNotes,
    generateAiInsight,
    toggleStageDropdown,
    selectStage,
    toggleNewLeadStage,
    selectNewLeadStage,
    toggleDatePicker,
    datePickerMonth,
    selectDatePickerDate,
    filterLeads,
    goLeadsPage,
    showAddLeadForm,
    hideAddLeadForm,
    addLead,
    deleteLead,
    selectLead,
    openWhatsAppChat,
    openContactChat,
    searchChats,
    syncServerContacts,
    showCalendarDetail,
    getServerSessionId: function() { return S._serverSessionId },
    getActiveChatId: function() { return S.activeChatId },
    getMessagesCount: function() { return S.messages?.length || 0 },
    analyzeConversation,
    updateSyncStatus,
    startSyncMonitor,
    loadLabels,
    setLabelFilter,
    editLead,
    saveEditedLead,
    toggleBulkSelect,
    toggleBulkAll,
    updateBulkCount,
    bulkTag,
    bulkEdit,
    applyBulkEdit,
    toggleNewLeadTimeDropdown,
    toggleEditLeadTimeDropdown,
    selectTime,
    enviarDisparo,
    onDisparoModeChange,
    onDisparoFilterChange,
    onDisparoSearch,
    updateDisparoCount,
    toggleDispTagDrop,
    selectDispTag,
    createTag,
    deleteTag,
    toggleLinkTagDrop,
    selectLinkTag,
    onLinkSearch,
    updateLinkCount,
    linkTagAction,
    backToChatList,
    switchTab,
  };
})();

// Auto-init on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.VeltrisWPP.init());
} else {
  window.VeltrisWPP.init();
}
