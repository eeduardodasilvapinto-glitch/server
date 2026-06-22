const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Update hover state
content = content.replace(
    /\.sidebar-nav \.tab:hover\s*\{[\s\S]*?\}/,
    `.sidebar-nav .tab:hover {
            color: var(--text);
            background: transparent;
        }`
);

// Update active state
content = content.replace(
    /\.sidebar-nav \.tab\.active\s*\{[\s\S]*?\}/,
    `.sidebar-nav .tab.active {
            background: transparent;
            color: var(--text);
            box-shadow: none;
        }
        .sidebar-nav .tab.active i,
        .sidebar-nav .tab.active .svg-icon {
            color: var(--accent);
        }`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Removed tab backgrounds, colored only active icons.');
