const fs = require('fs');
let content = fs.readFileSync('checklist.html', 'utf8');

// Sidebar background
content = content.replace(
    'background: hsl(var(--accent-h), var(--accent-s), 48%);\n            border: none;',
    'background: var(--surface);\n            border: 1px solid var(--border);'
);

// Sidebar text colors
content = content.replace(
    'color: rgba(0, 0, 0, 0.85);',
    'color: var(--text-dim);'
);

content = content.replace(
    '.sidebar-nav .tab.active {\n            background: var(--surface);',
    '.sidebar-nav .tab.active {\n            background: var(--accent-glow);\n            color: var(--accent);'
);

// Remove text-shadow from logo
content = content.replace(
    'text-shadow: 0 2px 12px rgba(0,0,0,0.3);',
    ''
);

// Closed sidebar background
content = content.replace(
    'background: hsl(var(--accent-h), var(--accent-s), 42%);',
    'background: var(--surface); border: 1px solid var(--border);'
);

fs.writeFileSync('checklist.html', content);
