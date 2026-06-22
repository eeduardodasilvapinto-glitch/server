const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Update the closed brand rules
content = content.replace(
    /\.sidebar\.closed \.sidebar-brand\s*\{[\s\S]*?\}/,
    `.sidebar.closed .sidebar-brand {
            flex-direction: row;
            justify-content: flex-start;
            align-items: center;
            padding: 16px 0 10px 14px;
            position: relative;
        }`
);

// We update the toggle button to be absolute when closed
content = content.replace(
    /\.sidebar\.closed \.sidebar-toggle\s*\{[\s\S]*?\}/,
    `.sidebar.closed .sidebar-toggle {
            position: absolute;
            right: 4px;
            top: 50%;
            margin-top: -2px; /* Slight vertical visual adjustment */
            transform: translateY(-50%) rotate(180deg);
            padding: 4px 2px; /* Make it take less space */
        }`
);

// And ensure the logo doesn't overflow or push
content = content.replace(
    /\.sidebar\.closed \.sidebar-brand \.logo\s*\{[\s\S]*?\}/,
    `.sidebar.closed .sidebar-brand .logo {
            display: inline-block !important;
            font-size: 1.4rem;
            letter-spacing: 0;
            overflow: hidden;
            width: 1.2ch;
            text-overflow: clip;
            white-space: nowrap;
            color: var(--accent);
            text-align: left;
            margin: 0;
            flex-shrink: 0;
        }`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Absolute positioning applied to toggle button.');
