

        function toggleTheme() {
            const html = document.documentElement;
            const icon = document.getElementById('themeIcon');
            if (html.getAttribute('data-theme') === 'light') {
                html.removeAttribute('data-theme');
                localStorage.setItem('theme', 'dark');
                icon.className = 'fi fi-rr-moon';
            } else {
                html.setAttribute('data-theme', 'light');
                localStorage.setItem('theme', 'light');
                icon.className = 'fi fi-rr-sun';
            }
        }
        if (localStorage.getItem('theme') === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
            window.addEventListener('DOMContentLoaded', () => {
                const icon = document.getElementById('themeIcon');
                if (icon) icon.className = 'fi fi-rr-sun';
            });
        }
    


            const STORAGE_KEY = 'orum_checklist_v2';

            // =====================================================================
            //  MOTOR DE INTELIGÊNCIA — ANALISA IMPACTO FINANCEIRO REAL
            // =====================================================================
            //
            //  O item é avaliado em 4 dimensões, cada uma gerando uma nota 0-10:
            //
            //  1. RECEITA DIRETA (peso 4)
            //     O item gera receita diretamente? (ex: fechar venda, emitir fatura)
            //
            //  2. AQUISIÇÃO / TRÁFEGO (peso 3)
            //     O item atrai clientes? (ex: SEO, landing page, anúncio)
            //
            //  3. EFICIÊNCIA OPERACIONAL (peso 2)
            //     O item evita perda de dinheiro? (ex: processo, fluxo de caixa)
            //
            //  4. VELOCIDADE DE ENTREGA (peso 2)
            //     O item gera resultado em dias (curto) ou meses (longo)?
            //
            // Dados de análise são atribuídos pela IA via sugestão

            // =====================================================================
            //  DADOS
            // =====================================================================

            const categories = [
                { id: 'vendas', name: 'Vendas', icon: '<i class="fi fi-rr-chart-line-up"></i>' },
                { id: 'marketing', name: 'Marketing', icon: '<img src="megaphone.svg" class="svg-icon">' },
                { id: 'financeiro', name: 'Financeiro', icon: '<i class="fi fi-rr-sack-dollar"></i>' },
                { id: 'produto', name: 'Produto', icon: '<img src="bullseye-arrow.svg" class="svg-icon">' },
                { id: 'operacional', name: 'Operacional', icon: '<i class="fi fi-rr-settings"></i>' },
                { id: 'rh', name: 'Pessoas & RH', icon: '<img src="user.svg" class="svg-icon">' },
            ];

            const defaultItems = [
                { id: 'v1', cat: 'vendas', label: 'Elaborar estratégia comercial' },
                { id: 'v2', cat: 'vendas', label: 'Estruturar roteiro de ligações' },
                { id: 'v3', cat: 'vendas', label: 'Criar base de leads qualificados' },
                { id: 'v4', cat: 'vendas', label: 'Definir funil de vendas e metas' },
                { id: 'm1', cat: 'marketing', label: 'Otimizar páginas do portfólio' },
                { id: 'm2', cat: 'marketing', label: 'Melhorar responsividade mobile' },
                { id: 'm3', cat: 'marketing', label: 'Fazer update do domínio' },
                { id: 'm4', cat: 'marketing', label: 'Criar calendário de conteúdo' },
                { id: 'o1', cat: 'operacional', label: 'Mapear processos internos' },
                { id: 'o2', cat: 'operacional', label: 'Definir ferramentas de gestão' },
                { id: 'o3', cat: 'operacional', label: 'Criar documentação de processos' },
                { id: 'f1', cat: 'financeiro', label: 'Definir precificação e pacotes' },
                { id: 'f2', cat: 'financeiro', label: 'Controlar fluxo de caixa' },
                { id: 'p1', cat: 'produto', label: 'Definir roadmap do produto' },
                { id: 'r1', cat: 'rh', label: 'Definir funções e responsabilidades' },
                { id: 'r2', cat: 'rh', label: 'Estruturar processo de onboarding' },
            ];

            function loadItems() {
                let stored;
                try { stored = localStorage.getItem(STORAGE_KEY); } catch { }
                if (stored) {
                    try {
                        const parsed = JSON.parse(stored);
                        if (Array.isArray(parsed) && parsed.length) {
                            return parsed.map(function (item, idx) {
                                return {
                                    ...item,
                                    createdAt: item.createdAt || Date.now() - (parsed.length - idx) * 86400000,
                                    doneAt: item.doneAt !== undefined ? item.doneAt : (item.done ? Date.now() - idx * 43200000 : null)
                                };
                            });
                        }
                    } catch { }
                }
                return defaultItems.map(function (i, idx) {
                    return {
                        ...i, done: false, prio: 'media', score: 50, prazo: 'medio',
                        createdAt: Date.now() - (defaultItems.length - idx) * 86400000 * 2,
                        doneAt: null
                    };
                });
            }

            let items = []; // populated by loadChecklistFromServer
            let finFilterPeriod = 'todo';
            let finFilterStart = '';
            let finFilterEnd = '';

            function loadChecklistFromServer() {
                items = loadItems(); // local fallback while loading
                if (!api.isLoggedIn()) { render(); return; }
                api.loadChecklist().then(function (res) {
                    var rows = res && res.data;
                    if (rows && rows.length && rows[0].data && Array.isArray(rows[0].data) && rows[0].data.length) {
                        items = rows[0].data;
                        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) { }
                    }
                    render();
                }).catch(function () { render(); });
            }

            function save() {
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { }
                if (!api.isLoggedIn()) return;
                api.saveChecklist(items).catch(function () { });
            }

            // =====================================================================
            //  HELPERS
            // =====================================================================

            function itemsByCat(catId) { return items.filter(i => i.cat === catId); }

            function catProgress(catId) {
                const list = itemsByCat(catId);
                if (!list.length) return 0;
                return Math.round((list.filter(i => i.done).length / list.length) * 100);
            }

            function totalDone() { return items.filter(i => i.done).length; }
            function totalItems() { return items.length; }
            function overallPct() { return totalItems() ? Math.round((totalDone() / totalItems()) * 100) : 0; }

            // =====================================================================
            //  CÁLCULO DE IMPACTO FINANCEIRO PONDERADO
            // =====================================================================

            function calcImpactoFinanceiro() {
                if (!items.length) return 0;
                let score = 0, maxScore = 0;
                for (const item of items) {
                    const w = (item.score || 50) / 100;
                    maxScore += w;
                    if (item.done) score += w;
                }
                return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
            }

            function calcVelocidadeFinanceira() {
                // Itens com score alto têm peso EXPONENCIAL (cúbico)
                // Um item score 100 vale 64x mais que um score 25
                if (!items.length) return 0;
                let score = 0, maxScore = 0;
                for (const item of items) {
                    const base = (item.score || 50) / 100;
                    const w = base * base * base;
                    maxScore += w;
                    if (item.done) score += w;
                }
                return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
            }

            function calcScoreGeral() {
                if (!items.length) return 0;
                const concl = overallPct();
                const prioridade = calcImpactoFinanceiro();
                return Math.round((concl + prioridade) / 2);
            }

            function getImpactDesc(score) {
                if (score >= 80) return 'Excelente — itens críticos concluídos';
                if (score >= 60) return 'Bom — foco nos itens de alto impacto';
                if (score >= 40) return 'Regular — priorize vendas e marketing';
                if (score >= 20) return 'Iniciando — ataque itens de curto prazo';
                return 'Foco em itens que geram receita rápida';
            }

            function getVelDesc(score) {
                if (score >= 80) return 'Itens de alto impacto em dia';
                if (score >= 50) return 'Metade dos itens críticos concluídos';
                return 'Foque em concluir itens de alto impacto';
            }

            function scoreLabel(score) {
                // Força o elemento a não usar o gradiente
                document.getElementById('scoreImpact').style.background = 'none';
                document.getElementById('scoreImpact').style.webkitTextFillColor = 'initial';

                if (score >= 70) {
                    document.getElementById('scoreImpact').style.color = '#4ade80';
                    return '<span style="font-size: 1.25em;">●</span> Saudável';
                }
                if (score >= 40) {
                    document.getElementById('scoreImpact').style.color = '#facc15';
                    return '<span style="font-size: 1.25em;">●</span> Regular';
                }

                document.getElementById('scoreImpact').style.color = '#ef4444';
                return '<span style="font-size: 1.25em;">●</span> Crítico';
            }

            function scoreDesc(score) {
                if (score >= 80) return 'Empresa saudável — bom ritmo de entregas';
                if (score >= 60) return 'Atenção necessária — foco em prioridades';
                if (score >= 40) return 'Regular — acelere itens de alto impacto';
                if (score >= 20) return 'Crítico — priorize ações curto prazo';
                return 'Grave — reavalie a estratégia';
            }

            // =====================================================================
            //  DATE PICKER
            // =====================================================================

            var dpMeses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
            var dpDiasSem = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
            var dpState = {};

            function initDP(id) {
                var d = new Date();
                dpState[id] = { month: d.getMonth(), year: d.getFullYear(), selected: null, view: 'day', yrRange: d.getFullYear() - 6 };
                renderDP(id);
            }

            function renderDP(id) {
                var s = dpState[id];
                document.getElementById(id + 'Month').textContent = dpMeses[s.month];
                document.getElementById(id + 'Year').textContent = s.year;
                var body = document.getElementById(id + 'Body');
                if (s.view === 'month') renderMonthPicker(id, body);
                else if (s.view === 'year') renderYearPicker(id, body);
                else renderDayGrid(id, body);
            }

            function renderDayGrid(id, body) {
                var s = dpState[id];
                var first = new Date(s.year, s.month, 1).getDay();
                var days = new Date(s.year, s.month + 1, 0).getDate();
                var hoje = new Date();
                var hojeStr = hoje.getFullYear() + '-' + (hoje.getMonth() + 1).toString().padStart(2, '0') + '-' + hoje.getDate().toString().padStart(2, '0');
                var html = '<div class="fin-dp-grid">';
                dpDiasSem.forEach(function (dw) { html += '<span class="dw">' + dw + '</span>'; });
                for (var i = 0; i < first; i++) html += '<span class="dd empty"></span>';
                for (var d = 1; d <= days; d++) {
                    var dStr = s.year + '-' + (s.month + 1).toString().padStart(2, '0') + '-' + d.toString().padStart(2, '0');
                    var cls = 'dd';
                    if (dStr === hojeStr) cls += ' today';
                    if (s.selected === dStr) cls += ' selected';
                    html += '<span class="' + cls + '" onclick="dpSel(\'' + id + '\',\'' + dStr + '\')">' + d + '</span>';
                }
                html += '</div>';
                body.innerHTML = html;
            }

            function renderMonthPicker(id, body) {
                var s = dpState[id];
                var html = '<div class="fin-dp-picker" style="grid-template-columns:repeat(3,1fr)">';
                for (var i = 0; i < 12; i++) {
                    var cls = 'dp-item';
                    if (i === s.month) cls += ' active';
                    html += '<span class="' + cls + '" onclick="dpSetMonth(' + i + ',\'' + id + '\')">' + dpMeses[i].slice(0, 3) + '</span>';
                }
                html += '</div>';
                body.innerHTML = html;
            }

            function renderYearPicker(id, body) {
                var s = dpState[id];
                var html = '<div style="display:flex;justify-content:space-between;margin-bottom:6px">';
                html += '<button class="fin-dp-nav" onclick="dpYrMove(-12,\'' + id + '\')">‹‹</button>';
                html += '<button class="fin-dp-nav" onclick="dpYrMove(-1,\'' + id + '\')">‹</button>';
                html += '<span style="font-size:0.65rem;color:var(--text-muted)">' + s.yrRange + ' – ' + (s.yrRange + 11) + '</span>';
                html += '<button class="fin-dp-nav" onclick="dpYrMove(1,\'' + id + '\')">›</button>';
                html += '<button class="fin-dp-nav" onclick="dpYrMove(12,\'' + id + '\')">››</button>';
                html += '</div>';
                html += '<div class="fin-dp-picker" style="grid-template-columns:repeat(4,1fr)">';
                for (var i = 0; i < 12; i++) {
                    var y = s.yrRange + i;
                    var cls = 'dp-item';
                    if (y === s.year) cls += ' active';
                    html += '<span class="' + cls + '" onclick="dpSetYear(' + y + ',\'' + id + '\')">' + y + '</span>';
                }
                html += '</div>';
                body.innerHTML = html;
            }

            function dpToggle(id) {
                document.querySelectorAll('.fin-dp-drop.open').forEach(function (el) {
                    if (el.id !== id + 'Drop') el.classList.remove('open');
                });
                var drop = document.getElementById(id + 'Drop');
                drop.classList.toggle('open');
                if (drop.classList.contains('open')) {
                    if (!dpState[id]) initDP(id);
                    else { dpState[id].view = 'day'; renderDP(id); }
                }
            }

            function dpMode(mode, id) {
                if (!dpState[id]) initDP(id);
                dpState[id].view = mode;
                renderDP(id);
                document.getElementById(id + 'Drop').classList.add('open');
            }

            function dpMove(dir, id) {
                if (!dpState[id]) initDP(id);
                var s = dpState[id];
                if (s.view === 'day') {
                    s.month += dir;
                    if (s.month < 0) { s.month = 11; s.year--; }
                    else if (s.month > 11) { s.month = 0; s.year++; }
                } else if (s.view === 'month') {
                    s.year += dir;
                }
                renderDP(id);
                document.getElementById(id + 'Drop').classList.add('open');
            }

            function dpYrMove(amt, id) {
                dpState[id].yrRange += amt;
                renderDP(id);
                document.getElementById(id + 'Drop').classList.add('open');
            }

            function dpSetMonth(month, id) {
                dpState[id].month = month;
                dpState[id].view = 'day';
                renderDP(id);
                document.getElementById(id + 'Drop').classList.add('open');
            }

            function dpSetYear(year, id) {
                dpState[id].year = year;
                dpState[id].view = 'month';
                renderDP(id);
                document.getElementById(id + 'Drop').classList.add('open');
            }

            function dpSel(id, dStr) {
                dpState[id].selected = dStr;
                renderDP(id);
                var parts = dStr.split('-');
                var d = new Date(parts[0], parts[1] - 1, parts[2]);
                var label = d.getDate().toString().padStart(2, '0') + '/' + (d.getMonth() + 1).toString().padStart(2, '0');
                document.getElementById(id + 'Val').textContent = label;
                document.getElementById(id + 'Drop').classList.remove('open');
                if (id === 'dpStart' || id === 'dpStartDup') { finFilterStart = dStr; setFinFilter('custom'); }
                else if (id === 'dpEnd' || id === 'dpEndDup') { finFilterEnd = dStr; setFinFilter('custom'); }
                else if (id === 'dpLeadClose') { document.getElementById('leadCloseDate').value = dStr; }
            }

            function dpHoje(id) {
                var hoje = new Date();
                var dStr = hoje.getFullYear() + '-' + (hoje.getMonth() + 1).toString().padStart(2, '0') + '-' + hoje.getDate().toString().padStart(2, '0');
                dpSel(id, dStr);
            }

            // Close date picker dropdowns on outside click
            document.addEventListener('click', function (e) {
                if (!document.body.contains(e.target)) return;
                if (!e.target.closest('.fin-dp')) {
                    document.querySelectorAll('.fin-dp-drop.open').forEach(function (el) { el.classList.remove('open'); });
                }
            });

            function setFinFilter(period) {
                finFilterPeriod = period;
                document.querySelectorAll('.fin-filtro-btn').forEach(function (btn) {
                    btn.classList.toggle('active', btn.dataset.period === period);
                });
                renderFinanceCharts();
                var svg = document.getElementById('finLineChart');
                if (svg) { svg.classList.remove('fade-in'); void svg.offsetWidth; svg.classList.add('fade-in'); }
            }

            function toggleFinFilterDropdown() {
                var dd = document.getElementById('finFilterDropdown');
                var arrow = document.getElementById('finFilterArrow');
                dd.classList.toggle('open');
                arrow.classList.toggle('open');
            }

            // Close filter dropdown on outside click
            document.addEventListener('click', function (e) {
                var dd = document.getElementById('finFilterDropdown');
                if (!dd) return;
                if (dd.classList.contains('open') && !e.target.closest('.fin-filtros')) {
                    dd.classList.remove('open');
                    var arrow = document.getElementById('finFilterArrow');
                    if (arrow) arrow.classList.remove('open');
                }
            });

            // =====================================================================
            //  SCORE COLOR (now after setFinFilter)
            // =====================================================================

            function renderEmptyChartGrid() {
                var w = 500, h = 200, padL = 10, padR = 10, padT = 24, padB = 24;
                var cH = h - padT - padB;
                var html = '';
                for (var gi = 1; gi <= 4; gi++) {
                    var gy = padT + cH - (cH / 4) * gi;
                    html += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + gy.toFixed(1) + '" stroke="rgba(var(--opacity-color),0.15)" stroke-width="0.5" stroke-dasharray="3,3" opacity="0.4"/>';
                }
                html += '<text x="' + (w / 2) + '" y="' + (padT + cH / 2 + 4) + '" text-anchor="middle" fill="rgba(var(--opacity-color),0.35)" font-size="11" font-weight="600">Nenhuma venda no período</text>';
                return html;
            }

            function getLeadCloseTs(l) {
                if (l.close_date) return new Date(l.close_date + 'T12:00:00').getTime();
                return new Date(l.updated_at || l.created_at).getTime();
            }

            function formatYValue(v) {
                if (v >= 1000000) return 'R$ ' + (v / 1000000).toFixed(1).replace('.', ',') + 'M';
                if (v >= 10000) return 'R$ ' + Math.round(v / 1000) + 'k';
                if (v >= 1000) return 'R$ ' + (v / 1000).toFixed(1).replace('.', ',') + 'k';
                return 'R$ ' + Math.round(v);
            }

            async function renderFinanceCharts() {
                // Update Faturamento, Ticket Médio, Vendas from CRM won leads
                var svg = document.getElementById('finLineChart');
                var fatEl = document.getElementById('finFaturamento');
                var tktEl = document.getElementById('finTicketMedio');
                var cntEl = document.getElementById('finVendasCount');

                try {
                    var leads = await api.listLeads() || [];
                    var won = leads.filter(function (l) { return l.status === 'won' && l.project_value; });

                    // Chart
                    if (!svg) return;
                    if (!won.length) {
                        if (fatEl) fatEl.textContent = '—';
                        if (tktEl) tktEl.textContent = '—';
                        if (cntEl) cntEl.textContent = '—';
                        if (svg) { svg.style.opacity = '0'; svg.style.transform = 'translateY(10px)'; svg.innerHTML = renderEmptyChartGrid(); animateFinChart(svg); }
                        return;
                    }

                    var now = Date.now();
                    function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
                    function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
                    function weekStart(d) {
                        var dt = new Date(d);
                        var day = dt.getDay();
                        var diff = dt.getDate() - day + (day === 0 ? -6 : 1);
                        return new Date(dt.getFullYear(), dt.getMonth(), diff).getTime();
                    }
                    var rangeStart, rangeEnd, bucketMs, fmt;
                    var allTs = won.map(function (l) { return getLeadCloseTs(l); });
                    var minTs = allTs.length ? Math.min.apply(null, allTs) : Date.now();
                    switch (finFilterPeriod) {
                        case 'hoje':
                            rangeStart = dayStart(new Date());
                            rangeEnd = rangeStart + 86400000;
                            bucketMs = 3600000;
                            fmt = 'h';
                            break;
                        case 'semana':
                            rangeStart = weekStart(new Date());
                            rangeEnd = rangeStart + 7 * 86400000;
                            bucketMs = 86400000;
                            fmt = 'd';
                            break;
                        case 'mes':
                            rangeStart = monthStart(new Date());
                            rangeEnd = monthStart(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
                            bucketMs = 86400000;
                            fmt = 'd';
                            break;
                        case '6meses':
                            rangeStart = monthStart(new Date(now - 180 * 86400000));
                            rangeEnd = now;
                            bucketMs = 30 * 86400000;
                            fmt = 'm';
                            break;
                        case 'ano':
                            rangeStart = new Date(new Date().getFullYear(), 0, 1).getTime();
                            rangeEnd = new Date(new Date().getFullYear() + 1, 0, 1).getTime();
                            bucketMs = 30 * 86400000;
                            fmt = 'm';
                            break;
                        case 'custom':
                            rangeStart = finFilterStart ? new Date(finFilterStart + 'T00:00:00').getTime() : minTs;
                            rangeEnd = finFilterEnd ? new Date(finFilterEnd + 'T23:59:59').getTime() : now;
                            bucketMs = (rangeEnd - rangeStart) > 120 * 86400000 ? 30 * 86400000 : 86400000;
                            fmt = (rangeEnd - rangeStart) > 120 * 86400000 ? 'm' : 'd';
                            break;
                        default:
                            rangeStart = Math.min(minTs, now - 30 * 86400000);
                            rangeEnd = now;
                            bucketMs = 30 * 86400000;
                            fmt = 'm';
                    }

                    var filtered = won.filter(function (l) {
                        var t = getLeadCloseTs(l);
                        return t >= rangeStart && t <= rangeEnd;
                    });
                    // Stats from filtered period
                    var ftotal = 0;
                    filtered.forEach(function (l) { ftotal += Number(l.project_value); });
                    if (fatEl) fatEl.textContent = ftotal ? 'R$ ' + ftotal.toLocaleString('pt-BR') : '—';
                    if (tktEl) tktEl.textContent = filtered.length ? 'R$ ' + Math.round(ftotal / filtered.length).toLocaleString('pt-BR') : '—';
                    if (cntEl) cntEl.textContent = filtered.length;
                    if (!filtered.length) { svg.style.opacity = '0'; svg.style.transform = 'translateY(10px)'; svg.innerHTML = renderEmptyChartGrid(); animateFinChart(svg); return; }
                    filtered.sort(function (a, b) { return getLeadCloseTs(a) - getLeadCloseTs(b); });

                    var buckets = [];
                    var cur = rangeStart;
                    while (cur < rangeEnd) {
                        var next;
                        if (fmt === 'm') {
                            var dd = new Date(cur);
                            next = new Date(dd.getFullYear(), dd.getMonth() + 1, 1).getTime();
                            if (next > rangeEnd) next = rangeEnd;
                        } else {
                            next = Math.min(cur + bucketMs, rangeEnd);
                        }
                        var inBucket = filtered.filter(function (l) {
                            var t = getLeadCloseTs(l);
                            return t >= cur && t < next;
                        });
                        var bucketVal = 0;
                        inBucket.forEach(function (l) { bucketVal += Number(l.project_value); });
                        var label;
                        var d = new Date(cur);
                        if (fmt === 'h') label = d.getHours() + 'h';
                        else if (fmt === 'd') label = d.getDate() + '/' + (d.getMonth() + 1);
                        else label = (d.getMonth() + 1) + '/' + d.getFullYear().toString().slice(-2);
                        buckets.push({ label: label, val: bucketVal, ts: cur });
                        cur = next;
                    }

                    // Period-value chart with dynamic Y scale
                    var vals = buckets.map(function (b) { return b.val; });
                    var dataMin = Math.min.apply(null, vals);
                    var dataMax = Math.max.apply(null, vals);
                    if (dataMax === dataMin) { dataMin = dataMax * 0.5; dataMax = dataMax * 1.5; }
                    if (!dataMax) dataMax = 1;
                    var yMin = dataMin * 0.9;
                    var yMax = dataMax * 1.1;
                    var yRange = yMax - yMin;

                    var isMobile = window.innerWidth < 768;
                    var w = 500, h = isMobile ? 300 : 160, padL = isMobile ? 70 : 45, padR = 10, padT = isMobile ? 14 : 16, padB = isMobile ? 18 : 16;
                    var cH = h - padT - padB;
                    var gap = (w - padL - padR) / buckets.length;

                    var linePts = [];
                    buckets.forEach(function (b, i) {
                        var cx = padL + i * gap + gap / 2;
                        var cy = padT + cH - ((b.val - yMin) / yRange) * cH;
                        linePts.push({ x: cx, y: cy, val: b.val });
                    });

                    var pathD = linePts.map(function (p, i) {
                        return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
                    }).join(' ');
                    var html = '';

                    // Transparent full-area rect so mousemove fires everywhere
                    html += '<rect width="' + w + '" height="' + h + '" fill="transparent"/>';

                    // Nice Y-axis ticks with clean values
                    var roughStep = yRange / 5;
                    var exp = Math.floor(Math.log10(roughStep));
                    var frac = roughStep / Math.pow(10, exp);
                    var niceStep;
                    if (frac <= 1.5) niceStep = 1;
                    else if (frac <= 3.5) niceStep = 2;
                    else if (frac <= 7.5) niceStep = 5;
                    else niceStep = 10;
                    niceStep *= Math.pow(10, exp);

                    var niceMin = Math.floor(yMin / niceStep) * niceStep;
                    var niceMax = Math.ceil(yMax / niceStep) * niceStep;

                    var yTicks = [];
                    for (var t = niceMin; t <= niceMax + niceStep * 0.01; t += niceStep) {
                        yTicks.push(t);
                        if (yTicks.length > 20) break;
                    }

                    var labelFontSize = Math.round(h / (isMobile ? 20 : 22));
                    yTicks.forEach(function (val) {
                        var ratio = (val - yMin) / yRange;
                        if (ratio < -0.05 || ratio > 1.05) return;
                        var gy = padT + cH - Math.max(0, Math.min(1, ratio)) * cH;
                        html += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + gy.toFixed(1) + '" stroke="rgba(var(--opacity-color),0.12)" stroke-width="0.5" stroke-dasharray="3,3" opacity="0.4"/>';
                        html += '<text x="' + (padL - 4) + '" y="' + (gy + Math.round(labelFontSize * 0.35)) + '" text-anchor="end" fill="rgba(var(--opacity-color),0.3)" font-size="' + labelFontSize + '">' + formatYValue(val) + '</text>';
                    });

                    // Period-value line (solid, thicker)
                    var lineW = isMobile ? '2.5' : '1.5';
                    html += '<path d="' + pathD + '" fill="none" stroke="rgba(74,222,128,0.8)" stroke-width="' + lineW + '" stroke-linejoin="round" stroke-linecap="round"/>';

                    // Data dots on each point
                    var dotR = isMobile ? '4' : '2.5';
                    linePts.forEach(function (pt) {
                        html += '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="' + dotR + '" fill="rgba(74,222,128,0.9)" stroke="rgba(var(--opacity-color),0.3)" stroke-width="0.5"/>';
                    });

                    // X-axis labels
                    if (buckets.length >= 1) {
                        var labelStep = Math.max(1, Math.floor(buckets.length / (isMobile ? 6 : 10)));
                        buckets.forEach(function (b, i) {
                            if (i % labelStep === 0 || i === buckets.length - 1) {
                                var cx = padL + i * gap + gap / 2;
                                html += '<text x="' + cx.toFixed(1) + '" y="' + (padT + cH + labelFontSize + 4) + '" text-anchor="middle" fill="rgba(var(--opacity-color),0.35)" font-size="' + labelFontSize + '">' + b.label + '</text>';
                            }
                        });
                    }

                    svg.style.opacity = '0';
                    svg.style.transform = 'translateY(10px)';
                    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
                    svg.innerHTML = html;
                    animateFinChart(svg);

                    // Store chart data for cursor tooltip
                    window._finChartData = {
                        buckets: buckets, linePts: linePts,
                        padL: padL, padT: padT, ch: cH, svgW: w, svgH: h, gap: gap
                    };

                    // Re-create tooltip group (innerHTML wipes it each render)
                    var oldG = svg.querySelector('#finChartTip');
                    if (oldG) oldG.remove();

                    var tipG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    tipG.id = 'finChartTip';
                    tipG.style.display = 'none';

                    var tLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    tLine.id = 'finCTL';
                    tLine.setAttribute('stroke', 'rgba(var(--opacity-color),0.35)');
                    tLine.setAttribute('stroke-width', '1');
                    tLine.setAttribute('stroke-dasharray', '3,3');

                    var tDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    tDot.id = 'finCTD';
                    var dotR = isMobile ? '7' : '5';
                    tDot.setAttribute('r', dotR);
                    tDot.setAttribute('fill', 'rgba(74,222,128,0.95)');
                    tDot.setAttribute('stroke', '#fff');
                    tDot.setAttribute('stroke-width', '2');

                    var tVal = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    tVal.id = 'finCTV';
                    tVal.setAttribute('fill', 'rgba(74,222,128,0.95)');
                    tVal.setAttribute('font-size', String(Math.round(h / 18)));
                    tVal.setAttribute('font-weight', '700');
                    tVal.setAttribute('text-anchor', 'middle');

                    [tLine, tDot, tVal].forEach(function (el) { tipG.appendChild(el); });
                    svg.appendChild(tipG);

                    // Always rebind event listeners (removed old ones first)
                    var onMove = svg._finOnMove;
                    var onLeave = svg._finOnLeave;
                    if (onMove) svg.removeEventListener('mousemove', onMove);
                    if (onLeave) svg.removeEventListener('mouseleave', onLeave);

                    svg._finOnMove = function (e) {
                        var data = window._finChartData;
                        if (!data || !data.buckets.length) return;
                        var rect = svg.getBoundingClientRect();
                        var mx = (e.clientX - rect.left) / rect.width * data.svgW;
                        var idx = Math.round((mx - data.padL - data.gap / 2) / data.gap);
                        idx = Math.max(0, Math.min(idx, data.buckets.length - 1));
                        var bucket = data.buckets[idx];
                        var pt = data.linePts[idx];
                        if (!pt) return;

                        var g = svg.querySelector('#finChartTip');
                        if (!g) return;
                        g.style.display = '';

                        var cx = pt.x, cy = pt.y;
                        var l = svg.querySelector('#finCTL');
                        if (l) { l.setAttribute('x1', cx.toFixed(1)); l.setAttribute('x2', cx.toFixed(1)); l.setAttribute('y1', data.padT.toFixed(1)); l.setAttribute('y2', (data.padT + data.ch).toFixed(1)); }
                        var d = svg.querySelector('#finCTD');
                        if (d) { d.setAttribute('cx', cx.toFixed(1)); d.setAttribute('cy', cy.toFixed(1)); }
                        var v = svg.querySelector('#finCTV');
                        if (v) { v.textContent = 'R$ ' + bucket.val.toLocaleString('pt-BR'); v.setAttribute('x', cx.toFixed(1)); v.setAttribute('y', (cy - Math.round(h / 12)).toFixed(1)); }
                    };
                    svg._finOnLeave = function () {
                        var g = svg.querySelector('#finChartTip');
                        if (g) g.style.display = 'none';
                    };

                    svg.addEventListener('mousemove', svg._finOnMove);
                    svg.addEventListener('mouseleave', svg._finOnLeave);
                    svg.style.cursor = 'crosshair';
                } catch (e) { }
            }

            function animateFinChart(svg) {
                requestAnimationFrame(function () {
                    svg.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    requestAnimationFrame(function () {
                        svg.style.opacity = '';
                        svg.style.transform = '';
                        setTimeout(function () { svg.style.transition = ''; }, 350);
                    });
                });
            }

            // =====================================================================
            //  ESCAPE
            // =====================================================================

            function esc(t) {
                const d = document.createElement('div');
                d.textContent = t;
                return d.innerHTML;
            }

            // =====================================================================
            //  SCORE COLOR
            // =====================================================================

            function scoreColor(score) {
                if (score >= 70) return 'var(--accent-light)';
                if (score >= 40) return 'var(--accent)';
                return 'var(--text-muted)';
            }

            // =====================================================================
            //  TOAST
            // =====================================================================

            let toastTimer = null;

            function showToast(msg) {
                const el = document.getElementById('toast');
                document.getElementById('toastMsg').textContent = msg;
                el.style.opacity = '1';
                clearTimeout(toastTimer);
                toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
            }

            // =====================================================================
            //  RENDER
            // =====================================================================

            function render() {
                const done = totalDone();
                const total = totalItems();
                const pct = overallPct();
                const fin = calcImpactoFinanceiro();
                const vel = calcVelocidadeFinanceira();
                const score = calcScoreGeral();

                document.getElementById('overallBar').style.width = pct + '%';
                document.getElementById('doneCount').textContent = done + ' concluídos';
                document.getElementById('totalCount').textContent = total + ' itens';

                document.getElementById('finImpact').textContent = fin + '%';
                document.getElementById('finImpactDesc').textContent = getImpactDesc(fin);
                document.getElementById('velImpact').textContent = vel + '%';
                document.getElementById('velImpactDesc').textContent = getVelDesc(vel);
                document.getElementById('scoreImpact').innerHTML = scoreLabel(score);
                document.getElementById('scoreImpactDesc').textContent = scoreDesc(score);

                renderTopPriorities();
                renderChart();
                renderCategories();
                renderModalSelects();
                updateBulkUI();
                renderFinanceCharts();
            }

            function renderTopPriorities() {
                const sorted = [...items]
                    .filter(i => !i.done)
                    .sort((a, b) => (b.score || 0) - (a.score || 0))
                    .slice(0, 5);

                const list = document.getElementById('tpList');
                if (!sorted.length) {
                    list.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:8px 0">Tudo concluído!</div>';
                    return;
                }

                list.innerHTML = sorted.map(item => {
                    const prazoLabel = item.prazo === 'curto' ? 'Curto' : item.prazo === 'medio' ? 'Médio' : 'Longo';
                    const prazoClass = 'tp-tag';
                    const cl = item.done ? 'tp-label done' : 'tp-label';
                    return `
                    <div class="tp-item" onclick="toggleItem('${item.id}')">
                        <span class="${cl}">${esc(item.label)}</span>
                        <span class="tp-tag ${prazoClass}">${prazoLabel}</span>
                    </div>
                `;
                }).join('');
            }

            function renderChart() {
                const grid = document.getElementById('chartGrid');
                const catPeso = { vendas: 'Alto', marketing: 'Alto', financeiro: 'Alto', produto: 'Médio', operacional: 'Baixo', rh: 'Baixo' };
                const catPesoClass = { vendas: 'impact-alto', marketing: 'impact-alto', financeiro: 'impact-alto', produto: 'impact-medio', operacional: 'impact-baixo', rh: 'impact-baixo' };

                grid.innerHTML = categories.map((cat, idx) => {
                    const p = catProgress(cat.id);
                    const list = itemsByCat(cat.id);
                    const done = list.filter(i => i.done).length;
                    const fillClass = 'c-fill-' + (idx + 1);
                    const pctClass = 'c-pct-' + (idx + 1);

                    return `
                    <div class="chart-row">
                        <div class="cat-label"><span class="cat-icon">${cat.icon}</span> ${cat.name}</div>
                        <div class="cat-bar-track">
                            <div class="cat-bar-fill ${fillClass}" style="width:${p}%">
                                ${p >= 15 ? `<span class="bar-count">${done}/${list.length}</span>` : ''}
                            </div>
                        </div>
                        <div class="cat-pct ${pctClass}">${p}%</div>
                    </div>
                `;
                }).join('');
            }

            function renderCategories() {
                const container = document.getElementById('categoriesContainer');
                container.classList.toggle('select-mode', selectMode);

                container.innerHTML = categories.map(cat => {
                    const list = itemsByCat(cat.id);
                    if (!list.length) return '';
                    const done = list.filter(i => i.done).length;
                    const p = catProgress(cat.id);
                    const fillIdx = categories.indexOf(cat) + 1;
                    const fillClass = 'c-fill-' + fillIdx;
                    const pctColor = p >= 50 ? 'var(--accent-light)' : p >= 25 ? 'var(--accent)' : 'var(--text-muted)';

                    return `
                    <div class="category" data-cat="${cat.id}">
                        <div class="cat-header" onclick="toggleCat('${cat.id}')">
                            <div class="cat-icon">${cat.icon}</div>
                            <div class="cat-info">
                                <div class="cat-name">${cat.name}</div>
                                <div class="cat-meta">
                                    <span>${done}/${list.length} concluídos</span>
                                    <div class="cat-mini-bar">
                                        <div class="cat-mini-fill ${fillClass}" style="width:${p}%"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="cat-pct-small" style="color:${pctColor}">${p}%</div>
                            <div class="chevron" id="chevron-${cat.id}">▼</div>
                        </div>
                        <div class="cat-body" id="body-${cat.id}">
                            <div class="cat-items">
                                ${list.map(item => {
                        const prazoLabel = item.prazo === 'curto' ? 'Curto' : item.prazo === 'medio' ? 'Médio' : 'Longo';
                        return `
                                        <div class="cat-item ${item.done ? 'done' : ''} ${selectedItems.has(item.id) ? 'selected' : ''}">
                                            <label class="ck-bulk" onclick="event.stopPropagation();toggleSelectItem('${item.id}')">
                                                <input type="checkbox" class="ck-bulk-input" data-id="${item.id}" ${selectedItems.has(item.id) ? 'checked' : ''} onchange="void(0)" />
                                            </label>
                                            <div class="ck-wrap" onclick="event.stopPropagation()">
                                                <input type="checkbox" id="ck-${item.id}" ${item.done ? 'checked' : ''} onchange="toggleItem('${item.id}')" />
                                                <label class="ck-box" for="ck-${item.id}">
                                                    <svg viewBox="0 0 12 12" fill="none">
                                                        <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                                    </svg>
                                                </label>
                                            </div>
                                            <span class="item-label">${esc(item.label)}</span>
                                            <span class="item-tag">${item.prio === 'alta' ? 'Alta' : item.prio === 'media' ? 'Média' : 'Baixa'}</span>
                                            <span class="impact-hint">${prazoLabel}</span>
                                            <button class="btn-remove" onclick="removeItem('${item.id}')" title="Remover item">✕</button>
                                        </div>
                                    `;
                    }).join('')}
                            </div>
                        </div>
                    </div>
                `;
                }).join('');

                if (!items.length) {
                    container.innerHTML = '<div class="empty-state">Nenhum item cadastrado. Clique em "+ Novo Item" para começar.</div>';
                }

                // Re-aplica o estado aberto das categorias após re-render
                openCats.forEach(function (id) {
                    var body = document.getElementById('body-' + id);
                    var ch = document.getElementById('chevron-' + id);
                    if (body) body.classList.add('open');
                    if (ch) ch.classList.add('open');
                });
            }

            function renderModalSelects() {
                const drop = document.getElementById('csDrop');
                drop.innerHTML = categories.map(c =>
                    `<div class="cs-opt" data-value="${c.id}" onclick="selectCS('${c.id}')">${c.icon} ${c.name}</div>`
                ).join('');
                const first = categories[0];
                if (first) selectCS(first.id);
            }

            let csOpen = false;
            function toggleCS() {
                csOpen ? closeCS() : openCS();
            }
            function openCS() {
                csOpen = true;
                document.getElementById('csDrop').classList.add('visible');
                document.getElementById('csTrigger').classList.add('open');
                document.getElementById('csArrow').classList.add('open');
            }
            function closeCS() {
                csOpen = false;
                document.getElementById('csDrop').classList.remove('visible');
                document.getElementById('csTrigger').classList.remove('open');
                document.getElementById('csArrow').classList.remove('open');
            }
            function selectCS(value) {
                const cat = categories.find(c => c.id === value);
                if (!cat) return;
                document.getElementById('newCategory').value = value;
                document.getElementById('csSelected').textContent = cat.icon + ' ' + cat.name;
                document.querySelectorAll('#csDrop .cs-opt').forEach(el => el.classList.remove('selected'));
                const opt = document.querySelector(`#csDrop .cs-opt[data-value="${value}"]`);
                if (opt) opt.classList.add('selected');
                closeCS();
            }
            // Fecha dropdown ao clicar fora
            document.addEventListener('click', function (e) {
                const wrap = document.getElementById('csTrigger').closest('.cs-wrap');
                if (csOpen && wrap && !wrap.contains(e.target)) closeCS();
                // BC dropdowns
                ['cat', 'pri', 'prazo'].forEach(function (k) {
                    if (bcOpen[k]) {
                        var w = document.getElementById('bc' + k.charAt(0).toUpperCase() + k.slice(1) + 'Wrap');
                        if (w && !w.contains(e.target)) closeBC(k);
                    }
                });
            });

            // =====================================================================
            //  BULK CUSTOM DROPDOWNS
            // =====================================================================
            var bcOpen = { cat: false, pri: false, prazo: false };
            var bcVal = { cat: '', pri: '', prazo: '' };
            function toggleBC(which) {
                bcOpen[which] ? closeBC(which) : openBC(which);
            }
            function openBC(which) {
                bcOpen[which] = true;
                var suffix = which.charAt(0).toUpperCase() + which.slice(1);
                document.getElementById('bc' + suffix + 'Drop').classList.add('visible');
                document.getElementById('bc' + suffix + 'Trigger').classList.add('open');
                document.getElementById('bc' + suffix + 'Arrow').classList.add('open');
                // Fecha os outros
                Object.keys(bcOpen).forEach(function (k) {
                    if (k !== which && bcOpen[k]) closeBC(k);
                });
            }
            function closeBC(which) {
                bcOpen[which] = false;
                var suffix = which.charAt(0).toUpperCase() + which.slice(1);
                document.getElementById('bc' + suffix + 'Drop').classList.remove('visible');
                document.getElementById('bc' + suffix + 'Trigger').classList.remove('open');
                document.getElementById('bc' + suffix + 'Arrow').classList.remove('open');
            }
            function selectBC(which, value) {
                bcVal[which] = value;
                var suffix = which.charAt(0).toUpperCase() + which.slice(1);
                var labelEl = document.getElementById('bc' + suffix + 'Label');
                var opts = document.querySelectorAll('#bc' + suffix + 'Drop .bc-opt');
                opts.forEach(function (el) { el.classList.remove('selected'); });
                var opt = document.querySelector('#bc' + suffix + 'Drop .bc-opt[data-value="' + value + '"]');
                if (opt) opt.classList.add('selected');
                // Atualiza label
                var labels = {
                    cat: { '': 'Manter categoria', 'vendas': '<i class="fi fi-rr-chart-line-up"></i> Vendas', 'marketing': '<img src="megaphone.svg" class="svg-icon"> Marketing', 'financeiro': '<i class="fi fi-rr-sack-dollar"></i> Financeiro', 'produto': '<img src="bullseye-arrow.svg" class="svg-icon"> Produto', 'operacional': '<i class="fi fi-rr-settings"></i> Operacional', 'rh': '<img src="user.svg" class="svg-icon"> Pessoas & RH' },
                    pri: { '': 'Manter prioridade', 'alta': '<i class="fi fi-rr-arrow-up" style="color:var(--red)"></i> Alta', 'media': '<i class="fi fi-rr-minus" style="color:#facc15"></i> Média', 'baixa': '<i class="fi fi-rr-arrow-down" style="color:#4ade80"></i> Baixa' },
                    prazo: { '': 'Manter prazo', 'curto': '<i class="fi fi-rr-time-fast"></i> Curto', 'medio': '<i class="fi fi-rr-calendar"></i> Médio', 'longo': '<i class="fi fi-rr-hourglass"></i> Longo' }
                };
                labelEl.textContent = labels[which][value] || value;
                closeBC(which);
            }

            // =====================================================================
            //  INTERAÇÕES
            // =====================================================================

            function toggleItem(id) {
                const item = items.find(i => i.id === id);
                if (item) {
                    item.done = !item.done;
                    item.doneAt = item.done ? Date.now() : null;
                    save();
                    render();
                }
            }

            function removeItem(id) {
                const item = items.find(i => i.id === id);
                if (!item) return;
                const label = item.label;
                items = items.filter(i => i.id !== id);
                save();
                render();
                showToast('Removido: "' + label + '"');
            }

            // =====================================================================
            //  FEEDBACK — registra correções manuais para a IA aprender
            // =====================================================================

            var feedbackLog = [];

            function loadFeedback() {
                if (!api.isLoggedIn()) {
                    try { var saved = localStorage.getItem('veltris_feedback'); if (saved) feedbackLog = JSON.parse(saved); } catch { }
                    return;
                }
                api.listFeedback().then(function (res) {
                    var rows = res && res.data || [];
                    feedbackLog = rows.map(function (r) { return { label: r.label, mudancas: r.mudancas, timestamp: new Date(r.created_at).getTime() }; });
                }).catch(function () {
                    try { var saved = localStorage.getItem('veltris_feedback'); if (saved) feedbackLog = JSON.parse(saved); } catch { }
                });
            }

            function saveFeedback() {
                if (!api.isLoggedIn()) {
                    try { localStorage.setItem('veltris_feedback', JSON.stringify(feedbackLog.slice(-50))); } catch { }
                    return;
                }
                // Keep last 50
                if (feedbackLog.length > 50) feedbackLog = feedbackLog.slice(-50);
                // Save each new feedback entry (ones without DB id)
                feedbackLog.forEach(function (f) {
                    if (!f._saved) {
                        f._saved = true;
                        api.saveFeedback({ label: f.label, mudancas: f.mudancas });
                    }
                });
            }

            function registrarFeedback(item, novosDados) {
                var mudancas = {};
                if (novosDados.cat && novosDados.cat !== item.cat) mudancas.categoria = { de: item.cat, para: novosDados.cat };
                if (novosDados.prio && novosDados.prio !== item.prio) mudancas.prioridade = { de: item.prio, para: novosDados.prio };
                if (novosDados.prazo && novosDados.prazo !== item.prazo) mudancas.prazo = { de: item.prazo, para: novosDados.prazo };
                if (Object.keys(mudancas).length) {
                    feedbackLog.push({ label: item.label, mudancas: mudancas, timestamp: Date.now() });
                    saveFeedback();
                }
            }

            // =====================================================================
            //  EDITAR ITEM
            // =====================================================================

            var editCSOpen = false;

            function editItem(id) {
                var item = items.find(function (i) { return i.id === id; });
                if (!item) return;
                document.getElementById('editItemId').value = id;
                document.getElementById('editLabel').textContent = item.label;
                document.getElementById('editPrioridade').value = item.prio || 'media';
                document.getElementById('editPrazo').value = item.prazo || 'medio';

                var drop = document.getElementById('editCsDrop');
                drop.innerHTML = categories.map(function (c) {
                    return '<div class="cs-opt" data-value="' + c.id + '" onclick="selectEditCS(\'' + c.id + '\')">' + c.icon + ' ' + c.name + '</div>';
                }).join('');
                var cat = categories.find(function (c) { return c.id === item.cat; });
                document.getElementById('editCategory').value = item.cat;
                document.getElementById('editCsSelected').textContent = cat ? cat.icon + ' ' + cat.name : item.cat;

                document.getElementById('editModalOverlay').classList.add('visible');
            }

            function saveEditItem() {
                var id = document.getElementById('editItemId').value;
                var item = items.find(function (i) { return i.id === id; });
                if (!item) return;

                var novosDados = {
                    cat: document.getElementById('editCategory').value,
                    prio: document.getElementById('editPrioridade').value,
                    prazo: document.getElementById('editPrazo').value,
                };

                registrarFeedback(item, novosDados);

                item.cat = novosDados.cat;
                item.prio = novosDados.prio;
                item.prazo = novosDados.prazo;

                save();
                render();
                closeEditModal();
                showToast('<i class="fi fi-rr-check-circle"></i> Item atualizado');
            }

            function closeEditModal() {
                document.getElementById('editModalOverlay').classList.remove('visible');
                editCSOpen = false;
            }

            function toggleEditCS() {
                editCSOpen ? closeEditCS() : openEditCS();
            }
            function openEditCS() {
                editCSOpen = true;
                document.getElementById('editCsDrop').classList.add('visible');
                document.getElementById('editCsTrigger').classList.add('open');
                document.getElementById('editCsArrow').classList.add('open');
            }
            function closeEditCS() {
                editCSOpen = false;
                document.getElementById('editCsDrop').classList.remove('visible');
                document.getElementById('editCsTrigger').classList.remove('open');
                document.getElementById('editCsArrow').classList.remove('open');
            }
            function selectEditCS(value) {
                var cat = categories.find(function (c) { return c.id === value; });
                if (!cat) return;
                document.getElementById('editCategory').value = value;
                document.getElementById('editCsSelected').textContent = cat.icon + ' ' + cat.name;
                document.querySelectorAll('#editCsDrop .cs-opt').forEach(function (el) { return el.classList.remove('selected'); });
                var opt = document.querySelector('#editCsDrop .cs-opt[data-value="' + value + '"]');
                if (opt) opt.classList.add('selected');
                closeEditCS();
            }

            // =====================================================================
            //  BULK EDIT — selecionar e editar múltiplos itens
            // =====================================================================

            var selectedItems = new Set();
            var selectMode = false;

            function toggleSelectAll() {
                if (selectMode && selectedItems.size > 0) {
                    selectedItems.clear();
                    // Reseta os dropdowns
                    bcVal = { cat: '', pri: '', prazo: '' };
                    document.getElementById('bcCatLabel').textContent = 'Manter categoria';
                    document.getElementById('bcPriLabel').textContent = 'Manter prioridade';
                    document.getElementById('bcPrazoLabel').textContent = 'Manter prazo';
                    document.querySelectorAll('#bcCatDrop .bc-opt, #bcPriDrop .bc-opt, #bcPrazoDrop .bc-opt').forEach(function (el) {
                        el.classList.remove('selected');
                    });
                    document.querySelectorAll('#bcCatDrop .bc-opt[data-value=""], #bcPriDrop .bc-opt[data-value=""], #bcPrazoDrop .bc-opt[data-value=""]').forEach(function (el) {
                        el.classList.add('selected');
                    });
                    updateBulkUI();
                    renderCategories();
                    return;
                }
                selectMode = !selectMode;
                if (!selectMode) selectedItems.clear();
                updateBulkUI();
                renderCategories();
            }

            function toggleSelectItem(id) {
                if (!selectMode) selectMode = true;
                if (selectedItems.has(id)) selectedItems.delete(id);
                else selectedItems.add(id);
                updateBulkUI();
                renderCategories();
            }

            function clearSelection() {
                selectMode = false;
                selectedItems.clear();
                bcVal = { cat: '', pri: '', prazo: '' };
                document.getElementById('bcCatLabel').textContent = 'Manter categoria';
                document.getElementById('bcPriLabel').textContent = 'Manter prioridade';
                document.getElementById('bcPrazoLabel').textContent = 'Manter prazo';
                document.querySelectorAll('#bcCatDrop .bc-opt, #bcPriDrop .bc-opt, #bcPrazoDrop .bc-opt').forEach(function (el) {
                    el.classList.remove('selected');
                });
                document.querySelectorAll('#bcCatDrop .bc-opt[data-value=""], #bcPriDrop .bc-opt[data-value=""], #bcPrazoDrop .bc-opt[data-value=""]').forEach(function (el) {
                    el.classList.add('selected');
                });
                updateBulkUI();
                renderCategories();
            }

            function updateBulkUI() {
                var bar = document.getElementById('bulkBar');
                var count = document.getElementById('bulkCount');
                var btn = document.getElementById('btnSelectAll');
                if (selectedItems.size > 0) {
                    bar.style.display = 'block';
                    count.textContent = selectedItems.size + ' selecionado' + (selectedItems.size > 1 ? 's' : '');
                    btn.textContent = '✕';
                } else if (selectMode) {
                    bar.style.display = 'none';
                    btn.textContent = '✕';
                } else {
                    bar.style.display = 'none';
                    btn.innerHTML = '<img src="pencil.svg" class="svg-icon" style="margin:0; width:0.9em; height:0.9em;">';
                }
            }

            function applyBulkEdit() {
                if (!selectedItems.size) return;
                var cat = bcVal.cat;
                var prio = bcVal.pri;
                var prazo = bcVal.prazo;
                if (!cat && !prio && !prazo) { showToast('Selecione pelo menos uma alteração'); return; }

                var atualizados = 0;
                selectedItems.forEach(function (id) {
                    var item = items.find(function (i) { return i.id === id; });
                    if (!item || item.done) return;

                    var novosDados = {};
                    if (cat) novosDados.cat = cat;
                    if (prio) novosDados.prio = prio;
                    if (prazo) novosDados.prazo = prazo;

                    registrarFeedback(item, novosDados);

                    if (cat) item.cat = cat;
                    if (prio) item.prio = prio;
                    if (prazo) item.prazo = prazo;
                    atualizados++;
                });

                selectedItems.clear();
                updateBulkUI();
                save();
                render();
                showToast('<i class="fi fi-rr-check-circle"></i> ' + atualizados + ' itens atualizados em massa');
            }

            let openCats = new Set();

            function toggleCat(id) {
                openCats.has(id) ? closeCat(id) : openCat(id);
            }

            function openCat(id) {
                openCats.add(id);
                const body = document.getElementById('body-' + id);
                const ch = document.getElementById('chevron-' + id);
                if (body) body.classList.add('open');
                if (ch) ch.classList.add('open');
            }

            function closeCat(id) {
                openCats.delete(id);
                const body = document.getElementById('body-' + id);
                const ch = document.getElementById('chevron-' + id);
                if (body) body.classList.remove('open');
                if (ch) ch.classList.remove('open');
            }

            // =====================================================================
            //  MODAL COM PRÉ-VISUALIZAÇÃO INTELIGENTE
            // =====================================================================

            function openModal() {
                document.getElementById('modalOverlay').classList.add('visible');
                document.getElementById('newLabel').value = '';
                document.getElementById('newLabel').focus();
                renderModalSelects();
                document.getElementById('csSelected').textContent = categories[0].icon + ' ' + categories[0].name;
            }

            function closeModal() {
                document.getElementById('modalOverlay').classList.remove('visible');
            }

            function addItem() {
                const label = document.getElementById('newLabel').value.trim();
                if (!label) return;

                const cat = document.getElementById('newCategory').value;
                const id = Date.now().toString();

                items.push({
                    id, cat, label, done: false,
                    prio: 'media',
                    score: 50,
                    prazo: 'medio',
                    createdAt: Date.now(),
                    doneAt: null
                });

                save();
                render();
                closeModal();
                showToast('Item adicionado');
            }

            function resetAll() {
                if (!items.length) return;
                if (confirm('Resetar todos os itens para "não concluído"?')) {
                    items.forEach(function (i) { i.done = false; i.doneAt = null; });
                    save();
                    render();
                    showToast('Todos os itens foram resetados');
                }
            }

            // =====================================================================
            //  KEYBOARD
            // =====================================================================

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && document.getElementById('modalOverlay').classList.contains('visible')) {
                    addItem();
                }
                if (e.key === 'Enter' && document.getElementById('editModalOverlay').classList.contains('visible')) {
                    saveEditItem();
                }
                if (e.key === 'Escape') {
                    if (document.getElementById('editModalOverlay').classList.contains('visible')) {
                        closeEditModal();
                    } else if (document.getElementById('cardModalOverlay').classList.contains('visible')) {
                        closeCardModal();
                    } else if (document.getElementById('modalOverlay').classList.contains('visible')) {
                        closeModal();
                    } else if (document.getElementById('settingsOverlay').classList.contains('visible')) {
                        closeSettings();
                    }
                }
            });

            // =====================================================================
            //  KANBAN SYSTEM
            // =====================================================================

            var kanbanData = [];

            function defaultKanban() {
                return [
                    {
                        id: 'col-1', title: '<i class="fi fi-rr-memo"></i> Ideias', cards: [
                            { title: 'Webinar sobre tráfego pago', desc: 'Convidar especialista para falar sobre Facebook Ads e Google Ads' },
                            { title: 'E-book: Guia de Marketing Digital para Agências', desc: 'Compilar cases da Veltris e criar material rico para captura de leads' },
                            { title: 'Série de vídeos curtos para o Instagram', desc: 'Reels com dicas rápidas de vendas e marketing' }
                        ]
                    },
                    {
                        id: 'col-2', title: '<i class="fi fi-rr-wrench"></i> Em Produção', cards: [
                            { title: 'Case de sucesso: Cliente X', desc: 'Entrevistar cliente, colher dados de resultado, editar depoimento' },
                            { title: 'Post carrossel: Tendências 2026', desc: 'Pesquisar tendências de marketing digital para o próximo ano' }
                        ]
                    },
                    {
                        id: 'col-3', title: '<i class="fi fi-rr-check-circle"></i> Revisão', cards: [
                            { title: 'Newsletter mensal - Junho', desc: 'Revisar textos, checar links e agendar disparo' }
                        ]
                    },
                    {
                        id: 'col-4', title: '<i class="fi fi-rr-rocket"></i> Publicado', cards: [
                            { title: 'Artigo: Como otimizar seu funil de vendas', desc: 'Publicado no blog e LinkedIn' },
                            { title: 'Template de brief criativo', desc: 'Disponível na biblioteca da equipe' }
                        ]
                    },
                ];
            }

            function loadKanban() {
                // Try to load from localStorage first for immediate rendering
                let localData = null;
                try {
                    var stored = localStorage.getItem('veltris_kanban');
                    if (stored) {
                        var parsed = JSON.parse(stored);
                        if (Array.isArray(parsed) && parsed.length) localData = parsed;
                    }
                } catch (e) { }

                kanbanData = localData || defaultKanban();

                if (!api.isLoggedIn()) { return; }

                api.loadKanban().then(function (res) {
                    var rows = res && res.data;
                    if (rows && rows.length && rows[0].data && Array.isArray(rows[0].data) && rows[0].data.length) {
                        kanbanData = rows[0].data;
                        // Cache it immediately so next reload is fast
                        try { localStorage.setItem('veltris_kanban', JSON.stringify(kanbanData)); } catch (e) { }
                        renderKanban();
                    }
                }).catch(function () {
                    renderKanban();
                });
            }

            function saveKanban() {
                if (!api.isLoggedIn()) {
                    try { localStorage.setItem('veltris_kanban', JSON.stringify(kanbanData)); } catch { }
                    return;
                }
                api.saveKanban(kanbanData).catch(function () {
                    try { localStorage.setItem('veltris_kanban', JSON.stringify(kanbanData)); } catch { }
                });
            }

            function renderKanban() {
                var board = document.getElementById('kanbanBoard');
                if (!board) return;
                if (!kanbanData || !Array.isArray(kanbanData) || !kanbanData.length) {
                    kanbanData = defaultKanban();
                    saveKanban();
                }
                board.innerHTML = kanbanData.map(function (col, ci) {
                    return '<div class="kanban-col" data-col="' + ci + '">' +
                        '<div class="kanban-col-header">' +
                        '<div class="kch-title">' + col.title +
                        '<span class="kch-count">' + col.cards.length + '</span>' +
                        '</div>' +
                        '<div class="kch-actions">' +
                        '<button onclick="renameKanbanCol(' + ci + ')" title="Renomear"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 0.9em; height: 0.9em;"></button>' +
                        '<button class="kch-del" onclick="deleteKanbanCol(' + ci + ')" title="Excluir coluna">✕</button>' +
                        '</div>' +
                        '</div>' +
                        '<div class="kanban-col-body" data-col="' + ci + '">' +
                        col.cards.map(function (card, ci2) {
                            var commentCount = (card.comments && card.comments.length) || 0;
                            return '<div class="kanban-card" data-col="' + ci + '" data-card="' + ci2 + '" style="--idx:' + ci2 + '">' +
                                '<div class="kc-title">' + esc(card.title) + '</div>' +
                                (card.desc ? '<div class="kc-desc">' + esc(card.desc) + '</div>' : '') +
                                '<div class="kc-footer">' +
                                '<span class="kc-tag ' + tagClass(col.id) + '">' + esc(col.title.replace(/<[^>]+>/g, '').trim()) + '</span>' +
                                '<div style="display:flex;align-items:center;gap:6px">' +
                                (commentCount > 0 ? '<span style="font-size:0.6rem;color:var(--text-muted)"><i class="fi fi-rr-comment-alt"></i>' + commentCount + '</span>' : '') +
                                '<div class="kc-actions">' +
                                '<button class="kc-del" onclick="event.stopPropagation();deleteKanbanCard(' + ci + ',' + ci2 + ')" title="Excluir">✕</button>' +
                                '</div>' +
                                '</div>' +
                                '</div>' +
                                '</div>';
                        }).join('') +
                        '</div>' +
                        '<button class="kanban-add-card" onclick="addKanbanCard(' + ci + ')">+ Novo Card</button>' +
                        '</div>';
                }).join('') +
                    '<button class="kanban-add-col" onclick="addKanbanColumn()">+ Nova Coluna</button>';
            }

            function tagClass(colId) {
                if (colId && colId.includes('1')) return 'ideo';
                if (colId && colId.includes('2')) return 'prod';
                if (colId && colId.includes('3')) return 'rev';
                if (colId && colId.includes('4')) return 'pronto';
                return 'ideo';
            }

            // --- Drag-to-scroll via mouse ---
            var scrollState = null;
            var scrollAnim = null;
            var cardDrag = null;
            var cardTimer = null;
            var cardClone = null;
            var cardMoving = false;
            var pointerMoved = false;

            function initBoardGrab() {
                var container = document.getElementById('tabConteudos');
                if (!container || container.dataset.grabInit) return;
                container.dataset.grabInit = '1';
                container.addEventListener('mousedown', onMouseDown);
                // Touch é nativo via touch-action: pan-x
            }

            function onMouseDown(e) {
                if (e.button !== 0) return;
                if (e.target.closest('button, input, select, textarea, .kc-actions, .kanban-add-card, .kanban-add-col')) return;

                var board = document.getElementById('kanbanBoard');
                if (!board) return;
                var cardEl = e.target.closest('.kanban-card');

                scrollState = {
                    startX: e.clientX,
                    scrollLeft: board.scrollLeft,
                    moved: false,
                    velocity: 0,
                    lastX: e.clientX,
                    lastTime: Date.now()
                };
                board.classList.add('grabbing');

                if (cardEl) {
                    cardDrag = { el: cardEl, col: parseInt(cardEl.dataset.col), card: parseInt(cardEl.dataset.card), ready: false };
                    cardTimer = setTimeout(function () {
                        if (cardDrag && scrollState && !scrollState.moved) {
                            cardDrag.ready = true;
                            var rect = cardDrag.el.getBoundingClientRect();
                            cardDrag.el.classList.add('dragging');
                            cardClone = cardDrag.el.cloneNode(true);
                            cardClone.style.cssText = 'position:fixed;pointer-events:none;z-index:1000;width:' + rect.width + 'px;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.4);border:2px solid var(--accent);background:var(--surface2);transform:scale(1.02)';
                            cardClone.style.left = (e.clientX - rect.width / 2) + 'px';
                            cardClone.style.top = (e.clientY - 20) + 'px';
                            document.body.appendChild(cardClone);
                            cardMoving = false;
                        }
                    }, 300);
                }
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            }

            function onMouseMove(e) {
                if (!scrollState) return;
                var board = document.getElementById('kanbanBoard');
                if (!board) return;
                var dx = e.clientX - scrollState.startX;

                if (cardDrag && cardDrag.ready) {
                    e.preventDefault();
                    if (cardClone) {
                        var halfW = cardClone.offsetWidth / 2;
                        cardClone.style.left = (e.clientX - halfW) + 'px';
                        cardClone.style.top = (e.clientY - 20) + 'px';
                    }
                    document.querySelectorAll('.kanban-col-body').forEach(function (b) { b.classList.remove('drag-over'); });
                    var target = document.elementFromPoint(e.clientX, e.clientY);
                    if (target) {
                        var body = target.closest('.kanban-col-body');
                        if (body) body.classList.add('drag-over');
                    }
                    cardMoving = true; scrollState.moved = true; pointerMoved = true;
                    return;
                }

                if (!scrollState.moved && Math.abs(dx) > 10) {
                    scrollState.moved = true; pointerMoved = true;
                    if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; cardDrag = null; }
                    board.style.cursor = 'grabbing';
                }

                if (scrollState.moved) {
                    e.preventDefault();
                    board.scrollLeft = scrollState.scrollLeft - dx;
                    var now = Date.now();
                    var dt = now - scrollState.lastTime;
                    if (dt > 0) scrollState.velocity = (e.clientX - scrollState.lastX) / dt * 16;
                    scrollState.lastX = e.clientX;
                    scrollState.lastTime = now;
                }
            }

            function onMouseUp(e) {
                if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                var board = document.getElementById('kanbanBoard');
                if (board) { board.classList.remove('grabbing'); board.style.cursor = ''; }

                if (cardMoving && cardDrag) {
                    document.querySelectorAll('.kanban-col-body').forEach(function (b) { b.classList.remove('drag-over'); });
                    if (cardDrag.el) cardDrag.el.classList.remove('dragging');
                    if (cardClone) { cardClone.remove(); cardClone = null; }
                    var target = document.elementFromPoint(e.clientX, e.clientY);
                    if (target) {
                        var body = target.closest('.kanban-col-body');
                        if (body) {
                            var targetCol = parseInt(body.dataset.col);
                            if (!isNaN(targetCol) && targetCol !== cardDrag.col) {
                                var card = kanbanData[cardDrag.col].cards.splice(cardDrag.card, 1)[0];
                                if (card) { kanbanData[targetCol].cards.push(card); saveKanban(); renderKanban(); }
                            }
                        }
                    }
                }

                if (scrollState && scrollState.moved && !cardMoving) {
                    var vel = scrollState.velocity || 0;
                    if (Math.abs(vel) > 0.5) startInertia(vel);
                }

                scrollState = null; cardDrag = null; cardMoving = false; cardClone = null;
                setTimeout(function () { pointerMoved = false; }, 50);
            }

            function startInertia(velocity) {
                if (scrollAnim) cancelAnimationFrame(scrollAnim);
                var board = document.getElementById('kanbanBoard');
                if (!board) return;
                var decel = 0.92, minVel = 0.5;
                function tick() {
                    velocity *= decel;
                    if (Math.abs(velocity) < minVel) return;
                    board.scrollLeft -= velocity;
                    scrollAnim = requestAnimationFrame(tick);
                }
                scrollAnim = requestAnimationFrame(tick);
            }

            function initCardClicks() {
                document.querySelectorAll('.kanban-card').forEach(function (card) {
                    card.addEventListener('click', function (e) {
                        if (pointerMoved) return;
                        if (e.target.closest('.kc-actions, .kc-del, button')) return;
                        var ci = parseInt(card.dataset.col), ci2 = parseInt(card.dataset.card);
                        if (!isNaN(ci) && !isNaN(ci2)) openKanbanCard(ci, ci2);
                    });
                });
            }

            // Override renderKanban
            var origRenderKanban1 = renderKanban;
            renderKanban = function () {
                origRenderKanban1();
                initBoardGrab();
                initCardClicks();
            };
            var cardModalMode = 'add';
            var cardModalCol = -1;
            var cardModalCard = -1;

            function openKanbanCard(colIdx, cardIdx) {
                var card = kanbanData[colIdx].cards[cardIdx];
                if (!card) return;
                cardModalMode = 'edit';
                cardModalCol = colIdx;
                cardModalCard = cardIdx;
                document.getElementById('cardModalTitle').textContent = '<i class="fi fi-rr-clipboard-list"></i> ' + esc(card.title);
                document.getElementById('cardTitleInput').value = card.title || '';
                document.getElementById('cardDescInput').value = card.desc || '';
                renderComments(card);
                document.getElementById('cardModalOverlay').classList.add('visible');
                setTimeout(function () { document.getElementById('cardTitleInput').focus(); }, 100);
            }

            function addKanbanCard(colIdx) {
                cardModalMode = 'add';
                cardModalCol = colIdx;
                cardModalCard = -1;
                document.getElementById('cardModalTitle').textContent = '✨ Novo Card';
                document.getElementById('cardTitleInput').value = '';
                document.getElementById('cardDescInput').value = '';
                document.getElementById('commentsList').innerHTML = '';
                document.getElementById('cardModalOverlay').classList.add('visible');
                setTimeout(function () { document.getElementById('cardTitleInput').focus(); }, 100);
            }

            function closeCardModal() {
                document.getElementById('cardModalOverlay').classList.remove('visible');
            }

            function saveCardModal() {
                var title = document.getElementById('cardTitleInput').value.trim();
                if (!title) { document.getElementById('cardTitleInput').focus(); return; }
                var desc = document.getElementById('cardDescInput').value.trim();
                if (cardModalMode === 'add') {
                    kanbanData[cardModalCol].cards.push({ title: title, desc: desc, comments: [] });
                    showToast('<i class="fi fi-rr-check-circle"></i> Card adicionado');
                } else if (cardModalMode === 'edit' && cardModalCard >= 0) {
                    var card = kanbanData[cardModalCol].cards[cardModalCard];
                    if (card) { card.title = title; card.desc = desc; }
                    showToast('<i class="fi fi-rr-check-circle"></i> Card atualizado');
                }
                saveKanban();
                renderKanban();
                closeCardModal();
            }

            // Comments
            function renderComments(card) {
                var list = document.getElementById('commentsList');
                var comments = card.comments || [];
                if (!comments.length) {
                    list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);padding:8px 0">Nenhum comentário ainda.</div>';
                    return;
                }
                list.innerHTML = comments.map(function (c) {
                    var time = c.time ? new Date(c.time).toLocaleString('pt-BR') : '';
                    return '<div class="cm-comment">' +
                        '<div class="cmc-meta">' +
                        '<span class="cmc-author">' + esc(c.author || 'Usuário') + '</span>' +
                        '<span class="cmc-time">' + time + '</span>' +
                        '</div>' +
                        '<div class="cmc-text">' + esc(c.text) + '</div>' +
                        '</div>';
                }).join('');
            }

            function addComment() {
                var input = document.getElementById('commentInput');
                var text = input.value.trim();
                if (!text) return;
                if (cardModalMode !== 'edit' || cardModalCard < 0) return;
                var card = kanbanData[cardModalCol].cards[cardModalCard];
                if (!card) return;
                if (!card.comments) card.comments = [];
                var u = api.getUser(); card.comments.push({ author: (u && u.name) || 'Usuário', text: text, time: Date.now() });
                input.value = '';
                renderComments(card);
                saveKanban();
                showToast('<i class="fi fi-rr-comment-alt"></i> Comentário adicionado');
            }

            // Allow Enter to send comment
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && document.getElementById('cardModalOverlay').classList.contains('visible')) {
                    if (document.activeElement === document.getElementById('commentInput')) {
                        addComment();
                    }
                }
            });

            function showConfirm(title, msg) {
                return new Promise(function (resolve) {
                    document.getElementById('confirmTitle').textContent = title;
                    document.getElementById('confirmMessage').textContent = msg;
                    document.getElementById('confirmOverlay').style.display = 'flex';
                    document.getElementById('confirmOkBtn').onclick = function () {
                        document.getElementById('confirmOverlay').style.display = 'none';
                        resolve(true);
                    };
                    // Also set cancel to resolve false
                    var cancelBtn = document.querySelector('#confirmOverlay .btn-cancel');
                    var oldClick = cancelBtn.onclick;
                    cancelBtn.onclick = function () {
                        document.getElementById('confirmOverlay').style.display = 'none';
                        resolve(false);
                    };
                });
            }

            function deleteKanbanCard(colIdx, cardIdx) {
                document.getElementById('confirmTitle').textContent = '🗑️ Excluir card';
                document.getElementById('confirmMessage').textContent = 'Excluir este card?';
                document.getElementById('confirmOverlay').style.display = 'flex';
                document.getElementById('confirmOkBtn').onclick = function () {
                    document.getElementById('confirmOverlay').style.display = 'none';
                    kanbanData[colIdx].cards.splice(cardIdx, 1);
                    saveKanban();
                    renderKanban();
                };
            }

            // Column operations
            function addKanbanColumn() {
                var input = document.getElementById('promptInput');
                var overlay = document.getElementById('promptOverlay');
                var title = document.getElementById('promptTitle');
                if (!input || !overlay || !title) { showToast('<i class="fi fi-rr-triangle-warning"></i> Erro: elementos do modal não encontrados'); return; }
                window._kanbanMode = 'add';
                window._kanbanIdx = -1;
                title.textContent = 'Nome da nova coluna';
                input.value = '';
                overlay.style.display = 'flex';
                setTimeout(function () { input.focus(); }, 100);
                showToast('<i class="fi fi-rr-clipboard-list"></i> Modal aberto');
            }

            function renameKanbanCol(colIdx) {
                var input = document.getElementById('promptInput');
                var overlay = document.getElementById('promptOverlay');
                var title = document.getElementById('promptTitle');
                if (!input || !overlay) return;
                window._kanbanMode = 'rename';
                window._kanbanIdx = colIdx;
                title.textContent = 'Novo nome';
                input.value = kanbanData[colIdx].title;
                overlay.style.display = 'flex';
                setTimeout(function () { input.focus(); }, 100);
            }

            // Enter para confirmar
            var pi = document.getElementById('promptInput');
            if (pi) pi.addEventListener('keydown', function (e) { if (e.key === 'Enter') document.querySelector('#promptOverlay .btn-save').click(); });
            var po = document.getElementById('promptOverlay');
            if (po) po.addEventListener('click', function (e) { if (e.target === po) po.style.display = 'none'; });
            // Confirm modal overlay click
            var co = document.getElementById('confirmOverlay');
            if (co) co.addEventListener('click', function (e) { if (e.target === co) co.style.display = 'none'; });

            function deleteKanbanCol(colIdx) {
                if (kanbanData.length <= 1) {
                    document.getElementById('confirmTitle').textContent = '<i class="fi fi-rr-triangle-warning"></i> Aviso';
                    document.getElementById('confirmMessage').textContent = 'Deve haver pelo menos uma coluna.';
                    document.getElementById('confirmOverlay').style.display = 'flex';
                    document.getElementById('confirmOkBtn').onclick = function () { document.getElementById('confirmOverlay').style.display = 'none'; };
                    return;
                }
                document.getElementById('confirmTitle').textContent = '🗑️ Excluir coluna';
                document.getElementById('confirmMessage').textContent = 'Excluir coluna "' + kanbanData[colIdx].title + '" e todos os seus cards?';
                document.getElementById('confirmOverlay').style.display = 'flex';
                document.getElementById('confirmOkBtn').onclick = function () {
                    document.getElementById('confirmOverlay').style.display = 'none';
                    kanbanData.splice(colIdx, 1);
                    saveKanban();
                    renderKanban();
                };
            }

            // Import .txt to kanban
            function importTxtToKanban(input) {
                var file = input.files && input.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function (e) {
                    var content = e.target.result;
                    var lines = content.split('\n').filter(function (l) { return l.trim(); });
                    if (lines.length === 0) { alert('Arquivo vazio.'); return; }
                    var title = file.name.replace('.txt', '').replace(/_/g, ' ');
                    var desc = lines.slice(0, 5).join('\n').slice(0, 300);
                    if (kanbanData.length > 0) {
                        kanbanData[0].cards.push({ title: title, desc: desc });
                        saveKanban();
                        renderKanban();
                        showToast('<i class="fi fi-rr-document"></i> "' + title + '" importado para <i class="fi fi-rr-memo"></i> Ideias');
                    }
                };
                reader.readAsText(file, 'UTF-8');
                input.value = '';
            }

            // =====================================================================
            //  CHAT IA — ASSISTENTE Veltris (multi-conversation)
            // =====================================================================

            var iaConversations = [];
            var activeIAConvId = null;
            var iaHistoryVisible = true;

            function loadIAConversations() {
                if (!api.isLoggedIn()) { iaConversations = [{ id: 'conv_' + Date.now(), title: 'Nova conversa', messages: [] }]; activeIAConvId = iaConversations[0].id; return; }
                api.listConversations('main').then(function (res) {
                    var rows = res && res.data;
                    if (rows && rows.length) {
                        iaConversations = rows.map(function (r) { return { id: '' + r.id, title: r.title, messages: r.messages || [] }; });
                        activeIAConvId = iaConversations[0].id;
                    } else {
                        iaConversations.push({ id: 'conv_' + Date.now(), title: 'Nova conversa', messages: [] });
                        activeIAConvId = iaConversations[0].id;
                    }
                }).catch(function () {
                    iaConversations.push({ id: 'conv_' + Date.now(), title: 'Nova conversa', messages: [] });
                    activeIAConvId = iaConversations[0].id;
                });
            }

            function saveIAConversations() {
                if (!api.isLoggedIn()) { return; }
                iaConversations.forEach(function (conv) {
                    api.saveConversation({ type: 'main', id: conv.id && !isNaN(conv.id) ? parseInt(conv.id) : null, title: conv.title, messages: conv.messages });
                });
                // Prune deleted
                api.listConversations('main').then(function (res) {
                    var rows = res && res.data || [];
                    var activeIds = new Set(iaConversations.map(function (c) { return c.id; }));
                    rows.forEach(function (r) {
                        if (!activeIds.has('' + r.id)) api.deleteConversation(r.id);
                    });
                });
            }

            function getActiveIAConv() {
                return iaConversations.find(function (c) { return c.id === activeIAConvId; });
            }

            function renderChat() {
                var container = document.getElementById('chatMessages');
                if (!container) return;
                var conv = getActiveIAConv();
                if (!conv || !conv.messages || !conv.messages.length) {
                    container.innerHTML = '<div class="chat-empty" id="chatEmpty"><div class="ce-icon">👋</div><div>Olá! Eu sou a IA da Veltris.<br/>Pergunte sobre estratégia, conteúdos, finanças ou peça sugestões.</div></div>';
                    return;
                }
                container.innerHTML = conv.messages.map(function (msg) {
                    var time = msg.time ? new Date(msg.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
                    var formatted = formatChatContent(msg.content);
                    return '<div class="chat-msg ' + msg.role + '">' + formatted + '<div class="msg-time">' + time + '</div></div>';
                }).join('');
                container.scrollTop = container.scrollHeight;
            }

            function formatChatContent(text) {
                var lines = esc(text).split('\n');
                return lines.map(function (line) {
                    var trimmed = line.trim();
                    if (trimmed.match(/^-\s/)) {
                        return '<div class="chat-bullet">' + line + '</div>';
                    }
                    if (line === '') return '<div class="chat-spacer"></div>';
                    return '<div class="chat-line">' + line + '</div>';
                }).join('');
            }

            function showTyping() {
                var container = document.getElementById('chatMessages');
                if (!container) return;
                var el = document.createElement('div');
                el.className = 'chat-typing';
                el.id = 'chatTyping';
                el.innerHTML = '<span></span><span></span><span></span>';
                container.appendChild(el);
                container.scrollTop = container.scrollHeight;
            }

            function hideTyping() {
                var el = document.getElementById('chatTyping');
                if (el) el.remove();
            }

            // Strip markdown formatting from AI replies
            function stripMarkdown(text) {
                return text
                    .replace(/\*\*(.+?)\*\*/g, '$1')
                    .replace(/\*(.+?)\*/g, '$1')
                    .replace(/### (.+)/g, '$1')
                    .replace(/## (.+)/g, '$1')
                    .replace(/# (.+)/g, '$1')
                    .replace(/^(\d+)\. /gm, '- ')
                    .replace(/___+/g, '')
                    .replace(/---+/g, '')
                    .replace(/\* /g, '- ')
                    .trim();
            }

            function chatInputKeydown(e) {
                if (e.key === 'Enter') {
                    var isMobile = window.matchMedia('(max-width: 768px)').matches;
                    if (isMobile) {
                        if (!e.shiftKey) {
                            e.preventDefault();
                            e.target.value += '\n';
                        }
                    } else {
                        if (!e.shiftKey) {
                            e.preventDefault();
                            sendChat();
                        }
                    }
                }
            }

            function renderIAHistory() {
                var list = document.getElementById('iaChatSidebarList');
                if (!list) return;
                list.innerHTML = iaConversations.map(function (c) {
                    var active = c.id === activeIAConvId ? 'active' : '';
                    var title = esc(c.title);
                    return '<div class="chat-sidebar-item ' + active + '" onclick="switchIAConv(\'' + c.id + '\')">' +
                        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">' + title + '</span>' +
                        '<button class="ch-del" onclick="event.stopPropagation();deleteIAConv(\'' + c.id + '\')" title="Excluir">✕</button>' +
                        '</div>';
                }).join('');
            }

            function toggleIAHistory() {
                var sidebar = document.getElementById('iaChatSidebar');
                iaHistoryVisible = !iaHistoryVisible;
                sidebar.classList.toggle('collapsed', !iaHistoryVisible);
                if (iaHistoryVisible) renderIAHistory();
            }

            function switchIAConv(id) {
                activeIAConvId = id;
                renderChat();
                renderIAHistory();
            }

            function newIAConv() {
                var convId = 'conv_' + Date.now();
                iaConversations.push({ id: convId, title: 'Nova conversa', messages: [], createdAt: Date.now() });
                activeIAConvId = convId;
                saveIAConversations();
                renderChat();
                renderIAHistory();
            }

            function deleteIAConv(id) {
                if (iaConversations.length <= 1) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> Mantenha ao menos uma conversa');
                    return;
                }
                iaConversations = iaConversations.filter(function (c) { return c.id !== id; });
                if (activeIAConvId === id) {
                    activeIAConvId = iaConversations[0].id;
                }
                saveIAConversations();
                renderChat();
                renderIAHistory();
            }

            // =====================================================================
            //  WEB SEARCH & LINK READING
            // =====================================================================

            function extractURLs(text) {
                var urls = [];
                var regex = /(https?:\/\/[^\s<]+)/g;
                var match;
                while ((match = regex.exec(text)) !== null) {
                    urls.push(match[1]);
                }
                return urls;
            }

            function fetchWithTimeout(url, ms) {
                var controller = new AbortController();
                var timeout = setTimeout(function () { controller.abort(); }, ms);
                return fetch(url, { signal: controller.signal }).then(function (r) {
                    clearTimeout(timeout);
                    return r;
                }).catch(function (e) {
                    clearTimeout(timeout);
                    throw e;
                });
            }

            async function fetchURLContent(url) {
                try {
                    var readerUrl = 'https://r.jina.ai/' + encodeURI(url);
                    var res = await fetchWithTimeout(readerUrl, 12000);
                    if (!res.ok) return null;
                    var text = await res.text();
                    return text.slice(0, 15000);
                } catch (e) {
                    return null;
                }
            }

            async function searchWeb(query) {
                var results = [];

                // Try DuckDuckGo Instant Answer API
                try {
                    var ddgUrl = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1';
                    var res = await fetchWithTimeout(ddgUrl, 10000);
                    if (res.ok) {
                        var data = await res.json();
                        if (data.AbstractText) results.push('Resumo: ' + data.AbstractText);
                        if (data.AbstractURL) results.push('Fonte: ' + data.AbstractURL);
                        if (data.RelatedTopics && data.RelatedTopics.length) {
                            data.RelatedTopics.slice(0, 5).forEach(function (topic) {
                                if (typeof topic === 'object' && topic.Text) results.push('- ' + topic.Text);
                                if (topic.Topics) {
                                    topic.Topics.slice(0, 3).forEach(function (sub) {
                                        if (sub.Text) results.push('- ' + sub.Text);
                                    });
                                }
                            });
                        }
                        if (data.Results && data.Results.length) {
                            data.Results.slice(0, 3).forEach(function (r) {
                                if (r.Text) results.push('- ' + r.Text);
                            });
                        }
                    }
                } catch (e) { }

                // If DDG returned nothing, try a web search via a public API
                if (results.length < 3) {
                    try {
                        var searchUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&format=json&origin=*&srlimit=5';
                        var wikiRes = await fetchWithTimeout(searchUrl, 8000);
                        if (wikiRes.ok) {
                            var wikiData = await wikiRes.json();
                            if (wikiData.query && wikiData.query.search && wikiData.query.search.length) {
                                results.push('--- Resultados da Wikipedia ---');
                                wikiData.query.search.slice(0, 5).forEach(function (r) {
                                    var snippet = r.snippet.replace(/<\/?[^>]+(>|$)/g, '');
                                    results.push('- ' + r.title + ': ' + snippet.slice(0, 200));
                                });
                            }
                        }
                    } catch (e) { }
                }

                return results.length ? results.join('\n') : null;
            }

            function wantsWebSearch(text) {
                var keywords = ['pesquisa', 'google', 'buscar', 'procure', 'pesquise', 'pesquisar', 'atual', 'notícia', 'novidade', 'último', 'na internet', 'online', 'site', 'url', 'http', 'o que', 'como está', 'últimas', 'noticias', '2025', '2026', 'tendência', 'mercado', 'concorrente', 'lançamento'];
                var lower = text.toLowerCase();
                return keywords.some(function (k) { return lower.indexOf(k) !== -1; }) || extractURLs(text).length > 0;
            }

            async function fetchWebAndLinks(text) {
                var parts = [];
                var doWebSearch = wantsWebSearch(text);
                var doVisual = wantsVisualAnalysis(text);

                // Fetch URLs if present
                var urls = extractURLs(text);
                for (var i = 0; i < urls.length; i++) {
                    var content = await fetchURLContent(urls[i]);
                    if (content) {
                        parts.push('=== CONTEÚDO DO LINK: ' + urls[i] + ' ===\n' + content);
                    }

                    // Take screenshot for visual analysis
                    if (doVisual) {
                        var visionResult = await analyzeSiteVisual(urls[i], text);
                        if (visionResult) {
                            parts.push('=== ANÁLISE VISUAL DO SITE: ' + urls[i] + ' ===\n' + visionResult);
                        }
                    }
                }

                // Web search only if message seems to ask for it
                if (doWebSearch) {
                    var searchResult = await searchWeb(text);
                    if (searchResult) {
                        parts.push('=== RESULTADOS DA PESQUISA WEB ===\n' + searchResult);
                    }
                }

                return parts.length ? parts.join('\n\n') : '';
            }

            // =====================================================================
            //  VISUAL ANALYSIS (screenshot + vision AI)
            // =====================================================================

            function wantsVisualAnalysis(text) {
                var keywords = ['analisa', 'visual', 'ver', 'olhar', 'design', 'layout', 'aparência', 'tela', 'interface', 'como é', 'como está', 'mostra', 'print', 'captura de tela', 'screenshot'];
                var lower = text.toLowerCase();
                return keywords.some(function (k) { return lower.indexOf(k) !== -1; }) && extractURLs(text).length > 0;
            }

            async function takeScreenshot(url) {
                try {
                    var iframe = document.createElement('iframe');
                    iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1280px;height:720px;border:none';
                    document.body.appendChild(iframe);
                    iframe.src = url;
                    await new Promise(function (resolve, reject) {
                        var timeout = setTimeout(function () { reject(new Error('timeout')); }, 8000);
                        iframe.onload = function () { clearTimeout(timeout); setTimeout(resolve, 3000); };
                        iframe.onerror = reject;
                    });
                    var canvas = await html2canvas(iframe.contentDocument.body, {
                        useCORS: true, allowTaint: false, width: 1280, height: 720,
                        scale: 1, logging: false
                    });
                    document.body.removeChild(iframe);
                    return canvas.toDataURL('image/jpeg', 0.8);
                } catch (e) {
                    try { if (iframe && iframe.parentNode) document.body.removeChild(iframe); } catch (ex) { }
                    return null;
                }
            }

            async function analyzeSiteVisual(siteUrl, userText) {
                var screenshotUrl = await takeScreenshot(siteUrl);
                if (!screenshotUrl) return null;

                var apiKey = localStorage.getItem('veltris_api_key') || '';
                if (!apiKey) return null;

                var siteName = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
                var systemPrompt = 'Você é um especialista em design, UX e marketing digital. Analise a aparência visual do site ' + siteName + ' (' + siteUrl + ') na imagem fornecida. Descreva especificamente: layout, cores, tipografia, espaçamento, CTAs, qualidade visual percebida. Sugira melhorias objetivas e ÚNICAS para este site. Seja direto e técnico, mencionando o nome do site.';
                var userPrompt = userText || 'Analise visualmente o site ' + siteName + ':';

                try {
                    var res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + apiKey,
                        },
                        body: JSON.stringify({
                            model: 'google/gemma-4-31b-it:free',
                            messages: [
                                { role: 'system', content: systemPrompt },
                                {
                                    role: 'user', content: [
                                        { type: 'text', text: userPrompt },
                                        { type: 'image_url', image_url: { url: screenshotUrl } }
                                    ]
                                }
                            ],
                            max_tokens: 2000,
                        })
                    });
                    if (!res.ok) return null;
                    var data = await res.json();
                    var reply = data?.choices?.[0]?.message?.content || data?.content || null;
                    if (reply) reply = stripMarkdown(reply);
                    return reply;
                } catch (e) {
                    return null;
                }
            }

            async function sendChat() {
                var input = document.getElementById('chatInput');
                var text = input.value.trim();
                if (!text) return;

                if (!api || !api.isLoggedIn()) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> Faça login para usar o chat');
                    return;
                }

                var conv = getActiveIAConv();
                if (!conv) return;

                // Add user message
                conv.messages.push({ role: 'user', content: text, time: Date.now() });
                input.value = '';
                input.style.height = '';
                saveIAConversations();
                renderChat();

                // Show typing
                showTyping();
                document.getElementById('chatSendBtn').disabled = true;

                // Search relevant documents and web
                var docContext = '';
                try {
                    var docs = await api.searchDocuments(text, null);
                    if (docs && docs.length) {
                        docContext = '=== DOCUMENTOS DA EMPRESA ===\n' +
                            docs.map(function (d) { return '--- ' + d.title + ' ---\n' + (d.content_text ? d.content_text.slice(0, 1000) : ''); }).join('\n\n');
                    }
                } catch { }

                // Fetch web content and search results
                var webContext = '';
                if (wantsWebSearch(text) || extractURLs(text).length > 0) {
                    showToast('<i class="fi fi-rr-search"></i> Pesquisando na internet...');
                    try {
                        var webData = await fetchWebAndLinks(text);
                        if (webData) webContext = webData;
                    } catch { }
                }

                // Build system context from all platform data
                var kb = loadKnowledgeBase();
                var itemsContext = items.map(function (i) {
                    return '- ' + i.label + ' [' + i.cat + '] ' + (i.done ? '<i class="fi fi-rr-check-circle"></i>' : '⬜') + ' (score:' + i.score + ', prazo:' + i.prazo + ')';
                }).join('\n');

                var kanbanContext = kanbanData.map(function (col) {
                    var cards = col.cards.map(function (c) { return '  - ' + c.title + (c.desc ? ': ' + c.desc.slice(0, 60) : '') + (c.comments && c.comments.length ? ' (' + c.comments.length + ' comentários)' : ''); }).join('\n');
                    return col.title + ' (' + col.cards.length + ' cards):\n' + cards;
                }).join('\n\n');

                var finMetrics = 'Conclusão (prioridade): ' + calcImpactoFinanceiro() + '% | ' +
                    'Velocidade: ' + calcVelocidadeFinanceira() + '% | ' +
                    'Score: ' + scoreLabel(calcScoreGeral()).replace(/<[^>]*>?/gm, '') + ' (' + calcScoreGeral() + '/100) | ' +
                    'Concluído: ' + overallPct() + '%';

                var systemPrompt = 'Você é um CEO/CMO/COO consultor sênior da empresa Veltris. ' +
                    'Você tem acesso TOTAL a todos os dados da plataforma. Seu papel é: ' +
                    '1) Responder perguntas sobre estratégia, marketing, vendas, finanças e operações. ' +
                    '2) Sugerir conteúdos, ações e melhorias baseadas nos dados reais. ' +
                    '3) Analisar documentos e extrair insights. ' +
                    '4) Ser objetivo, prático e dar recomendações acionáveis. ' +
                    'Seja direto, profissional e use linguagem executiva. ' +
                    'Responda SEMPRE em português brasileiro. ' +
                    'IMPORTANTE: Proibido usar qualquer caractere especial de formatação. Nada de asteriscos, hashtags, underscores, barras invertidas, ou qualquer símbolo de markdown. Use APENAS texto puro sem formatação. Para listar tarefas ou sugestões, use APENAS um hífen simples no início de cada linha, sem números ou outros símbolos. Exemplo correto: "- Criar funil de vendas" em vez de "**1. Criar funil de vendas**". Não use negrito, itálico, títulos, bullet points com *, numeração, ou qualquer recurso visual. Somente letras, números e pontuação básica. IMPORTANTE: Cada item da lista deve estar em uma linha separada. Use uma quebra de linha real (pressionar Enter) entre cada item. NUNCA junte múltiplos itens na mesma linha. VOCÊ TEM ACESSO À INTERNET: Quando o usuário perguntar sobre informações atuais, notícias, ou enviar links, você receberá o conteúdo pesquisado ou do link nos dados de contexto nas seções "RESULTADOS DA PESQUISA WEB" ou "CONTEÚDO DO LINK". Use essas informações para responder. Se os dados de pesquisa não forem suficientes, indique que não encontrou informações atualizadas.';

                var contextData = [
                    '=== BASE DE CONHECIMENTO DA EMPRESA ===',
                    kb || '(nenhuma informação cadastrada)',
                    '',
                    '=== CHECKLIST (Itens de Gestão) ===',
                    itemsContext || '(nenhum item)',
                    '',
                    '=== ESTEIRA DE CONTEÚDO (Kanban) ===',
                    kanbanContext || '(nenhum card)',
                    '',
                    '=== MÉTRICAS FINANCEIRAS ===',
                    finMetrics,
                    '',
                    docContext || '',
                    webContext || '',
                ].join('\n');

                var result = await callOpenRouter([
                    { role: 'system', content: systemPrompt + '\n\n' + contextData },
                    { role: 'user', content: text }
                ], { maxTokens: 3000, temperature: 0.7 });

                hideTyping();
                document.getElementById('chatSendBtn').disabled = false;

                var reply = result || 'Desculpe, não consegui processar sua pergunta agora. Verifique a chave de API e tente novamente.';
                reply = stripMarkdown(reply);

                conv.messages.push({ role: 'ai', content: reply, time: Date.now() });
                // Update title from first message if still default
                if (conv.title === 'Nova conversa' && conv.messages.length >= 2) {
                    var firstMsg = conv.messages[0].content;
                    conv.title = firstMsg.length > 35 ? firstMsg.slice(0, 35) + '...' : firstMsg;
                }
                saveIAConversations();
                renderChat();
                renderIAHistory();
            }

            var _kbCache = null;

            function loadKnowledgeBase() {
                if (_kbCache !== null) return _kbCache;
                try { return localStorage.getItem('veltris_kb') || ''; } catch { return ''; }
            }

            function reloadKnowledgeBase(cb) {
                if (!api.isLoggedIn()) { if (cb) cb(); return; }
                api.listDocuments().then(function (docs) {
                    var kbDoc = (docs || []).find(function (d) { return d.title === '__knowledge_base__'; });
                    _kbCache = kbDoc ? (kbDoc.content_text || '') : '';
                    if (cb) cb();
                }).catch(function () { if (cb) cb(); });
            }

            function saveKnowledgeBase() {
                var text = document.getElementById('kbText').value;
                _kbCache = text;
                try { localStorage.setItem('veltris_kb', text); } catch { }
                if (api.isLoggedIn()) {
                    api.listDocuments().then(function (docs) {
                        var kbDoc = (docs || []).find(function (d) { return d.title === '__knowledge_base__'; });
                        if (kbDoc) {
                            api.updateDocument(kbDoc.id, { content_text: text });
                        } else {
                            // Create a minimal document entry via the edge function
                            var blob = new Blob([text], { type: 'text/plain' });
                            var file = new File([blob], 'knowledge_base.txt');
                            api.uploadDocument(file, '__knowledge_base__', null, 'colaborador').catch(function () { });
                        }
                    });
                }
                var status = document.getElementById('kbStatus');
                status.className = 'kb-status ok';
                status.textContent = '<i class="fi fi-rr-check-circle"></i> Base salva! IA usará esse contexto.';
                status.style.display = 'block';
                setTimeout(function () { status.style.display = 'none'; }, 3000);
                showToast('📚 Base de conhecimento salva');
            }

            function kbPreset(type) {
                var presets = {
                    empresa: '<i class="fi fi-rr-building"></i> Veltris — Agência de Marketing, Vendas e Tecnologia\n- Missão: Transformar negócios com estratégia digital\n- Visão: Ser referência em growth para médias empresas\n- Valores: Dados > Opinião, Entrega > Promessa, Pessoas > Processos',
                    produtos: '📦 Produtos e Serviços Veltris:\n- Consultoria de Growth Marketing\n- Gestão de Tráfego Pago (Google, Meta, TikTok)\n- Desenvolvimento Web (Sites, Landing Pages, Portfólios)\n- Automação de Marketing e CRM\n- Consultoria de Vendas B2B',
                    metas: '🎯 Metas do Trimestre:\n- Faturamento: R$ 50k/mês\n- Novos clientes: 5/mês\n- Taxa de conversão: >15%\n- NPS: >80\n- Concluir 100% do checklist de gestão',
                    publico: '👥 Público-Alvo:\n- Empresas de médio porte (10-100 funcionários)\n- Segmentos: Imobiliário, Advocacia, Saúde, Educação\n- Decisores: CEO, CMO, Head de Marketing\n- Dores: Baixa geração de leads, processos manuais, falta de dados'
                };
                var kbText = document.getElementById('kbText');
                var current = kbText.value.trim();
                kbText.value = current ? current + '\n\n' + presets[type] : presets[type];
            }

            function clearChat() {
                if (!confirm('Limpar todas as mensagens desta conversa?')) return;
                var conv = getActiveIAConv();
                if (conv) {
                    conv.messages = [];
                    saveIAConversations();
                    renderChat();
                }
            }

            // =====================================================================
            //  SETTINGS / API KEY
            // =====================================================================

            function loadSettings() {
                // Show user info
                var info = document.getElementById('settingsUserInfo');
                if (api.isLoggedIn()) {
                    var u = api.getUser();
                    info.innerHTML = '<i class="fi fi-rr-user"></i> <strong>' + escapeHtml(u.name) + '</strong> &mdash; ' + escapeHtml(u.role);
                } else {
                    info.textContent = '—';
                }
                // Admin area visibility
                var isAdmin = api.isLoggedIn() && api.isAdmin();
                document.getElementById('adminSettingsArea').style.display = isAdmin ? '' : 'none';
                document.getElementById('nonAdminButtons').style.display = isAdmin ? 'none' : '';
                var docAdmin = document.getElementById('docAdminContent');
                var docNonAdmin = document.getElementById('docNonAdminMsg');
                if (docAdmin && docNonAdmin) {
                    docAdmin.style.display = isAdmin ? '' : 'none';
                    docNonAdmin.style.display = isAdmin ? 'none' : '';
                }
                // Load system settings (saves API key to localStorage for chat use)
                api.fetchSettings().then(function (s) {
                    if (s) {
                        if (s.openrouter_api_key) {
                            localStorage.setItem('veltris_api_key', s.openrouter_api_key);
                        }
                        if (s.openrouter_model) {
                            localStorage.setItem('veltris_model', s.openrouter_model);
                        }
                        if (s.meta_access_token) localStorage.setItem('veltris_meta_token', s.meta_access_token);
                        if (s.meta_ad_account) localStorage.setItem('veltris_meta_ad_account', s.meta_ad_account);
                        if (s.google_dev_token) localStorage.setItem('veltris_google_dev_token', s.google_dev_token);
                        if (s.google_client_id) localStorage.setItem('veltris_google_client_id', s.google_client_id);
                        if (s.google_client_secret) localStorage.setItem('veltris_google_client_secret', s.google_client_secret);
                        if (s.google_refresh_token) localStorage.setItem('veltris_google_refresh_token', s.google_refresh_token);
                        if (s.google_customer_id) localStorage.setItem('veltris_google_customer_id', s.google_customer_id);
                        if (s.google_pagespeed_key) localStorage.setItem('veltris_google_pagespeed_key', s.google_pagespeed_key);
                        if (isAdmin) {
                            document.getElementById('apiKeyInput').value = s.openrouter_api_key || '';
                            document.getElementById('modelSelect').value = s.openrouter_model || 'google/gemma-4-31b-it:free';
                            document.getElementById('metaTokenInput').value = s.meta_access_token || '';
                            document.getElementById('metaAdAccountInput').value = s.meta_ad_account || '';
                            document.getElementById('googleDevTokenInput').value = s.google_dev_token || '';
                            document.getElementById('googleClientIdInput').value = s.google_client_id || '';
                            document.getElementById('googleClientSecretInput').value = s.google_client_secret || '';
                            document.getElementById('googleRefreshTokenInput').value = s.google_refresh_token || '';
                            document.getElementById('googleCustomerIdInput').value = s.google_customer_id || '';
                            document.getElementById('googlePagespeedKeyInput').value = s.google_pagespeed_key || '';
                        }
                    }
                }).catch(function () {
                    if (isAdmin) {
                        var localKey = localStorage.getItem('veltris_api_key');
                        if (localKey) document.getElementById('apiKeyInput').value = localKey;
                    }
                });
            }

            function saveSettings() {
                var key = document.getElementById('apiKeyInput').value.trim();
                var model = document.getElementById('modelSelect').value;
                var metaToken = document.getElementById('metaTokenInput').value.trim();
                var metaAdAccount = document.getElementById('metaAdAccountInput').value.trim();
                var googleDevToken = document.getElementById('googleDevTokenInput').value.trim();
                var googleClientId = document.getElementById('googleClientIdInput').value.trim();
                var googleClientSecret = document.getElementById('googleClientSecretInput').value.trim();
                var googleRefreshToken = document.getElementById('googleRefreshTokenInput').value.trim();
                var googleCustomerId = document.getElementById('googleCustomerIdInput').value.trim();
                var googlePagespeedKey = document.getElementById('googlePagespeedKeyInput').value.trim();
                localStorage.setItem('veltris_api_key', key);
                localStorage.setItem('veltris_meta_token', metaToken);
                localStorage.setItem('veltris_meta_ad_account', metaAdAccount);
                localStorage.setItem('veltris_google_dev_token', googleDevToken);
                localStorage.setItem('veltris_google_client_id', googleClientId);
                localStorage.setItem('veltris_google_client_secret', googleClientSecret);
                localStorage.setItem('veltris_google_refresh_token', googleRefreshToken);
                localStorage.setItem('veltris_google_customer_id', googleCustomerId);
                localStorage.setItem('veltris_google_pagespeed_key', googlePagespeedKey);
                api.saveSettings({
                    openrouter_api_key: key,
                    openrouter_model: model,
                    meta_access_token: metaToken,
                    meta_ad_account: metaAdAccount,
                    google_dev_token: googleDevToken,
                    google_client_id: googleClientId,
                    google_client_secret: googleClientSecret,
                    google_refresh_token: googleRefreshToken,
                    google_customer_id: googleCustomerId,
                    google_pagespeed_key: googlePagespeedKey
                }).then(function (r) {
                    var status = document.getElementById('apiStatus');
                    if (r && r.success) {
                        status.className = 'settings-status ok';
                        status.textContent = '<i class="fi fi-rr-check-circle"></i> Configurações globais salvas!';
                    } else {
                        status.className = 'settings-status err';
                        status.textContent = '<i class="fi fi-rr-triangle-warning"></i> Erro ao salvar: ' + ((r && r.error) || 'desconhecido');
                    }
                    setTimeout(function () { status.className = 'settings-status'; }, 3000);
                }).catch(function (e) {
                    var status = document.getElementById('apiStatus');
                    status.className = 'settings-status err';
                    status.textContent = '<i class="fi fi-rr-triangle-warning"></i> ' + e.message;
                    setTimeout(function () { status.className = 'settings-status'; }, 3000);
                });
            }

            function openSettings() { document.getElementById('settingsOverlay').classList.add('visible'); loadSettings(); }
            function closeSettings() { document.getElementById('settingsOverlay').classList.remove('visible'); }
            function toggleCollapsible(id) {
                var body = document.getElementById(id);
                var arrow = document.getElementById(id.replace('Body', 'Arrow'));
                if (!body) return;
                var isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : '';
                if (arrow) arrow.classList.toggle('open', !isOpen);
            }
            function escapeHtml(t) { if (!t) return ''; return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

            // =====================================================================
            //  SECTOR DROPDOWN (multi-select)
            // =====================================================================

            var SECTORS = ['vendas', 'marketing', 'financeiro', 'produto', 'operacional', 'rh'];
            var sectorOpen = false;

            function initSectorDropdown() {
                var drop = document.getElementById('sectorDrop');
                drop.innerHTML = SECTORS.map(function (s) {
                    return '<div class="cs-opt" data-value="' + s + '" onclick="toggleSector(\'' + s + '\')">' +
                        '<span class="sector-ck" style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid var(--border);margin-right:8px;vertical-align:middle;text-align:center;line-height:14px;font-size:10px;transition:0.15s"></span>' +
                        s + '</div>';
                }).join('');
            }

            function toggleSectorDropdown() {
                sectorOpen ? closeSectorDropdown() : openSectorDropdown();
            }
            function openSectorDropdown() {
                sectorOpen = true;
                document.getElementById('sectorDrop').classList.add('visible');
                document.getElementById('sectorTrigger').classList.add('open');
                document.getElementById('sectorArrow').classList.add('open');
            }
            function closeSectorDropdown() {
                sectorOpen = false;
                document.getElementById('sectorDrop').classList.remove('visible');
                document.getElementById('sectorTrigger').classList.remove('open');
                document.getElementById('sectorArrow').classList.remove('open');
            }
            function toggleSector(value) {
                var opt = document.querySelector('#sectorDrop .cs-opt[data-value="' + value + '"]');
                if (!opt) return;
                opt.classList.toggle('selected');
                var ck = opt.querySelector('.sector-ck');
                if (opt.classList.contains('selected')) {
                    ck.textContent = '✓';
                    ck.style.background = 'var(--accent)';
                    ck.style.borderColor = 'var(--accent)';
                    ck.style.color = '#fff';
                } else {
                    ck.textContent = '';
                    ck.style.background = 'transparent';
                    ck.style.borderColor = 'var(--border)';
                }
                updateSectorTrigger();
            }
            function updateSectorTrigger() {
                var sel = document.querySelectorAll('#sectorDrop .cs-opt.selected');
                var names = Array.from(sel).map(function (o) { return o.dataset.value; });
                var text = names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? '...' : '') : 'Selecionar...';
                document.getElementById('sectorSelected').textContent = text;
                document.getElementById('sectorSelected').style.color = names.length ? '#fff' : 'var(--text-dim)';
            }
            function getSectorValues() {
                return Array.from(document.querySelectorAll('#sectorDrop .cs-opt.selected')).map(function (o) { return o.dataset.value; });
            }
            function clearSectors() {
                document.querySelectorAll('#sectorDrop .cs-opt.selected').forEach(function (o) {
                    o.classList.remove('selected');
                    var ck = o.querySelector('.sector-ck');
                    if (ck) { ck.textContent = ''; ck.style.background = 'transparent'; ck.style.borderColor = 'var(--border)'; }
                });
                updateSectorTrigger();
            }
            function setSectors(values) {
                clearSectors();
                (values || []).forEach(function (v) {
                    var opt = document.querySelector('#sectorDrop .cs-opt[data-value="' + v + '"]');
                    if (opt) {
                        opt.classList.add('selected');
                        var ck = opt.querySelector('.sector-ck');
                        if (ck) { ck.textContent = '✓'; ck.style.background = 'var(--accent)'; ck.style.borderColor = 'var(--accent)'; ck.style.color = '#fff'; }
                    }
                });
                updateSectorTrigger();
            }
            // Close sector dropdown on outside click
            document.addEventListener('click', function (e) {
                var wrap = document.getElementById('sectorTrigger');
                if (sectorOpen && wrap && !wrap.closest('.cs-wrap').contains(e.target)) closeSectorDropdown();
            });

            // =====================================================================
            //  ROLE DROPDOWN (single-select)
            // =====================================================================

            var ROLES = [
                { value: 'colaborador', label: 'Colaborador' },
                { value: 'gestor', label: 'Gestor' },
                { value: 'admin', label: 'Admin' },
            ];
            var roleOpen = false;

            function getRoleValue() {
                var sel = document.querySelector('#roleDrop .cs-opt.selected');
                return sel ? sel.dataset.value : 'colaborador';
            }
            function setRoleValue(value) {
                document.querySelectorAll('#roleDrop .cs-opt').forEach(function (o) { o.classList.remove('selected'); });
                var opt = document.querySelector('#roleDrop .cs-opt[data-value="' + value + '"]');
                if (opt) {
                    opt.classList.add('selected');
                    document.getElementById('roleSelected').textContent = opt.textContent;
                }
            }

            function initRoleDropdown() {
                var drop = document.getElementById('roleDrop');
                drop.innerHTML = ROLES.map(function (r) {
                    return '<div class="cs-opt" data-value="' + r.value + '" onclick="selectRole(\'' + r.value + '\')">' + r.label + '</div>';
                }).join('');
                var current = document.getElementById('roleSelected').textContent;
                var found = ROLES.find(function (r) { return r.label === current || r.value === current; });
                if (found) setRoleValue(found.value);
                else setRoleValue('colaborador');
            }

            function toggleRoleDropdown() {
                roleOpen ? closeRoleDropdown() : openRoleDropdown();
            }
            function openRoleDropdown() {
                roleOpen = true;
                document.getElementById('roleDrop').classList.add('visible');
                document.getElementById('roleTrigger').classList.add('open');
                document.getElementById('roleArrow').classList.add('open');
            }
            function closeRoleDropdown() {
                roleOpen = false;
                document.getElementById('roleDrop').classList.remove('visible');
                document.getElementById('roleTrigger').classList.remove('open');
                document.getElementById('roleArrow').classList.remove('open');
            }
            function selectRole(value) {
                setRoleValue(value);
                closeRoleDropdown();
            }
            // Close role dropdown on outside click
            document.addEventListener('click', function (e) {
                var wrap = document.getElementById('roleTrigger');
                if (roleOpen && wrap && !wrap.closest('.cs-wrap').contains(e.target)) closeRoleDropdown();
            });

            // ── Doc Min Role Dropdown ──
            var DOC_MIN_ROLES = [
                { value: 'colaborador', label: '<i class="fi fi-rr-user"></i> Todos (Colaborador+)' },
                { value: 'gestor', label: '🔶 Gestor+' },
                { value: 'admin', label: '🔴 Apenas Admin' },
            ];
            var docMinRoleOpen = false;
            var editDocMinRoleOpen = false;

            function getDocMinRoleValue() {
                var sel = document.querySelector('#docMinRoleDrop .cs-opt.selected');
                return sel ? sel.dataset.value : 'colaborador';
            }
            function setDocMinRoleValue(value) {
                document.querySelectorAll('#docMinRoleDrop .cs-opt').forEach(function (o) { o.classList.remove('selected'); });
                var opt = document.querySelector('#docMinRoleDrop .cs-opt[data-value="' + value + '"]');
                if (opt) {
                    opt.classList.add('selected');
                    document.getElementById('docMinRoleSelected').textContent = opt.textContent;
                }
            }
            function initDocMinRoleDropdown() {
                var drop = document.getElementById('docMinRoleDrop');
                if (drop.children.length) return;
                drop.innerHTML = DOC_MIN_ROLES.map(function (r) {
                    return '<div class="cs-opt" data-value="' + r.value + '" onclick="selectDocMinRole(\'' + r.value + '\')">' + r.label + '</div>';
                }).join('');
                setDocMinRoleValue('colaborador');
            }
            function toggleDocMinRoleDropdown() {
                docMinRoleOpen ? closeDocMinRoleDropdown() : openDocMinRoleDropdown();
            }
            function openDocMinRoleDropdown() {
                initDocMinRoleDropdown();
                docMinRoleOpen = true;
                document.getElementById('docMinRoleDrop').classList.add('visible');
                document.getElementById('docMinRoleTrigger').classList.add('open');
                document.getElementById('docMinRoleArrow').classList.add('open');
            }
            function closeDocMinRoleDropdown() {
                docMinRoleOpen = false;
                document.getElementById('docMinRoleDrop').classList.remove('visible');
                document.getElementById('docMinRoleTrigger').classList.remove('open');
                document.getElementById('docMinRoleArrow').classList.remove('open');
            }
            function selectDocMinRole(value) {
                setDocMinRoleValue(value);
                closeDocMinRoleDropdown();
            }

            function getEditDocMinRoleValue() {
                var sel = document.querySelector('#editDocMinRoleDrop .cs-opt.selected');
                return sel ? sel.dataset.value : 'colaborador';
            }
            function setEditDocMinRoleValue(value) {
                document.querySelectorAll('#editDocMinRoleDrop .cs-opt').forEach(function (o) { o.classList.remove('selected'); });
                var opt = document.querySelector('#editDocMinRoleDrop .cs-opt[data-value="' + value + '"]');
                if (opt) {
                    opt.classList.add('selected');
                    document.getElementById('editDocMinRoleSelected').textContent = opt.textContent;
                }
            }
            function initEditDocMinRoleDropdown() {
                var drop = document.getElementById('editDocMinRoleDrop');
                if (drop.children.length) return;
                drop.innerHTML = DOC_MIN_ROLES.map(function (r) {
                    return '<div class="cs-opt" data-value="' + r.value + '" onclick="selectEditDocMinRole(\'' + r.value + '\')">' + r.label + '</div>';
                }).join('');
                setEditDocMinRoleValue('colaborador');
            }
            function toggleEditDocMinRoleDropdown() {
                editDocMinRoleOpen ? closeEditDocMinRoleDropdown() : openEditDocMinRoleDropdown();
            }
            function openEditDocMinRoleDropdown() {
                initEditDocMinRoleDropdown();
                editDocMinRoleOpen = true;
                document.getElementById('editDocMinRoleDrop').classList.add('visible');
                document.getElementById('editDocMinRoleTrigger').classList.add('open');
                document.getElementById('editDocMinRoleArrow').classList.add('open');
            }
            function closeEditDocMinRoleDropdown() {
                editDocMinRoleOpen = false;
                document.getElementById('editDocMinRoleDrop').classList.remove('visible');
                document.getElementById('editDocMinRoleTrigger').classList.remove('open');
                document.getElementById('editDocMinRoleArrow').classList.remove('open');
            }
            function selectEditDocMinRole(value) {
                setEditDocMinRoleValue(value);
                closeEditDocMinRoleDropdown();
            }

            // ── Doc Sector Dropdown ──
            var DOC_SECTORS = [
                { value: '', label: 'Geral' },
                { value: 'vendas', label: 'Vendas' },
                { value: 'marketing', label: 'Marketing' },
                { value: 'financeiro', label: 'Financeiro' },
                { value: 'produto', label: 'Produto' },
                { value: 'operacional', label: 'Operacional' },
                { value: 'rh', label: 'RH' },
            ];
            var docSectorOpen = false;
            var editDocSectorOpen = false;

            function getDocSectorValue() {
                var sel = document.querySelector('#docSectorDrop .cs-opt.selected');
                return sel ? sel.dataset.value : '';
            }
            function setDocSectorValue(value) {
                document.querySelectorAll('#docSectorDrop .cs-opt').forEach(function (o) { o.classList.remove('selected'); });
                var opt = document.querySelector('#docSectorDrop .cs-opt[data-value="' + value + '"]');
                if (opt) {
                    opt.classList.add('selected');
                    document.getElementById('docSectorSelected').textContent = opt.textContent;
                } else {
                    document.getElementById('docSectorSelected').textContent = 'Geral';
                }
            }
            function initDocSectorDropdown() {
                var drop = document.getElementById('docSectorDrop');
                if (drop.children.length) return;
                drop.innerHTML = DOC_SECTORS.map(function (s) {
                    return '<div class="cs-opt" data-value="' + s.value + '" onclick="selectDocSector(\'' + s.value + '\')">' + s.label + '</div>';
                }).join('');
                setDocSectorValue('');
            }
            function toggleDocSectorDropdown() {
                docSectorOpen ? closeDocSectorDropdown() : openDocSectorDropdown();
            }
            function openDocSectorDropdown() {
                initDocSectorDropdown();
                docSectorOpen = true;
                document.getElementById('docSectorDrop').classList.add('visible');
                document.getElementById('docSectorTrigger').classList.add('open');
                document.getElementById('docSectorArrow').classList.add('open');
            }
            function closeDocSectorDropdown() {
                docSectorOpen = false;
                document.getElementById('docSectorDrop').classList.remove('visible');
                document.getElementById('docSectorTrigger').classList.remove('open');
                document.getElementById('docSectorArrow').classList.remove('open');
            }
            function selectDocSector(value) {
                setDocSectorValue(value);
                closeDocSectorDropdown();
            }

            function getEditDocSectorValue() {
                var sel = document.querySelector('#editDocSectorDrop .cs-opt.selected');
                return sel ? sel.dataset.value : '';
            }
            function setEditDocSectorValue(value) {
                document.querySelectorAll('#editDocSectorDrop .cs-opt').forEach(function (o) { o.classList.remove('selected'); });
                var opt = document.querySelector('#editDocSectorDrop .cs-opt[data-value="' + value + '"]');
                if (opt) {
                    opt.classList.add('selected');
                    document.getElementById('editDocSectorSelected').textContent = opt.textContent;
                } else {
                    document.getElementById('editDocSectorSelected').textContent = 'Geral';
                }
            }
            function initEditDocSectorDropdown() {
                var drop = document.getElementById('editDocSectorDrop');
                if (drop.children.length) return;
                drop.innerHTML = DOC_SECTORS.map(function (s) {
                    return '<div class="cs-opt" data-value="' + s.value + '" onclick="selectEditDocSector(\'' + s.value + '\')">' + s.label + '</div>';
                }).join('');
                setEditDocSectorValue('');
            }
            function toggleEditDocSectorDropdown() {
                editDocSectorOpen ? closeEditDocSectorDropdown() : openEditDocSectorDropdown();
            }
            function openEditDocSectorDropdown() {
                initEditDocSectorDropdown();
                editDocSectorOpen = true;
                document.getElementById('editDocSectorDrop').classList.add('visible');
                document.getElementById('editDocSectorTrigger').classList.add('open');
                document.getElementById('editDocSectorArrow').classList.add('open');
            }
            function closeEditDocSectorDropdown() {
                editDocSectorOpen = false;
                document.getElementById('editDocSectorDrop').classList.remove('visible');
                document.getElementById('editDocSectorTrigger').classList.remove('open');
                document.getElementById('editDocSectorArrow').classList.remove('open');
            }
            function selectEditDocSector(value) {
                setEditDocSectorValue(value);
                closeEditDocSectorDropdown();
            }

            // Close dropdowns on outside click
            document.addEventListener('click', function (e) {
                var wrap1 = document.getElementById('docMinRoleTrigger');
                if (docMinRoleOpen && wrap1 && !wrap1.closest('.settings-field').contains(e.target)) closeDocMinRoleDropdown();
            });
            document.addEventListener('click', function (e) {
                var wrap2 = document.getElementById('editDocMinRoleTrigger');
                if (editDocMinRoleOpen && wrap2 && !wrap2.closest('.settings-field').contains(e.target)) closeEditDocMinRoleDropdown();
            });
            document.addEventListener('click', function (e) {
                var wrap3 = document.getElementById('docSectorTrigger');
                if (docSectorOpen && wrap3 && !wrap3.closest('.settings-field').contains(e.target)) closeDocSectorDropdown();
            });
            document.addEventListener('click', function (e) {
                var wrap4 = document.getElementById('editDocSectorTrigger');
                if (editDocSectorOpen && wrap4 && !wrap4.closest('.settings-field').contains(e.target)) closeEditDocSectorDropdown();
            });

            // =====================================================================
            //  USER MANAGEMENT
            // =====================================================================

            var editingUserId = null;

            function openUserManager() {
                initSectorDropdown();
                initRoleDropdown();
                editingUserId = null;
                document.getElementById('userSaveBtn').textContent = 'Adicionar';
                document.getElementById('ufName').value = '';
                document.getElementById('ufPass').value = '';
                clearSectors();
                document.getElementById('userStatus').className = 'user-status-msg';
                closeSettings();
                document.getElementById('userManagerOverlay').classList.add('visible');
                loadUsers();
            }

            function closeUserManager() {
                document.getElementById('userManagerOverlay').classList.remove('visible');
            }

            function loadUsers() {
                api.listUsers().then(function (users) {
                    var tbody = document.getElementById('usersTableBody');
                    tbody.innerHTML = '';
                    (users || []).forEach(function (u) {
                        var sectors = u.sectors || [];
                        if (typeof sectors === 'string') { try { sectors = JSON.parse(sectors); } catch (e) { sectors = []; } }
                        var sectorTags = (Array.isArray(sectors) ? sectors : []).map(function (s) { return '<span class="sector-tag">' + escapeHtml(s) + '</span>'; }).join('');
                        var roleClass = u.role || 'colaborador';
                        var roleLabel = { admin: 'Admin', gestor: 'Gestor', colaborador: 'Colaborador' }[roleClass] || roleClass;
                        var row = document.createElement('tr');
                        row.innerHTML = '<td><strong>' + escapeHtml(u.name) + '</strong></td>' +
                            '<td><span class="role-badge ' + roleClass + '">' + roleLabel + '</span></td>' +
                            '<td>' + (sectorTags || '<span style="color:var(--text-muted);font-size:0.7rem">—</span>') + '</td>' +
                            '<td><div class="user-actions">' +
                            '<button onclick="editUser(' + u.id + ')">✏️</button>' +
                            '<button class="btn-del" onclick="deleteUser(' + u.id + ')">🗑️</button>' +
                            '</div></td>';
                        tbody.appendChild(row);
                    });
                }).catch(function (e) {
                    showUserStatus(e.message, 'err');
                });
            }

            function saveUser() {
                var name = document.getElementById('ufName').value.trim();
                var pass = document.getElementById('ufPass').value;
                var role = getRoleValue();
                var sectors = getSectorValues();

                if (!name) { showUserStatus('Digite um nome de usuário', 'err'); return; }

                if (editingUserId) {
                    var prom = api.updateUser(editingUserId, { role: role, sectors: sectors });
                    if (pass) {
                        prom = prom.then(function () { return api.updateUserPassword(editingUserId, pass); });
                    }
                    prom.then(function () {
                        showUserStatus('<i class="fi fi-rr-check-circle"></i> Usuário atualizado!', 'ok');
                        loadUsers();
                        clearUserForm();
                    }).catch(function (e) {
                        showUserStatus('<i class="fi fi-rr-triangle-warning"></i> ' + e.message, 'err');
                    });
                } else {
                    if (!pass) { showUserStatus('Digite uma senha', 'err'); return; }
                    api.createUser(name, pass, role, sectors).then(function () {
                        showUserStatus('<i class="fi fi-rr-check-circle"></i> Usuário criado!', 'ok');
                        loadUsers();
                        clearUserForm();
                    }).catch(function (e) {
                        showUserStatus('<i class="fi fi-rr-triangle-warning"></i> ' + e.message, 'err');
                    });
                }
            }

            function editUser(id) {
                editingUserId = id;
                document.getElementById('userSaveBtn').textContent = 'Salvar';
                api.listUsers().then(function (users) {
                    var user = (users || []).find(function (u) { return u.id === id; });
                    if (!user) return;
                    document.getElementById('ufName').value = user.name;
                    document.getElementById('ufPass').value = '';
                    setRoleValue(user.role || 'colaborador');
                    var sectors = user.sectors || [];
                    if (typeof sectors === 'string') { try { sectors = JSON.parse(sectors); } catch (e) { sectors = []; } }
                    setSectors(Array.isArray(sectors) ? sectors : []);
                    document.getElementById('userManagerOverlay').classList.add('visible');
                    document.getElementById('usersTable').parentElement.scrollTop = 0;
                });
            }

            function deleteUser(id) {
                if (!confirm('Tem certeza que deseja remover este usuário?')) return;
                api.deleteUser(id).then(function () {
                    showUserStatus('<i class="fi fi-rr-check-circle"></i> Usuário removido!', 'ok');
                    loadUsers();
                }).catch(function (e) {
                    showUserStatus('<i class="fi fi-rr-triangle-warning"></i> ' + e.message, 'err');
                });
            }

            function clearUserForm() {
                editingUserId = null;
                document.getElementById('userSaveBtn').textContent = 'Adicionar';
                document.getElementById('ufName').value = '';
                document.getElementById('ufPass').value = '';
                setRoleValue('colaborador');
                clearSectors();
            }

            function showUserStatus(msg, type) {
                var el = document.getElementById('userStatus');
                el.textContent = msg;
                el.className = 'user-status-msg ' + (type || 'ok');
                setTimeout(function () { if (el.textContent === msg) { el.className = 'user-status-msg'; } }, 4000);
            }

            // =====================================================================
            //  TAB SYSTEM
            // =====================================================================

            document.querySelectorAll('.tab').forEach(function (tab) {
                tab.addEventListener('click', function () {
                    closeMobileSidebar();
                    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
                    document.querySelectorAll('.tab-content').forEach(function (tc) { tc.classList.remove('active'); });
                    tab.classList.add('active');
                    if (!tab.dataset.tab) return;
                    var target = document.getElementById('tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1));
                    if (target) target.classList.add('active');
                    if (tab.dataset.tab === 'conteudos') renderKanban();
                    if (tab.dataset.tab === 'ia') { renderChat(); reloadKnowledgeBase(function () { document.getElementById('kbText').value = loadKnowledgeBase(); }); }
                    if (tab.dataset.tab === 'financeiro') renderFinanceCharts();
                    if (tab.dataset.tab === 'crm') {
                        loadRoletaAvailableUsers();
                        loadRoletaData().then(function () {
                            return loadRoletaAssigns();
                        }).then(function () {
                            renderCRM();
                            startCRMPoll();
                            requestNotificationPermission();
                        });
                    } else stopCRMPoll();
                    if (tab.dataset.tab === 'metricas') {
                        initMetricaSourceDropdown();
                        renderMetricas();
                    }
                    if (tab.dataset.tab === 'empresas') {
                        empRender();
                    }
                    if (tab.dataset.tab === 'usuarios') {
                        usrRender();
                    }
                });
            });

            function toggleSidebar() {
                var sb = document.getElementById('sidebar');
                var btn = document.getElementById('sidebarToggle');
                var layout = document.querySelector('.app-layout');
                sb.classList.toggle('closed');
                btn.textContent = sb.classList.contains('closed') ? '▶' : '◀';
                if (layout) {
                    layout.style.paddingLeft = sb.classList.contains('closed') ? '80px' : '280px';
                }
            }

            function mobileToggleSidebar() {
                var sb = document.getElementById('sidebar');
                var bp = document.getElementById('sidebarBackdrop');
                sb.classList.toggle('open');
                bp.classList.toggle('visible');
            }

            function closeMobileSidebar() {
                var sb = document.getElementById('sidebar');
                var bp = document.getElementById('sidebarBackdrop');
                sb.classList.remove('open');
                bp.classList.remove('visible');
            }

            document.addEventListener('click', function (e) {
                if (e.target && e.target.id === 'sidebarBackdrop') { closeMobileSidebar(); }
            });

            function switchTab(name) {
                var tab = document.querySelector('.tab[data-tab="' + name + '"]');
                if (tab) tab.click();
            }

            function toggleKbAdd() {
                var panel = document.getElementById('kbAddPanel');
                var btn = document.getElementById('kbAddBtn2');
                if (!btn) return;
                var isOpen = panel.style.display !== 'none';
                panel.style.display = isOpen ? 'none' : '';
                btn.textContent = isOpen ? '➕ Documentos' : '✕ Fechar';
                btn.className = isOpen ? 'btn btn-outline' : 'btn btn-save';
                if (!isOpen) {
                    initDocMinRoleDropdown();
                    initDocSectorDropdown();
                    loadSettings();
                    if (api.isLoggedIn() && api.isAdmin()) loadDocuments();
                }
            }

            function toggleChatConfig() {
                var overlay = document.getElementById('chatConfigOverlay');
                overlay.classList.toggle('open');
                if (overlay.classList.contains('open')) {
                    loadSettings();
                    if (api.isLoggedIn() && api.isAdmin()) loadDocuments();
                    initDocMinRoleDropdown();
                    initDocSectorDropdown();
                }
            }
            function closeChatConfig() {
                document.getElementById('chatConfigOverlay').classList.remove('open');
            }

            // =====================================================================
            //  OPENROUTER API SERVICE
            // =====================================================================

            // ── Login ──
            async function faqLogin() {
                var btn = document.getElementById('loginBtn');
                var err = document.getElementById('loginError');
                var name = document.getElementById('loginUser').value.trim();
                var pass = document.getElementById('loginPass').value.trim();
                if (!name || !pass) { err.textContent = 'Preencha usuário e senha'; err.style.display = 'block'; return; }
                btn.disabled = true; btn.textContent = 'Entrando...';
                err.style.display = 'none';
                try {
                    var result = await api.login(name, pass);
                    if (result.forcePasswordChange) {
                        document.getElementById('loginOverlay').classList.add('hidden');
                        document.getElementById('pwChangeOverlay').style.display = 'flex';
                    } else {
                        document.getElementById('loginOverlay').classList.add('hidden');
                        showToast('<i class="fi fi-rr-check-circle"></i> Bem-vindo, ' + name);
                        _analysesCache = null;
                        _kbCache = null;
                        render();
                        try { await loadSystemSettings(); } catch { }
                        loadSettings();
                        btn.disabled = false; btn.textContent = 'Entrar';
                        // Load server data in background
                        setTimeout(function () { reloadAnalyses(); reloadKnowledgeBase(); }, 100);
                    }
                } catch (e) {
                    err.textContent = e.message;
                    err.style.display = 'block';
                    btn.disabled = false; btn.textContent = 'Entrar';
                }
            }

            async function loadSystemSettings() {
                if (!api.isLoggedIn()) return;
                try {
                    var settings = await api.fetchSettings();
                    if (settings) {
                        if (settings.openrouter_api_key) {
                            localStorage.setItem('veltris_ia_configured', '1');
                            localStorage.setItem('veltris_api_key', settings.openrouter_api_key);
                        }
                        if (settings.openrouter_model) {
                            localStorage.setItem('veltris_model', settings.openrouter_model);
                        }
                        if (settings.meta_access_token) localStorage.setItem('veltris_meta_token', settings.meta_access_token);
                        if (settings.meta_ad_account) localStorage.setItem('veltris_meta_ad_account', settings.meta_ad_account);
                        if (settings.google_dev_token) localStorage.setItem('veltris_google_dev_token', settings.google_dev_token);
                        if (settings.google_client_id) localStorage.setItem('veltris_google_client_id', settings.google_client_id);
                        if (settings.google_client_secret) localStorage.setItem('veltris_google_client_secret', settings.google_client_secret);
                        if (settings.google_refresh_token) localStorage.setItem('veltris_google_refresh_token', settings.google_refresh_token);
                        if (settings.google_customer_id) localStorage.setItem('veltris_google_customer_id', settings.google_customer_id);
                    }
                } catch { }
            }

            // ── Document Management ──
            async function uploadDocument() {
                if (!api.isLoggedIn() || !api.isAdmin()) return;
                var title = document.getElementById('docTitle').value.trim();
                var file = document.getElementById('docFile').files[0];
                var sector = getDocSectorValue();
                var minRole = getDocMinRoleValue();
                var status = document.getElementById('docStatus');
                var btn = document.getElementById('docUploadBtn');
                if (!title) { status.textContent = 'Digite um título'; status.className = 'kb-status'; status.style.display = 'block'; return; }
                if (!file) { status.textContent = 'Selecione um arquivo'; status.className = 'kb-status'; status.style.display = 'block'; return; }
                if (file.size > 10 * 1024 * 1024) { status.textContent = 'Arquivo muito grande (máx 10MB)'; status.className = 'kb-status'; status.style.display = 'block'; return; }
                btn.disabled = true; btn.textContent = 'Enviando...';
                status.style.display = 'none';
                try {
                    await api.uploadDocument(file, title, sector || null, minRole);
                    status.textContent = '<i class="fi fi-rr-check-circle"></i> Documento enviado e processado!';
                    status.className = 'kb-status ok';
                    status.style.display = 'block';
                    document.getElementById('docTitle').value = '';
                    document.getElementById('docFile').value = '';
                    loadDocuments();
                } catch (e) {
                    status.textContent = '<i class="fi fi-rr-triangle-warning"></i> ' + e.message;
                    status.className = 'kb-status';
                    status.style.display = 'block';
                }
                btn.disabled = false; btn.textContent = '📤 Enviar';
                setTimeout(function () { status.style.display = 'none'; }, 4000);
            }

            var _allDocs = [];

            function renderDocList(docs) {
                var list = document.getElementById('docList');
                var isAdmin = api.isLoggedIn() && api.isAdmin();
                if (!docs.length) { list.innerHTML = '<div style="padding:30px 0;color:var(--text-muted)">Nenhum documento encontrado.</div>'; return; }
                list.innerHTML = docs.map(function (d) {
                    var date = d.created_at ? new Date(d.created_at).toLocaleDateString('pt-BR') : '';
                    var preview = d.content_text ? d.content_text.slice(0, 120) + (d.content_text.length > 120 ? '...' : '') : '';
                    var fileName = d.file_path ? d.file_path.split('/').pop() : '';
                    var ext = fileName ? fileName.split('.').pop().toUpperCase() : '';
                    var iconMap = { PDF: '📕', DOCX: '📘', DOC: '📘', TXT: '<i class="fi fi-rr-document"></i>' };
                    var fileIcon = iconMap[ext] || '<i class="fi fi-rr-document"></i>';
                    var dlUrl = d.file_path ? api.getDocumentUrl(d.file_path) : null;

                    var actions = '';
                    if (dlUrl) actions += '<a href="' + dlUrl + '" download style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.75rem;text-decoration:none" title="Baixar">⬇️</a>';
                    if (isAdmin) {
                        actions += ' <button onclick="editDocument(' + d.id + ',\'' + escapeHtml(d.title) + '\',\'' + escapeHtml(d.sector || '') + '\',\'' + escapeHtml(d.min_role || '') + '\')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.75rem" title="Editar"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 1.2em; height: 1.2em;"></button>';
                        actions += ' <button onclick="deleteDocument(' + d.id + ',\'' + escapeHtml(d.file_path || '') + '\')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.75rem" title="Remover">🗑️</button>';
                    }

                    var roleLabel = { admin: '🔴 Admin', gestor: '🔶 Gestor+', colaborador: '<i class="fi fi-rr-user"></i> Todos' };
                    var roleBadge = roleLabel[d.min_role] || '<i class="fi fi-rr-user"></i> Todos';

                    return '<div style="display:grid;grid-template-columns:36px 1fr auto;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border);text-align:left">' +
                        '<div style="font-size:1.2rem;text-align:center">' + fileIcon + '</div>' +
                        '<div style="min-width:0">' +
                        '<div style="color: var(--text);font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(d.title) + '</div>' +
                        '<div style="font-size:0.68rem;color:var(--text-muted);margin-top:1px">' +
                        (d.sector ? '<span class="sector-tag">' + escapeHtml(d.sector) + '</span> ' : '') +
                        '<span style="opacity:0.6">' + roleBadge + '</span> ' +
                        date +
                        (fileName ? ' · ' + escapeHtml(fileName) : '') +
                        '</div>' +
                        (preview ? '<div style="color:var(--text-muted);font-size:0.7rem;margin-top:3px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(preview) + '</div>' : '') +
                        '</div>' +
                        '<div style="display:flex;gap:4px;flex-shrink:0">' + actions + '</div>' +
                        '</div>';
                }).join('');
            }

            async function loadDocuments() {
                if (!api.isLoggedIn() || !api.isAdmin()) return;
                var list = document.getElementById('docList');
                list.innerHTML = 'Carregando...';
                try {
                    var docs = await api.listDocuments();
                    _allDocs = docs;
                    renderDocList(docs);
                } catch (e) {
                    list.innerHTML = '<div style="padding:30px 0;color:#ef4444">Erro: ' + escapeHtml(e.message) + '</div>';
                }
            }

            async function searchDocuments() {
                if (!api.isLoggedIn() || !api.isAdmin()) return;
                var query = document.getElementById('docSearchInput').value.trim();
                if (!query) { loadDocuments(); return; }
                var list = document.getElementById('docList');
                list.innerHTML = 'Buscando...';
                try {
                    var docs = await api.searchDocuments(query, null);
                    renderDocList(docs);
                } catch (e) {
                    list.innerHTML = '<div style="padding:30px 0;color:#ef4444">Erro: ' + escapeHtml(e.message) + '</div>';
                }
            }

            async function deleteDocument(id, filePath) {
                if (!api.isLoggedIn() || !api.isAdmin()) return;
                if (!confirm('Remover este documento permanentemente?')) return;
                try {
                    await api.deleteDocument(id, filePath);
                    showToast('<i class="fi fi-rr-document"></i> Documento removido');
                    loadDocuments();
                } catch (e) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> ' + e.message);
                }
            }

            function editDocument(id, title, sector, minRole) {
                document.getElementById('editDocId').value = id;
                document.getElementById('editDocTitle').value = title;
                initEditDocSectorDropdown();
                setEditDocSectorValue(sector || '');
                initEditDocMinRoleDropdown();
                setEditDocMinRoleValue(minRole || 'colaborador');
                document.getElementById('editDocOverlay').classList.add('visible');
            }

            async function saveDocEdit() {
                if (!api.isLoggedIn() || !api.isAdmin()) return;
                var id = document.getElementById('editDocId').value;
                var title = document.getElementById('editDocTitle').value.trim();
                var sector = getEditDocSectorValue();
                var minRole = getEditDocMinRoleValue();
                if (!title) { showToast('<i class="fi fi-rr-triangle-warning"></i> O título é obrigatório'); return; }
                try {
                    await api.updateDocument(id, { title: title, sector: sector || null, min_role: minRole });
                    document.getElementById('editDocOverlay').classList.remove('visible');
                    showToast('<i class="fi fi-rr-check-circle"></i> Documento atualizado');
                    loadDocuments();
                } catch (e) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> ' + e.message);
                }
            }

            async function callOpenRouter(messages, options) {
                if (!window.api || !api.isLoggedIn()) {
                    showToast('⚠ Faça login para usar a IA');
                    return null;
                }
                options = options || {};
                try {
                    var systemMsg = '';
                    var userMsg = '';
                    messages.forEach(function (m) {
                        if (m.role === 'system') systemMsg = m.content;
                        else if (m.role === 'user') userMsg = m.content;
                    });
                    var savedKey = localStorage.getItem('veltris_api_key') || '';
                    var result = await api.analyze(userMsg, systemMsg, savedKey);
                    if (result && result.error) {
                        showToast('⚠ ' + result.error);
                        return null;
                    }
                    return result ? result.text : null;
                } catch (e) {
                    showToast('⚠ ' + e.message);
                    return null;
                }
                options = options || {};
                try {
                    var systemMsg = '';
                    var userMsg = '';
                    messages.forEach(function (m) {
                        if (m.role === 'system') systemMsg = m.content;
                        else if (m.role === 'user') userMsg = m.content;
                    });
                    var result = await api.analyze(userMsg, systemMsg);
                    if (result && result.error) {
                        showToast('<i class="fi fi-rr-triangle-warning"></i> ' + result.error);
                        return null;
                    }
                    return result ? result.text : null;
                } catch (e) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> ' + e.message);
                    return null;
                }
            }

            // =====================================================================
            //  NOTIFICATION / SUGGESTIONS SYSTEM
            // =====================================================================

            var sugestoes = [];

            function loadSugestoes() {
                if (!api.isLoggedIn()) { renderNotifs(); return; }
                api.listSuggestions().then(function (res) {
                    var rows = res && res.data || [];
                    sugestoes = rows.map(function (r) { return { id: r.id, titulo: r.titulo, descricao: r.descricao, categoria: r.categoria, impacto: r.impacto }; });
                    renderNotifs();
                }).catch(function () { renderNotifs(); });
            }

            function renderNotifs() {
                var list = document.getElementById('notifList');
                var badge = document.getElementById('notifBadge');
                if (!sugestoes.length) {
                    list.innerHTML = '<div class="notif-empty">Clique em "Gerar Novas" para a IA sugerir melhorias para a Veltris.</div>';
                    badge.style.display = 'none';
                    return;
                }
                list.innerHTML = sugestoes.map(function (s, i) {
                    return '<div class="notif-item" onclick="desenvolverIdeia(' + i + ')">' +
                        '<button class="notif-close" onclick="event.stopPropagation();dismissNotif(' + i + ')" title="Descartar sugestão">✕</button>' +
                        '<div class="notif-title">' + esc(s.titulo) + '</div>' +
                        '<div class="notif-desc">' + esc(s.descricao) + '</div>' +
                        '<div class="notif-cat">' + esc(s.categoria) + ' · Impacto: ' + esc(s.impacto) + '</div>' +
                        '</div>';
                }).join('');
                badge.textContent = sugestoes.length;
                badge.style.display = 'flex';
            }

            // =====================================================================
            //  POPUP CHAT (from notifications) — multi-conversation
            // =====================================================================

            var popupConversations = [];
            var activePopupConvId = null;
            var popupHistoryVisible = false;
            var minimizedPopupConvs = [];

            function loadPopupConversations() {
                if (!api.isLoggedIn()) {
                    if (!popupConversations.length) popupConversations.push({ id: 'conv_' + Date.now(), title: 'Nova conversa', messages: [], createdAt: Date.now() });
                    return;
                }
                api.listConversations('popup').then(function (res) {
                    var rows = res && res.data || [];
                    if (rows.length) {
                        popupConversations = rows.map(function (r) { return { id: '' + r.id, title: r.title, messages: r.messages || [], createdAt: new Date(r.created_at).getTime() }; });
                    }
                    if (!popupConversations.length) popupConversations.push({ id: 'conv_' + Date.now(), title: 'Nova conversa', messages: [], createdAt: Date.now() });
                }).catch(function () {
                    if (!popupConversations.length) popupConversations.push({ id: 'conv_' + Date.now(), title: 'Nova conversa', messages: [], createdAt: Date.now() });
                });
            }

            function savePopupConversations() {
                if (!api.isLoggedIn()) { return; }
                popupConversations.forEach(function (conv) {
                    api.saveConversation({ type: 'popup', id: conv.id && !isNaN(conv.id) ? parseInt(conv.id) : null, title: conv.title, messages: conv.messages });
                });
            }

            function getActivePopupConv() {
                return popupConversations.find(function (c) { return c.id === activePopupConvId; });
            }

            function renderPopupMessages() {
                var container = document.getElementById('chatPopupMessages');
                var empty = document.getElementById('chatPopupEmpty');
                var conv = getActivePopupConv();
                if (!container) return;
                if (!conv || !conv.messages.length) {
                    container.innerHTML = '<div class="chat-empty" id="chatPopupEmpty"><div class="ce-icon"><i class="fi fi-rr-lightbulb-on"></i></div><div>Clique em uma notificação ou digite abaixo para começar.</div></div>';
                    return;
                }
                container.innerHTML = conv.messages.map(function (msg) {
                    var time = msg.time ? new Date(msg.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
                    var formatted = formatPopupContent(msg.content);
                    return '<div class="chat-popup-msg ' + msg.role + '">' + formatted + '<div class="msg-time">' + time + '</div></div>';
                }).join('');
                container.scrollTop = container.scrollHeight;
            }

            function formatPopupContent(text) {
                var lines = esc(text).split('\n');
                return lines.map(function (line) {
                    var trimmed = line.trim();
                    if (trimmed.match(/^-\s/)) {
                        return '<div style="padding-left:8px;position:relative">• ' + line.substring(trimmed.indexOf('- ') + 2) + '</div>';
                    }
                    if (line === '') return '<div style="height:4px"></div>';
                    return '<div>' + line + '</div>';
                }).join('');
            }

            function showPopupTyping() {
                var container = document.getElementById('chatPopupMessages');
                if (!container) return;
                var el = document.createElement('div');
                el.className = 'chat-popup-typing';
                el.id = 'chatPopupTyping';
                el.innerHTML = '<span></span><span></span><span></span>';
                container.appendChild(el);
                container.scrollTop = container.scrollHeight;
            }

            function hidePopupTyping() {
                var el = document.getElementById('chatPopupTyping');
                if (el) el.remove();
            }

            function renderMinimizedIcons() {
                var container = document.getElementById('chatMinimizedIcons');
                if (!container) return;
                container.innerHTML = minimizedPopupConvs.map(function (convId) {
                    var conv = popupConversations.find(function (c) { return c.id === convId; });
                    var title = conv ? conv.title : 'Chat';
                    var short = title.length > 10 ? title.slice(0, 10) + '…' : title;
                    return '<button class="chat-minimized-icon" onclick="restorePopupChat(\'' + convId + '\')" title="' + esc(title) + '">' +
                        '<i class="fi fi-rr-comment-alt"></i>' +
                        '<span class="chat-minimized-close" onclick="event.stopPropagation();fullyClosePopupChat(\'' + convId + '\')" title="Fechar">✕</span>' +
                        '</button>';
                }).join('');
            }

            function showPopupForConv(convId) {
                activePopupConvId = convId;
                document.getElementById('chatPopupBackdrop').style.display = 'block';
                var overlay = document.getElementById('chatPopupOverlay');
                overlay.style.display = 'flex';
                overlay.classList.remove('minimized');
                renderPopupMessages();
                renderPopupHistory();
            }

            function hidePopup() {
                document.getElementById('chatPopupOverlay').style.display = 'none';
                document.getElementById('chatPopupBackdrop').style.display = 'none';
            }

            function openPopupChat(title, desc) {
                loadPopupConversations();
                var overlay = document.getElementById('chatPopupOverlay');
                if (!overlay) return;

                // If popup is showing another conversation, keep it minimized
                if (activePopupConvId && document.getElementById('chatPopupOverlay').style.display !== 'none') {
                    var currentConv = getActivePopupConv();
                    if (currentConv && currentConv.messages.length > 0) {
                        if (minimizedPopupConvs.indexOf(activePopupConvId) === -1) {
                            minimizedPopupConvs.push(activePopupConvId);
                        }
                    }
                }

                // Create a new conversation for this idea
                var convId = 'conv_' + Date.now();
                var titleShort = title.length > 30 ? title.slice(0, 30) + '...' : title;
                popupConversations.push({ id: convId, title: titleShort, messages: [], createdAt: Date.now() });
                savePopupConversations();

                showPopupForConv(convId);
                renderMinimizedIcons();

                var msgText = 'Desenvolver ideia: ' + title + '. ' + desc;
                sendPopupChatMessage(msgText);
            }

            function minimizePopupChat() {
                var conv = getActivePopupConv();
                if (conv && conv.messages.length > 0) {
                    if (minimizedPopupConvs.indexOf(activePopupConvId) === -1) {
                        minimizedPopupConvs.push(activePopupConvId);
                    }
                }
                hidePopup();
                renderMinimizedIcons();
            }

            function restorePopupChat(convId) {
                minimizedPopupConvs = minimizedPopupConvs.filter(function (id) { return id !== convId; });
                showPopupForConv(convId);
                renderMinimizedIcons();
            }

            function fullyClosePopupChat(convId) {
                minimizedPopupConvs = minimizedPopupConvs.filter(function (id) { return id !== convId; });
                popupConversations = popupConversations.filter(function (c) { return c.id !== convId; });
                savePopupConversations();
                if (activePopupConvId === convId) {
                    hidePopup();
                    // If there are still minimized conversations, restore the last one
                    if (minimizedPopupConvs.length) {
                        showPopupForConv(minimizedPopupConvs[minimizedPopupConvs.length - 1]);
                        minimizedPopupConvs.pop();
                    } else if (popupConversations.length) {
                        showPopupForConv(popupConversations[popupConversations.length - 1].id);
                    }
                }
                if (!minimizedPopupConvs.length && (document.getElementById('chatPopupOverlay').style.display === 'none' || !document.getElementById('chatPopupOverlay').style.display)) {
                    hidePopup();
                }
                renderMinimizedIcons();
            }

            function popupChatKeydown(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendPopupChat();
                }
            }

            function sendPopupChat() {
                var input = document.getElementById('chatPopupInput');
                var text = input.value.trim();
                if (!text) return;
                input.value = '';
                input.style.height = '';
                sendPopupChatMessage(text);
            }

            async function sendPopupChatMessage(text) {
                var conv = getActivePopupConv();
                if (!conv) return;

                if (!api || !api.isLoggedIn()) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> Faça login para usar o chat');
                    return;
                }

                conv.messages.push({ role: 'user', content: text, time: Date.now() });
                savePopupConversations();
                renderPopupMessages();

                showPopupTyping();
                document.getElementById('chatPopupSendBtn').disabled = true;

                var docContext = '';
                try {
                    var docs = await api.searchDocuments(text, null);
                    if (docs && docs.length) {
                        docContext = '=== DOCUMENTOS DA EMPRESA ===\n' +
                            docs.map(function (d) { return '--- ' + d.title + ' ---\n' + (d.content_text ? d.content_text.slice(0, 1000) : ''); }).join('\n\n');
                    }
                } catch { }

                var webContext = '';
                if (wantsWebSearch(text) || extractURLs(text).length > 0) {
                    showToast('<i class="fi fi-rr-search"></i> Pesquisando na internet...');
                    try {
                        var webData = await fetchWebAndLinks(text);
                        if (webData) webContext = webData;
                    } catch { }
                }

                var kb = loadKnowledgeBase();
                var itemsContext = items.map(function (i) {
                    return '- ' + i.label + ' [' + i.cat + '] ' + (i.done ? '<i class="fi fi-rr-check-circle"></i>' : '⬜') + ' (score:' + i.score + ', prazo:' + i.prazo + ')';
                }).join('\n');

                var kanbanContext = kanbanData.map(function (col) {
                    var cards = col.cards.map(function (c) { return '  - ' + c.title + (c.desc ? ': ' + c.desc.slice(0, 60) : '') + (c.comments && c.comments.length ? ' (' + c.comments.length + ' comentários)' : ''); }).join('\n');
                    return col.title + ' (' + col.cards.length + ' cards):\n' + cards;
                }).join('\n\n');

                var finMetrics = 'Conclusão (prioridade): ' + calcImpactoFinanceiro() + '% | ' +
                    'Velocidade: ' + calcVelocidadeFinanceira() + '% | ' +
                    'Score: ' + scoreLabel(calcScoreGeral()).replace(/<[^>]*>?/gm, '') + ' (' + calcScoreGeral() + '/100) | ' +
                    'Concluído: ' + overallPct() + '%';

                var systemPrompt = 'Você é um CEO/CMO/COO consultor sênior da empresa Veltris. ' +
                    'Você tem acesso TOTAL a todos os dados da plataforma. Seu papel é: ' +
                    '1) Responder perguntas sobre estratégia, marketing, vendas, finanças e operações. ' +
                    '2) Sugerir conteúdos, ações e melhorias baseadas nos dados reais. ' +
                    '3) Analisar documentos e extrair insights. ' +
                    '4) Ser objetivo, prático e dar recomendações acionáveis. ' +
                    'Seja direto, profissional e use linguagem executiva. ' +
                    'Responda SEMPRE em português brasileiro. ' +
                    'IMPORTANTE: Proibido usar qualquer caractere especial de formatação. Nada de asteriscos, hashtags, underscores, barras invertidas, ou qualquer símbolo de markdown. Use APENAS texto puro sem formatação. Para listar tarefas ou sugestões, use APENAS um hífen simples no início de cada linha, sem números ou outros símbolos. Exemplo correto: "- Criar funil de vendas" em vez de "**1. Criar funil de vendas**". Não use negrito, itálico, títulos, bullet points com *, numeração, ou qualquer recurso visual. Somente letras, números e pontuação básica. IMPORTANTE: Cada item da lista deve estar em uma linha separada. Use uma quebra de linha real (pressionar Enter) entre cada item. NUNCA junte múltiplos itens na mesma linha. VOCÊ TEM ACESSO À INTERNET: Quando o usuário perguntar sobre informações atuais, notícias, ou enviar links, você receberá o conteúdo pesquisado ou do link nos dados de contexto nas seções "RESULTADOS DA PESQUISA WEB" ou "CONTEÚDO DO LINK". Use essas informações para responder. Se os dados de pesquisa não forem suficientes, indique que não encontrou informações atualizadas.';

                var contextData = [
                    '=== BASE DE CONHECIMENTO DA EMPRESA ===',
                    kb || '(nenhuma informação cadastrada)',
                    '',
                    '=== CHECKLIST (Itens de Gestão) ===',
                    itemsContext || '(nenhum item)',
                    '',
                    '=== ESTEIRA DE CONTEÚDO (Kanban) ===',
                    kanbanContext || '(nenhum card)',
                    '',
                    '=== MÉTRICAS FINANCEIRAS ===',
                    finMetrics,
                    '',
                    docContext || '',
                    webContext || '',
                ].join('\n');

                try {
                    var userContent = '=== CONVERSA ATUAL ===\n' +
                        conv.messages.map(function (m) { return m.role.toUpperCase() + ': ' + m.content; }).join('\n') +
                        '\n\nASSISTANT:';
                    var reply = await callOpenRouter([
                        { role: 'system', content: systemPrompt + '\n\n' + contextData },
                        { role: 'user', content: userContent }
                    ], { maxTokens: 3000, temperature: 0.7 });
                    reply = reply || '(sem resposta)';
                    reply = stripMarkdown(reply);
                    conv.messages.push({ role: 'assistant', content: reply, time: Date.now() });
                    savePopupConversations();
                    // Update the conversation title from first user message if still default
                    if (conv.title === 'Nova conversa' && conv.messages.length >= 2) {
                        var firstMsg = conv.messages[0].content;
                        conv.title = firstMsg.length > 35 ? firstMsg.slice(0, 35) + '...' : firstMsg;
                        savePopupConversations();
                        renderPopupHistory();
                    }
                } catch (err) {
                    conv.messages.push({ role: 'assistant', content: '<i class="fi fi-rr-cross-circle"></i> Erro ao conectar com a IA: ' + (err.message || 'tente novamente'), time: Date.now() });
                    savePopupConversations();
                    if (conv.title === 'Nova conversa' && conv.messages.length >= 2) {
                        var firstMsg = conv.messages[0].content;
                        conv.title = firstMsg.length > 35 ? firstMsg.slice(0, 35) + '...' : firstMsg;
                        savePopupConversations();
                        renderPopupHistory();
                    }
                }

                hidePopupTyping();
                document.getElementById('chatPopupSendBtn').disabled = false;
                renderPopupMessages();
                renderPopupHistory();
            }

            function togglePopupHistory() {
                var panel = document.getElementById('chPopupHistory');
                popupHistoryVisible = !popupHistoryVisible;
                panel.style.display = popupHistoryVisible ? 'flex' : 'none';
                if (popupHistoryVisible) renderPopupHistory();
            }

            function renderPopupHistory() {
                var list = document.getElementById('chPopupHistoryList');
                if (!list) return;
                list.innerHTML = popupConversations.map(function (c) {
                    var active = c.id === activePopupConvId ? 'active' : '';
                    var title = esc(c.title);
                    return '<div class="ch-popup-history-item ' + active + '" onclick="switchPopupConv(\'' + c.id + '\')">' +
                        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">' + title + '</span>' +
                        '<button class="ch-del" onclick="event.stopPropagation();deletePopupConv(\'' + c.id + '\')" title="Excluir">✕</button>' +
                        '</div>';
                }).join('');
            }

            function switchPopupConv(id) {
                activePopupConvId = id;
                renderPopupMessages();
                renderPopupHistory();
            }

            function newPopupConversation() {
                var convId = 'conv_' + Date.now();
                popupConversations.push({ id: convId, title: 'Nova conversa', messages: [], createdAt: Date.now() });
                activePopupConvId = convId;
                savePopupConversations();
                renderPopupMessages();
                renderPopupHistory();
            }

            function deletePopupConv(id) {
                if (popupConversations.length <= 1) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> Mantenha ao menos uma conversa');
                    return;
                }
                popupConversations = popupConversations.filter(function (c) { return c.id !== id; });
                minimizedPopupConvs = minimizedPopupConvs.filter(function (c) { return c !== id; });
                if (activePopupConvId === id) {
                    activePopupConvId = popupConversations[0].id;
                }
                savePopupConversations();
                renderPopupMessages();
                renderPopupHistory();
                renderMinimizedIcons();
            }

            function desenvolverIdeia(index) {
                var s = sugestoes[index];
                if (!s) return;
                notifPanelOpen = false;
                document.getElementById('notifPanel').classList.remove('visible');
                openPopupChat(s.titulo, s.descricao);
            }

            function dismissNotif(index) {
                sugestoes.splice(index, 1);
                saveSugestoes();
                renderNotifs();
                if (!sugestoes.length) {
                    notifPanelOpen = false;
                    document.getElementById('notifPanel').classList.remove('visible');
                }
            }

            var notifPanelOpen = false;
            function toggleNotifPanel() {
                notifPanelOpen = !notifPanelOpen;
                document.getElementById('notifPanel').classList.toggle('visible', notifPanelOpen);
            }

            async function gerarSugestoesIA() {
                if (!api || !api.isLoggedIn()) return;

                showToast('🤔 IA está pensando em sugestões...');

                var itemsList = items.map(function (i) {
                    return '- ' + i.label + ' [' + i.cat + '] ' + (i.done ? '(concluído)' : '(pendente)');
                }).join('\n') || '(nenhum item cadastrado)';

                var systemPrompt = 'Você é um CEO/CMO/COO consultor da empresa Veltris, uma agência/consultoria de marketing, vendas e tecnologia. ' +
                    'Com base nos itens atuais do checklist e seu conhecimento em gestão empresarial, sugira 3-5 ações práticas que a Veltris deveria implementar ' +
                    'para melhorar performance, receita, eficiência ou crescimento. Cada sugestão deve ter: título, descrição curta, categoria (Vendas/Marketing/Financeiro/Produto/Operacional/RH) e nível de impacto (Alto/Médio/Baixo). ' +
                    'Retorne APENAS um JSON array válido no formato: [{"titulo":"...","descricao":"...","categoria":"...","impacto":"Alto"}]. Não use markdown.';

                var result = await callOpenRouter([
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Checklist atual da Veltris:\n' + itemsList + '\n\nCom base nisso, gere sugestões de melhoria.' }
                ], { maxTokens: 2000, temperature: 0.8 });

                if (!result) {
                    // fallback: sugestões offline
                    result = JSON.stringify([
                        { titulo: 'Analisar funil de vendas', descricao: 'Identifique gargalos no processo comercial para aumentar conversão.', categoria: 'Vendas', impacto: 'Alto' },
                        { titulo: 'Otimizar presença digital', descricao: 'Revise SEO, redes sociais e site para atrair mais leads orgânicos.', categoria: 'Marketing', impacto: 'Alto' },
                        { titulo: 'Revisar fluxo de caixa', descricao: 'Analise entradas e saídas dos últimos 3 meses para planejar crescimento.', categoria: 'Financeiro', impacto: 'Médio' },
                    ]);
                }

                try {
                    var cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                    var parsed = JSON.parse(cleaned);
                    if (Array.isArray(parsed) && parsed.length) {
                        sugestoes = parsed;
                        saveSugestoes();
                        renderNotifs();
                        notifPanelOpen = true;
                        document.getElementById('notifPanel').classList.add('visible');
                        showToast('<i class="fi fi-rr-lightbulb-on"></i> ' + sugestoes.length + ' sugestões geradas pela IA!');
                    }
                } catch (e) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> Erro ao processar sugestões. Tente novamente.');
                }
            }

            async function analisarItensIA() {
                if (!api || !api.isLoggedIn()) { showToast('<i class="fi fi-rr-triangle-warning"></i> Faça login para usar a IA'); return; }

                var pendentes = items.filter(function (i) { return !i.done; });
                if (!pendentes.length) { showToast('<i class="fi fi-rr-check-circle"></i> Todos os itens já estão concluídos'); return; }

                showToast('🤔 IA está analisando ' + pendentes.length + ' itens...');

                var lista = pendentes.map(function (i, idx) {
                    return idx + 1 + '. "' + i.label + '" (categoria atual: ' + i.cat + ', prioridade: ' + i.prio + ', prazo: ' + i.prazo + ')';
                }).join('\n');

                var systemPrompt = 'Você é um CEO/CMO/COO consultor da Veltris, uma agência de marketing, vendas e tecnologia. ' +
                    'Analise CADA item individualmente e reavalie sua categoria, prioridade e prazo com base no significado REAL de cada categoria:\n\n' +
                    'CATEGORIAS:\n' +
                    '- vendas: ações que geram receita DIRETA (fechar contratos, propostas, ligações, negociações, funil de vendas, leads)\n' +
                    '- marketing: ações de ATRAÇÃO e VISIBILIDADE (SEO, tráfego, anúncios, redes sociais, conteúdo, site, blog, landing page)\n' +
                    '- financeiro: ações de GESTÃO FINANCEIRA (fluxo de caixa, precificação, custos, faturamento, impostos)\n' +
                    '- produto: ações de DESENVOLVIMENTO de produto/serviço (roadmap, funcionalidades, versões, qualidade)\n' +
                    '- operacional: ações de INFRAESTRUTURA e PROCESSOS INTERNOS (documentação, ferramentas, processos, servidor, domínio, configurações técnicas)\n' +
                    '- rh: ações de PESSOAS e EQUIPE (contratação, treinamento, cargos, cultura)\n\n' +
                    'Regras:\n' +
                    '1) "score": 0-100 com base no impacto financeiro REAL (quanto dinheiro isso traz ou economiza para a Veltris)\n' +
                    '2) "prioridade": "alta" (score >= 60), "media" (score 35-59), "baixa" (score < 35)\n' +
                    '3) "prazo": "curto" (dias/semana), "medio" (semanas/mês), "longo" (meses/trimestre)\n' +
                    '4) "categoria": a que MELHOR descreve a natureza da ação, não a área que solicitou\n' +
                    '5) Seja CRÍTICO: nem toda tarefa de marketing realmente gera impacto em marketing\n' +
                    '\nRetorne APENAS um JSON array válido no formato: [{"id":1,"score":75,"prioridade":"alta","prazo":"curto","categoria":"vendas"}]. ' +
                    'Use o ID de cada item da lista abaixo (1, 2, 3...) para referenciar. Não use markdown.';

                // Inclui feedback recente para a IA aprender com correções manuais
                if (feedbackLog.length) {
                    var exemplos = feedbackLog.slice(-10).map(function (f) {
                        var mudancasStr = Object.entries(f.mudancas).map(function (kv) {
                            return kv[0] + ': "' + kv[1].de + '" -> "' + kv[1].para + '"';
                        }).join(', ');
                        return '- "' + f.label + '": ' + mudancasStr;
                    }).join('\n');
                    systemPrompt += '\n\nEXEMPLOS DE CORREÇÕES ANTERIORES (aprenda com elas):\n' + exemplos +
                        '\nUse esses exemplos como referência de como o usuário prefere classificar itens similares.';
                }

                var result = await callOpenRouter([
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Analise estes itens da Veltris:\n' + lista }
                ], { maxTokens: 3000, temperature: 0.3 });

                if (!result) { showToast('<i class="fi fi-rr-triangle-warning"></i> IA não retornou análise. Tente novamente.'); return; }

                try {
                    var cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                    var parsed = JSON.parse(cleaned);

                    if (!Array.isArray(parsed) || !parsed.length) throw new Error('Array vazio ou inválido');

                    var atualizados = 0;
                    var erros = [];

                    parsed.forEach(function (analise) {
                        var idx = analise.id - 1;
                        if (idx >= 0 && idx < pendentes.length) {
                            var item = pendentes[idx];
                            var mudou = false;
                            if (analise.score !== undefined) { item.score = Math.max(0, Math.min(100, Math.round(analise.score))); mudou = true; }
                            if (analise.prioridade && ['alta', 'media', 'baixa'].includes(analise.prioridade)) { item.prio = analise.prioridade; mudou = true; }
                            if (analise.prazo && ['curto', 'medio', 'longo'].includes(analise.prazo)) { item.prazo = analise.prazo; mudou = true; }
                            if (analise.categoria && ['vendas', 'marketing', 'financeiro', 'produto', 'operacional', 'rh'].includes(analise.categoria)) {
                                item.cat = analise.categoria; mudou = true;
                            }
                            if (mudou) atualizados++;
                        } else {
                            erros.push('id ' + analise.id + ' inválido');
                        }
                    });

                    if (atualizados > 0) {
                        save();
                        render();
                        var msg = '<i class="fi fi-rr-check-circle"></i> ' + atualizados + ' itens analisados e atualizados!';
                        if (erros.length) msg += ' (' + erros.length + ' erros)';
                        showToast(msg);
                    } else {
                        showToast('<i class="fi fi-rr-triangle-warning"></i> Nenhum item foi alterado. A IA manteve as classificações atuais.');
                    }
                } catch (e) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> Erro ao processar resposta. Verifique o console.');
                    console.error('Resposta bruta da IA:', result);
                    console.error('Erro:', e);
                }
            }

            function saveSugestoes() {
                if (!api.isLoggedIn()) { try { localStorage.setItem('veltris_sugestoes', JSON.stringify(sugestoes)); } catch { } return; }
                // Replace all: delete existing and insert new
                api.listSuggestions().then(function (res) {
                    var existing = res && res.data || [];
                    var del = existing.map(function (r) { return api.deleteSuggestion(r.id); });
                    return Promise.all(del);
                }).then(function () {
                    return Promise.all(sugestoes.map(function (s) {
                        return api.saveSuggestion({ titulo: s.titulo, descricao: s.descricao, categoria: s.categoria, impacto: s.impacto });
                    }));
                }).catch(function () {
                    try { localStorage.setItem('veltris_sugestoes', JSON.stringify(sugestoes)); } catch { }
                });
            }

            // =====================================================================
            //  FILE UPLOAD / CONTEÚDOS
            // =====================================================================

            var uploadedFiles = [];

            function handleFile(input) {
                var file = input.files && input.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function (e) {
                    var content = e.target.result;
                    var fileData = { name: file.name, content: content, analysis: null };
                    uploadedFiles.push(fileData);
                    renderUploads();
                    // Auto-analyze with AI
                    analisarUploadIA(fileData, uploadedFiles.length - 1);
                };
                reader.readAsText(file, 'UTF-8');
                input.value = '';
            }

            // Drag & drop
            var uploadArea = document.getElementById('uploadArea');
            if (uploadArea) {
                uploadArea.addEventListener('dragover', function (e) {
                    e.preventDefault();
                    uploadArea.classList.add('dragover');
                });
                uploadArea.addEventListener('dragleave', function () {
                    uploadArea.classList.remove('dragover');
                });
                uploadArea.addEventListener('drop', function (e) {
                    e.preventDefault();
                    uploadArea.classList.remove('dragover');
                    var file = e.dataTransfer.files && e.dataTransfer.files[0];
                    if (file && file.name.endsWith('.txt')) {
                        var reader = new FileReader();
                        reader.onload = function (ev) {
                            var fileData = { name: file.name, content: ev.target.result, analysis: null };
                            uploadedFiles.push(fileData);
                            renderUploads();
                            analisarUploadIA(fileData, uploadedFiles.length - 1);
                        };
                        reader.readAsText(file, 'UTF-8');
                    } else {
                        showToast('<i class="fi fi-rr-triangle-warning"></i> Apenas arquivos .txt são aceitos');
                    }
                });
            }

            function renderUploads() {
                var container = document.getElementById('uploadResults');
                if (!uploadedFiles.length) { container.innerHTML = ''; return; }
                container.innerHTML = uploadedFiles.map(function (f, idx) {
                    return '<div class="upload-result">' +
                        '<div class="ur-header">' +
                        '<span class="ur-file"><i class="fi fi-rr-document"></i> ' + esc(f.name) + '</span>' +
                        '<span class="ur-status">' + (f.analysis ? '<i class="fi fi-rr-check-circle"></i> Analisado' : '⏳ Aguardando IA...') + '</span>' +
                        '</div>' +
                        (f.analysis ? '<div class="ur-analysis">' + esc(f.analysis) + '</div>' : '') +
                        '<div class="ur-actions">' +
                        (f.analysis ? '<button class="ur-btn-ia" onclick="analisarUploadIA(uploadedFiles[' + idx + '], ' + idx + ')">🔄 Reanalisar</button>' : '') +
                        '<button class="ur-btn-add" onclick="removerUpload(' + idx + ')">✕ Remover</button>' +
                        '</div>' +
                        '</div>';
                }).join('');
            }

            function removerUpload(idx) {
                uploadedFiles.splice(idx, 1);
                renderUploads();
            }

            async function analisarUploadIA(fileData, idx) {
                if (!api || !api.isLoggedIn()) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> Faça login para usar a IA');
                    fileData.analysis = '[Faça login para análise por IA]';
                    renderUploads();
                    return;
                }

                var systemPrompt = 'Você é um consultor CEO/CMO/COO especialista em análise de documentos empresariais. ' +
                    'Analise o conteúdo do arquivo enviado e extraia: pontos principais, oportunidades de melhoria, ' +
                    'riscos identificados e ações recomendadas para a Veltris. Seja objetivo e prático. ' +
                    'Mantenha a análise concisa (máximo 400 palavras). ' +
                    'IMPORTANTE: Proibido usar asteriscos, hashtags, underscores ou qualquer formatação markdown. Use APENAS texto puro.';

                var preview = fileData.content.slice(0, 4000);

                showToast('<i class="fi fi-rr-document"></i> IA analisando "' + fileData.name + '"...');

                var result = await callOpenRouter([
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Conteúdo do arquivo "' + fileData.name + '":\n\n' + preview }
                ], { maxTokens: 2000, temperature: 0.5 });

                if (result) {
                    fileData.analysis = stripMarkdown(result);
                } else {
                    fileData.analysis = '[Falha na análise - verifique a chave de API]';
                }
                renderUploads();
            }

            // =====================================================================
            //  FINANCEIRO IA
            // =====================================================================

            async function analisarFinanceiroIA() {
                if (!api || !api.isLoggedIn()) { showToast('<i class="fi fi-rr-triangle-warning"></i> Faça login para usar a IA'); return; }

                var content = document.getElementById('finAiContent');
                content.textContent = '🤔 IA está analisando as finanças...';

                var done = totalDone();
                var total = totalItems();
                var pct = overallPct();
                var fin = calcImpactoFinanceiro();
                var vel = calcVelocidadeFinanceira();
                var score = calcScoreGeral();

                var itemsByCat = {};
                categories.forEach(function (c) {
                    var list = items.filter(function (i) { return i.cat === c.id && !i.done; });
                    if (list.length) itemsByCat[c.name] = list.map(function (i) { return i.label; });
                });

                var context = 'Métricas da Veltris:\n' +
                    '- Itens concluídos: ' + done + '/' + total + ' (' + pct + '%)\n' +
                    '- Impacto Financeiro: ' + fin + '%\n' +
                    '- Velocidade Financeira: ' + vel + '%\n' +
                    '- Score Geral: ' + score + '/100\n' +
                    '- Itens pendentes por setor: ' + JSON.stringify(itemsByCat) + '\n\n' +
                    'Com base nesses dados, faça um diagnóstico financeiro executivo (máx 300 palavras) com: ' +
                    '1) Análise da situação atual 2) Riscos identificados 3) Recomendações práticas para melhorar resultados financeiros.';

                var systemPrompt = 'Você é um CFO consultor da Veltris. Analise dados financeiros e operacionais e dê recomendações práticas. Seja direto e executivo. IMPORTANTE: Proibido usar asteriscos, hashtags, underscores ou qualquer formatação markdown. Use APENAS texto puro.';

                var result = await callOpenRouter([
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: context }
                ], { maxTokens: 1500, temperature: 0.5 });

                content.textContent = stripMarkdown(result) || 'Não foi possível gerar análise. Verifique a chave de API.';
            }

            // =====================================================================
            //  NEW TOAST SYSTEM
            // =====================================================================

            function showToast(msg) {
                var container = document.getElementById('toastContainer');
                var el = document.createElement('div');
                el.className = 'toast-item';
                el.textContent = msg;
                container.appendChild(el);
                setTimeout(function () { if (el.parentNode) el.remove(); }, 3000);
            }

            // Override old toast
            var oldShowToast = window.showToast || function () { };

            // =====================================================================
            //  INTEGRATE AI INTO EXISTING ANALYZER
            // =====================================================================

            // Enhance the addItem to optionally ask AI
            var originalAddItem = window.addItem || function () { };

            function requestNotificationPermission() {
                try {
                    if ('Notification' in window && Notification.permission === 'default') {
                        var asked = false;
                        try { asked = localStorage.getItem('veltris_notif_asked') === '1'; } catch { }
                        if (!asked) {
                            try { localStorage.setItem('veltris_notif_asked', '1'); } catch { }
                            Notification.requestPermission();
                        }
                    }
                } catch (e) { }
            }

            // =====================================================================
            //  INIT
            // =====================================================================

            // Auth check
            async function confirmPasswordChange() {
                var btn = document.getElementById('pwChangeBtn');
                var err = document.getElementById('pwChangeError');
                var pw = document.getElementById('pwChangeNew').value;
                var confirm = document.getElementById('pwChangeConfirm').value;
                err.style.display = 'none';
                if (!pw || pw.length < 4) { err.textContent = 'A senha deve ter no mínimo 4 caracteres'; err.style.display = 'block'; return; }
                if (pw !== confirm) { err.textContent = 'As senhas não conferem'; err.style.display = 'block'; return; }
                btn.disabled = true; btn.textContent = 'Alterando...';
                try {
                    var user = api.getUser();
                    await api.setPassword(user.id, pw);
                    localStorage.removeItem('veltris_force_pw_change');
                    document.getElementById('pwChangeOverlay').style.display = 'none';
                    document.getElementById('pwChangeNew').value = '';
                    document.getElementById('pwChangeConfirm').value = '';
                    showToast('<i class="fi fi-rr-check-circle"></i> Senha alterada! Bem-vindo, ' + user.name);
                    render();
                    try { await loadSystemSettings(); } catch { }
                } catch (e) {
                    err.textContent = e.message;
                    err.style.display = 'block';
                }
                btn.disabled = false; btn.textContent = 'Alterar senha';
            }

            // =====================================================================
            //  CRM — Functions
            // =====================================================================

            var CRM_STATUS = [
                { value: 'new', label: 'Novo' },
                { value: 'contacted', label: 'Contatado' },
                { value: 'negotiating', label: 'Negociando' },
                { value: 'won', label: 'Ganho' },
                { value: 'lost', label: 'Perdido' },
            ];
            var CRM_SOURCES = [
                { value: 'google', label: 'Google Ads' },
                { value: 'meta', label: 'Meta Ads' },
                { value: 'direct', label: 'Direto' },
                { value: 'external', label: 'Externo' },
            ];

            function initCrmStatusDropdown() {
                var drop = document.getElementById('crmStatusDrop');
                if (!drop || drop.dataset.inited) return;
                drop.dataset.inited = '1';
                drop.innerHTML = '<div class="cs-opt" data-value="">Todos status</div>' +
                    CRM_STATUS.map(function (s) { return '<div class="cs-opt" data-value="' + s.value + '">' + s.label + '</div>'; }).join('');
                drop.querySelectorAll('.cs-opt').forEach(function (el) {
                    el.addEventListener('click', function () {
                        selectCrmStatusValue(this.dataset.value);
                        closeCrmStatusDropdown();
                        crmFilterTimer();
                    });
                });
            }

            function initCrmSourceDropdown() {
                var drop = document.getElementById('crmSourceDrop');
                if (!drop || drop.dataset.inited) return;
                drop.dataset.inited = '1';
                drop.innerHTML = '<div class="cs-opt" data-value="">Todas origens</div>' +
                    CRM_SOURCES.map(function (s) { return '<div class="cs-opt" data-value="' + s.value + '">' + s.label + '</div>'; }).join('');
                drop.querySelectorAll('.cs-opt').forEach(function (el) {
                    el.addEventListener('click', function () {
                        selectCrmSourceValue(this.dataset.value);
                        closeCrmSourceDropdown();
                        crmFilterTimer();
                    });
                });
            }

            function getCrmStatusValue() {
                return document.getElementById('crmStatusSelected').dataset.value || '';
            }

            function setCrmStatusValue(value) {
                var el = document.getElementById('crmStatusSelected');
                var label = 'Todos status';
                if (value) {
                    var found = CRM_STATUS.find(function (s) { return s.value === value; });
                    if (found) label = found.label;
                }
                el.textContent = label;
                el.dataset.value = value || '';
                document.querySelectorAll('#crmStatusDrop .cs-opt').forEach(function (o) { o.classList.toggle('selected', o.dataset.value === (value || '')); });
            }

            function selectCrmStatusValue(value) {
                setCrmStatusValue(value);
            }

            function getCrmSourceValue() {
                return document.getElementById('crmSourceSelected').dataset.value || '';
            }

            function setCrmSourceValue(value) {
                var el = document.getElementById('crmSourceSelected');
                var label = 'Todas origens';
                if (value) {
                    var found = CRM_SOURCES.find(function (s) { return s.value === value; });
                    if (found) label = found.label;
                }
                el.textContent = label;
                el.dataset.value = value || '';
                document.querySelectorAll('#crmSourceDrop .cs-opt').forEach(function (o) { o.classList.toggle('selected', o.dataset.value === (value || '')); });
            }

            function selectCrmSourceValue(value) {
                setCrmSourceValue(value);
            }

            function toggleCrmStatusDropdown() {
                var drop = document.getElementById('crmStatusDrop');
                var isVisible = drop.classList.contains('visible');
                closeAllCrmDropdowns();
                if (!isVisible) { initCrmStatusDropdown(); drop.classList.add('visible'); }
            }

            function toggleCrmSourceDropdown() {
                var drop = document.getElementById('crmSourceDrop');
                var isVisible = drop.classList.contains('visible');
                closeAllCrmDropdowns();
                if (!isVisible) { initCrmSourceDropdown(); drop.classList.add('visible'); }
            }

            function closeAllCrmDropdowns() {
                document.querySelectorAll('#crmStatusDrop, #crmSourceDrop, #roletaAssignDrop, #roletaUserDrop').forEach(function (el) { el.classList.remove('visible'); });
            }

            function closeCrmStatusDropdown() {
                document.getElementById('crmStatusDrop').classList.remove('visible');
            }

            function closeCrmSourceDropdown() {
                document.getElementById('crmSourceDrop').classList.remove('visible');
            }

            // =====================================================================
            //  MÉTRICAS
            // =====================================================================

            var METRICA_SOURCES = [
                { value: 'google', label: 'Google Ads' },
                { value: 'meta', label: 'Meta Ads' },
            ];

            // =====================================================================
            //  META ADS API
            // =====================================================================

            async function fetchMetaAdsData() {
                var token = localStorage.getItem('veltris_meta_token');
                var adAccount = localStorage.getItem('veltris_meta_ad_account');
                if (!token || !adAccount) return null;

                var accountId = adAccount.replace(/^act_?/, '');
                var url = 'https://graph.facebook.com/v21.0/' + accountId + '/insights' +
                    '?access_token=' + encodeURIComponent(token) +
                    '&fields=campaign_name,spend,impressions,clicks,ctr,cpc,actions' +
                    '&level=campaign&date_preset=last_30d&limit=100';

                var resp = await fetch(url);
                var json = await resp.json();
                if (json.error) throw new Error(json.error.message);

                var campaigns = (json.data || []).map(function (c) {
                    var leads = 0;
                    (c.actions || []).forEach(function (a) {
                        if (a.action_type === 'lead' || a.action_type === 'onsite_conversion_lead' || a.action_type === 'offline_conversion') {
                            leads += parseInt(a.value) || 0;
                        }
                    });
                    return {
                        name: c.campaign_name || 'Sem nome',
                        spend: parseFloat(c.spend) || 0,
                        impressions: parseInt(c.impressions) || 0,
                        clicks: parseInt(c.clicks) || 0,
                        leads: leads,
                        ctr: parseFloat(c.ctr) || 0,
                        cpc: parseFloat(c.cpc) || 0,
                        cpl: leads > 0 ? ((parseFloat(c.spend) || 0) / leads) : 0
                    };
                });

                var totalSpend = campaigns.reduce(function (s, c) { return s + c.spend; }, 0);
                var totalLeads = campaigns.reduce(function (s, c) { return s + c.leads; }, 0);
                var totalImpressions = campaigns.reduce(function (s, c) { return s + c.impressions; }, 0);
                var totalClicks = campaigns.reduce(function (s, c) { return s + c.clicks; }, 0);

                return {
                    campaigns: campaigns,
                    summary: {
                        total_spend: totalSpend,
                        total_leads: totalLeads,
                        total_impressions: totalImpressions,
                        total_clicks: totalClicks,
                        overall_cpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
                        overall_ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
                        overall_cpc: totalClicks > 0 ? totalSpend / totalClicks : 0
                    }
                };
            }

            // =====================================================================
            //  GOOGLE ADS API (via Supabase Edge Function proxy)
            // =====================================================================

            async function fetchGoogleAdsData() {
                var devToken = localStorage.getItem('veltris_google_dev_token');
                var clientId = localStorage.getItem('veltris_google_client_id');
                var clientSecret = localStorage.getItem('veltris_google_client_secret');
                var refreshToken = localStorage.getItem('veltris_google_refresh_token');
                var customerId = localStorage.getItem('veltris_google_customer_id');
                if (!devToken || !clientId || !clientSecret || !refreshToken || !customerId) return null;

                try {
                    var result = await api._callFunc('google-ads-proxy', {
                        developerToken: devToken,
                        clientId: clientId,
                        clientSecret: clientSecret,
                        refreshToken: refreshToken,
                        customerId: customerId
                    });
                    return result;
                } catch (e) {
                    throw new Error('Erro ao buscar dados do Google Ads: ' + e.message);
                }
            }

            var METRICA_STATUS_ORDER = ['new', 'contacted', 'negotiating', 'won'];
            var METRICA_STATUS_LOST = 'lost';

            function initMetricaSourceDropdown() {
                var drop = document.getElementById('metricaSourceDrop');
                if (!drop || drop.dataset.inited) return;
                drop.dataset.inited = '1';
                drop.innerHTML = METRICA_SOURCES.map(function (s) {
                    return '<div class="cs-opt' + (s.value === 'google' ? ' selected' : '') + '" data-value="' + s.value + '">' + s.label + '</div>';
                }).join('');
                drop.querySelectorAll('.cs-opt').forEach(function (el) {
                    el.addEventListener('click', function () {
                        selectMetricaSource(this.dataset.value);
                        closeMetricaSourceDropdown();
                        renderMetricas();
                    });
                });
                if (!document.getElementById('metricaSourceSelected').dataset.value) {
                    setMetricaSource('google');
                }
            }

            function getMetricaSource() {
                return document.getElementById('metricaSourceSelected').dataset.value || 'google';
            }

            function setMetricaSource(value) {
                var el = document.getElementById('metricaSourceSelected');
                var found = METRICA_SOURCES.find(function (s) { return s.value === value; });
                el.textContent = found ? found.label : 'Google Ads';
                el.dataset.value = value || 'google';
                document.querySelectorAll('#metricaSourceDrop .cs-opt').forEach(function (o) {
                    o.classList.toggle('selected', o.dataset.value === (value || 'google'));
                });
            }

            function selectMetricaSource(value) {
                setMetricaSource(value);
            }

            function toggleMetricaSourceDropdown() {
                var drop = document.getElementById('metricaSourceDrop');
                var isVisible = drop.classList.contains('visible');
                closeMetricaSourceDropdown();
                if (!isVisible) { initMetricaSourceDropdown(); drop.classList.add('visible'); }
            }

            function closeMetricaSourceDropdown() {
                var drop = document.getElementById('metricaSourceDrop');
                if (drop) drop.classList.remove('visible');
            }

            function renderMetricas() {
                var source = getMetricaSource();
                if (!source) return;

                var statusEl = document.getElementById('metricaStatus');
                statusEl.textContent = '⏳ Carregando...';
                statusEl.style.color = 'var(--text-muted)';

                // Try API data first
                var apiFetch = source === 'meta' ? fetchMetaAdsData() : fetchGoogleAdsData();
                apiFetch.then(function (apiData) {
                    if (apiData && apiData.campaigns && apiData.campaigns.length) {
                        renderAdData(source, apiData);
                        // Also render CRM funnel in secondary section
                        loadCrmLeadsForMetricas(source, true);
                        statusEl.textContent = '<i class="fi fi-rr-check-circle"></i> Dados da API • ' + (source === 'meta' ? 'Meta Ads' : 'Google Ads');
                        statusEl.style.color = '#4ade80';
                    } else {
                        // No API data, fall back to CRM
                        statusEl.textContent = '<i class="fi fi-rr-clipboard-list"></i> Dados do CRM (API não configurada)';
                        statusEl.style.color = 'var(--text-muted)';
                        loadCrmLeadsForMetricas(source, false);
                    }
                }).catch(function (err) {
                    statusEl.textContent = '<i class="fi fi-rr-triangle-warning"></i> API: ' + err.message + ' • Usando CRM';
                    statusEl.style.color = '#f87171';
                    loadCrmLeadsForMetricas(source, false);
                });
            }

            function loadCrmLeadsForMetricas(source, isFallback) {
                try {
                    if (crmLeads && crmLeads.length) {
                        renderMetricasCrm(source, crmLeads.filter(function (l) { return l.source === source; }), isFallback);
                    } else if (api && api.isLoggedIn()) {
                        api.listLeads().then(function (result) {
                            crmLeads = result || [];
                            renderMetricasCrm(source, crmLeads.filter(function (l) { return l.source === source; }), isFallback);
                        });
                    } else {
                        renderMetricasCrm(source, [], isFallback);
                    }
                } catch (e) { renderMetricasCrm(source, [], isFallback); }
            }

            function renderAdData(source, apiData) {
                var s = apiData.summary;
                var campaigns = apiData.campaigns;

                // Update summary cards
                document.getElementById('metTotalSpend').textContent = fmtVal(s.total_spend);
                document.getElementById('metTotalLeads').textContent = s.total_leads;
                document.getElementById('metCpl').textContent = 'R$ ' + s.overall_cpl.toFixed(2);
                document.getElementById('metCtr').textContent = s.overall_ctr.toFixed(2) + '%';
                document.getElementById('metImpressions').textContent = s.total_impressions.toLocaleString('pt-BR');
                document.getElementById('metClicks').textContent = s.total_clicks.toLocaleString('pt-BR');

                // Show campaign section
                document.getElementById('metricaApiSection').style.display = '';

                // Render campaign table
                var tableHtml = campaigns.map(function (c) {
                    var statusLabel = c.status === 'ACTIVE' ? '<i class="fi fi-rr-check-circle"></i> Ativa' : c.status === 'PAUSED' ? '⏸ Pausada' : '⏹ ' + (c.status || '');
                    return '<tr>' +
                        '<td style="font-weight:500">' + esc(c.name) + '</td>' +
                        '<td style="font-size:0.65rem">' + statusLabel + '</td>' +
                        '<td class="crm-val">' + fmtVal(c.spend) + '</td>' +
                        '<td>' + (c.impressions || 0).toLocaleString('pt-BR') + '</td>' +
                        '<td>' + (c.clicks || 0).toLocaleString('pt-BR') + '</td>' +
                        '<td>' + (c.leads || 0) + '</td>' +
                        '<td>' + (c.ctr || 0).toFixed(2) + '%</td>' +
                        '<td>R$ ' + (c.cpc || 0).toFixed(2) + '</td>' +
                        '<td>R$ ' + (c.cpl || 0).toFixed(2) + '</td>' +
                        '</tr>';
                }).join('');
                document.getElementById('metricaCampaignBody').innerHTML = tableHtml;

                // Render ad funnel: Impressions → Clicks → Leads
                var impressions = s.total_impressions;
                var clicks = s.total_clicks;
                var leads = s.total_leads;
                var maxFunnel = Math.max(impressions, clicks, leads, 1);

                var funnelStages = [
                    { label: '👀 Impressões', count: impressions, pct: (impressions / maxFunnel) * 100, bar: 'funil-bar-new' },
                    { label: '🖱 Cliques', count: clicks, pct: (clicks / maxFunnel) * 100, bar: 'funil-bar-contacted' },
                    { label: '📩 Leads', count: leads, pct: (leads / maxFunnel) * 100, bar: 'funil-bar-won' },
                ];

                var funnelHtml = '';
                for (var i = 0; i < funnelStages.length; i++) {
                    var st = funnelStages[i];
                    var w = st.pct;
                    if (w < 5) w = 5;
                    var convFrom = '';
                    if (i > 0) {
                        var prev = funnelStages[i - 1].count;
                        var cv = prev > 0 ? (st.count / prev * 100) : 0;
                        var cls = cv <= 10 ? 'funil-conv-pct down' : 'funil-conv-pct';
                        convFrom = '<span class="' + cls + '">' + cv.toFixed(1) + '%</span>';
                    } else {
                        convFrom = '<span class="funil-conv-pct" style="color:var(--text-muted)">100%</span>';
                    }
                    funnelHtml +=
                        '<div class="funil-stage">' +
                        '<div class="funil-stage-top">' +
                        '<div class="funil-stage-name">' + st.label + '</div>' +
                        '<div class="funil-stage-stats">' +
                        '<span class="fi-count">' + st.count.toLocaleString('pt-BR') + '</span>' +
                        '<span class="funil-conv-pct">' + convFrom + '</span>' +
                        '</div>' +
                        '</div>' +
                        '<div class="funil-bar-wrap">' +
                        '<div class="' + st.bar + '" style="width:' + w.toFixed(0) + '%">' + st.count.toLocaleString('pt-BR') + '</div>' +
                        '</div>' +
                        '</div>';
                }
                document.getElementById('metricaFunnel').innerHTML = funnelHtml;
            }

            function renderMetricasCrm(source, leads, isFallback) {
                // Hide API section
                document.getElementById('metricaApiSection').style.display = 'none';

                var totalLeads = leads.length;
                // Update summary cards (only when primary)
                if (!isFallback) {
                    document.getElementById('metTotalSpend').textContent = '—';
                    document.getElementById('metCpl').textContent = '—';
                    document.getElementById('metCtr').textContent = '—';
                    document.getElementById('metImpressions').textContent = '—';
                    document.getElementById('metClicks').textContent = '—';
                }
                document.getElementById('metTotalLeads').textContent = totalLeads;
                var counts = {};
                var values = {};
                METRICA_STATUS_ORDER.forEach(function (s) { counts[s] = 0; values[s] = 0; });
                counts['lost'] = 0; values['lost'] = 0;

                leads.forEach(function (l) {
                    var st = l.status || 'new';
                    if (counts[st] !== undefined) counts[st]++;
                    var val = (l.project_value || 0);
                    if (values[st] !== undefined) values[st] += val;
                });

                var totalLeads = leads.length;
                var wonCount = counts['won'] || 0;
                var totalRevenue = values['won'] || 0;
                var nonLostLeads = METRICA_STATUS_ORDER.reduce(function (acc, s) { return acc + counts[s]; }, 0);
                var convRate = nonLostLeads > 0 ? (wonCount / nonLostLeads * 100) : 0;
                var avgTicket = wonCount > 0 ? totalRevenue / wonCount : 0;

                document.getElementById('metTotalSpend').textContent = '—';
                document.getElementById('metTotalLeads').textContent = totalLeads;
                document.getElementById('metCpl').textContent = '—';
                document.getElementById('metCtr').textContent = '—';
                document.getElementById('metImpressions').textContent = '—';
                document.getElementById('metClicks').textContent = '—';

                // Render CRM funnel
                var maxCount = 1;
                METRICA_STATUS_ORDER.forEach(function (s) { if (counts[s] > maxCount) maxCount = counts[s]; });

                var funnelHtml = '';
                METRICA_STATUS_ORDER.forEach(function (s, i) {
                    var cnt = counts[s] || 0;
                    var val = values[s] || 0;
                    var pct = maxCount > 0 ? (cnt / maxCount * 100) : 0;
                    if (pct < 8) pct = 8;
                    var stageNames = { 'new': '🆕 Novo', 'contacted': '📞 Contatado', 'negotiating': '🤝 Negociando', 'won': '<i class="fi fi-rr-check-circle"></i> Ganho' };
                    var stageLabel = stageNames[s] || s;
                    var barClass = 'funil-bar funil-bar-' + s;
                    var convFromPrev = '';
                    if (i > 0) {
                        var prevCnt = counts[METRICA_STATUS_ORDER[i - 1]] || 0;
                        var convPct = prevCnt > 0 ? (cnt / prevCnt * 100) : 0;
                        var cls = convPct <= 50 ? 'funil-conv-pct down' : 'funil-conv-pct';
                        convFromPrev = '<span class="' + cls + '">' + convPct.toFixed(0) + '%</span>';
                    } else {
                        convFromPrev = '<span class="funil-conv-pct" style="color:var(--text-muted)">0%</span>';
                    }
                    funnelHtml +=
                        '<div class="funil-stage">' +
                        '<div class="funil-stage-top">' +
                        '<div class="funil-stage-name">' + stageLabel + '</div>' +
                        '<div class="funil-stage-stats">' +
                        '<span class="fi-count">' + cnt + '</span>' +
                        '<span class="fi-value">' + fmtVal(val) + '</span>' +
                        '<span class="funil-conv-pct">' + convFromPrev + '</span>' +
                        '</div>' +
                        '</div>' +
                        '<div class="funil-bar-wrap">' +
                        '<div class="' + barClass + '" style="width:' + pct.toFixed(0) + '%">' + cnt + '</div>' +
                        '</div>' +
                        '</div>';
                });

                var lostCnt = counts['lost'] || 0;
                if (lostCnt > 0) {
                    funnelHtml +=
                        '<div class="funil-stage" style="opacity:0.7">' +
                        '<div class="funil-stage-top">' +
                        '<div class="funil-stage-name"><i class="fi fi-rr-cross-circle"></i> Perdido</div>' +
                        '<div class="funil-stage-stats">' +
                        '<span class="fi-count">' + lostCnt + '</span>' +
                        '<span class="fi-value">' + fmtVal(values['lost'] || 0) + '</span>' +
                        '</div>' +
                        '</div>' +
                        '<div class="funil-bar-wrap">' +
                        '<div class="funil-bar funil-bar-lost" style="width:' + (maxCount > 0 ? Math.max(5, lostCnt / maxCount * 100) : 5).toFixed(0) + '%">' + lostCnt + '</div>' +
                        '</div>' +
                        '</div>';
                }
                document.getElementById('metricaFunnel').innerHTML = funnelHtml;

                // Render CRM conversion table
                var tableHtml = '';
                var prevCnt = totalLeads;
                METRICA_STATUS_ORDER.forEach(function (s) {
                    var cnt = counts[s] || 0;
                    var val = values[s] || 0;
                    var pctOfTop = totalLeads > 0 ? (cnt / totalLeads * 100) : 0;
                    var convPct = prevCnt > 0 ? (cnt / prevCnt * 100) : 0;
                    var stageNames = { 'new': 'Novo', 'contacted': 'Contatado', 'negotiating': 'Negociando', 'won': 'Ganho' };
                    tableHtml +=
                        '<tr>' +
                        '<td style="font-weight:500">' + stageNames[s] + '</td>' +
                        '<td>' + cnt + '</td>' +
                        '<td class="crm-val">' + fmtVal(val) + '</td>' +
                        '<td>' + pctOfTop.toFixed(1) + '%</td>' +
                        '<td style="font-weight:600;color:' + (convPct <= 50 ? '#f87171' : '#4ade80') + '">' + convPct.toFixed(1) + '%</td>' +
                        '</tr>';
                    prevCnt = cnt;
                });
                var lc = counts['lost'] || 0;
                if (lc > 0) {
                    var lostPct = totalLeads > 0 ? (lc / totalLeads * 100) : 0;
                    tableHtml +=
                        '<tr style="opacity:0.6">' +
                        '<td style="font-weight:500">Perdido</td>' +
                        '<td>' + lc + '</td>' +
                        '<td class="crm-val">' + fmtVal(values['lost'] || 0) + '</td>' +
                        '<td>' + lostPct.toFixed(1) + '%</td>' +
                        '<td style="color:#f87171">—</td>' +
                        '</tr>';
                }
                document.getElementById('metricaConvBody').innerHTML = tableHtml;
            }

            document.addEventListener('click', function (e) {
                if (!e.target.closest('[id$="StatusTrigger"], [id$="StatusDrop"], [id$="SourceTrigger"], [id$="SourceDrop"], [id$="AssignTrigger"], [id$="AssignDrop"], [id$="UserTrigger"], [id$="UserDrop"], [id$="MetricaSourceTrigger"], [id$="MetricaSourceDrop"]')) {
                    closeAllCrmDropdowns();
                    closeMetricaSourceDropdown();
                }
            });

            // ── Lead Modal Dropdowns ──

            function initLeadSourceDropdown() {
                var drop = document.getElementById('leadSourceDrop');
                if (!drop || drop.dataset.inited) return;
                drop.dataset.inited = '1';
                drop.innerHTML = CRM_SOURCES.map(function (s) { return '<div class="cs-opt" data-value="' + s.value + '">' + s.label + '</div>'; }).join('');
                drop.querySelectorAll('.cs-opt').forEach(function (el) {
                    el.addEventListener('click', function () {
                        selectLeadSourceValue(this.dataset.value);
                        closeLeadSourceDropdown();
                    });
                });
            }

            function initLeadStatusDropdown() {
                var drop = document.getElementById('leadStatusDrop');
                if (!drop || drop.dataset.inited) return;
                drop.dataset.inited = '1';
                drop.innerHTML = CRM_STATUS.map(function (s) { return '<div class="cs-opt" data-value="' + s.value + '">' + s.label + '</div>'; }).join('');
                drop.querySelectorAll('.cs-opt').forEach(function (el) {
                    el.addEventListener('click', function () {
                        selectLeadStatusValue(this.dataset.value);
                        closeLeadStatusDropdown();
                    });
                });
            }

            function getLeadSourceValue() {
                return document.getElementById('leadSourceSelected').dataset.value || 'direct';
            }

            function setLeadSourceValue(value) {
                var el = document.getElementById('leadSourceSelected');
                var found = CRM_SOURCES.find(function (s) { return s.value === value; });
                el.textContent = found ? found.label : 'Direto';
                el.dataset.value = value || 'direct';
                document.querySelectorAll('#leadSourceDrop .cs-opt').forEach(function (o) { o.classList.toggle('selected', o.dataset.value === (value || 'direct')); });
            }

            function selectLeadSourceValue(value) {
                setLeadSourceValue(value);
            }

            function getLeadStatusValue() {
                return document.getElementById('leadStatusSelected').dataset.value || 'new';
            }

            function setLeadStatusValue(value) {
                var el = document.getElementById('leadStatusSelected');
                var found = CRM_STATUS.find(function (s) { return s.value === value; });
                el.textContent = found ? found.label : 'Novo';
                el.dataset.value = value || 'new';
                document.querySelectorAll('#leadStatusDrop .cs-opt').forEach(function (o) { o.classList.toggle('selected', o.dataset.value === (value || 'new')); });
            }

            function selectLeadStatusValue(value) {
                setLeadStatusValue(value);
            }

            function toggleLeadSourceDropdown() {
                var drop = document.getElementById('leadSourceDrop');
                var isVisible = drop.classList.contains('visible');
                closeAllLeadDropdowns();
                if (!isVisible) { initLeadSourceDropdown(); drop.classList.add('visible'); }
            }

            function toggleLeadStatusDropdown() {
                var drop = document.getElementById('leadStatusDrop');
                var isVisible = drop.classList.contains('visible');
                closeAllLeadDropdowns();
                if (!isVisible) { initLeadStatusDropdown(); drop.classList.add('visible'); }
            }

            function closeAllLeadDropdowns() {
                document.querySelectorAll('#leadSourceDrop, #leadStatusDrop').forEach(function (el) { el.classList.remove('visible'); });
            }

            function closeLeadSourceDropdown() {
                document.getElementById('leadSourceDrop').classList.remove('visible');
            }

            function closeLeadStatusDropdown() {
                document.getElementById('leadStatusDrop').classList.remove('visible');
            }

            document.addEventListener('click', function (e) {
                if (!e.target.closest('#leadSourceTrigger, #leadSourceDrop, #leadStatusTrigger, #leadStatusDrop')) {
                    closeAllLeadDropdowns();
                }
            });

            var crmLeads = [];
            var crmFilterTimerId = null;
            var crmPollTimer = null;

            // ── Roleta server cache ──
            var _roletaConfig = null;
            var _roletaAssigns = {};
            var _prevLeadIds = new Set();

            async function loadRoletaData() {
                if (!api.isLoggedIn()) return;
                try {
                    _roletaConfig = await api.getRoletaConfig();
                } catch (e) {
                    _roletaConfig = null;
                }
            }

            async function loadRoletaAssigns() {
                if (!api.isLoggedIn()) return;
                try {
                    _roletaAssigns = await api.getRoletaAssigns() || {};
                } catch (e) {
                    _roletaAssigns = {};
                }
            }

            function startCRMPoll() {
                stopCRMPoll();
                crmPollTimer = setInterval(renderCRM, 5000);
            }
            function stopCRMPoll() {
                if (crmPollTimer) { clearInterval(crmPollTimer); crmPollTimer = null; }
            }

            function crmFilterTimer() {
                clearTimeout(crmFilterTimerId);
                crmFilterTimerId = setTimeout(renderCRM, 300);
            }

            function statusLabel(s) {
                var map = { 'new': 'Novo', 'contacted': 'Contatado', 'negotiating': 'Negociando', 'won': 'Ganho', 'lost': 'Perdido' };
                return map[s] || s;
            }

            function statusClass(s) {
                return 'crm-status-' + (s || 'new');
            }

            function sourceLabel(s) {
                var map = { 'google': 'Google Ads', 'meta': 'Meta Ads', 'direct': 'Direto', 'external': 'Externo' };
                return map[s] || s;
            }

            function sourceClass(s) {
                return 'crm-source-' + (s || 'direct');
            }

            function fmtVal(v) {
                if (v == null || isNaN(v)) return '—';
                return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }

            function fmtDate(d) {
                if (!d) return '—';
                var dt = new Date(d);
                return dt.toLocaleDateString('pt-BR');
            }

            var crmReloadTimer = null;

            function scheduleCRMRender() {
                clearTimeout(crmReloadTimer);
                crmReloadTimer = setTimeout(function () { renderCRM(); }, 500);
            }

            async function loadLeads() {
                if (!api.isLoggedIn()) {
                    return [
                        { id: 'l1', name: 'Marcos Silva', phone: '(11) 99999-1111', email: 'marcos@example.com', value: 5000, status: 'new', source: 'google', created_at: new Date(Date.now() - 100000).toISOString() },
                        { id: 'l2', name: 'Juliana Costa', phone: '(11) 98888-2222', email: 'juliana@example.com', value: 3500, status: 'contacted', source: 'meta', created_at: new Date(Date.now() - 3600000).toISOString() },
                        { id: 'l3', name: 'Roberto Almeida', phone: '(21) 97777-3333', email: 'roberto@example.com', value: 12000, status: 'qualified', source: 'google', created_at: new Date(Date.now() - 7200000).toISOString() },
                        { id: 'l4', name: 'Fernanda Lima', phone: '(31) 96666-4444', email: 'fernanda@example.com', value: 800, status: 'converted', source: 'meta', created_at: new Date(Date.now() - 86400000).toISOString() },
                        { id: 'l5', name: 'Pedro Henrique', phone: '(41) 95555-5555', email: 'pedro@example.com', value: 2500, status: 'new', source: 'google', created_at: new Date(Date.now() - 172800000).toISOString() },
                        { id: 'l6', name: 'Camila Rocha', phone: '(51) 94444-6666', email: 'camila@example.com', value: 4500, status: 'contacted', source: 'meta', created_at: new Date(Date.now() - 259200000).toISOString() },
                        { id: 'l7', name: 'Lucas Martins', phone: '(61) 93333-7777', email: 'lucas@example.com', value: 15000, status: 'qualified', source: 'google', created_at: new Date(Date.now() - 345600000).toISOString() },
                        { id: 'l8', name: 'Mariana Azevedo', phone: '(71) 92222-8888', email: 'mariana@example.com', value: 3200, status: 'converted', source: 'meta', created_at: new Date(Date.now() - 432000000).toISOString() },
                        { id: 'l9', name: 'Tiago Mendes', phone: '(81) 91111-9999', email: 'tiago@example.com', value: 6700, status: 'new', source: 'google', created_at: new Date(Date.now() - 518400000).toISOString() },
                        { id: 'l10', name: 'Amanda Oliveira', phone: '(91) 90000-0000', email: 'amanda@example.com', value: 9400, status: 'contacted', source: 'meta', created_at: new Date(Date.now() - 604800000).toISOString() },
                        { id: 'l11', name: 'Ricardo Souza', phone: '(11) 98765-4321', email: 'ricardo@example.com', value: 11000, status: 'qualified', source: 'google', created_at: new Date(Date.now() - 691200000).toISOString() },
                        { id: 'l12', name: 'Beatriz Castro', phone: '(21) 97654-3210', email: 'beatriz@example.com', value: 500, status: 'converted', source: 'meta', created_at: new Date(Date.now() - 777600000).toISOString() },
                        { id: 'l13', name: 'Guilherme Dias', phone: '(31) 96543-2109', email: 'guilherme@example.com', value: 2100, status: 'new', source: 'google', created_at: new Date(Date.now() - 864000000).toISOString() },
                        { id: 'l14', name: 'Leticia Ramos', phone: '(41) 95432-1098', email: 'leticia@example.com', value: 3800, status: 'contacted', source: 'meta', created_at: new Date(Date.now() - 950400000).toISOString() },
                        { id: 'l15', name: 'Diego Ferreira', phone: '(51) 94321-0987', email: 'diego@example.com', value: 8500, status: 'qualified', source: 'google', created_at: new Date(Date.now() - 1036800000).toISOString() },
                        { id: 'l16', name: 'Tatiana Moura', phone: '(61) 93210-9876', email: 'tatiana@example.com', value: 14000, status: 'converted', source: 'meta', created_at: new Date(Date.now() - 1123200000).toISOString() },
                        { id: 'l17', name: 'Rafael Silva', phone: '(71) 92109-8765', email: 'rafael@example.com', value: 7200, status: 'new', source: 'google', created_at: new Date(Date.now() - 1209600000).toISOString() },
                        { id: 'l18', name: 'Carolina Alves', phone: '(81) 91098-7654', email: 'carolina@example.com', value: 9900, status: 'contacted', source: 'meta', created_at: new Date(Date.now() - 1296000000).toISOString() },
                        { id: 'l19', name: 'Felipe Gomes', phone: '(91) 90987-6543', email: 'felipe@example.com', value: 5300, status: 'qualified', source: 'google', created_at: new Date(Date.now() - 1382400000).toISOString() },
                        { id: 'l20', name: 'Isabela Nunes', phone: '(11) 99876-5432', email: 'isabela@example.com', value: 27500, status: 'converted', source: 'meta', created_at: new Date(Date.now() - 1468800000).toISOString() }
                    ];
                }
                try {
                    var result = await api.listLeads();
                    var leads = result || [];
                    var search = (document.getElementById('crmSearch') || {}).value;
                    var statusF = getCrmStatusValue();
                    var sourceF = getCrmSourceValue();
                    if (search) leads = leads.filter(function (l) { return (l.name || '').toLowerCase().includes(search.toLowerCase()) || (l.phone || '').includes(search); });
                    if (statusF) leads = leads.filter(function (l) { return l.status === statusF; });
                    if (sourceF) leads = leads.filter(function (l) { return l.source === sourceF; });
                    return leads;
                } catch (e) {
                    return [];
                }
            }

            function autoAssignRoletaLeads() {
                var data = getRoletaData();
                if (!data.enabled || !data.pages) return;
                var assigns = getRoletaAssigns();
                var changed = false;
                crmLeads.forEach(function (lead) {
                    if (assigns[lead.id]) return;
                    var campaign = (lead.campaign || '').trim().toLowerCase();
                    if (!campaign) return;
                    var matchedPageId = null;
                    Object.keys(data.pages).forEach(function (pid) {
                        if ((data.pages[pid].name || '').trim().toLowerCase() === campaign) {
                            matchedPageId = pid;
                        }
                    });
                    if (!matchedPageId) return;
                    var matchedRoletaId = null;
                    Object.keys(data.roletas).forEach(function (rid) {
                        var r = data.roletas[rid];
                        if (r.pages && r.pages.indexOf(matchedPageId) !== -1) {
                            matchedRoletaId = rid;
                        }
                    });
                    if (!matchedRoletaId) return;
                    var roleta = data.roletas[matchedRoletaId];
                    if (!roleta.users || !roleta.users.length) return;
                    var nextUser = roleta.users[roleta.index];
                    if (!nextUser) return;
                    assigns[lead.id] = nextUser.id;
                    roleta.index = (roleta.index + 1) % roleta.users.length;
                    changed = true;
                });
                if (changed) {
                    saveRoletaAssigns(assigns);
                    saveRoletaData(data);
                }
            }

            async function renderCRM() {
                if (!api.isLoggedIn()) return;
                var prevLeads = crmLeads.slice();
                crmLeads = await loadLeads();

                // Detect new leads and fire browser notification
                if (crmLeads.length > prevLeads.length) {
                    var prevIds = new Set(prevLeads.map(function (l) { return l.id; }));
                    var newLeads = crmLeads.filter(function (l) { return !prevIds.has(l.id); });
                    newLeads.forEach(function (l) {
                        try {
                            if (Notification && Notification.permission === 'granted') {
                                var n = new Notification('Novo lead: ' + l.name, {
                                    body: 'Origem: ' + sourceLabel(l.source) + (l.campaign ? ' · ' + l.campaign : ''),
                                    icon: '/favicon.ico'
                                });
                                setTimeout(function () { n.close(); }, 6000);
                            }
                        } catch (e) { if (svg) svg.innerHTML = renderEmptyChartGrid(); }
                    });
                }

                autoAssignRoletaLeads();
                var body = document.getElementById('crmBody');
                var empty = document.getElementById('crmEmpty');
                var counter = document.getElementById('crmCounter');
                if (!body) return;

                if (!crmLeads.length) {
                    body.innerHTML = '';
                    empty.style.display = 'block';
                    counter.textContent = '0 leads';
                    return;
                }
                empty.style.display = 'none';
                counter.textContent = crmLeads.length + ' lead' + (crmLeads.length !== 1 ? 's' : '');

                body.innerHTML = crmLeads.map(function (l) {
                    var checked = crmSelectedIds.has(l.id) ? 'checked' : '';
                    var roletaAssign = getLeadRoletaAssign(l.id);
                    var roletaUser = '';
                    if (roletaAssign) {
                        var rd = getRoletaData();
                        var activeRoleta = getActiveRoleta(rd);
                        var ru = activeRoleta ? activeRoleta.users.find(function (u) { return u.id === roletaAssign; }) : null;
                        if (ru) roletaUser = '<span style="display:inline-block;padding:1px 7px;border-radius:100px;background:rgba(var(--opacity-color),0.05);color:var(--text-dim);font-size:0.6rem;margin-left:6px">' + esc(ru.name) + '</span>';
                    }
                    return '<tr class="crm-clickable" onclick="openLeadModal(' + l.id + ')">' +
                        '<td class="crm-chk" style="width:32px;text-align:center" onclick="event.stopPropagation()">' +
                        '<input type="checkbox" ' + checked + ' onchange="toggleCrmSelect(' + l.id + ')" />' +
                        '</td>' +
                        '<td style="font-weight:500">' + esc(l.name) + roletaUser + '</td>' +
                        '<td style="color:var(--text-dim)">' + esc(l.phone || '—') + '</td>' +
                        '<td><span class="crm-source ' + sourceClass(l.source) + '">' + sourceLabel(l.source) + '</span></td>' +
                        '<td><span class="crm-status ' + statusClass(l.status) + '">' + statusLabel(l.status) + '</span></td>' +
                        '<td class="crm-val">' + fmtVal(l.project_value) + '</td>' +
                        '<td style="color:var(--text-muted);font-size:0.7rem">' + (l.close_date ? l.close_date : fmtDate(l.created_at)) + '</td>' +
                        '<td class="crm-actions" onclick="event.stopPropagation()">' +
                        '<button class="btn-icon" onclick="openWppForLead(' + l.id + ')" title="WhatsApp" style="font-size:0.9rem"><i class="fi fi-rr-comment-alt"></i></button>' +
                        '<button class="btn-icon" onclick="openLeadModal(' + l.id + ')" title="Editar lead"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 1.2em; height: 1.2em;"></button>' +
                        '<button class="btn-icon btn-icon-del" onclick="deleteLead(' + l.id + ')" title="Remover lead">🗑</button>' +
                        '</td>' +
                        '</tr>';
                }).join('');
                updateCrmBulkBar();
            }

            function openLeadForm() {
                document.getElementById('leadModalTitle').textContent = 'Novo Lead';
                document.getElementById('leadId').value = '';
                document.getElementById('leadName').value = '';
                document.getElementById('leadPhone').value = '';
                document.getElementById('leadEmail').value = '';
                document.getElementById('leadCampaign').value = '';
                document.getElementById('leadProjectValue').value = '';
                document.getElementById('leadCloseDate').value = '';
                document.getElementById('dpLeadCloseVal').textContent = '--/--/--';
                dpState['dpLeadClose'] = null;
                document.getElementById('leadDescription').value = '';
                document.getElementById('leadNotes').value = '';
                setLeadSourceValue('direct');
                setLeadStatusValue('new');
                setRoletaAssignValue(null);
                updateRoletaAssignVisibility();
                document.getElementById('leadModal').classList.add('open');
            }

            function openLeadModal(id) {
                var l = crmLeads.find(function (x) { return x.id === id; });
                if (!l) return;
                document.getElementById('leadModalTitle').textContent = '✏️ ' + esc(l.name);
                document.getElementById('leadId').value = l.id;
                document.getElementById('leadName').value = l.name;
                document.getElementById('leadPhone').value = l.phone || '';
                document.getElementById('leadEmail').value = l.email || '';
                document.getElementById('leadCampaign').value = l.campaign || '';
                document.getElementById('leadProjectValue').value = l.project_value || '';
                document.getElementById('leadCloseDate').value = l.close_date || '';
                if (l.close_date) {
                    var parts = l.close_date.split('-');
                    var d = new Date(parts[0], parts[1] - 1, parts[2]);
                    document.getElementById('dpLeadCloseVal').textContent = d.getDate().toString().padStart(2, '0') + '/' + (d.getMonth() + 1).toString().padStart(2, '0');
                    dpState['dpLeadClose'] = { month: d.getMonth(), year: d.getFullYear(), selected: l.close_date, view: 'day', yrRange: d.getFullYear() - 6 };
                } else {
                    document.getElementById('dpLeadCloseVal').textContent = '--/--/--';
                    dpState['dpLeadClose'] = null;
                }
                document.getElementById('leadDescription').value = l.description || '';
                document.getElementById('leadNotes').value = l.notes || '';
                setLeadSourceValue(l.source || 'direct');
                setLeadStatusValue(l.status || 'new');
                setRoletaAssignValue(l.assigned_to || null);
                updateRoletaAssignVisibility();
                document.getElementById('leadModal').classList.add('open');
            }

            function closeLeadModal() {
                document.getElementById('leadModal').classList.remove('open');
            }

            async function saveLead() {
                var id = document.getElementById('leadId').value;
                var data = {
                    name: document.getElementById('leadName').value.trim(),
                    phone: document.getElementById('leadPhone').value.trim(),
                    email: document.getElementById('leadEmail').value.trim(),
                    source: getLeadSourceValue(),
                    campaign: document.getElementById('leadCampaign').value.trim(),
                    project_value: parseFloat(document.getElementById('leadProjectValue').value) || null,
                    close_date: document.getElementById('leadCloseDate').value || null,
                    description: document.getElementById('leadDescription').value.trim(),
                    status: getLeadStatusValue(),
                    notes: document.getElementById('leadNotes').value.trim(),
                };
                if (!data.name) { showToast('<i class="fi fi-rr-triangle-warning"></i> Nome é obrigatório'); return; }
                try {
                    var rotAssign = getRoletaAssignValue();
                    if (id) {
                        await api.updateLead(parseInt(id), data);
                        if (rotAssign) setLeadRoletaAssign(parseInt(id), rotAssign);
                        else removeLeadRoletaAssign(parseInt(id));
                        showToast('<i class="fi fi-rr-check-circle"></i> Lead atualizado!');
                    } else {
                        var result = await api.createLead(data);
                        if (rotAssign && result && result.id) setLeadRoletaAssign(result.id, rotAssign);
                        showToast('<i class="fi fi-rr-check-circle"></i> Lead criado!');
                    }
                    // Auto-rotation: if assigned to the current roleta user, rotate
                    if (rotAssign) {
                        var rd = getRoletaData();
                        var rr = getActiveRoleta(rd);
                        if (rr) rotateRoletaOnAssign(rd, rr, rotAssign);
                    }
                    closeLeadModal();
                    scheduleCRMRender();
                    renderFinanceCharts();
                } catch (e) {
                    showToast('<i class="fi fi-rr-cross-circle"></i> ' + e.message);
                }
            }

            async function deleteLead(id) {
                var ok = await showConfirm('🗑️ Remover lead', 'Remover este lead permanentemente?');
                if (!ok) return;
                try {
                    await api.deleteLead(id);
                    removeLeadRoletaAssign(id);
                    showToast('🗑 Lead removido');
                    scheduleCRMRender();
                } catch (e) {
                    showToast('<i class="fi fi-rr-cross-circle"></i> ' + e.message);
                }
            }

            function openWebhookInfo() {
                document.getElementById('webhookModal').classList.add('open');
            }

            // ── CRM Bulk Edit ──

            var crmEditMode = false;

            function toggleCrmEditMode() {
                crmEditMode = !crmEditMode;
                var table = document.getElementById('crmTable');
                var btn = document.getElementById('crmEditMassBtn');
                if (crmEditMode) {
                    table.classList.add('crm-editing');
                    btn.classList.add('active');
                } else {
                    table.classList.remove('crm-editing');
                    btn.classList.remove('active');
                    crmSelectedIds.clear();
                    updateCrmBulkBar();
                    updateCrmSelectAllCheckbox();
                }
            }

            var crmSelectedIds = new Set();

            function toggleCrmSelect(id) {
                if (crmSelectedIds.has(id)) crmSelectedIds.delete(id);
                else crmSelectedIds.add(id);
                updateCrmBulkBar();
                updateCrmSelectAllCheckbox();
            }

            function toggleCrmSelectAll() {
                var checked = document.getElementById('crmSelectAll').checked;
                crmSelectedIds.clear();
                if (checked) crmLeads.forEach(function (l) { crmSelectedIds.add(l.id); });
                updateCrmBulkBar();
                renderCRM();
            }

            function updateCrmSelectAllCheckbox() {
                var el = document.getElementById('crmSelectAll');
                if (!el) return;
                var visibleIds = crmLeads.map(function (l) { return l.id; });
                var allSelected = visibleIds.length > 0 && visibleIds.every(function (id) { return crmSelectedIds.has(id); });
                el.checked = allSelected;
            }

            function updateCrmBulkBar() {
                var bar = document.getElementById('crmBulkBar');
                var count = document.getElementById('crmBulkCount');
                if (!bar || !count) return;
                var len = crmSelectedIds.size;
                if (len === 0) {
                    bar.style.display = 'none';
                    return;
                }
                bar.style.display = 'flex';
                count.textContent = len + ' lead' + (len !== 1 ? 's' : '') + ' selecionado' + (len !== 1 ? 's' : '');
            }

            function clearCrmSelection() {
                crmSelectedIds.clear();
                updateCrmBulkBar();
                renderCRM();
            }

            function initCrmBulkStatusDropdown() {
                var drop = document.getElementById('crmBulkStatusDrop');
                if (!drop || drop.dataset.inited) return;
                drop.dataset.inited = '1';
                drop.innerHTML = CRM_STATUS.map(function (s) {
                    return '<div class="cs-opt" data-value="' + s.value + '">' + s.label + '</div>';
                }).join('');
                drop.querySelectorAll('.cs-opt').forEach(function (el) {
                    el.addEventListener('click', function () {
                        applyCrmBulkStatus(this.dataset.value);
                        closeCrmBulkStatusDropdown();
                    });
                });
            }

            function toggleCrmBulkStatusDropdown() {
                var drop = document.getElementById('crmBulkStatusDrop');
                var isVisible = drop.classList.contains('visible');
                closeAllCrmBulkDropdowns();
                if (!isVisible) { initCrmBulkStatusDropdown(); drop.classList.add('visible'); }
            }

            function closeCrmBulkStatusDropdown() {
                document.getElementById('crmBulkStatusDrop').classList.remove('visible');
            }

            function initCrmBulkSourceDropdown() {
                var drop = document.getElementById('crmBulkSourceDrop');
                if (!drop || drop.dataset.inited) return;
                drop.dataset.inited = '1';
                drop.innerHTML = CRM_SOURCES.map(function (s) {
                    return '<div class="cs-opt" data-value="' + s.value + '">' + s.label + '</div>';
                }).join('');
                drop.querySelectorAll('.cs-opt').forEach(function (el) {
                    el.addEventListener('click', function () {
                        applyCrmBulkSource(this.dataset.value);
                        closeCrmBulkSourceDropdown();
                    });
                });
            }

            function toggleCrmBulkSourceDropdown() {
                var drop = document.getElementById('crmBulkSourceDrop');
                var isVisible = drop.classList.contains('visible');
                closeAllCrmBulkDropdowns();
                if (!isVisible) { initCrmBulkSourceDropdown(); drop.classList.add('visible'); }
            }

            function closeCrmBulkSourceDropdown() {
                document.getElementById('crmBulkSourceDrop').classList.remove('visible');
            }

            function closeAllCrmBulkDropdowns() {
                document.querySelectorAll('#crmBulkStatusDrop, #crmBulkSourceDrop').forEach(function (el) { el.classList.remove('visible'); });
            }

            document.addEventListener('click', function (e) {
                if (!e.target.closest('#crmBulkStatusTrigger, #crmBulkStatusDrop, #crmBulkSourceTrigger, #crmBulkSourceDrop')) {
                    closeAllCrmBulkDropdowns();
                }
            });

            async function applyCrmBulkStatus(value) {
                var ids = Array.from(crmSelectedIds);
                if (!ids.length) return;
                var label = 'Status';
                var found = CRM_STATUS.find(function (s) { return s.value === value; });
                if (found) label = found.label;
                if (!confirm('Alterar status para "' + label + '" em ' + ids.length + ' lead' + (ids.length !== 1 ? 's' : '') + '?')) return;
                for (var i = 0; i < ids.length; i++) {
                    try {
                        await api.updateLead(ids[i], { status: value });
                    } catch (e) {
                        showToast('<i class="fi fi-rr-cross-circle"></i> Erro no lead ' + ids[i] + ': ' + e.message);
                    }
                }
                showToast('<i class="fi fi-rr-check-circle"></i> Status alterado para ' + ids.length + ' leads');
                clearCrmSelection();
                scheduleCRMRender();
            }

            async function applyCrmBulkSource(value) {
                var ids = Array.from(crmSelectedIds);
                if (!ids.length) return;
                var label = 'Origem';
                var found = CRM_SOURCES.find(function (s) { return s.value === value; });
                if (found) label = found.label;
                if (!confirm('Alterar origem para "' + label + '" em ' + ids.length + ' lead' + (ids.length !== 1 ? 's' : '') + '?')) return;
                for (var i = 0; i < ids.length; i++) {
                    try {
                        await api.updateLead(ids[i], { source: value });
                    } catch (e) {
                        showToast('<i class="fi fi-rr-cross-circle"></i> Erro no lead ' + ids[i] + ': ' + e.message);
                    }
                }
                showToast('<i class="fi fi-rr-check-circle"></i> Origem alterada para ' + ids.length + ' leads');
                clearCrmSelection();
                scheduleCRMRender();
            }

            async function applyCrmBulkDelete() {
                var ids = Array.from(crmSelectedIds);
                if (!ids.length) return;
                var ok = await showConfirm('🗑️ Excluir em massa', 'Remover permanentemente ' + ids.length + ' lead' + (ids.length !== 1 ? 's' : '') + '?');
                if (!ok) return;
                ok = await showConfirm('<i class="fi fi-rr-triangle-warning"></i> Confirmação final', 'Essa ação não pode ser desfeita.');
                if (!ok) return;
                for (var i = 0; i < ids.length; i++) {
                    try {
                        await api.deleteLead(ids[i]);
                    } catch (e) {
                        showToast('<i class="fi fi-rr-cross-circle"></i> Erro no lead ' + ids[i] + ': ' + e.message);
                    }
                }
                showToast('🗑 ' + ids.length + ' lead' + (ids.length !== 1 ? 's' : '') + ' removido' + (ids.length !== 1 ? 's' : ''));
                clearCrmSelection();
                scheduleCRMRender();
            }

            // ── CRM Roleta ──

            function getRoletaData() {
                if (_roletaConfig) return _roletaConfig;
                return { enabled: false, roletas: {}, activeRoletaId: null, pages: {} };
            }

            async function saveRoletaData(d) {
                _roletaConfig = d;
                if (api && api.isLoggedIn()) {
                    try { await api.saveRoletaConfig(d); } catch { }
                }
            }

            function getActiveRoleta(data) {
                if (!data || !data.enabled) return null;
                if (!data.activeRoletaId || !data.roletas[data.activeRoletaId]) {
                    var keys = Object.keys(data.roletas);
                    if (keys.length) { data.activeRoletaId = keys[0]; saveRoletaData(data); }
                    else return null;
                }
                return data.roletas[data.activeRoletaId];
            }

            function toggleCrmRoleta() {
                var panel = document.getElementById('crmRoletaPanel');
                var btn = document.getElementById('crmRoletaBtn');
                var isOpen = panel.style.display !== 'none';
                panel.style.display = isOpen ? 'none' : 'block';
                btn.classList.toggle('active', !isOpen);
                if (!isOpen) renderRoleta();
            }

            function renderRoleta() {
                var data = getRoletaData();
                document.getElementById('roletaToggle').checked = data.enabled;
                var body = document.getElementById('roletaBody');
                body.style.display = data.enabled ? 'block' : 'none';
                if (!data.enabled) return;

                // Render roleta tabs
                var tabBar = document.getElementById('roletaTabBar');
                var keys = Object.keys(data.roletas);
                tabBar.innerHTML = keys.map(function (k) {
                    var r = data.roletas[k];
                    var active = k === data.activeRoletaId ? ' active' : '';
                    return '<div class="roleta-tab-wrap' + active + '">' +
                        '<button class="roleta-tab" onclick="switchRoleta(\'' + k + '\')" title="' + esc(r.name) + '">' + esc(r.name) + '</button>' +
                        '<button class="roleta-tab-close" onclick="event.stopPropagation();deleteRoleta(\'' + k + '\')" title="Excluir roleta">✕</button>' +
                        '</div>';
                }).join('') +
                    '<button class="roleta-tab roleta-tab-add" onclick="createRoleta()" title="Nova roleta">+</button>';

                var roleta = getActiveRoleta(data);
                if (!roleta) {
                    document.getElementById('roletaQueue').style.display = 'none';
                    document.getElementById('roletaLeadsByUser').innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-muted);font-size:0.75rem">Crie uma roleta para começar</div>';
                    return;
                }
                document.getElementById('roletaQueue').style.display = 'block';

                var current = roleta.users[roleta.index];
                document.getElementById('roletaNextUser').textContent = current ? current.name : '—';
                document.getElementById('roletaPosBadge').textContent = roleta.users.length ? (roleta.index + 1) + '/' + roleta.users.length : '0/0';

                var list = document.getElementById('roletaUserList');
                var assigns = getRoletaAssigns();
                var leadsCount = {};
                try {
                    (crmLeads || []).forEach(function (l) {
                        var uid = assigns[l.id] || 'unassigned';
                        leadsCount[uid] = (leadsCount[uid] || 0) + 1;
                    });
                } catch { }

                list.innerHTML = roleta.users.map(function (u, i) {
                    var isCurrent = i === roleta.index;
                    var lc = leadsCount[u.id] || 0;
                    return '<div class="roleta-user-item' + (isCurrent ? ' current' : '') + '">' +
                        '<div class="roleta-user-pos">' + (i + 1) + '</div>' +
                        '<span class="roleta-user-name">' + esc(u.name) + '</span>' +
                        '<span class="roleta-user-leads">' + lc + ' lead' + (lc !== 1 ? 's' : '') + '</span>' +
                        '<button class="roleta-rm-btn" onclick="removeRoletaUser(\'' + u.id + '\')" title="Remover">✕</button>' +
                        '</div>';
                }).join('') || '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.8rem">Nenhum usuário na roleta</div>';

                renderRoletaLeadsByUser();
                renderRoletaPages();
            }

            function renderRoletaPages() {
                var data = getRoletaData();
                var container = document.getElementById('roletaPagesList');
                if (!container) return;
                if (!data.pages) data.pages = {};
                var roleta = getActiveRoleta(data);
                if (!roleta) { container.innerHTML = ''; return; }

                var linkedIds = roleta.pages || [];

                var html = '';
                if (linkedIds.length) {
                    html += linkedIds.map(function (pid) {
                        var p = data.pages[pid];
                        if (!p) return '';
                        var webhookUrl = 'https://dwkjynmelculfzumoreg.supabase.co/functions/v1/crm-webhook?page=' + encodeURIComponent(p.name);
                        return '<div class="roleta-page-item">' +
                            '<span class="roleta-page-name">' + esc(p.name) + '</span>' +
                            '<span class="roleta-page-url" title="' + esc(webhookUrl) + '">' + esc(webhookUrl) + '</span>' +
                            '<span class="roleta-page-linked" onclick="unlinkPageFromRoleta(\'' + pid + '\')" title="Desvincular">✔ Vinculada</span>' +
                            '</div>';
                    }).join('');
                } else {
                    html += '<div style="padding:6px 0;font-size:0.68rem;color:var(--text-muted)">Nenhuma página vinculada</div>';
                }

                var unlinked = Object.keys(data.pages).filter(function (pid) { return linkedIds.indexOf(pid) === -1; });
                if (unlinked.length) {
                    html += '<div class="roleta-pages-global">';
                    html += unlinked.map(function (pid) {
                        var p = data.pages[pid];
                        return '<div class="roleta-page-item">' +
                            '<span class="roleta-page-name">' + esc(p.name) + '</span>' +
                            '<span class="roleta-page-unlinked" onclick="linkPageToRoleta(\'' + pid + '\')" title="Vincular a esta roleta">+ Vincular</span>' +
                            '<button class="roleta-rm-btn" onclick="deleteRoletaPage(\'' + pid + '\')" title="Excluir página" style="font-size:0.65rem">✕</button>' +
                            '</div>';
                    }).join('');
                    html += '</div>';
                }

                container.innerHTML = html;
            }

            function addRoletaPage() {
                var name = prompt('Nome da página/campanha (ex: LP Solar):');
                if (!name || !name.trim()) return;
                var data = getRoletaData();
                if (!data.pages) data.pages = {};
                var id = 'p' + Date.now();
                data.pages[id] = { name: name.trim() };
                // Auto-link to active roleta
                var roleta = getActiveRoleta(data);
                if (roleta) {
                    if (!roleta.pages) roleta.pages = [];
                    if (roleta.pages.indexOf(id) === -1) roleta.pages.push(id);
                }
                saveRoletaData(data);
                renderRoleta();
                showToast('<i class="fi fi-rr-check-circle"></i> Página "' + name.trim() + '" registrada');
            }

            function deleteRoletaPage(id) {
                if (!confirm('Excluir esta página permanentemente?')) return;
                var data = getRoletaData();
                if (data.pages) delete data.pages[id];
                // Remove from all roletas
                Object.keys(data.roletas).forEach(function (rid) {
                    var r = data.roletas[rid];
                    if (r.pages) {
                        var idx = r.pages.indexOf(id);
                        if (idx !== -1) r.pages.splice(idx, 1);
                    }
                });
                saveRoletaData(data);
                renderRoleta();
            }

            function linkPageToRoleta(pageId) {
                var data = getRoletaData();
                var roleta = getActiveRoleta(data);
                if (!roleta) return;
                if (!roleta.pages) roleta.pages = [];
                if (roleta.pages.indexOf(pageId) === -1) roleta.pages.push(pageId);
                saveRoletaData(data);
                renderRoleta();
            }

            function unlinkPageFromRoleta(pageId) {
                var data = getRoletaData();
                var roleta = getActiveRoleta(data);
                if (!roleta || !roleta.pages) return;
                var idx = roleta.pages.indexOf(pageId);
                if (idx !== -1) roleta.pages.splice(idx, 1);
                saveRoletaData(data);
                renderRoleta();
            }

            function renderRoletaLeadsByUser() {
                var data = getRoletaData();
                var container = document.getElementById('roletaLeadsByUser');
                var assigns = getRoletaAssigns();
                var byUser = {};
                (crmLeads || []).forEach(function (l) {
                    var uid = assigns[l.id] || 'unassigned';
                    if (!byUser[uid]) byUser[uid] = [];
                    byUser[uid].push(l);
                });
                var roleta = getActiveRoleta(data);
                if (!roleta) { container.innerHTML = ''; return; }
                container.innerHTML = roleta.users.map(function (u) {
                    var leads = byUser[u.id] || [];
                    return '<div class="roleta-assigned-user"><strong>' + esc(u.name) + '</strong>: ' +
                        (leads.length ? leads.map(function (l) { return esc(l.name); }).join(', ') : '—') +
                        '</div>';
                }).join('') || '<div style="padding:10px;text-align:center;color:var(--text-muted);font-size:0.75rem">Nenhum lead atribuído</div>';
            }

            function getActiveRoletaId() {
                var data = getRoletaData();
                return data.activeRoletaId;
            }

            function switchRoleta(id) {
                var data = getRoletaData();
                data.activeRoletaId = id;
                saveRoletaData(data);
                renderRoleta();
            }

            function createRoleta() {
                var name = prompt('Nome do projeto para a nova roleta:');
                if (!name || !name.trim()) return;
                var data = getRoletaData();
                var id = 'r' + Date.now();
                data.roletas[id] = { name: name.trim(), users: [], index: 0, pages: [] };
                data.activeRoletaId = id;
                data.enabled = true;
                saveRoletaData(data);
                renderRoleta();
                showToast('<i class="fi fi-rr-check-circle"></i> Roleta "' + name.trim() + '" criada');
            }

            function deleteRoleta(id) {
                if (!confirm('Excluir esta roleta permanentemente?')) return;
                var data = getRoletaData();
                delete data.roletas[id];
                if (data.activeRoletaId === id) data.activeRoletaId = Object.keys(data.roletas)[0] || null;
                if (!Object.keys(data.roletas).length) data.enabled = false;
                saveRoletaData(data);
                renderRoleta();
            }

            function toggleRoletaEnabled() {
                var data = getRoletaData();
                data.enabled = document.getElementById('roletaToggle').checked;
                if (data.enabled && !Object.keys(data.roletas).length) {
                    createRoleta();
                    return;
                }
                saveRoletaData(data);
                renderRoleta();
            }

            function addRoletaUser() {
                var sel = document.getElementById('roletaUserSelected');
                var uid = sel.dataset.value;
                if (!uid) { showToast('<i class="fi fi-rr-triangle-warning"></i> Selecione um vendedor'); return; }
                var allUsers = window._roletaAvailableUsers || [];
                var user = allUsers.find(function (u) { return String(u.id) === uid; });
                if (!user) { showToast('<i class="fi fi-rr-triangle-warning"></i> Usuário não encontrado'); return; }
                var data = getRoletaData();
                var roleta = getActiveRoleta(data);
                if (!roleta) return;
                if (roleta.users.some(function (u) { return u.id === 'sys_' + user.id; })) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> ' + user.name + ' já está na roleta');
                    return;
                }
                roleta.users.push({ id: 'sys_' + user.id, name: user.name });
                saveRoletaData(data);
                sel.textContent = 'Selecionar vendedor';
                sel.dataset.value = '';
                renderRoleta();
                showToast('<i class="fi fi-rr-check-circle"></i> ' + user.name + ' adicionado à roleta');
            }

            function loadRoletaAvailableUsers() {
                if (!api.isLoggedIn()) return;
                api.listUsers().then(function (users) {
                    var vendas = (users || []).filter(function (u) {
                        var sectors = u.sectors || [];
                        if (typeof sectors === 'string') { try { sectors = JSON.parse(sectors); } catch (e) { sectors = []; } }
                        return Array.isArray(sectors) && sectors.some(function (s) { return s.toLowerCase() === 'vendas'; });
                    });
                    window._roletaAvailableUsers = vendas;
                    initRoletaUserDropdown();
                }).catch(function () { });
            }

            function initRoletaUserDropdown() {
                var drop = document.getElementById('roletaUserDrop');
                if (!drop) return;
                var users = window._roletaAvailableUsers || [];
                var data = getRoletaData();
                var roleta = getActiveRoleta(data);
                var inRoleta = {};
                if (roleta) roleta.users.forEach(function (u) { inRoleta[u.id] = true; });
                var available = users.filter(function (u) { return !inRoleta['sys_' + u.id]; });
                if (!available.length) {
                    drop.innerHTML = '<div class="cs-opt" style="color:var(--text-muted);cursor:default">Nenhum disponível</div>';
                    return;
                }
                drop.innerHTML = available.map(function (u) {
                    return '<div class="cs-opt" data-value="' + u.id + '">' + esc(u.name) + '</div>';
                }).join('');
                drop.querySelectorAll('.cs-opt').forEach(function (el) {
                    el.addEventListener('click', function () {
                        document.getElementById('roletaUserSelected').textContent = el.textContent;
                        document.getElementById('roletaUserSelected').dataset.value = el.dataset.value;
                        closeRoletaUserDropdown();
                    });
                });
            }

            function toggleRoletaUserDropdown() {
                initRoletaUserDropdown();
                var drop = document.getElementById('roletaUserDrop');
                if (!drop) return;
                var isVisible = drop.classList.contains('visible');
                closeAllCrmDropdowns();
                if (!isVisible) drop.classList.add('visible');
            }

            function closeRoletaUserDropdown() {
                var drop = document.getElementById('roletaUserDrop');
                if (drop) drop.classList.remove('visible');
            }

            function removeRoletaUser(id) {
                var data = getRoletaData();
                var roleta = getActiveRoleta(data);
                if (!roleta) return;
                var idx = roleta.users.findIndex(function (u) { return u.id === id; });
                if (idx === -1) return;
                roleta.users.splice(idx, 1);
                if (roleta.index >= roleta.users.length) roleta.index = 0;
                if (roleta.index < 0) roleta.index = 0;
                saveRoletaData(data);
                renderRoleta();
            }

            function roletaNext() {
                var data = getRoletaData();
                var roleta = getActiveRoleta(data);
                if (!roleta || !roleta.users.length) { showToast('<i class="fi fi-rr-triangle-warning"></i> Nenhum usuário na roleta'); return; }
                roleta.index = (roleta.index + 1) % roleta.users.length;
                saveRoletaData(data);
                renderRoleta();
                showToast('▶ Próximo: ' + roleta.users[roleta.index].name);
            }

            function rotateRoletaOnAssign(data, roleta, assignedUserId) {
                if (!roleta || !roleta.users.length) return;
                var currentIdx = roleta.index;
                var currentUser = roleta.users[currentIdx];
                if (!currentUser || currentUser.id !== assignedUserId) return;
                var moved = roleta.users.splice(currentIdx, 1)[0];
                roleta.users.push(moved);
                roleta.index = 0;
                saveRoletaData(data);
            }

            // ── Roleta Assignment Helpers ──

            function getRoletaAssigns() {
                return _roletaAssigns || {};
            }

            async function saveRoletaAssigns(d) {
                _roletaAssigns = d;
            }

            function getLeadRoletaAssign(leadId) {
                return getRoletaAssigns()[leadId] || null;
            }

            function setLeadRoletaAssign(leadId, userId) {
                var d = getRoletaAssigns();
                d[leadId] = userId;
                saveRoletaAssigns(d);
            }

            function removeLeadRoletaAssign(leadId) {
                var d = getRoletaAssigns();
                delete d[leadId];
                saveRoletaAssigns(d);
            }

            function getRoletaAssignValue() {
                return document.getElementById('roletaAssignSelected').dataset.value || null;
            }

            function setRoletaAssignValue(userId) {
                var el = document.getElementById('roletaAssignSelected');
                if (!userId) { el.textContent = '—'; el.dataset.value = ''; return; }
                var data = getRoletaData();
                var roleta = getActiveRoleta(data);
                var user = roleta ? roleta.users.find(function (u) { return u.id === userId; }) : null;
                el.textContent = user ? user.name : '—';
                el.dataset.value = userId || '';
            }

            function updateRoletaAssignVisibility() {
                var data = getRoletaData();
                var group = document.getElementById('roletaAssignGroup');
                var roleta = getActiveRoleta(data);
                group.style.display = data.enabled && roleta && roleta.users.length ? 'block' : 'none';
            }

            function initRoletaAssignDropdown() {
                var drop = document.getElementById('roletaAssignDrop');
                if (!drop) return;
                var data = getRoletaData();
                var roleta = getActiveRoleta(data);
                var users = roleta ? roleta.users : [];
                drop.innerHTML = '<div class="cs-opt" data-value="">—</div>' +
                    users.map(function (u) {
                        return '<div class="cs-opt" data-value="' + u.id + '">' + esc(u.name) + '</div>';
                    }).join('');
                drop.querySelectorAll('.cs-opt').forEach(function (el) {
                    el.addEventListener('click', function () {
                        document.getElementById('roletaAssignSelected').textContent = el.textContent;
                        document.getElementById('roletaAssignSelected').dataset.value = el.dataset.value;
                        closeRoletaAssignDropdown();
                    });
                });
            }

            function toggleRoletaAssignDropdown() {
                initRoletaAssignDropdown();
                var drop = document.getElementById('roletaAssignDrop');
                var isVisible = drop.classList.contains('visible');
                closeAllCrmDropdowns();
                if (!isVisible) drop.classList.add('visible');
            }

            function closeRoletaAssignDropdown() {
                var drop = document.getElementById('roletaAssignDrop');
                if (drop) drop.classList.remove('visible');
            }

            // Load CRM data and update Financeiro pipeline cards
            async function updateCRMPipeline() {
                if (!api.isLoggedIn()) return;
                try {
                    var leads = await api.listLeads() || [];
                    var activeLeads = leads.filter(function (l) { return l.status !== 'lost' && l.status !== 'won'; });
                    var wonLeads = leads.filter(function (l) { return l.status === 'won'; });
                    var negotiating = leads.filter(function (l) { return l.status === 'negotiating'; });

                    var pipelineTotal = 0;
                    negotiating.forEach(function (l) { if (l.project_value) pipelineTotal += Number(l.project_value); });
                    var wonTotal = 0;
                    wonLeads.forEach(function (l) { if (l.project_value) wonTotal += Number(l.project_value); });

                    var el1 = document.getElementById('crmPipelineTotal');
                    var el2 = document.getElementById('crmWonTotal');
                    var el3 = document.getElementById('crmLeadsCount');
                    if (el1) el1.textContent = pipelineTotal ? 'R$ ' + pipelineTotal.toLocaleString('pt-BR') : '—';
                    if (el2) el2.textContent = wonTotal ? 'R$ ' + wonTotal.toLocaleString('pt-BR') : '—';
                    if (el3) el3.textContent = activeLeads.length;
                } catch (e) { }
            }

            // =====================================================================
            //  SITE AUDITORIA IA
            // =====================================================================

            var _anAbort = null;

            async function runSiteAnalysis() {
                var url = document.getElementById('anUrl').value.trim();
                if (!url) { showToast('<i class="fi fi-rr-triangle-warning"></i> Informe a URL do site'); return; }
                if (!url.match(/^https?:\/\//)) url = 'https://' + url;
                var btn = document.getElementById('anAnalyzeBtn');
                btn.disabled = true; btn.textContent = '⏳ Analisando...';
                var loading = document.getElementById('anLoading');
                loading.style.display = 'block';
                document.getElementById('anResults').style.display = 'none';
                var container = document.getElementById('tabAnalise');
                container.classList.remove('an-empty');
                container.classList.add('an-dashboard');
                setAnLoadText('Validando URL...');

                try {
                    new URL(url);
                } catch (e) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> URL inválida');
                    document.getElementById('tabAnalise').classList.add('an-empty');
                    document.getElementById('tabAnalise').classList.remove('an-dashboard');
                    btn.disabled = false; btn.textContent = '<i class="fi fi-rr-search"></i> Analisar Site';
                    loading.style.display = 'none';
                    return;
                }

                setTimeout(function () { setAnLoadText('Buscando dados de performance (PageSpeed)...'); }, 100);
                var pageSpeed = await fetchPageSpeedData(url);

                setTimeout(function () { setAnLoadText('Extraindo conteúdo da página...'); }, 200);
                var pageContent = await fetchURLContent(url);

                setTimeout(function () { setAnLoadText('Capturando screenshot...'); }, 300);
                var screenshotUrl = await takeScreenshot(url);

                setTimeout(function () { setAnLoadText('Gerando relatório com IA...'); }, 400);
                var report = await analyzeSiteFull(url, pageSpeed, pageContent, screenshotUrl);

                loading.style.display = 'none';
                btn.disabled = false; btn.textContent = '<i class="fi fi-rr-search"></i> Analisar Site';

                if (!report) {
                    showToast('<i class="fi fi-rr-cross-circle"></i> Erro ao gerar relatório. Verifique a chave de API.');
                    document.getElementById('tabAnalise').classList.add('an-empty');
                    document.getElementById('tabAnalise').classList.remove('an-dashboard');
                    return;
                }

                renderAnalysisReport(report);
                var anContext = { url: url, pageSpeed: pageSpeed, pageContent: pageContent, screenshotUrl: screenshotUrl };
                addAnalysis(url, report, anContext);
                startAnalysisChat(report, anContext);
                document.getElementById('anResults').style.display = 'block';
                document.getElementById('anResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            function setAnLoadText(t) {
                var el = document.getElementById('anLoadingText');
                if (el) el.textContent = t;
            }

            async function fetchPageSpeedData(url) {
                try {
                    var psKey = localStorage.getItem('veltris_google_pagespeed_key') || '';
                    var psUrl = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=' + encodeURIComponent(url) +
                        '&strategy=mobile&categories=performance&categories=seo&categories=accessibility&categories=best-practices';
                    if (psKey) psUrl += '&key=' + encodeURIComponent(psKey);
                    var res = await fetchWithTimeout(psUrl, 20000);
                    if (!res.ok) return null;
                    var data = await res.json();
                    var lh = data.lighthouseResult || {};
                    var perf = (lh.categories || {}).performance || {};
                    var seo = (lh.categories || {}).seo || {};
                    var a11y = (lh.categories || {}).accessibility || {};
                    var bp = (lh.categories || {})['best-practices'] || {};
                    var audits = lh.audits || {};

                    return {
                        score: Math.round((perf.score || 0) * 100),
                        seoScore: Math.round((seo.score || 0) * 100),
                        a11yScore: Math.round((a11y.score || 0) * 100),
                        bpScore: Math.round((bp.score || 0) * 100),
                        fcp: audits['first-contentful-paint'] ? (audits['first-contentful-paint'].numericValue || 0) / 1000 : null,
                        lcp: audits['largest-contentful-paint'] ? (audits['largest-contentful-paint'].numericValue || 0) / 1000 : null,
                        tbt: audits['total-blocking-time'] ? (audits['total-blocking-time'].numericValue || 0) / 1000 : null,
                        cls: audits['cumulative-layout-shift'] ? (audits['cumulative-layout-shift'].numericValue || 0) : null,
                        si: audits['speed-index'] ? (audits['speed-index'].numericValue || 0) / 1000 : null,
                        requests: audits['network-requests'] ? (audits['network-requests'].numericValue || 0) : null,
                        totalBytes: audits['total-byte-weight'] ? (audits['total-byte-weight'].numericValue || 0) : null,
                        raw: data
                    };
                } catch (e) {
                    return null;
                }
            }

            async function analyzeSiteFull(url, pageSpeed, pageContent, screenshotUrl, userFeedback) {
                var apiKey = localStorage.getItem('veltris_api_key') || '';
                if (!apiKey) return null;

                var perfSection = '';
                if (pageSpeed) {
                    perfSection = [
                        '=== DADOS PAGESPEED ===',
                        'Performance Score: ' + pageSpeed.score,
                        'SEO Score: ' + pageSpeed.seoScore,
                        'Acessibilidade: ' + pageSpeed.a11yScore,
                        'Boas Práticas: ' + pageSpeed.bpScore,
                        'FCP: ' + (pageSpeed.fcp ? pageSpeed.fcp.toFixed(1) + 's' : 'N/A'),
                        'LCP: ' + (pageSpeed.lcp ? pageSpeed.lcp.toFixed(1) + 's' : 'N/A'),
                        'TBT: ' + (pageSpeed.tbt ? pageSpeed.tbt.toFixed(2) + 's' : 'N/A'),
                        'CLS: ' + (pageSpeed.cls ? pageSpeed.cls.toFixed(3) : 'N/A'),
                        'Speed Index: ' + (pageSpeed.si ? pageSpeed.si.toFixed(1) + 's' : 'N/A'),
                        'Requisições: ' + (pageSpeed.requests || 'N/A'),
                        'Peso Total: ' + (pageSpeed.totalBytes ? (pageSpeed.totalBytes / 1024).toFixed(0) + ' KB' : 'N/A'),
                    ].join('\n');
                }

                var contentPreview = '';
                if (pageContent) {
                    contentPreview = pageContent.slice(0, 8000);
                }

                var screenshotLine = screenshotUrl ? 'Screenshot disponível em: ' + screenshotUrl : 'Sem screenshot.';

                var siteName = url.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
                var systemPrompt = [
                    'Você é um consultor sênior de marketing digital, CRO, UX e vendas.',
                    'Você está analisando o site: **' + siteName + '** (' + url + ').',
                    '',
                    'Analise APENAS os dados reais fornecidos abaixo (PageSpeed, conteúdo, screenshot).',
                    'NÃO invente dados genéricos. NÃO repita exemplos prontos.',
                    'Cada análise deve ser ÚNICA e baseada no site específico.',
                    '',
                    'IMPORTANTE:',
                    '- O roteiro_ligacao DEVE mencionar o nome do site (' + siteName + ') várias vezes.',
                    '- O resumo_executivo DEVE citar problemas e oportunidades reais observados nos dados.',
                    '- As estimativas de conversão devem variar conforme o nicho e qualidade do site.',
                    '- Sempre indique que estimativas são baseadas em benchmarks de mercado.',
                    '',
                    'Retorne APENAS um JSON válido (sem markdown, sem ```json), com esta estrutura:',
                    '{',
                    '  "score_geral": (0-100, baseado nos dados reais),',
                    '  "scores": { "performance": N, "conversao": N, "copywriting": N, "ux_mobile": N, "seo_tecnico": N, "autoridade": N },',
                    '  "performance": {',
                    '    "carregamento_estimado": "string",',
                    '    "nota_mobile": N,',
                    '    "nota_desktop": N,',
                    '    "peso_pagina": "string",',
                    '    "requisicoes": N,',
                    '    "gargalos": [ { "tipo": "red|yellow|green", "texto": "descoberta real do site" } ]',
                    '  },',
                    '  "cro": [ { "item": "string", "nota": 0-10, "prioridade": "alta|media|baixa", "explicacao": "string específica" } ],',
                    '  "copy": [ { "problema": "string real", "impacto": "Alto|Medio|Baixo", "sugestao": "string específica" } ],',
                    '  "estimativas": {',
                    '    "conversao_atual_min": N, "conversao_atual_max": N,',
                    '    "conversao_potencial_min": N, "conversao_potencial_max": N,',
                    '    "perda_velocidade_min": N, "perda_velocidade_max": N,',
                    '    "perda_ux_min": N, "perda_ux_max": N,',
                    '    "perda_copy_min": N, "perda_copy_max": N',
                    '  },',
                    '  "oportunidades": [ { "prioridade": "alta|media|baixa", "oportunidade": "string específica", "impacto": "string" } ],',
                    '  "roteiro_ligacao": "string com roteiro personalizado para ' + siteName + ' (abertura, diagnóstico, valor, solução, fechamento)",',
                    '  "resumo_executivo": "string com resumo real baseado nos dados"',
                    '}'
                ].join('\n');

                var userContent = [
                    'URL do site: ' + url,
                    '',
                    perfSection,
                    '',
                    '=== CONTEÚDO DA PÁGINA ===',
                    contentPreview.slice(0, 6000),
                    '',
                    screenshotLine,
                    '',
                    'Com base nos dados acima, gere o JSON completo com a análise.'
                ].join('\n');

                if (userFeedback) {
                    userContent += '\n\n=== FEEDBACK DO USUÁRIO PARA RE-ANÁLISE ===\n' + userFeedback +
                        '\n\nGere um NOVO relatório completo considerando este feedback. Não copie o relatório anterior, analise novamente os dados originais aplicando as alterações solicitadas.';
                }

                try {
                    var messages = [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userContent }
                    ];

                    // If we have a screenshot, send as multimodal
                    if (screenshotUrl) {
                        messages = [
                            { role: 'system', content: systemPrompt },
                            {
                                role: 'user', content: [
                                    { type: 'text', text: userContent },
                                    { type: 'image_url', image_url: { url: screenshotUrl } }
                                ]
                            }
                        ];
                    }

                    var res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + apiKey,
                        },
                        body: JSON.stringify({
                            model: 'google/gemma-4-31b-it:free',
                            messages: messages,
                            max_tokens: 4096,
                            temperature: 0.6,
                        })
                    });
                    if (!res.ok) return null;
                    var data = await res.json();
                    var reply = data?.choices?.[0]?.message?.content || data?.content || null;
                    if (!reply) return null;

                    // Strip markdown code fences if present
                    reply = reply.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
                    var parsed = JSON.parse(reply);
                    return parsed;
                } catch (e) {
                    return null;
                }
            }

            function renderAnalysisReport(r) {
                // Card 1: Score Geral
                var score = r.score_geral || 0;

                var circle = document.getElementById('anScoreCircleSm');
                var circleColor = score >= 70 ? '#4ade80' : score >= 40 ? '#facc15' : '#f87171';
                circle.style.setProperty('--pct', score + '%');
                circle.style.setProperty('--circle-color', circleColor);
                document.getElementById('anGeneralScore').textContent = score;
                document.getElementById('anGeneralScore').style.color = circleColor;


                var scores = r.scores || {};
                var barDefs = [
                    { key: 'performance', label: 'Performance', color: '#4ade80' },
                    { key: 'conversao', label: 'Conversão (CRO)', color: '#60a5fa' },
                    { key: 'copywriting', label: 'Copywriting', color: '#a78bfa' },
                    { key: 'ux_mobile', label: 'UX Mobile', color: '#facc15' },
                    { key: 'seo_tecnico', label: 'SEO Técnico', color: '#f87171' },
                    { key: 'autoridade', label: 'Confiança', color: '#34d399' },
                ];
                var barsHtml = '';
                barDefs.forEach(function (b) {
                    var v = scores[b.key] || 0;
                    barsHtml +=
                        '<div class="an-score-bar-row">' +
                        '<span class="an-score-bar-label">' + b.label + '</span>' +
                        '<div class="an-score-bar-track"><div class="an-score-bar-fill" style="width:' + v + '%;background:' + b.color + '"></div></div>' +
                        '<span class="an-score-bar-val">' + v + '</span>' +
                        '</div>';
                });
                document.getElementById('anScoreBars').innerHTML = barsHtml;

                // Card 2: Performance
                var perf = r.performance || {};
                var perfGrid = document.getElementById('anPerfGrid');
                perfGrid.innerHTML =
                    '<div class="an-perf-item"><div class="an-perf-val">' + (perf.carregamento_estimado || '—') + '</div><div class="an-perf-label">Carregamento</div></div>' +
                    '<div class="an-perf-item ' + (perf.nota_mobile < 50 ? 'an-perf-bad' : perf.nota_mobile < 80 ? 'an-perf-mid' : 'an-perf-good') + '"><div class="an-perf-val">' + (perf.nota_mobile ?? '—') + '</div><div class="an-perf-label">Nota Mobile</div></div>' +
                    '<div class="an-perf-item ' + (perf.nota_desktop < 50 ? 'an-perf-bad' : perf.nota_desktop < 80 ? 'an-perf-mid' : 'an-perf-good') + '"><div class="an-perf-val">' + (perf.nota_desktop ?? '—') + '</div><div class="an-perf-label">Nota Desktop</div></div>' +
                    '<div class="an-perf-item"><div class="an-perf-val">' + (perf.peso_pagina || '—') + '</div><div class="an-perf-label">Peso da Página</div></div>' +
                    '<div class="an-perf-item"><div class="an-perf-val">' + (perf.requisicoes ?? '—') + '</div><div class="an-perf-label">Requisições</div></div>';

                var gargalos = perf.gargalos || [];
                var gargHtml = gargalos.map(function (g) {
                    var cls = g.tipo === 'red' ? 'an-gargalo-red' : g.tipo === 'yellow' ? 'an-gargalo-yellow' : 'an-gargalo-green';
                    var icon = g.tipo === 'red' ? '🔴' : g.tipo === 'yellow' ? '🟡' : '🟢';
                    return '<div class="an-gargalo ' + cls + '">' + icon + ' ' + esc(g.texto) + '</div>';
                }).join('');
                document.getElementById('anGargalos').innerHTML = gargHtml || '<div style="color:var(--text-dim);font-size:0.7rem">Nenhum gargalo identificado.</div>';

                // Card 3: CRO
                var cro = r.cro || [];
                var croHtml = cro.map(function (c) {
                    var tag = c.prioridade === 'alta' ? 'an-tag-high' : c.prioridade === 'media' ? 'an-tag-mid' : 'an-tag-low';
                    var label = c.prioridade === 'alta' ? 'Alta' : c.prioridade === 'media' ? 'Média' : 'Baixa';
                    return '<div class="an-cro-item">' +
                        '<div class="an-cro-top">' +
                        '<span class="an-cro-label">' + esc(c.item) + '</span>' +
                        '<span><span class="an-tag an-tag-score">' + (c.nota || 0) + '/10</span> <span class="an-tag ' + tag + '">' + label + '</span></span>' +
                        '</div>' +
                        (c.explicacao ? '<div class="an-cro-note">' + esc(c.explicacao) + '</div>' : '') +
                        '</div>';
                }).join('');
                document.getElementById('anCroList').innerHTML = croHtml || '<div style="color:var(--text-dim);font-size:0.7rem">Nenhum item de CRO disponível.</div>';

                // Card 4: Copy
                var copy = r.copy || [];
                var copyHtml = copy.map(function (c) {
                    return '<div class="an-copy-item">' +
                        '<span class="an-copy-label">' + esc(c.problema) + '</span>' +
                        (c.sugestao ? '<div class="an-copy-note"><i class="fi fi-rr-lightbulb-on"></i> ' + esc(c.sugestao) + '</div>' : '') +
                        '</div>';
                }).join('');
                document.getElementById('anCopyList').innerHTML = copyHtml || '<div style="color:var(--text-dim);font-size:0.7rem">Nenhum problema de copy identificado.</div>';

                // Card 5: Estimativas
                var estim = r.estimativas || {};
                document.getElementById('anEstimGrid').innerHTML =
                    '<div class="an-estim-item"><div class="an-estim-val">' + (estim.conversao_atual_min ?? '?') + '% a ' + (estim.conversao_atual_max ?? '?') + '%</div><div class="an-estim-label">Conversão estimada atual</div></div>' +
                    '<div class="an-estim-item"><div class="an-estim-val">' + (estim.conversao_potencial_min ?? '?') + '% a ' + (estim.conversao_potencial_max ?? '?') + '%</div><div class="an-estim-label">Conversão potencial após otimizações</div></div>' +
                    '<div class="an-estim-item"><div class="an-estim-val">' + (estim.perda_velocidade_min ?? '?') + '% a ' + (estim.perda_velocidade_max ?? '?') + '%</div><div class="an-estim-label">Perda estimada por carregamento lento</div></div>' +
                    '<div class="an-estim-item"><div class="an-estim-val">' + (estim.perda_ux_min ?? '?') + '% a ' + (estim.perda_ux_max ?? '?') + '%</div><div class="an-estim-label">Perda estimada por problemas de UX</div></div>' +
                    '<div class="an-estim-item"><div class="an-estim-val">' + (estim.perda_copy_min ?? '?') + '% a ' + (estim.perda_copy_max ?? '?') + '%</div><div class="an-estim-label">Perda estimada por copy inadequada</div></div>';

                // Card 6: Oportunidades (simplified list in fin-card)
                var ops = r.oportunidades || [];
                var opsHtml = ops.map(function (o) {
                    var icon = o.prioridade === 'alta' ? '<img src="fire-flame-curved.svg" class="svg-icon" style="margin:0; filter:none">' : o.prioridade === 'media' ? '⚡' : '🧊';
                    var tag = o.prioridade === 'alta' ? 'an-tag-high' : o.prioridade === 'media' ? 'an-tag-mid' : 'an-tag-low';
                    return '<div class="an-ops-mini-item">' +
                        '<span>' + icon + '</span>' +
                        '<span style="flex:1">' + esc(o.oportunidade) + '</span>' +
                        '<span class="an-tag ' + tag + '">' + (o.impacto || 'Médio') + '</span>' +
                        '</div>';
                }).join('');
                document.getElementById('anOpsMini').innerHTML = opsHtml || '<div style="color:var(--text-dim);font-size:0.7rem;text-align:center;padding:12px">Nenhuma oportunidade listada.</div>';

                // Card 7: Roteiro
                var script = r.roteiro_ligacao || 'Roteiro não disponível.';
                document.getElementById('anScriptContent').innerHTML = formatScript(script);

                // Card 8: Resumo
                var summary = r.resumo_executivo || 'Resumo não disponível.';
                document.getElementById('anSummaryContent').innerHTML = summary;
            }

            // ── Analysis History ──
            var _analysesCache = null;

            function loadAnalyses() {
                if (_analysesCache) return _analysesCache;
                if (!api.isLoggedIn()) {
                    try { return JSON.parse(localStorage.getItem('veltris_analyses')) || []; } catch { return []; }
                }
                return [];
            }

            function reloadAnalyses(cb) {
                if (!api.isLoggedIn()) { if (cb) cb(); return; }
                api.listAnalyses().then(function (res) {
                    var rows = res && res.data || [];
                    _analysesCache = rows.map(function (r) {
                        return { id: r.id, url: r.url, siteName: r.site_name, date: r.date, score: r.score, report: r.report, context: r.context };
                    });
                    if (cb) cb();
                }).catch(function () { if (cb) cb(); });
            }

            function saveAnalyses(list) {
                _analysesCache = list;
                if (!api.isLoggedIn()) { localStorage.setItem('veltris_analyses', JSON.stringify(list)); return; }
                api.listAnalyses().then(function (res) {
                    var existing = res && res.data || [];
                    return Promise.all(existing.map(function (r) { return api.deleteAnalysis(r.id); }));
                }).then(function () {
                    return Promise.all(list.map(function (a) {
                        return api.saveAnalysis({ url: a.url, site_name: a.siteName, date: a.date, score: a.score, report: a.report, context: a.context });
                    }));
                }).catch(function () {
                    localStorage.setItem('veltris_analyses', JSON.stringify(list));
                });
            }

            function addAnalysis(url, report, context) {
                var list = loadAnalyses();
                var siteName = url.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
                list.unshift({ id: Date.now(), url: url, siteName: siteName, date: new Date().toLocaleString('pt-BR'), score: report.score_geral || 0, report: report, context: context || null });
                if (list.length > 50) list = list.slice(0, 50);
                saveAnalyses(list);
                renderAnalysisHistory();
            }

            function renderAnalysisHistory() {
                var self = this;
                if (!_analysesCache && api.isLoggedIn()) {
                    reloadAnalyses(function () { renderAnalysisHistory(); });
                    return;
                }
                var list = loadAnalyses();
                var container = document.getElementById('anHistoryList');
                var header = document.getElementById('anHistory');
                if (!container || !header) return;
                if (!list.length) { header.style.display = 'none'; return; }
                header.style.display = 'block';
                container.innerHTML = list.map(function (a) {
                    var color = a.score >= 70 ? '#4ade80' : a.score >= 40 ? '#facc15' : '#f87171';
                    return '<div class="an-history-item" onclick="openAnalysis(' + a.id + ')">' +
                        '<div class="an-history-main">' +
                        '<div class="an-history-url">' + esc(a.siteName || a.site_name) + '</div>' +
                        '<div class="an-history-date">' + esc(a.date) + '</div>' +
                        '</div>' +
                        '<div style="display:flex;align-items:center;gap:8px">' +
                        '<span class="an-history-score" style="color:' + color + '">' + a.score + '</span>' +
                        '<button class="an-history-del" onclick="event.stopPropagation();deleteAnalysis(' + a.id + ')" title="Remover">✕</button>' +
                        '</div>' +
                        '</div>';
                }).join('');
            }

            function openAnalysis(id) {
                var list = loadAnalyses();
                var item = list.find(function (a) { return a.id === id; });
                if (!item) { showToast('<i class="fi fi-rr-triangle-warning"></i> Análise não encontrada'); return; }
                document.getElementById('anResults').style.display = 'block';
                document.getElementById('anResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
                renderAnalysisReport(item.report);
                startAnalysisChat(item.report, item.context || null);
                showToast('<i class="fi fi-rr-clipboard-list"></i> Análise carregada: ' + (item.siteName || item.site_name));
            }

            function deleteAnalysis(id) {
                var list = loadAnalyses();
                list = list.filter(function (a) { return a.id !== id; });
                if (api.isLoggedIn()) api.deleteAnalysis(id);
                saveAnalyses(list);
                renderAnalysisHistory();
            }

            function clearAnalysisHistory() {
                if (!confirm('Limpar todo o histórico de análises?')) return;
                saveAnalyses([]);
                renderAnalysisHistory();
                showToast('🗑️ Histórico limpo');
            }

            // ── WhatsApp Panel ──
            var _wppLead = null;
            var _wppPopup = null;

            function openWppForLead(leadId) {
                var l = crmLeads.find(function (x) { return x.id === leadId; });
                if (!l) return;
                _wppLead = l;
                document.getElementById('wppLeadName').textContent = l.name;
                document.getElementById('wppLeadPhone').textContent = l.phone || 'Sem telefone';
                document.getElementById('wppEmpty').style.display = 'none';
                document.getElementById('wppLeadInfo').style.display = 'block';
                document.getElementById('wppOpenBtn').style.display = l.phone ? 'flex' : 'none';
                document.getElementById('wppCopyBtn').style.display = l.phone ? 'flex' : 'none';
                restoreWppPanel();
            }

            function toggleWppPanel() {
                var p = document.getElementById('wppPanel');
                if (p.classList.contains('minimized')) restoreWppPanel();
                else minimizeWppPanel();
            }

            function minimizeWppPanel() {
                document.getElementById('wppPanel').classList.add('minimized');
                document.getElementById('wppMinimizedIcon').classList.add('visible');
            }

            function restoreWppPanel() {
                document.getElementById('wppPanel').classList.remove('hidden', 'minimized');
                document.getElementById('wppMinimizedIcon').classList.remove('visible');
            }

            function closeWppPanel() {
                document.getElementById('wppPanel').classList.add('hidden');
                document.getElementById('wppMinimizedIcon').classList.remove('visible');
                _wppLead = null;
            }

            function openWppChat() {
                if (!_wppLead || !_wppLead.phone) return;
                var phone = _wppLead.phone.replace(/\D/g, '');
                if (phone.length < 10) { showToast('<i class="fi fi-rr-triangle-warning"></i> Número de telefone inválido'); return; }
                var url = 'https://web.whatsapp.com/send?phone=55' + phone + '&text=Olá%20' + encodeURIComponent(_wppLead.name.split(' ')[0]) + '!';
                _wppPopup = window.open(url, '_blank');
                showToast('<i class="fi fi-rr-check-circle"></i> WhatsApp aberto para ' + _wppLead.name);
            }

            function copyWppNumber() {
                if (!_wppLead || !_wppLead.phone) return;
                navigator.clipboard.writeText(_wppLead.phone).then(function () {
                    showToast('<i class="fi fi-rr-clipboard-list"></i> Número copiado: ' + _wppLead.phone);
                }).catch(function () {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> Erro ao copiar');
                });
            }

            // ── Analysis Chat ──
            var _anChatReport = null;
            var _anChatMessages = [];
            var _anChatContext = null;

            function startAnalysisChat(report, context) {
                _anChatReport = report;
                _anChatContext = context || null;
                _anChatMessages = [
                    { role: 'system', content: 'Você é um consultor sênior analisando o relatório de auditoria abaixo. O usuário pede ajustes, questiona pontos ou sugere correções.\n\nREGRAS:\n1. Primeiro responda de forma CONVERSACIONAL e objetiva, explicando o que vai mudar.\n2. DEPOIS, no final, inclua o JSON completo do relatório atualizado entre tags ```json ... ```.\n3. NÃO mostre o JSON bruto na conversa. Apenas explique as alterações em texto.\n4. O JSON será processado automaticamente.' },
                    { role: 'system', content: 'RELATÓRIO ATUAL:\n' + JSON.stringify(report, null, 2) }
                ];
                document.getElementById('anChatMessages').innerHTML = '';
                addAnalysisChatMessage('ai', '<i class="fi fi-rr-check-circle"></i> Análise carregada! Pergunte, peça ajustes no roteiro, questione pontos ou sugira mudanças. Se aprovar uma alteração, eu retornarei o relatório atualizado entre tags ```json.');
                document.getElementById('anChatCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            function addAnalysisChatMessage(role, text) {
                var container = document.getElementById('anChatMessages');
                if (!container) return;
                var msgEl = document.createElement('div');
                msgEl.className = 'an-chat-msg ' + role;
                msgEl.innerHTML = text.replace(/\n/g, '<br>');
                container.appendChild(msgEl);
                container.scrollTop = container.scrollHeight;
            }

            function isRoteiroOnlyChange(oldR, newR) {
                var keysOld = Object.keys(oldR).sort();
                var keysNew = Object.keys(newR).sort();
                if (JSON.stringify(keysOld) !== JSON.stringify(keysNew)) return false;
                for (var k in oldR) {
                    if (k === 'roteiro_ligacao' || k === 'resumo_executivo') continue;
                    if (JSON.stringify(oldR[k]) !== JSON.stringify(newR[k])) return false;
                }
                return true;
            }

            async function reanalyzeWithFeedback(feedback) {
                var ctx = _anChatContext;
                if (!ctx) {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> Contexto da análise original não encontrado. Tentando re-analisar do zero...');
                    ctx = { url: document.getElementById('anUrl').value.trim(), pageSpeed: null, pageContent: null, screenshotUrl: null };
                    ctx.url = ctx.url.match(/^https?:\/\//) ? ctx.url : 'https://' + ctx.url;
                    showToast('🔄 Buscando dados do site novamente...');
                    ctx.pageSpeed = await fetchPageSpeedData(ctx.url).catch(function () { return null; });
                    ctx.pageContent = await fetchURLContent(ctx.url).catch(function () { return null; });
                    ctx.screenshotUrl = await takeScreenshot(ctx.url).catch(function () { return null; });
                }
                showToast('🔄 Re-analisando com seu feedback...');
                var newReport = await analyzeSiteFull(ctx.url, ctx.pageSpeed, ctx.pageContent, ctx.screenshotUrl, feedback);
                if (!newReport) {
                    showToast('<i class="fi fi-rr-cross-circle"></i> Erro ao re-analisar. Tente novamente.');
                    return null;
                }
                _anChatContext = ctx;
                return newReport;
            }

            function saveReportToHistory(report) {
                var list = loadAnalyses();
                var url = document.getElementById('anUrl').value.trim();
                if (!url.match(/^https?:\/\//)) url = 'https://' + url;
                var idx = list.findIndex(function (a) { return a.url === url || a.url.replace(/^https?:\/\//, '') === url.replace(/^https?:\/\//, ''); });
                if (idx >= 0) {
                    list[idx].report = report;
                    list[idx].score = report.score_geral || 0;
                    if (_anChatContext) list[idx].context = _anChatContext;
                    saveAnalyses(list);
                }
            }

            function addAnalysisChatActions(msgEl, text) {
                var jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
                if (!jsonMatch) return;
                var actionsDiv = document.createElement('div');
                actionsDiv.className = 'an-chat-actions';

                var oldReport = _anChatReport;
                var newReport;
                try { newReport = JSON.parse(jsonMatch[1].trim()); } catch (e) { return; }

                var isRoteiroOnly = isRoteiroOnlyChange(oldReport, newReport);

                if (isRoteiroOnly) {
                    var applyBtn = document.createElement('button');
                    applyBtn.className = 'an-chat-apply-btn';
                    applyBtn.textContent = '<i class="fi fi-rr-memo"></i> Aplicar ajustes no roteiro';
                    applyBtn.onclick = function () {
                        _anChatReport = newReport;
                        renderAnalysisReport(newReport);
                        saveReportToHistory(newReport);
                        showToast('<i class="fi fi-rr-check-circle"></i> Roteiro atualizado!');
                    };
                    actionsDiv.appendChild(applyBtn);
                } else {
                    var applyBtn = document.createElement('button');
                    applyBtn.className = 'an-chat-apply-btn';
                    applyBtn.textContent = '🔄 Re-analisar com estas alterações';
                    applyBtn.onclick = async function () {
                        applyBtn.disabled = true; applyBtn.textContent = '⏳ Re-analisando...';
                        var userFeedback = 'O usuário solicitou as seguintes alterações no relatório:\n' +
                            JSON.stringify(newReport, null, 2) +
                            '\n\nCom base no feedback do usuário, gere um novo relatório completo e atualizado.';
                        var result = await reanalyzeWithFeedback(userFeedback);
                        if (result) {
                            _anChatReport = result;
                            renderAnalysisReport(result);
                            saveReportToHistory(result);
                            showToast('<i class="fi fi-rr-check-circle"></i> Nova análise concluída com as alterações!');
                        }
                        applyBtn.disabled = false; applyBtn.textContent = '🔄 Re-analisar com estas alterações';
                    };
                    actionsDiv.appendChild(applyBtn);
                }
                msgEl.appendChild(actionsDiv);
            }

            async function sendAnalysisChat() {
                var input = document.getElementById('anChatInput');
                var text = input.value.trim();
                if (!text || !_anChatReport) return;

                input.value = '';
                input.style.height = '';
                addAnalysisChatMessage('user', text);
                document.getElementById('anChatSendBtn').disabled = true;

                var apiKey = localStorage.getItem('veltris_api_key') || '';

                var messages = _anChatMessages.concat([
                    { role: 'user', content: text + '\n\nSe for fazer alterações, explique-as em texto e inclua o JSON atualizado entre ```json ... ``` no final.' }
                ]);

                try {
                    var res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + apiKey,
                        },
                        body: JSON.stringify({
                            model: 'google/gemma-4-31b-it:free',
                            messages: messages,
                            max_tokens: 4096,
                            temperature: 0.5,
                        })
                    });
                    if (!res.ok) { addAnalysisChatMessage('ai', '<i class="fi fi-rr-triangle-warning"></i> Erro na resposta da IA. Tente novamente.'); return; }
                    var data = await res.json();
                    var reply = data?.choices?.[0]?.message?.content || null;
                    if (!reply) { addAnalysisChatMessage('ai', '<i class="fi fi-rr-triangle-warning"></i> Resposta vazia.'); return; }

                    _anChatMessages.push({ role: 'user', content: text });
                    _anChatMessages.push({ role: 'assistant', content: reply });

                    // Strip json block from displayed text
                    var displayText = reply.replace(/```json[\s\S]*?```/g, '').trim();
                    var msgEl = document.createElement('div');
                    msgEl.className = 'an-chat-msg ai';
                    msgEl.innerHTML = displayText.replace(/\n/g, '<br>');
                    addAnalysisChatActions(msgEl, reply);
                    document.getElementById('anChatMessages').appendChild(msgEl);
                    document.getElementById('anChatMessages').scrollTop = document.getElementById('anChatMessages').scrollHeight;
                } catch (e) {
                    addAnalysisChatMessage('ai', '<i class="fi fi-rr-triangle-warning"></i> Erro: ' + e.message);
                } finally {
                    document.getElementById('anChatSendBtn').disabled = false;
                }
            }

            function formatScript(text) {
                return text.split('\n').map(function (line) {
                    if (line.match(/^\*\*/)) {
                        return '<strong>' + line.replace(/\*\*/g, '') + '</strong>';
                    }
                    return line;
                }).join('\n');
            }

            function copyScriptContent() {
                var el = document.getElementById('anScriptContent');
                var text = el.textContent || el.innerText || '';
                if (!text) { showToast('<i class="fi fi-rr-triangle-warning"></i> Nada para copiar'); return; }
                navigator.clipboard.writeText(text).then(function () {
                    showToast('<i class="fi fi-rr-check-circle"></i> Roteiro copiado!');
                }).catch(function () {
                    showToast('<i class="fi fi-rr-triangle-warning"></i> Erro ao copiar');
                });
            }

            async function initAuth() {
                var token = localStorage.getItem('veltris_token');
                var forcePw = localStorage.getItem('veltris_force_pw_change');
                if (token) {
                    api.token = token;
                    try { var ok = await api.verifyToken(); } catch { var ok = false; }
                    if (ok) {
                        if (forcePw) {
                            document.getElementById('loginOverlay').classList.add('hidden');
                            document.getElementById('pwChangeOverlay').style.display = 'flex';
                            return false;
                        }
                        document.getElementById('loginOverlay').classList.add('hidden');
                        requestNotificationPermission();
                        return true;
                    }
                    localStorage.removeItem('veltris_token');
                    localStorage.removeItem('veltris_user');
                    api.token = null;
                    api.user = null;
                }
                document.getElementById('loginOverlay').classList.remove('hidden');
                return false;
            }

            initAuth().then(function (authed) {
                if (!authed) return;
                if (!api.isAdmin()) document.getElementById('sidebarSettingsBtn').style.display = 'none';
                render();
                setFinFilter('todo');
                loadSettings();
                loadChecklistFromServer();
                loadFeedback();
                loadSugestoes();
                loadKanban();
                loadRoletaAvailableUsers();
                renderKanban();
                loadIAConversations();
                renderChat();
                renderIAHistory();
                loadPopupConversations();
                renderAnalysisHistory();
                document.getElementById('kbText').value = loadKnowledgeBase();

                // Generate initial suggestions if empty
                setTimeout(function () {
                    if (!sugestoes.length) {
                        gerarSugestoesIA();
                    }
                }, 2000);
            });
            // =====================================================================
            //  EMPRESAS
            // =====================================================================
            var _tabLabels = {
                dashboard: '<i class="fi fi-rr-clipboard-list"></i> Tasks', conteudos: '<i class="fi fi-rr-document"></i> Conteúdos',
                financeiro: '<i class="fi fi-rr-sack-dollar"></i> Financeiro', ia: '<img src="user-robot.svg" class="svg-icon"> IA Assistente',
                crm: '<i class="fi fi-rr-chart-histogram"></i> Leads', metricas: '<i class="fi fi-rr-chart-line-up"></i> Métricas',
                analise: '<i class="fi fi-rr-search"></i> Analisar', wpp: '<i class="fi fi-rr-comment-alt"></i> WhatsApp',
                empresas: '<i class="fi fi-rr-building"></i> Empresas', configuracoes: '<i class="fi fi-rr-settings"></i> Configurações'
            };
            var _aiTabs = { dashboard: 1, conteudos: 1, financeiro: 1, crm: 1, metricas: 1 };

            function empDefaultPerms() {
                var o = {};
                Object.keys(_tabLabels).forEach(function (k) { o[k] = { access: k !== 'empresas' && k !== 'configuracoes' }; });
                o.ia.chat = true;
                return o;
            }

            function empRender() {
                var el = document.getElementById('empList');
                if (!api.isLoggedIn() || !api.isAdmin()) { el.innerHTML = ''; return; }
                api.companyList().then(function (list) {
                    el.innerHTML = list.map(function (e) {
                        var created = e.created_at ? new Date(e.created_at).toLocaleDateString('pt-BR') : '';
                        return '<div class="emp-card" onclick="empOpenForm(\'' + e.id + '\')">' +
                            '<div class="emp-name">' + esc(e.name) + '</div>' +
                            '<div class="emp-admin-info"><i class="fi fi-rr-calendar"></i> ' + created + '</div>' +
                            '<span class="emp-status ' + (e.active ? 'active' : 'inactive') + '">' + (e.active ? 'Ativa' : 'Inativa') + '</span>' +
                            '<button class="emp-del" onclick="event.stopPropagation();empDelete(\'' + e.id + '\')">✕</button></div>';
                    }).join('') || '<div style="color:var(--text-muted);font-size:0.85rem;padding:16px 0">Nenhuma empresa cadastrada.</div>';
                }).catch(function () {
                    el.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:16px 0">Erro ao carregar empresas.</div>';
                });
            }

            function empOpenForm(id) {
                if (!api.isLoggedIn() || !api.isAdmin()) { showToast('Faça login como administrador master'); return; }
                var overlay = document.getElementById('empFormOverlay');
                var adminFields = document.getElementById('empFormAdminFields');
                if (!id) {
                    document.getElementById('empFormTitle').textContent = 'Nova Empresa';
                    document.getElementById('empFormName').value = '';
                    document.getElementById('empFormAdminName').value = '';
                    document.getElementById('empFormAdminPass').value = '';
                    document.getElementById('empFormShowPass').checked = false;
                    document.getElementById('empFormAdminPass').type = 'password';
                    document.getElementById('empFormActive').checked = true;
                    overlay.dataset.editId = '';
                    adminFields.style.display = '';
                    var perms = empDefaultPerms();
                    renderEmpPerms(perms);
                    overlay.style.display = 'flex';
                    return;
                }
                api.companyGet(id).then(function (empresa) {
                    if (!empresa) { showToast('Empresa não encontrada'); return; }
                    document.getElementById('empFormTitle').textContent = 'Editar Empresa';
                    document.getElementById('empFormName').value = empresa.name || '';
                    document.getElementById('empFormActive').checked = empresa.active !== false;
                    overlay.dataset.editId = empresa.id;
                    adminFields.style.display = 'none';
                    var perms = Object.assign({}, empDefaultPerms(), (empresa.permissions || {}));
                    renderEmpPerms(perms);
                    overlay.style.display = 'flex';
                }).catch(function (e) {
                    showToast('Erro ao carregar empresa: ' + e.message);
                });
            }

            function renderEmpPerms(perms) {
                var html = '';
                Object.keys(perms).forEach(function (key) {
                    var p = perms[key];
                    html += '<div class="emp-perm-row">' +
                        '<span class="perm-label">' + (_tabLabels[key] || key) + '</span>' +
                        '<div class="perm-toggles">' +
                        '<label><input type="checkbox" data-perm="' + key + '" data-type="access" ' + (p.access ? 'checked' : '') + '> Acesso</label>';
                    if (_aiTabs[key]) html += '<label><input type="checkbox" data-perm="' + key + '" data-type="ai" ' + (p.ai !== false ? 'checked' : '') + '> IA</label>';
                    if (key === 'ia') html += '<label><input type="checkbox" data-perm="ia" data-type="chat" ' + (p.chat !== false ? 'checked' : '') + '> Chat</label>';
                    html += '</div></div>';
                });
                document.getElementById('empFormPerms').innerHTML = html;
            }

            function empCloseForm() { document.getElementById('empFormOverlay').style.display = 'none'; }

            function empSave() {
                var overlay = document.getElementById('empFormOverlay');
                var name = document.getElementById('empFormName').value.trim();
                if (!name) { showToast('Informe o nome da empresa'); return; }
                var editId = overlay.dataset.editId;
                var perms = {};
                document.querySelectorAll('#empFormPerms input[type="checkbox"]').forEach(function (cb) {
                    var perm = cb.dataset.perm, type = cb.dataset.type;
                    if (!perms[perm]) perms[perm] = {};
                    perms[perm][type] = cb.checked;
                });
                var data = {
                    name: name,
                    active: document.getElementById('empFormActive').checked,
                    permissions: perms
                };
                var promise;
                if (editId) {
                    promise = api.companyUpdate(editId, data);
                } else {
                    var adminName = document.getElementById('empFormAdminName').value.trim();
                    var adminPass = document.getElementById('empFormAdminPass').value.trim();
                    if (!adminName || !adminPass) { showToast('Informe nome e senha do admin'); return; }
                    data.adminName = adminName;
                    data.adminPassword = adminPass;
                    promise = api.companyCreate(data);
                }
                promise.then(function () {
                    empCloseForm();
                    empRender();
                    showToast('Empresa salva!');
                }).catch(function (e) {
                    showToast('Erro: ' + e.message);
                });
            }

            function empDelete(id) {
                if (!confirm('Remover esta empresa?')) return;
                api.companyDelete(id).then(function () {
                    empRender();
                    showToast('Empresa removida');
                }).catch(function (e) {
                    showToast('Erro: ' + e.message);
                });
            }

            // =====================================================================
            //  COMPANY USERS
            // =====================================================================
            var _companyUsersCache = [];

            function usrRender() {
                var el = document.getElementById('usrList');
                if (!isCompanyMode()) { el.innerHTML = ''; return; }
                api.companyListUsers(_companyMode.id).then(function (users) {
                    _companyUsersCache = users || [];
                    el.innerHTML = (users || []).map(function (u) {
                        return '<div class="emp-card" onclick="usrOpenForm(\'' + u.id + '\')">' +
                            '<div class="emp-name">' + esc(u.name) + '</div>' +
                            '<span class="emp-status ' + (u.active !== false ? 'active' : 'inactive') + '">' + (u.active !== false ? 'Ativo' : 'Inativo') + '</span>' +
                            '<button class="emp-del" onclick="event.stopPropagation();usrDelete(\'' + u.id + '\')">✕</button></div>';
                    }).join('') || '<div style="color:var(--text-muted);font-size:0.85rem;padding:16px 0">Nenhum usuário cadastrado.</div>';
                }).catch(function () {
                    el.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:16px 0">Erro ao carregar usuários.</div>';
                });
            }

            function usrOpenForm(id) {
                var overlay = document.getElementById('usrFormOverlay');
                var usr = id ? (_companyUsersCache.find(function (u) { return u.id === id; }) || null) : null;
                document.getElementById('usrFormTitle').textContent = usr ? 'Editar Usuário' : 'Novo Usuário';
                document.getElementById('usrFormName').value = usr ? usr.name : '';
                document.getElementById('usrFormPass').value = '';
                document.getElementById('usrFormActive').checked = usr ? (usr.active !== false) : true;
                overlay.dataset.editId = usr ? usr.id : '';
                overlay.style.display = 'flex';
            }

            function usrCloseForm() { document.getElementById('usrFormOverlay').style.display = 'none'; }

            function usrSave() {
                var overlay = document.getElementById('usrFormOverlay');
                var name = document.getElementById('usrFormName').value.trim();
                if (!name) { showToast('Informe o nome do usuário'); return; }
                var editId = overlay.dataset.editId;
                var pass = document.getElementById('usrFormPass').value.trim();
                if (!editId && !pass) { showToast('Informe uma senha'); return; }
                var active = document.getElementById('usrFormActive').checked;

                var promise;
                if (editId) {
                    var data = { name: name, active: active };
                    if (pass) data.password = pass;
                    promise = api.companyUpdateUser(editId, data);
                } else {
                    promise = api.companyCreateUser(_companyMode.id, name, pass, 'user');
                }
                promise.then(function () {
                    usrCloseForm();
                    usrRender();
                    showToast('Usuário salvo!');
                }).catch(function (e) {
                    showToast('Erro: ' + e.message);
                });
            }

            function usrDelete(id) {
                if (!confirm('Remover este usuário?')) return;
                api.companyDeleteUser(id).then(function () {
                    usrRender();
                    showToast('Usuário removido');
                }).catch(function (e) {
                    showToast('Erro: ' + e.message);
                });
            }

            // =====================================================================
            //  COMPANY REGISTRATION
            // =====================================================================
            function showCompanyRegister() {
                document.getElementById('loginOverlay').classList.add('hidden');
                document.getElementById('companyRegisterOverlay').style.display = 'flex';
                document.getElementById('regCompanyName').value = '';
                document.getElementById('regAdminName').value = '';
                document.getElementById('regPassword').value = '';
                document.getElementById('regPasswordConfirm').value = '';
                document.getElementById('regError').style.display = 'none';
                document.getElementById('regBtn').disabled = false;
                document.getElementById('regBtn').textContent = 'Criar Conta';
            }

            function closeCompanyRegister() {
                document.getElementById('companyRegisterOverlay').style.display = 'none';
                document.getElementById('loginOverlay').classList.remove('hidden');
            }

            function companyRegister() {
                var err = document.getElementById('regError');
                var btn = document.getElementById('regBtn');
                var companyName = document.getElementById('regCompanyName').value.trim();
                var adminName = document.getElementById('regAdminName').value.trim();
                var pass = document.getElementById('regPassword').value;
                var passConfirm = document.getElementById('regPasswordConfirm').value;
                if (!companyName || !adminName || !pass) {
                    err.textContent = 'Preencha todos os campos'; err.style.display = 'block'; return;
                }
                if (pass.length < 4) {
                    err.textContent = 'Senha deve ter no mínimo 4 caracteres'; err.style.display = 'block'; return;
                }
                if (pass !== passConfirm) {
                    err.textContent = 'Senhas não conferem'; err.style.display = 'block'; return;
                }
                err.style.display = 'none';
                btn.disabled = true; btn.textContent = 'Cadastrando...';
                api.companyRegister(companyName, adminName, pass).then(function (result) {
                    btn.disabled = false; btn.textContent = 'Criar Conta';
                    closeCompanyRegister();
                    showToast('<i class="fi fi-rr-check-circle"></i> ' + result.message);
                    // Switch to empresa login tab
                    switchLoginTab('empresa');
                    document.getElementById('loginEmpresaName').value = companyName;
                    document.getElementById('loginEmpresaAdmin').value = adminName;
                    document.getElementById('loginEmpresaPass').value = pass;
                }).catch(function (e) {
                    err.textContent = e.message; err.style.display = 'block';
                    btn.disabled = false; btn.textContent = 'Criar Conta';
                });
            }

            // =====================================================================
            //  COMPANY MODE
            // =====================================================================
            var _companyMode = null; // empresa object when logged in as company admin

            function isCompanyMode() { return !!_companyMode; }

            function switchLoginTab(tab) {
                document.querySelectorAll('.login-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.loginTab === tab); });
                document.querySelectorAll('.login-section').forEach(function (s) { s.classList.toggle('active', s.id === 'loginSection' + tab.charAt(0).toUpperCase() + tab.slice(1)); });
            }

            function empCompanyLogin() {
                var err = document.getElementById('loginEmpresaError');
                var btn = document.getElementById('loginEmpresaBtn');
                var companyName = document.getElementById('loginEmpresaName').value.trim();
                var adminName = document.getElementById('loginEmpresaAdmin').value.trim();
                var pass = document.getElementById('loginEmpresaPass').value.trim();
                if (!companyName || !adminName || !pass) { err.textContent = 'Preencha todos os campos'; err.style.display = 'block'; return; }
                err.style.display = 'none';
                btn.disabled = true; btn.textContent = 'Entrando...';
                api.companyLogin(companyName, adminName, pass).then(function (result) {
                    _companyMode = { id: result.company.id, name: result.company.name, permissions: result.company.permissions || {}, adminName: result.user.name };
                    document.getElementById('loginOverlay').classList.add('hidden');
                    applyCompanyMode();
                    showToast('<i class="fi fi-rr-check-circle"></i> Bem-vindo, ' + result.user.name + ' (' + result.company.name + ')');
                    render();
                    try { renderFinanceCharts(); } catch (e) { }
                    btn.disabled = false; btn.textContent = 'Entrar';
                }).catch(function (e) {
                    err.textContent = e.message; err.style.display = 'block';
                    btn.disabled = false; btn.textContent = 'Entrar';
                });
            }

            function empCompanyLogout() {
                _companyMode = null;
                api.companyLogout();
                document.getElementById('loginEmpresaName').value = '';
                document.getElementById('loginEmpresaAdmin').value = '';
                document.getElementById('loginEmpresaPass').value = '';
                switchLoginTab('master');
                document.getElementById('loginOverlay').classList.remove('hidden');
                applyCompanyMode();
            }

            function applyCompanyMode() {
                var isCompany = isCompanyMode();
                var bar = document.getElementById('companyBar');
                if (bar) bar.style.display = isCompany ? '' : 'none';
                document.querySelectorAll('.sidebar-nav .tab[data-tab]').forEach(function (tab) {
                    var key = tab.dataset.tab;
                    if (key === 'empresas') {
                        tab.style.display = isCompany ? 'none' : '';
                        return;
                    }
                    if (key === 'usuarios') {
                        tab.style.display = isCompany ? '' : 'none';
                        return;
                    }
                    if (key === 'configuracoes') {
                        tab.style.display = 'none';
                        return;
                    }
                    if (!key) return;
                    if (isCompany) {
                        var perms = _companyMode.permissions || {};
                        var p = perms[key] || {};
                        tab.style.display = p.access ? '' : 'none';
                    } else {
                        tab.style.display = '';
                    }
                });
                document.getElementById('sidebarSettingsBtn').style.display = isCompany ? 'none' : '';
                if (isCompany) {
                    var active = document.querySelector('.sidebar-nav .tab.active');
                    if (active && active.style.display === 'none') {
                        var firstVisible = document.querySelector('.sidebar-nav .tab[data-tab]:not([style*="display: none"])');
                        if (firstVisible) firstVisible.click();
                    }
                }
                if (!isCompany && typeof api !== 'undefined') {
                    document.getElementById('sidebarSettingsBtn').style.display = api.isAdmin() ? '' : 'none';
                }
            }

            // Build company bar HTML (inserted once)
            function ensureCompanyBar() {
                if (document.getElementById('companyBar')) return;
                var bar = document.createElement('div');
                bar.id = 'companyBar';
                bar.style.cssText = 'display:none;background:var(--accent);color: var(--text);padding:6px 20px;font-size:0.8rem;display:none;align-items:center;justify-content:space-between';
                var left = document.createElement('span');
                left.id = 'companyBarInfo';
                var right = document.createElement('button');
                right.textContent = 'Sair';
                right.style.cssText = 'background:rgba(var(--opacity-color),0.2);border:none;color: var(--text);padding:4px 12px;border-radius:6px;cursor:pointer;font-size:0.75rem;font-family:inherit';
                right.onclick = empCompanyLogout;
                bar.appendChild(left);
                bar.appendChild(right);
                document.querySelector('.main-content').insertBefore(bar, document.querySelector('.main-content').firstChild);
            }

            // Override render to update company bar
            var _origRender = render;
            render = function () {
                if (_origRender) _origRender();
                ensureCompanyBar();
                if (isCompanyMode()) {
                    var bar = document.getElementById('companyBar');
                    bar.style.display = 'flex';
                    document.getElementById('companyBarInfo').textContent = '<i class="fi fi-rr-building"></i> ' + _companyMode.name + ' — <i class="fi fi-rr-user"></i> ' + _companyMode.adminName;
                    applyCompanyMode();
                } else {
                    var bar = document.getElementById('companyBar');
                    if (bar) bar.style.display = 'none';
                    applyCompanyMode();
                }
            };

            // Restore company session on page load if token exists
            function restoreCompanySession() {
                var session = api.companyGetSession();
                if (session && session.company && session.user) {
                    api.companyVerify().then(function (result) {
                        if (result && result.company) {
                            _companyMode = {
                                id: result.company.id,
                                name: result.company.name,
                                permissions: result.company.permissions || {},
                                adminName: (result.user || {}).name || session.user.name
                            };
                            document.getElementById('loginOverlay').classList.add('hidden');
                            applyCompanyMode();
                            render();
                        } else {
                            api.companyLogout();
                        }
                    }).catch(function () {
                        api.companyLogout();
                    });
                }
            }

            // Initialize company bar on load
            ensureCompanyBar();
            applyCompanyMode();
            restoreCompanySession();
        

