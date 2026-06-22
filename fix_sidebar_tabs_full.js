const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

content = content.replace(
    /\.sidebar\.closed \.sidebar-nav\s*\{\s*padding:\s*24px 8px;[\s\S]*?\}/,
    `.sidebar.closed .sidebar-nav {
            padding: 24px 6px; 
        }`
);

content = content.replace(
    /\.sidebar\.closed \.sidebar-nav \.tab\s*\{[\s\S]*?\}/,
    `.sidebar.closed .sidebar-nav .tab {
            justify-content: center;
            width: 100%;
            height: 48px;
            padding: 0;
            font-size: 1.3rem;
            border-radius: 10px;
        }`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Sidebar tab size expanded.');
