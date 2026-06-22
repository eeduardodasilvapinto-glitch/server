const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Replace the logo HTML properly (globally)
content = content.replace(
    /<div class="logo">\s*AUREOON\s*<\/div>/g,
    `<div class="logo"><span class="logo-full">AUREOON</span><span class="logo-icon">A</span></div>`
);

// We need to make sure the arrow toggle CSS is injected!
// Since the previous replace failed, let's just append it to the logo CSS.
content = content.replace(
    /\.sidebar\.closed \.sidebar-brand \.logo\s*\{[\s\S]*?\}/,
    `.sidebar.closed .sidebar-brand .logo {
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
        
        .sidebar.closed .sidebar-brand {
            position: relative;
            justify-content: flex-start;
            padding: 16px 0 10px 14px;
        }

        .sidebar.closed .sidebar-toggle {
            position: absolute !important;
            right: 4px;
            top: 50%;
            transform: translateY(-50%) rotate(180deg) !important;
            margin: 0;
            display: block !important;
        }`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Fixed HTML logo replacement and arrow absolute positioning.');
