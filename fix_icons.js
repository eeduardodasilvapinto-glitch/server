const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Replace categories array elements
content = content.replace(/{ id: 'vendas', name: 'Vendas', icon: '.*?' }/g, "{ id: 'vendas', name: 'Vendas', icon: '<img src=\"bullseye-arrow.svg\" class=\"svg-icon\">' }");
content = content.replace(/{ id: 'marketing', name: 'Marketing', icon: '.*?' }/g, "{ id: 'marketing', name: 'Marketing', icon: '<img src=\"megaphone.svg\" class=\"svg-icon\">' }");
content = content.replace(/{ id: 'financeiro', name: 'Financeiro', icon: '.*?' }/g, "{ id: 'financeiro', name: 'Financeiro', icon: '<i class=\"fi fi-rr-sack-dollar\"></i>' }");
content = content.replace(/{ id: 'produto', name: 'Produto', icon: '.*?' }/g, "{ id: 'produto', name: 'Produto', icon: '<i class=\"fi fi-rr-box\"></i>' }");
content = content.replace(/{ id: 'operacional', name: 'Operacional', icon: '.*?' }/g, "{ id: 'operacional', name: 'Operacional', icon: '<i class=\"fi fi-rr-settings\"></i>' }");
content = content.replace(/{ id: 'rh', name: 'Pessoas & RH', icon: '.*?' }/g, "{ id: 'rh', name: 'Pessoas & RH', icon: '<img src=\"user.svg\" class=\"svg-icon\">' }");

// Replace cat object mapping correctly
content = content.replace(
    /cat: \{\s*''.*?\},/g,
    `cat: { '': 'Manter categoria', 'vendas': '<img src="bullseye-arrow.svg" class="svg-icon"> Vendas', 'marketing': '<img src="megaphone.svg" class="svg-icon"> Marketing', 'financeiro': '<i class="fi fi-rr-sack-dollar"></i> Financeiro', 'produto': '<i class="fi fi-rr-box"></i> Produto', 'operacional': '<i class="fi fi-rr-settings"></i> Operacional', 'rh': '<img src="user.svg" class="svg-icon"> Pessoas & RH' },`
);

// HTML dropdown opt replacements
const replaceOpt = (cat, replacement) => {
    const reg = new RegExp(`<div class="bc-opt" data-value="${cat}" onclick="selectBC\\('cat','${cat}'\\)">[\\s\\S]*?<\\/div>`);
    content = content.replace(reg, `<div class="bc-opt" data-value="${cat}" onclick="selectBC('cat','${cat}')">${replacement}</div>`);
};

replaceOpt('vendas', '<img src="bullseye-arrow.svg" class="svg-icon"> Vendas');
replaceOpt('marketing', '<img src="megaphone.svg" class="svg-icon"> Marketing');
replaceOpt('financeiro', '<i class="fi fi-rr-sack-dollar"></i> Financeiro');
replaceOpt('produto', '<i class="fi fi-rr-box"></i> Produto');
replaceOpt('operacional', '<i class="fi fi-rr-settings"></i> Operacional');
replaceOpt('rh', '<img src="user.svg" class="svg-icon"> Pessoas & RH');

// Clean up some ?? leftovers in other dictionaries
content = content.replace(
    /pri: \{\s*''.*?\},/g,
    `pri: { '': 'Manter prioridade', 'alta': '<i class="fi fi-rr-arrow-up" style="color:var(--red)"></i> Alta', 'media': '<i class="fi fi-rr-minus" style="color:#facc15"></i> Média', 'baixa': '<i class="fi fi-rr-arrow-down" style="color:#4ade80"></i> Baixa' },`
);

content = content.replace(
    /prazo: \{\s*''.*?\}\s*\};/g,
    `prazo: { '': 'Manter prazo', 'curto': '<i class="fi fi-rr-time-fast"></i> Curto', 'medio': '<i class="fi fi-rr-calendar"></i> Médio', 'longo': '<i class="fi fi-rr-hourglass"></i> Longo' }\n                  };`
);

// Some titles have emojis replaced incorrectly
content = content.replace(/>\?\? Produtos e Servios/g, '><i class="fi fi-rr-box"></i> Produtos e Serviços');

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Icons and leftovers fixed.');
