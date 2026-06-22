const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// The CSS filter to turn black/white into #2563eb (the var(--accent) blue)
const svgBlueFilterCSS = `
        .sidebar-nav .tab:hover .svg-icon,
        .sidebar-nav .tab.active .svg-icon {
            filter: brightness(0) saturate(100%) invert(32%) sepia(87%) saturate(3062%) hue-rotate(212deg) brightness(96%) contrast(93%) !important;
        }
`;

content = content.replace(
    /\.sidebar-nav \.tab\.active\s*\{[\s\S]*?box-shadow:\s*none;\s*\}/,
    match => match + '\n' + svgBlueFilterCSS
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('SVG icon color filter added.');
