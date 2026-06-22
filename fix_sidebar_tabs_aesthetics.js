const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

content = content.replace(
    /\.sidebar\.closed \.sidebar-nav\s*\{\s*padding:\s*24px 0px;\s*\}/,
    `.sidebar.closed .sidebar-nav {
            padding: 24px 8px; 
        }`
);

content = content.replace(
    /\.sidebar\.closed \.sidebar-nav \.tab\s*\{[\s\S]*?\}/,
    `.sidebar.closed .sidebar-nav .tab {
            justify-content: center;
            width: 100%;
            height: 44px;
            padding: 0;
            font-size: 1.25rem;
            border-radius: 12px;
        }`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Sidebar tab styling adjusted for aesthetics.');
