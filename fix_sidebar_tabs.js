const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Update the closed sidebar nav tab styling
content = content.replace(
    /\.sidebar\.closed \.sidebar-nav \.tab\s*\{[\s\S]*?\}/,
    `.sidebar.closed .sidebar-nav .tab {
            justify-content: center;
            width: 100%;
            height: 44px; /* Fixed height for a perfect square look */
            padding: 0;
            font-size: 1.2rem;
            border-radius: 12px; /* Smoother corner */
        }`
);

// We should also adjust the sidebar-nav padding when closed to allow the tabs to be wider
content = content.replace(
    /\.sidebar\.closed \.sidebar-nav \.tab span\s*\{/,
    `.sidebar.closed .sidebar-nav {
            padding: 24px 8px; /* Less left/right padding to give tabs more width */
        }
        .sidebar.closed .sidebar-nav .tab span {`
);

// And ensure tabs have width: 100% generally
content = content.replace(
    /\.sidebar-nav \.tab\s*\{\s*display:\s*flex;/,
    `.sidebar-nav .tab {\n            display: flex;\n            width: 100%;`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Sidebar tabs styling fixed to fill perfectly.');
