const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Update the DOM for the logo
content = content.replace(
    /<div class="logo">AUREOON<\/div>/,
    `<div class="logo"><span class="logo-full">AUREOON</span><span class="logo-icon">A</span></div>`
);

// Add CSS to handle the switching
const logoCSS = `
        .logo-icon {
            display: none;
            color: var(--accent);
            font-weight: 900;
        }
        .sidebar.closed .logo-full {
            display: none;
        }
        .sidebar.closed .logo-icon {
            display: block;
        }
        
        .sidebar.closed .sidebar-brand .logo {
            display: inline-block !important;
            font-size: 1.6rem;
            letter-spacing: 0;
            width: auto;
            overflow: visible;
            text-align: left;
            margin: 0;
            flex-shrink: 0;
            color: var(--accent);
        }
`;

content = content.replace(
    /\.sidebar\.closed \.sidebar-brand \.logo\s*\{[\s\S]*?\}/,
    logoCSS
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Logo logic updated to switch between full and icon.');
