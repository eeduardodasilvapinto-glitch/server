const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Fix loadKanban logic
const loadKanbanLogic = `function loadKanban() {
                // Try to load from localStorage first for immediate rendering
                let localData = null;
                try {
                    var stored = localStorage.getItem('aureoon_kanban');
                    if (stored) {
                        var parsed = JSON.parse(stored);
                        if (Array.isArray(parsed) && parsed.length) localData = parsed;
                    }
                } catch(e) {}
                
                kanbanData = localData || defaultKanban();

                if (!api.isLoggedIn()) { return; }
                
                api.loadKanban().then(function (res) {
                    var rows = res && res.data;
                    if (rows && rows.length && rows[0].data && Array.isArray(rows[0].data) && rows[0].data.length) {
                        kanbanData = rows[0].data;
                        // Cache it immediately so next reload is fast
                        try { localStorage.setItem('aureoon_kanban', JSON.stringify(kanbanData)); } catch(e){}
                        renderKanban();
                    }
                }).catch(function () {
                    renderKanban();
                });
            }`;

content = content.replace(/function loadKanban\(\) \{[\s\S]*?\}\s*function saveKanban\(\) \{/m, loadKanbanLogic + '\n\n            function saveKanban() {');

// Fix saveKanban logic to always save locally
const saveKanbanLogic = `function saveKanban() {
                // Always save to localStorage as a reliable fallback
                try { localStorage.setItem('aureoon_kanban', JSON.stringify(kanbanData)); } catch(e) {}
                
                if (!api.isLoggedIn()) { return; }
                
                api.saveKanban(kanbanData).catch(function () {});
            }`;

content = content.replace(/function saveKanban\(\) \{[\s\S]*?\}\s*function defaultKanban\(\) \{/m, saveKanbanLogic + '\n\n            function defaultKanban() {');


// Also do the exact same cache fix for loadChecklistFromServer (the Análise tab items)
content = content.replace(
    /api\.loadChecklist\(\)\.then\(function \(res\) \{[\s\S]*?\}\)\.catch\(function \(\) \{ render\(\); \}\);/m,
    `api.loadChecklist().then(function (res) {
                    var rows = res && res.data;
                    if (rows && rows.length && rows[0].data && Array.isArray(rows[0].data) && rows[0].data.length) {
                        items = rows[0].data;
                        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch(e){}
                    }
                    render();
                }).catch(function () { render(); });`
);

content = content.replace(
    /function save\(\) \{[\s\S]*?if \(api\.isLoggedIn\(\)\) \{[\s\S]*?api\.saveChecklist\(items\);[\s\S]*?\}[\s\S]*?\}/m,
    `function save() {
                saveItems(items);
                if (api.isLoggedIn()) {
                    api.saveChecklist(items);
                }
            }`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Fixed Kanban local caching logic to prevent tasks from disappearing on reload.');
