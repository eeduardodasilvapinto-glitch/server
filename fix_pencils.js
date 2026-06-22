const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// 1. <h3>?? Editar Documento</h3>
content = content.replace(
    /<h3>\?\?\s*Editar Documento<\/h3>/g,
    `<h3><img src="pencil.svg" class="svg-icon" style="transform: translateY(2px);"> Editar Documento</h3>`
);

// 2. <h3>?? Editar Item</h3>
content = content.replace(
    /<h3>\?\?\s*Editar Item<\/h3>/g,
    `<h3><img src="pencil.svg" class="svg-icon" style="transform: translateY(2px);"> Editar Item</h3>`
);

// 3. Renomear Kanban Col
content = content.replace(
    /title="Renomear">\?\?<\/button>/g,
    `title="Renomear"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 1.2em; height: 1.2em;"></button>`
);

// 4. Editar em massa
content = content.replace(
    /<button class="crm-btn-outline" id="crmEditMassBtn" onclick="toggleCrmEditMode\(\)">\?\?\s*Editar em massa<\/button>/g,
    `<button class="crm-btn-outline" id="crmEditMassBtn" onclick="toggleCrmEditMode()"><img src="pencil.svg" class="svg-icon" style="transform: translateY(2px);"> Editar em massa</button>`
);

// 5. Editar documento (tabela)
content = content.replace(
    /title="Editar">\?\?<\/button>/g,
    `title="Editar"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 1.2em; height: 1.2em;"></button>`
);

// 6. Editar lead
content = content.replace(
    /title="Editar lead">\?\?<\/button>/g,
    `title="Editar lead"><img src="pencil.svg" class="svg-icon" style="margin:0; width: 1.2em; height: 1.2em;"></button>`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Pencil icons replaced successfully.');
