const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Swap in the categories array
content = content.replace(
    /{ id: 'vendas', name: 'Vendas', icon: '<img src="bullseye-arrow\.svg" class="svg-icon">' }/g,
    `{ id: 'vendas', name: 'Vendas', icon: '<i class="fi fi-rr-chart-line-up"></i>' }`
);
content = content.replace(
    /{ id: 'produto', name: 'Produto', icon: '<i class="fi fi-rr-box"><\/i>' }/g,
    `{ id: 'produto', name: 'Produto', icon: '<img src="bullseye-arrow.svg" class="svg-icon">' }`
);

// Swap in the cat dictionary
content = content.replace(
    /'vendas': '<img src="bullseye-arrow\.svg" class="svg-icon"> Vendas'/g,
    `'vendas': '<i class="fi fi-rr-chart-line-up"></i> Vendas'`
);
content = content.replace(
    /'produto': '<i class="fi fi-rr-box"><\/i> Produto'/g,
    `'produto': '<img src="bullseye-arrow.svg" class="svg-icon"> Produto'`
);

// Swap in the bc-opt dropdowns
content = content.replace(
    /<div class="bc-opt" data-value="vendas" onclick="selectBC\('cat','vendas'\)"><img src="bullseye-arrow\.svg" class="svg-icon"> Vendas<\/div>/g,
    `<div class="bc-opt" data-value="vendas" onclick="selectBC('cat','vendas')"><i class="fi fi-rr-chart-line-up"></i> Vendas</div>`
);
content = content.replace(
    /<div class="bc-opt" data-value="produto" onclick="selectBC\('cat','produto'\)"><i class="fi fi-rr-box"><\/i> Produto<\/div>/g,
    `<div class="bc-opt" data-value="produto" onclick="selectBC('cat','produto')"><img src="bullseye-arrow.svg" class="svg-icon"> Produto</div>`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Swapped vendas and produto icons.');
