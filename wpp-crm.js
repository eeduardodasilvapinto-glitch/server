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
    try {
      var result = await window._supaGet(table, params);
      return result.data || [];
    } catch (e) { if (typeof console !== 'undefined' && console.error) { console.error('apiGet error'); } return []; }
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
    }
  }

  /* ============================ CONNECTION ============================ */
  async function loadSessions() {
    if (!window.api || !api.isLoggedIn()) { S.sessions = []; return; }
    S.sessions = await apiGet('whatsapp_sessions', {});
    S.activeSessionId = S.sessions.find(s => s.status === 'connected')?.id || null;
    S.connected = !!S.activeSessionId;
    renderConnectionStatus();
    if (S.connected) {
      startPolling();
      startRealtime();
    }
  }

  function renderConnectionStatus() {
    const container = el('wppConnectionStatus');
    if (!container) return;
    const session = S.sessions.find(s => s.id === S.activeSessionId) || S.sessions[0];
    if (S.connected) {
      container.innerHTML = `
        <div class="wpp-connect-card">
          <div class="wpp-connect-status">
            <span class="wpp-status-dot connected"></span>
            <span style="font-size:0.82rem;color:var(--text);font-weight:600">WhatsApp Conectado</span>
            ${session ? `<span style="font-size:0.68rem;color:var(--text-muted)">${escHtml(session.phone || session.name || 'WhatsApp')}</span>` : ''}
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-outline" onclick="VeltrisWPP.disconnect()" style="font-size:0.72rem">Desconectar</button>
          </div>
        </div>`;
    } else {
      const activeSession = S.sessions.find(s => s.status === 'connecting' || s.status === 'expired');
      if (activeSession && activeSession.qr_code) {
        S.qrCode = activeSession.qr_code;
        container.innerHTML = `
          <div class="wpp-connect-card" style="flex-direction:column;align-items:center">
            <div class="wpp-connect-status">
              <span class="wpp-status-dot ${activeSession.status === 'expired' ? 'expired' : 'connecting'}"></span>
              <span style="font-size:0.82rem;color:var(--text);font-weight:600">
                ${activeSession.status === 'expired' ? 'QR Expirado' : 'Aguardando Leitura...'}
              </span>
            </div>
            <div class="wpp-qr-container">
              <img src="${escHtml(activeSession.qr_code)}" alt="QR Code" />
              <p>Aponte a cÃ¢mera do WhatsApp para este QR Code</p>
            </div>
            <button class="btn btn-outline" onclick="VeltrisWPP.newSession()" style="font-size:0.75rem">Gerar Novo QR</button>
          </div>`;
      } else {
        container.innerHTML = `
          <div class="wpp-connect-card">
            <div class="wpp-connect-status">
              <span class="wpp-status-dot disconnected"></span>
              <span style="font-size:0.82rem;color:var(--text-muted)">WhatsApp Desconectado</span>
            </div>
            <button class="btn btn-save" onclick="VeltrisWPP.newSession()" style="font-size:0.78rem">Conectar WhatsApp</button>
          </div>`;
      }
    }
  }

  async function newSession() {
    const res = await apiPost('whatsapp_sessions', { status: 'connecting' });
    if (res && res.id) {
      S.sessions.push(res);
      renderConnectionStatus();
      // Poll for QR
      const poll = setInterval(async () => {
        const sessions = await apiGet('whatsapp_sessions', {});
        const updated = sessions.find(s => s.id === res.id);
        if (updated) {
          Object.assign(res, updated);
          if (updated.qr_code) {
            renderConnectionStatus();
          }
          if (updated.status === 'connected') {
            clearInterval(poll);
            S.connected = true;
            S.activeSessionId = updated.id;
            renderConnectionStatus();
            startPolling();
            startRealtime();
          }
          if (updated.status === 'expired') {
            clearInterval(poll);
            renderConnectionStatus();
          }
        }
      }, 3000);
    }
  }

  async function disconnect() {
    if (S.activeSessionId) {
      await apiPatch('whatsapp_sessions', S.activeSessionId, { status: 'disconnected' });
    }
    S.connected = false;
    S.activeSessionId = null;
    S.chats = [];
    S.activeChatId = null;
    S.messages = [];
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
    S.chats = await apiGet('whatsapp_chats', {});
    renderChatList();
  }

  function renderChatList() {
    const container = el('wcChatList');
    if (!container) return;
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
    container.innerHTML = S.chats.map(c => {
      const contact = S.contacts[c.contact_id];
      const name = contact?.name || c.contact_name || c.remote_jid || 'Desconhecido';
      const lastMsg = c.last_message?.text || c.last_message || '';
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
    renderChatList();
    renderMessages();
    renderContactPanel();
    await loadMessages(chatId);
    // Mark as read
    if (S.chats.find(c => c.id === chatId && c.unread_count > 0)) {
      await apiPatch('whatsapp_chats', chatId, { unread_count: 0 });
      const chat = S.chats.find(c => c.id === chatId);
      if (chat) chat.unread_count = 0;
      renderChatList();
    }
  }

  async function loadMessages(chatId) {
    if (!chatId) return;
    S.messages = await apiGet('whatsapp_messages', { chat_id: 'eq.' + chatId, order: 'created_at.asc' });
    renderMessages();
  }

  function renderMessages() {
    const container = el('wcMessages');
    const header = el('wcWindowHeader');
    const inputArea = el('wcInputArea');
    if (!container) return;
    if (!S.activeChatId) {
      container.style.display = 'flex';
      container.innerHTML = '<div style="margin:auto;text-align:center;color:var(--text-muted);font-size:0.85rem">Selecione uma conversa</div>';
      if (header) header.innerHTML = '';
      if (inputArea) inputArea.style.display = 'none';
      return;
    }
    if (inputArea) inputArea.style.display = '';
    const chat = S.chats.find(c => c.id === S.activeChatId);
    const contact = chat ? (S.contacts[chat.contact_id] || {}) : {};
    const name = contact?.name || chat?.contact_name || chat?.remote_jid || 'Desconhecido';
    if (header) {
      header.innerHTML = `
        <div class="wc-avatar">${initials(name)}</div>
        <div class="wc-info">
          <div class="name">${escHtml(name)}</div>
          <div class="status">${contact?.stage ? stageLabel(contact.stage) : 'lead'}</div>
        </div>`;
    }
    if (S.messages.length === 0) {
      container.style.display = 'flex';
      container.innerHTML = '<div style="margin:auto;text-align:center;color:var(--text-muted);font-size:0.78rem">Nenhuma mensagem ainda. Envie a primeira!</div>';
      return;
    }
    container.style.display = '';
    container.innerHTML = S.messages.map(m => {
      const isSent = m.direction === 'sent' || m.direction === 'outgoing';
      return `<div class="wc-msg ${isSent ? 'sent' : 'received'}">
        ${escHtml(m.text || m.content || '')}
        <div class="time">${formatTime(m.created_at)}</div>
      </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  }

  async function sendMessage() {
    const input = el('wcMessageInput');
    if (!input || !input.value.trim() || !S.activeChatId || !S.activeSessionId) return;
    const text = input.value.trim();
    input.value = '';
    // Optimistic
    const tempMsg = { id: 'temp_' + Date.now(), text, direction: 'sent', created_at: new Date().toISOString(), chat_id: S.activeChatId };
    S.messages.push(tempMsg);
    renderMessages();
    // Send via API
    await apiPost('whatsapp_messages', {
      chat_id: S.activeChatId,
      session_id: S.activeSessionId,
      text,
      direction: 'sent',
      status: 'queued',
    });
    // Refresh messages after short delay
    setTimeout(() => loadMessages(S.activeChatId), 1000);
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
  async function renderWhatsapp() {
    const dash = el('wppDashboard');
    if (dash) {
      const items = await apiGet('cadence_actions', { order: 'scheduled_at.desc' });
      const list = Array.isArray(items) ? items : [];
      const total = list.length;
      const agendados = list.filter(a => a.status === 'pending').length;
      const realizados = list.filter(a => a.status === 'sent' || a.status === 'done').length;
      const cancelados = list.filter(a => a.status === 'cancelled').length;
      const pctAgendados = total > 0 ? Math.round((agendados / total) * 100) : 0;
      const pctRealizados = agendados > 0 ? Math.round((realizados / agendados) * 100) : 0;
      const pctCancelados = agendados > 0 ? Math.round((cancelados / agendados) * 100) : 0;
      dash.innerHTML = `
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
            <div class="stage-header"><span class="name">Recebidos</span><span class="count">${total} ${total > 0 ? '100' : '0'}%</span></div>
          </div>
          <div class="wc-funnel-stage">
            <div class="stage-header"><span class="name">Agendados</span><span class="count">${agendados} ${pctAgendados}%</span></div>
          </div>
          <div class="wc-funnel-stage">
            <div class="stage-header"><span class="name">Realizados</span><span class="count">${realizados} ${pctRealizados}%</span></div>
          </div>
          <div class="wc-funnel-stage">
            <div class="stage-header"><span class="name">Cancelados</span><span class="count">${cancelados} ${pctCancelados}%</span></div>
          </div>
        </div>`;
    }
    renderConnectionStatus();
    if (!S.connected) {
      const conv = el('wppConversas');
      if (conv) conv.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)">Conecte o WhatsApp para ver conversas</div>';
      return;
    }
    renderConversasChatView();
  }

  /* ============================ CLIENTES TABLE ============================ */
  async function renderClientes() {
    const container = el('wppClientes');
    if (!container) return;
    S.leads = await apiGet('contacts', {});
    const list = Array.isArray(S.leads) ? S.leads : [];
    container.innerHTML = `
      <div class="wc-lead-toolbar">
        <input id="wcLeadSearch" placeholder="Buscar cliente..." oninput="VeltrisWPP.filterLeads()" />
        <div class="cs-wrap" style="position:relative;min-width:140px">
          <div class="cs-trigger" id="wcStageTrigger" onclick="VeltrisWPP.toggleStageDropdown(event)">
            <span id="wcStageSelected">Todos os estágios</span>
            <span class="cs-arrow">▾</span>
          </div>
          <div class="cs-drop" id="wcStageDrop">
            <div class="cs-opt" data-value="" onclick="VeltrisWPP.selectStage('')">Todos os estágios</div>
            ${S.stages.map(s => `<div class="cs-opt" data-value="${s}" onclick="VeltrisWPP.selectStage('${s}')">${stageLabel(s)}</div>`).join('')}
          </div>
        </div>
        <button class="btn btn-save" onclick="VeltrisWPP.showAddLeadForm()" style="font-size:0.7rem">+ Novo Cliente</button>
      </div>
      <div id="wcAddLeadForm" style="display:none">
        <div class="wc-add-lead">
          <div class="field"><label>Nome</label><input id="wcNewLeadName" placeholder="Nome" /></div>
          <div class="field"><label>Telefone</label><input id="wcNewLeadPhone" placeholder="+5511999999999" /></div>
          <div class="field"><label>Email</label><input id="wcNewLeadEmail" placeholder="email@exemplo.com" /></div>
          <div class="field"><label>Estágio</label><select id="wcNewLeadStage" class="wc-lead-select">
            ${S.stages.map(s => `<option value="${s}">${stageLabel(s)}</option>`).join('')}
          </select></div>
          <button class="btn btn-save" onclick="VeltrisWPP.addLead()" style="font-size:0.7rem">Adicionar</button>
          <button class="btn btn-outline" onclick="VeltrisWPP.hideAddLeadForm()" style="font-size:0.7rem">Cancelar</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="task-table" style="width:100%;font-size:0.78rem">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Telefone</th>
              <th>Estágio</th>
              <th>Score</th>
              <th>Último Contato</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="wcLeadsBody">${renderClientesRows(list)}</tbody>
        </table>
      </div>`;
  }

  function renderClientesRows(leads) {
    if (leads.length === 0) return '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">Nenhum cliente encontrado</td></tr>';
    return leads.map(l => `
      <tr style="cursor:pointer" onclick="VeltrisWPP.selectLead('${l.id}')">
        <td><strong>${escHtml(l.name || '—')}</strong></td>
        <td>${escHtml(l.phone || '—')}</td>
        <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${stageColor(l.stage)};margin-right:6px"></span>${stageLabel(l.stage)}</td>
        <td>${l.score || 0}</td>
        <td>${l.last_contacted_at ? formatFullDate(l.last_contacted_at) : '—'}</td>
        <td><button class="btn btn-outline" style="font-size:0.6rem;padding:2px 8px" onclick="event.stopPropagation();VeltrisWPP.openWhatsAppChat('${l.phone}')">WhatsApp</button></td>
      </tr>
    `).join('');
  }

  var _wcStageValue = '';

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
    var label = value ? stageLabel(value) : 'Todos os estágios';
    el('wcStageSelected').textContent = label;
    closeStageDropdown();
    filterLeads();
  }

  function filterLeads() {
    const search = (el('wcLeadSearch')?.value || '').toLowerCase();
    const stage = _wcStageValue;
    const list = Array.isArray(S.leads) ? S.leads : [];
    const filtered = list.filter(l => {
      if (search && !(l.name || '').toLowerCase().includes(search) && !(l.phone || '').includes(search)) return false;
      if (stage && l.stage !== stage) return false;
      return true;
    });
    const tbody = el('wcLeadsBody');
    if (tbody) tbody.innerHTML = renderClientesRows(filtered);
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
    const stage = el('wcNewLeadStage')?.value || 'agendado';
    if (!name) return;
    const res = await apiPost('contacts', { name, phone, email, stage, source: 'manual', score: 0 });
    if (res) {
      S.leads.push(res);
      hideAddLeadForm();
      el('wcNewLeadName').value = '';
      el('wcNewLeadPhone').value = '';
      el('wcNewLeadEmail').value = '';
      filterLeads();
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
      var cls = 'wc-cal-day';
      if (isToday) cls += ' today';
      if (dayActions.length > 0) cls += ' has-events';
      html += '<div class="' + cls + '" data-date="' + dateStr + '" onclick="showCalendarDetail(\'' + dateStr + '\')">';
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
      const res = await apiPost('whatsapp_chats', {
        contact_id: contactId,
        remote_jid: contact?.phone || '',
        contact_name: contact?.name || '',
        unread_count: 0,
      });
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

  function renderConversasChatView() {
    const container = el('wppConversas');
    if (!container) return;
    container.innerHTML = `
      <div class="wc-layout">
        <div class="wc-col wc-col-1">
          <div class="wc-search"><input placeholder="Buscar conversa..." oninput="VeltrisWPP.searchChats(this.value)" /></div>
          <div class="wc-list" id="wcChatList"></div>
        </div>
        <div class="wc-col wc-col-2">
          <div class="wc-window-header" id="wcWindowHeader"></div>
          <div class="wc-messages" id="wcMessages"></div>
          <div class="wc-input-area" id="wcInputArea" style="display:none">
            <textarea id="wcMessageInput" placeholder="Digite sua mensagem..." rows="2" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();VeltrisWPP.sendMessage()}"></textarea>
            <button onclick="VeltrisWPP.sendMessage()">Enviar</button>
          </div>
        </div>
        <div class="wc-col wc-col-3" id="wcContactPanel"></div>
      </div>`;
    renderChatList();
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
    }, 5000);
  }

  function stopPolling() {
    if (S.pollingInterval) { clearInterval(S.pollingInterval); S.pollingInterval = null; }
  }

  function startRealtime() {
    stopRealtime();
    // Simple polling-based realtime for now
  }

  function stopRealtime() {
    // noop
  }

  /* ============================ INIT ============================ */
  async function init() {
    initTabs();
    await loadSessions();
    if (S.connected) {
      await loadChats();
    }
    // Render initial view
    renderWhatsapp();
    // Periodic session refresh
    setInterval(async () => {
      if (!window.api || !api.isLoggedIn()) return;
      const sessions = await apiGet('whatsapp_sessions', {});
      const connected = sessions.find(s => s.status === 'connected');
      if (connected && !S.connected) {
        S.connected = true;
        S.activeSessionId = connected.id;
        renderConnectionStatus();
        startPolling();
        loadChats();
      } else if (!connected && S.connected) {
        S.connected = false;
        S.activeSessionId = null;
        stopPolling();
        renderConnectionStatus();
      }
      S.sessions = sessions;
    }, 15000);
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
    filterLeads,
    showAddLeadForm,
    hideAddLeadForm,
    addLead,
    selectLead,
    openWhatsAppChat,
    openContactChat,
    searchChats,
  };
})();

// Auto-init on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.VeltrisWPP.init());
} else {
  window.VeltrisWPP.init();
}
