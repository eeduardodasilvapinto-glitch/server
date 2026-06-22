const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// 1. Fix Kanban Title Escaping
content = content.replace(/'<div class="kch-title">' \+ esc\(col\.title\)/g, '\'<div class="kch-title">\' + col.title');

// 2. Fix broken button icons in Kanban
content = content.replace(/'<button onclick="renameKanbanCol\(' \+ ci \+ '\)" title="Renomear">\?\?<\/button>'/g, '\'<button onclick="renameKanbanCol(\' + ci + \')" title="Renomear"><i class="fi fi-rr-edit"></i></button>\'');
content = content.replace(/'<button class="kch-del" onclick="deleteKanbanCol\(' \+ ci \+ '\)" title="Excluir \\r?\\ncoluna">\?<\/button>'/g, '\'<button class="kch-del" onclick="deleteKanbanCol(\' + ci + \')" title="Excluir coluna"><i class="fi fi-rr-trash"></i></button>\'');
content = content.replace(/'<button class="kch-del" onclick="deleteKanbanCol\(' \+ ci \+ '\)" title="Excluir coluna">\?<\/button>'/g, '\'<button class="kch-del" onclick="deleteKanbanCol(\' + ci + \')" title="Excluir coluna"><i class="fi fi-rr-trash"></i></button>\'');

// 3. Fix Score Circle Color
content = content.replace(
    'background: conic-gradient(var(--accent) var(--pct, 0%), var(--border) var(--pct, 0%));',
    'background: conic-gradient(var(--circle-color, var(--accent)) var(--pct, 0%), var(--border) var(--pct, 0%));'
);

const scoreColorLogic = `
                var circle = document.getElementById('anScoreCircleSm');
                var circleColor = score >= 70 ? '#4ade80' : score >= 40 ? '#facc15' : '#f87171';
                circle.style.setProperty('--pct', score + '%');
                circle.style.setProperty('--circle-color', circleColor);
                document.getElementById('anGeneralScore').textContent = score;
                document.getElementById('anGeneralScore').style.color = circleColor;
`;

content = content.replace(
    /var circle = document\.getElementById\('anScoreCircleSm'\);\s*circle\.style\.setProperty\('--pct', score \+ '%'\);\s*document\.getElementById\('anGeneralScore'\)\.textContent = score;/,
    scoreColorLogic
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Fixes applied.');
