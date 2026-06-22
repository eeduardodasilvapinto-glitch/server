const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Update hover state to color the icon in a different tone
content = content.replace(
    /\.sidebar-nav \.tab:hover\s*\{[\s\S]*?\}/,
    `.sidebar-nav .tab:hover {
            color: var(--text);
            background: transparent;
        }
        .sidebar-nav .tab:hover i,
        .sidebar-nav .tab:hover .svg-icon {
            color: var(--accent);
            opacity: 0.6;
        }`
);

// Ensure smooth transition on the icon itself
content = content.replace(
    /\.sidebar-nav \.tab\s*\{/,
    `.sidebar-nav .tab i, .sidebar-nav .tab .svg-icon { transition: all 0.2s ease; }\n        .sidebar-nav .tab {`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Added hover icon color animation.');
