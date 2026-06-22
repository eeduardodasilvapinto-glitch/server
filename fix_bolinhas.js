const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Fix scoreLabel to use only 3 stages with colored circles
const scoreLabelLogic = `function scoreLabel(score) {
                  if (score >= 70) return '<span style="color:#4ade80">●</span> Saudável';
                  if (score >= 40) return '<span style="color:#facc15">●</span> Regular';
                  return '<span style="color:#ef4444">●</span> Crítico';
              }`;
content = content.replace(/function scoreLabel\(score\) \{[\s\S]*?return '[^']*Grave';\s*\}/, scoreLabelLogic);

const scoreDescLogic = `function scoreDesc(score) {
                  if (score >= 70) return 'Empresa saudável - bom ritmo de entregas';
                  if (score >= 40) return 'Regular - acelere itens de alto impacto';
                  return 'Crítico - priorize ações curto prazo';
              }`;
content = content.replace(/function scoreDesc\(score\) \{[\s\S]*?return 'Grave - reavalie a estrat.*';\s*\}/, scoreDescLogic);

// Fix gargalos icons
const gargHtmlLogic = `var icon = g.tipo === 'red' ? '<span style="color:#ef4444">●</span>' : g.tipo === 'yellow' ? '<span style="color:#facc15">●</span>' : '<span style="color:#4ade80">●</span>';`;
content = content.replace(/var icon = g\.tipo === 'red' \? '\?\?' : g\.tipo === 'yellow' \? '\?\?' : '\?\?';/, gargHtmlLogic);

// Fix oportunidades icons
const opsHtmlLogic = `var icon = o.prioridade === 'alta' ? '<span style="color:#ef4444">●</span>' : o.prioridade === 'media' ? '<span style="color:#facc15">●</span>' : '<span style="color:#4ade80">●</span>';`;
content = content.replace(/var icon = o\.prioridade === 'alta' \? '\?\?' : o\.prioridade === 'media' \? '\?\?' : '\?\?';/, opsHtmlLogic);

// Fix bc-opt missing emojis for prioridades and prazos
content = content.replace(
    /<div class="bc-opt" data-value="alta" onclick="selectBC\('pri','alta'\)">\?\? Alta<\/div>/g,
    `<div class="bc-opt" data-value="alta" onclick="selectBC('pri','alta')"><i class="fi fi-rr-arrow-up" style="color:var(--red)"></i> Alta</div>`
);
content = content.replace(
    /<div class="bc-opt" data-value="media" onclick="selectBC\('pri','media'\)">\?\? M.*dia\s*<\/div>/g,
    `<div class="bc-opt" data-value="media" onclick="selectBC('pri','media')"><i class="fi fi-rr-minus" style="color:#facc15"></i> Média</div>`
);
content = content.replace(
    /<div class="bc-opt" data-value="baixa" onclick="selectBC\('pri','baixa'\)">\?\? Baixa\s*<\/div>/g,
    `<div class="bc-opt" data-value="baixa" onclick="selectBC('pri','baixa')"><i class="fi fi-rr-arrow-down" style="color:#4ade80"></i> Baixa</div>`
);

// Admins roles leftovers
content = content.replace(
    /roleLabel = \{ admin: '\?\? Admin', gestor: '\?\? Gestor\+', colaborador: '<i class="fi fi-rr-user"><\/i> Todos' \};/g,
    `roleLabel = { admin: '<i class="fi fi-rr-crown"></i> Admin', gestor: '<i class="fi fi-rr-briefcase"></i> Gestor+', colaborador: '<i class="fi fi-rr-user"></i> Todos' };`
);
content = content.replace(
    /\{ value: 'gestor', label: '\?\? Gestor\+' \},/g,
    `{ value: 'gestor', label: '<i class="fi fi-rr-briefcase"></i> Gestor+' },`
);
content = content.replace(
    /\{ value: 'admin', label: '\?\? Apenas Admin' \},/g,
    `{ value: 'admin', label: '<i class="fi fi-rr-crown"></i> Apenas Admin' },`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Stages and bolinhas updated.');
