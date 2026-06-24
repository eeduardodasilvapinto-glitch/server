;(function () {
  'use strict';

  // ── CONFIG: edite aqui com seus dados do Supabase ──
  var SUPABASE_URL = 'https://dwkjynmelculfzumoreg.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_gsf7GLZd9jqL-r_MuQQcuw_g9CONjKt';
  // ──────────────────────────────────────────────────

  var PROXY_ACTIVE = typeof window !== 'undefined' && window.location.origin && window.location.origin.indexOf('vercel.app') >= 0;
  var VERCEL_API = PROXY_ACTIVE ? window.location.origin + '/api' : 'https://veltris-v2.vercel.app/api';
  var SUPABASE_API = SUPABASE_URL + '/functions/v1';
  var FUNCTIONS_URL = PROXY_ACTIVE ? VERCEL_API : VERCEL_API;
  var RAILWAY_URL = 'https://server-production-d7c0.up.railway.app';
  var REST_URL = SUPABASE_URL + '/rest/v1';

  var TOKEN_KEY = 'aureoon_token';
  var USER_KEY = 'aureoon_user';

  function _getStore(key) {
    var v = localStorage.getItem(key);
    if (v !== null) return v;
    return sessionStorage.getItem(key);
  }

  // Clear stale old JWT tokens from previous auth system
  try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); sessionStorage.removeItem(USER_KEY); } catch (e) {}

  var api = {
    _saveLogin: true,

    _companyScopedTables: ['tasks','kanban_columns','kanban_cards','documents','contacts','cadence_actions','cadences','whatsapp_chats','whatsapp_messages','whatsapp_sessions','app_checklist','app_kanban','app_conversations','app_suggestions','app_analyses','app_feedback'],

    _getCompanyId: function () {
      try {
        var mode = window._companyMode;
        if (mode && mode.id) return mode.id;
        var sess = this.companyGetSession();
        if (sess && sess.company) return sess.company.id || sess.company.company_id || null;
      } catch (e) {}
      return null;
    },

    _isCompanyScoped: function (table) {
      return this._companyScopedTables.indexOf(table) >= 0;
    },

    token: _getStore(TOKEN_KEY) || null,
    user: (function () {
      try { return JSON.parse(_getStore(USER_KEY)); } catch { return null; }
    })(),

    isLoggedIn: function () { return !!this.companyGetSession(); },
    isAdmin: function () {
      var sess = this.companyGetSession();
      if (sess && sess.company && (sess.company.company_name || sess.company.name || '').toLowerCase() === 'admin') return true;
      return false;
    },
    isGestor: function () {
      var sess = this.companyGetSession();
      return sess && sess.user && (sess.user.role === 'admin' || sess.user.role === 'gestor');
    },

    login: async function (name, password) {
      var url = FUNCTIONS_URL + '/login';
      var res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ name: name, password: password }),
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return { error: 'Erro de conexão' }; });
        throw new Error(err.error || 'Falha no login');
      }
      var data = await res.json();
      this.token = data.token;
      this.user = data.user;
      var store = this._saveLogin ? localStorage : sessionStorage;
      store.setItem(TOKEN_KEY, data.token);
      store.setItem(USER_KEY, JSON.stringify(data.user));
      if (data.forcePasswordChange) {
        localStorage.setItem('aureoon_force_pw_change', '1');
      } else {
        localStorage.removeItem('aureoon_force_pw_change');
      }
      return data;
    },

    logout: function () {
      this.token = null;
      this.user = null;
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(USER_KEY);
      // Close all overlays except loginOverlay, then show login
      document.querySelectorAll('.modal-overlay.visible, .overlay.visible').forEach(function(el){ el.classList.remove('visible'); });
      document.querySelectorAll('[id$="Overlay"]').forEach(function(el){
        if (el.id !== 'loginOverlay') el.style.display = 'none';
      });
      document.getElementById('pwChangeOverlay').style.display = 'none';
      var overlay = document.getElementById('loginOverlay');
      if (overlay) {
        overlay.style.display = '';
        overlay.classList.remove('hidden');
      }
    },

    getToken: function () { return this.token; },
    getUser: function () { return this.user; },

    verifyToken: async function () {
      if (!this.token) return false;
      try {
        var result = await this._callFunc('manage-leads', { action: 'settings_get' });
        return true;
      } catch (e) {
        return false;
      }
    },

    // ── Generic REST helpers (via api-proxy Edge Function) ──
    _proxyCall: async function (operation, table, params, body) {
      if (window._supabaseBlocked) return { data: [] };
      var sid = null;
      try { sid = window.VeltrisWPP && window.VeltrisWPP.getServerSessionId ? window.VeltrisWPP.getServerSessionId() : null; } catch (e) {}
      var h = { 'Content-Type': 'application/json' };
      var fetchUrl = RAILWAY_URL + '/api-proxy';
      if (sid) fetchUrl += '?sessionId=' + encodeURIComponent(sid);
      var res = await fetch(fetchUrl, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ operation: operation, table: table, params: Object.assign({}, params || {}, { sessionId: sid }), body: body }),
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return { error: 'Erro no proxy' }; });
        throw new Error(err.error || 'Erro na requisição');
      }
      return await res.json();
    },

    _supaGet: async function (table, params) {
      var filters = {};
      var select = '*';
      var order, limit, offset;
      if (params) {
        for (var k in params) {
          if (k === 'select') { select = params[k]; }
          else if (k === 'order') { order = params[k]; }
          else if (k === 'limit') { limit = parseInt(params[k], 10); }
          else if (k === 'offset') { offset = parseInt(params[k], 10); }
          else {
            var val = params[k];
            if (val.indexOf('.') > 0) val = val.substring(val.indexOf('.') + 1);
            filters[k] = val;
          }
        }
      }
      var cid = this._getCompanyId();
      if (this._isCompanyScoped(table)) {
        if (!cid) return { data: [] };
        filters['company_id'] = cid;
      }
      var proxyParams = { select: select, filters: filters };
      if (order) proxyParams.order = order;
      if (limit) proxyParams.limit = limit;
      if (offset) proxyParams.offset = offset;
      var result = await this._proxyCall('select', table, proxyParams);
      return { data: result.data, total: result.total };
    },

    _supaPost: async function (table, body) {
      var cid = this._getCompanyId();
      if (this._isCompanyScoped(table) && !cid) return { data: [] };
      if (cid && this._isCompanyScoped(table)) {
        body = Object.assign({}, body, { company_id: cid });
      }
      var result = await this._proxyCall('insert', table, {}, body);
      return result.data || {};
    },

    _supaPatch: async function (table, filterStr, body) {
      var filters = {};
      var entries = filterStr.split('&');
      for (var i = 0; i < entries.length; i++) {
        var eq = entries[i].indexOf('=');
        if (eq < 0) continue;
        var k = decodeURIComponent(entries[i].substring(0, eq));
        var val = decodeURIComponent(entries[i].substring(eq + 1));
        if (val.indexOf('.') > 0) val = val.substring(val.indexOf('.') + 1);
        filters[k] = val;
      }
      var cid = this._getCompanyId();
      if (cid && this._isCompanyScoped(table)) {
        filters['company_id'] = cid;
      }
      await this._proxyCall('update', table, { filters: filters }, body);
    },

    _supaDelete: async function (table, filterStr) {
      var filters = {};
      var entries = filterStr.split('&');
      for (var i = 0; i < entries.length; i++) {
        var eq = entries[i].indexOf('=');
        if (eq < 0) continue;
        var k = decodeURIComponent(entries[i].substring(0, eq));
        var val = decodeURIComponent(entries[i].substring(eq + 1));
        if (val.indexOf('.') > 0) val = val.substring(val.indexOf('.') + 1);
        filters[k] = val;
      }
      var cid = this._getCompanyId();
      if (cid && this._isCompanyScoped(table)) {
        filters['company_id'] = cid;
      }
      await this._proxyCall('delete', table, { filters: filters });
    },

    // ── Tasks ──
    listTasks: function (sector, opts) {
      var params = {};
      if (sector) params['sector'] = 'eq.' + sector;
      if (opts && opts.limit) params['limit'] = opts.limit;
      if (opts && opts.offset) params['offset'] = opts.offset;
      params['order'] = 'id.desc';
      return this._supaGet('tasks', params);
    },

    createTask: function (data) { return this._supaPost('tasks', data); },

    updateTask: function (id, data) {
      return this._supaPatch('tasks', 'id=eq.' + encodeURIComponent(id), data);
    },

    deleteTask: function (id) {
      return this._supaDelete('tasks', 'id=eq.' + encodeURIComponent(id));
    },

    // ── Checklist (shared, single JSONB row) ──
    loadChecklist: function () {
      return this._supaGet('app_checklist', { limit: '1' });
    },

    saveChecklist: function (data) {
      var self = this;
      return this._supaGet('app_checklist', { limit: '1' }).then(function (res) {
        var rows = res && res.data || [];
        if (rows.length) {
          return self._supaPatch('app_checklist', 'id=eq.' + rows[0].id, { data: data });
        }
        return self._supaPost('app_checklist', { data: data });
      });
    },

    // ── Kanban ──
    listColumns: function (sector) {
      var params = { order: 'ord.asc' };
      if (sector) params['sector'] = 'eq.' + sector;
      return this._supaGet('kanban_columns', params);
    },

    createColumn: function (data) { return this._supaPost('kanban_columns', data); },
    updateColumn: function (id, data) { return this._supaPatch('kanban_columns', 'id=eq.' + id, data); },
    deleteColumn: function (id) { return this._supaDelete('kanban_columns', 'id=eq.' + id); },

    listCards: function (columnId, opts) {
      var params = { order: 'id.asc' };
      if (columnId) params['column_id'] = 'eq.' + columnId;
      if (opts && opts.limit) params['limit'] = opts.limit;
      if (opts && opts.offset) params['offset'] = opts.offset;
      return this._supaGet('kanban_cards', params);
    },

    createCard: function (data) { return this._supaPost('kanban_cards', data); },
    updateCard: function (id, data) { return this._supaPatch('kanban_cards', 'id=eq.' + id, data); },
    deleteCard: function (id) { return this._supaDelete('kanban_cards', 'id=eq.' + id); },

    // ── Users (via Edge Function) ──
    _manageUsers: async function (body) {
      var h = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      };
      var t = this.token || localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
      if (t) h['Authorization'] = 'Bearer ' + t;
      var ct = (this._companyMemory && this._companyMemory.token) || localStorage.getItem(this.COMPANY_TOKEN_KEY) || sessionStorage.getItem(this.COMPANY_TOKEN_KEY);
      if (ct) h['x-company-auth'] = ct;
      if (!t && !ct) return { users: [] };
      try {
        var res = await fetch(FUNCTIONS_URL + '/manage-users', {
          method: 'POST',
          headers: h,
          body: JSON.stringify(body),
        });
        if (res.status === 401) return { users: [] };
        if (!res.ok) {
          var err = await res.json().catch(function () { return { error: 'Erro' }; });
          throw new Error(err.error || 'Erro ao gerenciar usuário');
        }
        return await res.json();
      } catch (e) {
        return { users: [] };
      }
    },

    listUsers: function () {
      return this._manageUsers({ action: 'list', data: {} });
    },

    createUser: function (name, password, role, sectors) {
      return this._manageUsers({ action: 'create', data: { name, password, role, sectors: sectors || [] } });
    },

    updateUser: function (id, data) {
      return this._manageUsers({ action: 'update', data: { id: id, role: data.role, sectors: data.sectors } });
    },

    updateUserPassword: function (id, password) {
      return this._manageUsers({ action: 'update-password', data: { id, password } });
    },

    deleteUser: function (id) {
      return this._manageUsers({ action: 'delete', data: { id } });
    },

    setPassword: function (id, password) {
      return this._manageUsers({ action: 'set-password', data: { id, password } });
    },

    // ── Generic function caller ──
    _callFunc: async function (name, body) {
      var h = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      };
      var ct = this.token || (this._companyMemory && this._companyMemory.token) || localStorage.getItem(this.COMPANY_TOKEN_KEY) || sessionStorage.getItem(this.COMPANY_TOKEN_KEY);
      if (ct) h['x-company-auth'] = ct;
      var res = await fetch(FUNCTIONS_URL + '/' + name, {
        method: 'POST',
        headers: h,
        body: JSON.stringify(body),
      });
      if (res.status === 401) { this.logout(); throw new Error('Sessão expirada'); }
      if (!res.ok) {
        var err = await res.json().catch(function () { return { error: 'Erro' }; });
        throw new Error(err.error || 'Erro na requisição');
      }
      return await res.json();
    },

    // ── Settings ──
    fetchSettings: async function () {
      return await this._callFunc('manage-leads', { action: 'settings_get' });
    },

    saveSettings: async function (settings) {
      var result = await this._callFunc('manage-leads', { action: 'settings_save', data: settings });
      return result;
    },

    // ── AI ──
    analyze: async function (prompt, context, apiKey) {
      var body = { prompt: prompt, context: context };
      if (apiKey) body.apiKey = apiKey;
      var h = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      };
      var ct = this.token || (this._companyMemory && this._companyMemory.token) || localStorage.getItem(this.COMPANY_TOKEN_KEY) || sessionStorage.getItem(this.COMPANY_TOKEN_KEY);
      if (ct) h['x-company-auth'] = ct;
      var res = await fetch(FUNCTIONS_URL + '/analyze', {
        method: 'POST',
        headers: h,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        return { error: err.error || 'Erro na IA' };
      }
      return await res.json();
    },

    analyzeTasks: async function (tasks, instructions) {
      var h = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      };
      var ct = this.token || (this._companyMemory && this._companyMemory.token) || localStorage.getItem(this.COMPANY_TOKEN_KEY) || sessionStorage.getItem(this.COMPANY_TOKEN_KEY);
      if (ct) h['x-company-auth'] = ct;
      var res = await fetch(FUNCTIONS_URL + '/analyze-tasks', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ tasks: tasks, instructions: instructions }),
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        return { error: err.error || 'Erro na IA' };
      }
      return await res.json();
    },

    // ── Documents (Knowledge Base) ──
    uploadDocument: async function (file, title, sector, minRole) {
      var ext = file.name.split('.').pop().toLowerCase();
      var filePath = 'documents/' + Date.now() + '_' + file.name;
      var formData = new FormData();
      formData.append('file', file);
      var uploadRes = await fetch(SUPABASE_URL + '/storage/v1/object/company-documents/' + filePath, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
        body: file,
      });
      if (!uploadRes.ok) {
        var uploadErr = await uploadRes.json().catch(function() { return {}; });
        throw new Error(uploadErr.message || 'Erro ao fazer upload');
      }
      var h = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      };
      var ct = this.token || (this._companyMemory && this._companyMemory.token) || localStorage.getItem(this.COMPANY_TOKEN_KEY) || sessionStorage.getItem(this.COMPANY_TOKEN_KEY);
      if (ct) h['x-company-auth'] = ct;
      var res = await fetch(FUNCTIONS_URL + '/process-document', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          title: title,
          filePath: filePath,
          fileType: ext,
          fileName: file.name,
          fileSize: file.size,
          sector: sector || null,
          minRole: minRole || 'colaborador',
        }),
      });
      if (!res.ok) {
        // Try to clean up storage
        try { await fetch(SUPABASE_URL + '/storage/v1/object/company-documents/' + filePath, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY } }); } catch {}
        var err = await res.json().catch(function () { return { error: 'Erro ao processar documento' }; });
        throw new Error(err.error || 'Erro ao processar documento');
      }
      return await res.json();
    },

    searchDocuments: async function (query, sector) {
      var h = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      };
      var ct = this.token || (this._companyMemory && this._companyMemory.token) || localStorage.getItem(this.COMPANY_TOKEN_KEY) || sessionStorage.getItem(this.COMPANY_TOKEN_KEY);
      if (ct) h['x-company-auth'] = ct;
      var res = await fetch(FUNCTIONS_URL + '/search-knowledge', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ query: query, sector: sector || null }),
      });
      if (res.status === 401) { this.logout(); throw new Error('Sessão expirada'); }
      if (!res.ok) {
        var err = await res.json().catch(function () { return { error: 'Erro' }; });
        throw new Error(err.error || 'Erro ao buscar documentos');
      }
      return await res.json();
    },

    listDocuments: async function (sector) {
      var params = { order: 'created_at.desc', select: 'id,title,content_text,sector,min_role,file_path,file_name,created_at' };
      if (sector) params['sector'] = 'eq.' + sector;
      var result = await this._supaGet('documents', params);
      return result.data || [];
    },

    deleteDocument: async function (id, filePath) {
      if (filePath) {
        try { await fetch(SUPABASE_URL + '/storage/v1/object/company-documents/' + filePath, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY } }); } catch {}
      }
      return this._supaDelete('documents', 'id=eq.' + id);
    },

    updateDocument: async function (id, data) {
      return this._supaPatch('documents', 'id=eq.' + id, data);
    },

    getDocumentUrl: function (filePath) {
      return SUPABASE_URL + '/storage/v1/object/public/company-documents/' + encodeURIComponent(filePath);
    },

    // ── CRM ──
    _manageLeads: async function (body) {
      var h = { 'Content-Type': 'application/json' };
      var sid = null;
      try { sid = window.VeltrisWPP && window.VeltrisWPP.getServerSessionId ? window.VeltrisWPP.getServerSessionId() : null; } catch (e) {}
      var res = await fetch(RAILWAY_URL + '/manage-leads', {
        method: 'POST',
        headers: h,
        body: JSON.stringify(Object.assign({}, body, { sessionId: sid })),
      });
      if (res.status === 401) { this.logout(); throw new Error('Sessão expirada'); }
      if (!res.ok) {
        var err = await res.json().catch(function () { return { error: 'Erro' }; });
        throw new Error(err.error || 'Erro ao gerenciar leads');
      }
      return await res.json();
    },

    listLeads: function () {
      return this._manageLeads({ action: 'list', data: { excludeWhatsApp: true } });
    },

    createLead: function (data) {
      return this._manageLeads({ action: 'create', data: data });
    },

    updateLead: function (id, data) {
      data.id = id;
      return this._manageLeads({ action: 'update', data: data });
    },

    deleteLead: function (id) {
      return this._manageLeads({ action: 'delete', data: { id: id } });
    },

    submitLead: async function (data) {
      var h = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      };
      var ct = this.token || (this._companyMemory && this._companyMemory.token) || localStorage.getItem(this.COMPANY_TOKEN_KEY) || sessionStorage.getItem(this.COMPANY_TOKEN_KEY);
      if (ct) h['x-company-auth'] = ct;
      var res = await fetch(FUNCTIONS_URL + '/crm-webhook', {
        method: 'POST',
        headers: h,
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return { error: 'Erro' }; });
        throw new Error(err.error || 'Erro ao enviar lead');
      }
      return await res.json();
    },

    // ── Roleta ──
    _manageRoleta: async function (body) {
      var h = { 'Content-Type': 'application/json' };
      var sid = null;
      try { sid = window.VeltrisWPP && window.VeltrisWPP.getServerSessionId ? window.VeltrisWPP.getServerSessionId() : null; } catch (e) {}
      var res = await fetch(RAILWAY_URL + '/manage-leads', {
        method: 'POST',
        headers: h,
        body: JSON.stringify(Object.assign({}, body, { sessionId: sid })),
      });
      if (res.status === 401) { this.logout(); throw new Error('Sessão expirada'); }
      if (!res.ok) {
        var err = await res.json().catch(function () { return { error: 'Erro' }; });
        throw new Error(err.error || 'Erro ao gerenciar roleta');
      }
      return await res.json();
    },

    getRoletaConfig: function () {
      return this._manageRoleta({ action: 'roleta_config_get', data: {} });
    },

    saveRoletaConfig: function (config) {
      return this._manageRoleta({ action: 'roleta_config_set', data: { config: config } });
    },

    getRoletaAssigns: function () {
      return this._manageRoleta({ action: 'roleta_assigns_get', data: {} });
    },

    // ── Shared App Data (Kanban, Suggestions, Analyses, Feedback) ──
    _listAppData: async function (table) {
      return this._supaGet(table, { order: 'created_at.desc' });
    },

    _getAppData: async function (table, id) {
      var result = await this._supaGet(table, { id: 'eq.' + id });
      return result.data && result.data[0] ? result.data[0] : null;
    },

    _saveAppData: async function (table, data) {
      // If has id, update; otherwise create
      if (data.id) {
        await this._supaPatch(table, 'id=eq.' + encodeURIComponent(data.id), data);
        return data;
      }
      return await this._supaPost(table, data);
    },

    _deleteAppData: async function (table, id) {
      return this._supaDelete(table, 'id=eq.' + encodeURIComponent(id));
    },

    // ── Kanban (shared, stored as single JSONB row) ──
    loadKanban: function () {
      return this._supaGet('app_kanban', { limit: '1' });
    },

    saveKanban: function (data) {
      // Upsert: try to update first, insert if no rows
      var self = this;
      return this._supaGet('app_kanban', { limit: '1' }).then(function (res) {
        var rows = res && res.data || [];
        if (rows.length) {
          return self._supaPatch('app_kanban', 'id=eq.' + rows[0].id, { data: data });
        }
        return self._supaPost('app_kanban', { data: data });
      });
    },

    // ── AI Conversations (per user) ──
    listConversations: function (type) {
      var userId = this.user ? this.user.id : (this.companyGetSession && this.companyGetSession() && this.companyGetSession().user ? this.companyGetSession().user.id : null);
      if (!userId) return Promise.resolve({ data: [] });
      var params = { user_id: 'eq.' + userId, order: 'updated_at.desc' };
      if (type) params['type'] = 'eq.' + type;
      return this._supaGet('app_conversations', params);
    },

    saveConversation: function (conv) {
      var user = this.user || (this.companyGetSession && this.companyGetSession() && this.companyGetSession().user);
      if (!user) return Promise.reject(new Error('Não logado'));
      conv.user_id = user.id;
      if (conv.id && !isNaN(Number(conv.id))) {
        var patchData = Object.assign({}, conv);
        delete patchData.id;
        return this._supaPatch('app_conversations', 'id=eq.' + encodeURIComponent(conv.id), patchData);
      }
      var insertData = Object.assign({}, conv);
      delete insertData.id;
      return this._supaPost('app_conversations', insertData);
    },

    deleteConversation: function (id) {
      return this._supaDelete('app_conversations', 'id=eq.' + encodeURIComponent(id));
    },

    // ── Suggestions (shared) ──
    listSuggestions: function () {
      return this._supaGet('app_suggestions', { order: 'created_at.desc' });
    },

    saveSuggestion: function (data) {
      if (data.id) {
        return this._supaPatch('app_suggestions', 'id=eq.' + encodeURIComponent(data.id), data);
      }
      return this._supaPost('app_suggestions', data);
    },

    deleteSuggestion: function (id) {
      return this._supaDelete('app_suggestions', 'id=eq.' + encodeURIComponent(id));
    },

    // ── Site Analyses (shared) ──
    listAnalyses: function () {
      return this._supaGet('app_analyses', { order: 'created_at.desc' });
    },

    saveAnalysis: function (data) {
      if (data.id) {
        return this._supaPatch('app_analyses', 'id=eq.' + encodeURIComponent(data.id), data);
      }
      data.user_id = this.user ? this.user.id : null;
      return this._supaPost('app_analyses', data);
    },

    deleteAnalysis: function (id) {
      return this._supaDelete('app_analyses', 'id=eq.' + encodeURIComponent(id));
    },

    // ── Feedback (shared) ──
    listFeedback: function () {
      return this._supaGet('app_feedback', { order: 'created_at.desc' });
    },

    saveFeedback: function (data) {
      data.user_id = this.user ? this.user.id : null;
      return this._supaPost('app_feedback', data);
    },

    deleteFeedback: function (id) {
      return this._supaDelete('app_feedback', 'id=eq.' + encodeURIComponent(id));
    },

    // ── Companies (Multi-tenant) ──
    COMPANY_TOKEN_KEY: 'aureoon_company_token',
    COMPANY_DATA_KEY: 'aureoon_company_data',
    _companyMemory: null, // fallback when storage is unavailable (mobile)

    _saveCompanySession: function (token, data) {
      this._companyMemory = { token: token, data: data };
      try {
        var store = this._saveLogin ? localStorage : sessionStorage;
        store.setItem(this.COMPANY_TOKEN_KEY, token);
        store.setItem(this.COMPANY_DATA_KEY, JSON.stringify(data));
      } catch (e) {
        try {
          sessionStorage.setItem(this.COMPANY_TOKEN_KEY, token);
          sessionStorage.setItem(this.COMPANY_DATA_KEY, JSON.stringify(data));
        } catch (e2) { /* keep in memory only */ }
      }
    },

    _companyHeaders: function () {
      var h = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      };
      var t = this.token || (this._companyMemory && this._companyMemory.token) || localStorage.getItem(this.COMPANY_TOKEN_KEY) || sessionStorage.getItem(this.COMPANY_TOKEN_KEY);
      if (t) h['x-company-auth'] = t;
      return h;
    },

    _companyFetch: async function (action, data) {
      var res = await fetch(FUNCTIONS_URL + '/manage-companies', {
        method: 'POST',
        headers: this._companyHeaders(),
        body: JSON.stringify({ action: action, data: data || {} }),
      });
      var result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Erro na requisição');
      return result;
    },

    companyRegister: async function (companyName, adminName, password) {
      return await this._companyFetch('register', { companyName, adminName, password });
    },

    companyLogin: async function (companyName, adminName, password) {
      var result = await this._companyFetch('login', { companyName, adminName, password });
      if (result.token) {
        this._saveCompanySession(result.token, { company: result.company, user: result.user });
      }
      return result;
    },

    companyLogout: function () {
      this._companyMemory = null;
      localStorage.removeItem(this.COMPANY_TOKEN_KEY);
      sessionStorage.removeItem(this.COMPANY_TOKEN_KEY);
      localStorage.removeItem(this.COMPANY_DATA_KEY);
      sessionStorage.removeItem(this.COMPANY_DATA_KEY);
    },

    companyGetSession: function () {
      if (this._companyMemory && this._companyMemory.data) return this._companyMemory.data;
      try {
        var raw = localStorage.getItem(this.COMPANY_DATA_KEY);
        if (!raw) raw = sessionStorage.getItem(this.COMPANY_DATA_KEY);
        if (raw) {
          var data = JSON.parse(raw);
          this._companyMemory = { data: data };
          return data;
        }
      } catch { }
      return null;
    },

    companyVerify: async function () {
      try {
        var result = await this._companyFetch('verify');
        if (result.ok) return result;
        return null;
      } catch { return null; }
    },

    companyList: async function () {
      var result = await this._companyFetch('list');
      return result.companies || [];
    },

    companyCreate: async function (data) {
      return await this._companyFetch('create', data);
    },

    companyGet: async function (id) {
      var result = await this._companyFetch('get', { id: id });
      return result.company || null;
    },

    companyUpdate: async function (id, data) {
      data.id = id;
      return await this._companyFetch('update', data);
    },

    companyDelete: async function (id) {
      return await this._companyFetch('delete', { id: id });
    },

    companyListUsers: async function (companyId) {
      var result = await this._companyFetch('list_users', { company_id: companyId });
      return result.users || [];
    },

    companyCreateUser: async function (companyId, name, password, role, sector, permissions) {
      return await this._companyFetch('create_user', { company_id: companyId, name: name, password: password, role: role || 'user', sector: sector || '', permissions: permissions || {} });
    },

    companyUpdateUser: async function (id, data) {
      data.id = id;
      return await this._companyFetch('update_user', data);
    },

    companyDeleteUser: async function (id) {
      return await this._companyFetch('delete_user', { id: id });
    },
  };

  // Expose REST helpers for wpp-crm.js
  window._supaGet = api._supaGet.bind(api);
  window._supaPatch = api._supaPatch.bind(api);
  window._supaPost = api._supaPost.bind(api);
  window._supaDelete = api._supaDelete.bind(api);
  window._supabaseKey = SUPABASE_ANON_KEY;
  window._supabaseUrl = SUPABASE_URL;

  window.api = api;
})();
