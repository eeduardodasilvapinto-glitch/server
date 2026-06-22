const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// 1. <h3>... Editar Documento</h3>
content = content.replace(
    /<h3>.*?Editar Documento<\/h3>/g,
    `<h3><img src="pencil.svg" class="svg-icon" style="transform: translateY(2px);"> Editar Documento</h3>`
);

// 2. <h3>... Editar Item</h3>
content = content.replace(
    /<h3>.*?Editar Item<\/h3>/g,
    `<h3><img src="pencil.svg" class="svg-icon" style="transform: translateY(2px);"> Editar Item</h3>`
);

// 3. Renomear Kanban Col
content = content.replace(
    /title="Renomear">.*?<\/button>/g,
    `title="Renomear"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 1.2em; height: 1.2em;"></button>`
);

// 4. Editar em massa
content = content.replace(
    /<button class="crm-btn-outline" id="crmEditMassBtn" onclick="toggleCrmEditMode\(\)">.*?Editar em massa<\/button>/g,
    `<button class="crm-btn-outline" id="crmEditMassBtn" onclick="toggleCrmEditMode()"><img src="pencil.svg" class="svg-icon" style="transform: translateY(2px);"> Editar em massa</button>`
);

// 5. Editar documento (tabela)
content = content.replace(
    /title="Editar">.*?<\/button>/g,
    `title="Editar"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 1.2em; height: 1.2em;"></button>`
);

// 6. Editar lead
content = content.replace(
    /title="Editar lead">.*?<\/button>/g,
    `title="Editar lead"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 1.2em; height: 1.2em;"></button>`
);

// ALSO, REPLACE THE FIRE ICONS while we're at it!
// We copied fire-flame-curved.svg earlier.
// <h2>... Itens com maior impacto de curto prazo</h2>
content = content.replace(
    /<h2>.*?Itens com maior impacto de curto prazo<\/h2>/g,
    `<h2><img src="fire-flame-curved.svg" class="svg-icon" style="transform: translateY(2px);"> Itens com maior impacto de curto prazo</h2>`
);

// <div class="fin-card-header">... Principais Oportunidades</div>
content = content.replace(
    /<div class="fin-card-header">.*?Principais Oportunidades<\/div>/g,
    `<div class="fin-card-header"><img src="fire-flame-curved.svg" class="svg-icon" style="transform: translateY(2px);"> Principais Oportunidades</div>`
);

// And the ops.map icons:
// var icon = o.prioridade === 'alta' ? '...' : o.prioridade === 'media' ? '...' : '...';
content = content.replace(
    /var icon = o\.prioridade === 'alta' \? '.*?' : o\.prioridade === 'media' \? '.*?' : '.*?';/g,
    `var icon = o.prioridade === 'alta' ? '<img src="fire-flame-curved.svg" class="svg-icon" style="margin:0; filter:none">' : o.prioridade === 'media' ? '⚡' : '🧊';`
);


// WAIT, I must ensure I am updating the right Netlify directory!
fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Pencils and Fires replaced in Netlify - Copia!');

// Just in case, I will also attempt to write to Netlify/checklist.html if it exists, to ensure the user's active editor reflects it!
try {
    let content2 = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify/checklist.html', 'utf8');
    
    content2 = content2.replace(/<h3>.*?Editar Documento<\/h3>/g, `<h3><img src="pencil.svg" class="svg-icon" style="transform: translateY(2px);"> Editar Documento</h3>`);
    content2 = content2.replace(/<h3>.*?Editar Item<\/h3>/g, `<h3><img src="pencil.svg" class="svg-icon" style="transform: translateY(2px);"> Editar Item</h3>`);
    content2 = content2.replace(/title="Renomear">.*?<\/button>/g, `title="Renomear"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 1.2em; height: 1.2em;"></button>`);
    content2 = content2.replace(/<button class="crm-btn-outline" id="crmEditMassBtn" onclick="toggleCrmEditMode\(\)">.*?Editar em massa<\/button>/g, `<button class="crm-btn-outline" id="crmEditMassBtn" onclick="toggleCrmEditMode()"><img src="pencil.svg" class="svg-icon" style="transform: translateY(2px);"> Editar em massa</button>`);
    content2 = content2.replace(/title="Editar">.*?<\/button>/g, `title="Editar"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 1.2em; height: 1.2em;"></button>`);
    content2 = content2.replace(/title="Editar lead">.*?<\/button>/g, `title="Editar lead"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 1.2em; height: 1.2em;"></button>`);
    
    content2 = content2.replace(/<h2>.*?Itens com maior impacto de curto prazo<\/h2>/g, `<h2><img src="fire-flame-curved.svg" class="svg-icon" style="transform: translateY(2px);"> Itens com maior impacto de curto prazo</h2>`);
    content2 = content2.replace(/<div class="fin-card-header">.*?Principais Oportunidades<\/div>/g, `<div class="fin-card-header"><img src="fire-flame-curved.svg" class="svg-icon" style="transform: translateY(2px);"> Principais Oportunidades</div>`);
    content2 = content2.replace(/var icon = o\.prioridade === 'alta' \? '.*?' : o\.prioridade === 'media' \? '.*?' : '.*?';/g, `var icon = o.prioridade === 'alta' ? '<img src="fire-flame-curved.svg" class="svg-icon" style="margin:0; filter:none">' : o.prioridade === 'media' ? '⚡' : '🧊';`);

    fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify/checklist.html', content2, 'utf8');
    console.log('Pencils and Fires replaced in Netlify too!');
} catch(e) {
    console.log('Netlify folder update failed: ' + e.message);
}
