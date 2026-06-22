const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Insert the flex-direction: column rule OUTSIDE the media query (globally for .sidebar.closed)
const newCSS = `
        .sidebar.closed .sidebar-brand {
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: 12px;
            padding: 18px 0 10px 0;
        }
        .sidebar.closed .sidebar-toggle {
            transform: rotate(180deg);
            margin: 0;
        }
        .sidebar:not(.closed) .sidebar-toggle {
            transform: rotate(0deg);
        }
`;

content = content.replace(
    /\.sidebar\.closed:not\(\.no-animate\) \{/g,
    newCSS + '\n        .sidebar.closed:not(.no-animate) {'
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Fixed overlapping logo and toggle button.');
