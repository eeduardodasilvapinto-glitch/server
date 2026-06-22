const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// First, find all rules hiding the logo and remove/override them
content = content.replace(
    /\.sidebar\.closed \.sidebar-brand \.logo\s*\{\s*display:\s*none;\s*\}/g,
    '' // remove the rule that hides it on tablet/mobile
);

content = content.replace(
    /\.sidebar\.closed \.sidebar-brand \.logo\s*\{[\s\S]*?\}/g,
    `.sidebar.closed .sidebar-brand .logo {
            display: block !important;
            font-size: 1.4rem;
            letter-spacing: 0;
            overflow: hidden;
            width: 1ch;
            text-overflow: clip;
            white-space: nowrap;
            color: var(--accent);
            text-align: center;
            margin: 0 auto;
        }`
);

// We should also make sure the toggle button doesn't hide or crowd the layout when closed
content = content.replace(
    /\.sidebar\.closed \.sidebar-brand\s*\{\s*justify-content:\s*center;\s*padding:\s*14px 4px 8px;\s*\}/g,
    `.sidebar.closed .sidebar-brand {
            justify-content: center;
            padding: 14px 0px 8px;
            flex-direction: column;
            gap: 8px;
        }`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Sidebar closed brand updated.');
