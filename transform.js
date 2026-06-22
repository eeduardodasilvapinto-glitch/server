const fs = require('fs');

const file = 'checklist.html';
let content = fs.readFileSync(file, 'utf8');

// 1. CSS Theme replacements
const rootVars = `
        :root {
            --bg: #0f172a;
            --surface: #1e293b;
            --surface2: #334155;
            --border: #334155;
            --border-hover: #475569;
            --text: #f8fafc;
            --text-dim: #94a3b8;
            --text-muted: #64748b;
            --accent-h: 221;
            --accent-s: 83%;
            --accent-l: 53%;
            --accent: #2563eb;
            --accent-light: #60a5fa;
            --accent-dark: #1d4ed8;
            --accent-glow: transparent;
            --gradient: #2563eb;
            --gradient-glare: transparent;
            --red: #ef4444;
            --opacity-color: 255, 255, 255;
            --icon-filter: invert(1);
        }

        [data-theme="light"] {
            --bg: #f8fafc;
            --surface: #ffffff;
            --surface2: #f1f5f9;
            --border: #e2e8f0;
            --border-hover: #cbd5e1;
            --text: #0f172a;
            --text-dim: #475569;
            --text-muted: #64748b;
            --accent-glow: rgba(37, 99, 235, 0.1);
            --opacity-color: 0, 0, 0;
            --icon-filter: none;
        }
`;

// Replace original :root
content = content.replace(/:root\s*\{[\s\S]*?--red:\s*#ef4444;\s*\}/, rootVars);

// Replace rgba(255, 255, 255, with rgba(var(--opacity-color), 
content = content.replace(/rgba\(255,\s*255,\s*255,/g, 'rgba(var(--opacity-color),');

// Replace some color: #fff; to color: var(--text); except in logos
content = content.replace(/color:\s*#fff/g, 'color: var(--text)');
content = content.replace(/\.brand \.logo \{[\s\S]*?\}/g, match => match.replace(/color: var\(--text\)/g, 'color: #fff'));

// Replace glowing box shadows
content = content.replace(/box-shadow: 0 0 \d+px var\(--accent-glow\);/g, 'box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);');

// Simplify sidebar
content = content.replace(
    'background: hsl(var(--accent-h), var(--accent-s), 48%);',
    'background: var(--surface); border-right: 1px solid var(--border);'
);
content = content.replace(
    '.sidebar-nav .tab.active {\n            background: var(--surface);',
    '.sidebar-nav .tab.active {\n            background: rgba(37, 99, 235, 0.1);\n            color: var(--accent);'
);
content = content.replace(
    'text-shadow: 0 2px 12px rgba(0,0,0,0.3);',
    ''
);
content = content.replace(
    'background: hsl(var(--accent-h), var(--accent-s), 42%);',
    'background: var(--surface); border-right: 1px solid var(--border);'
);

// 2. Add Flaticon CSS and custom icon CSS
if (!content.includes('cdn-uicons.flaticon.com')) {
    content = content.replace(
        '</head>',
        '    <link rel="stylesheet" href="https://cdn-uicons.flaticon.com/uicons-regular-rounded/css/uicons-regular-rounded.css">\n</head>'
    );
}

if (!content.includes('.fi { display: inline-flex;')) {
    content = content.replace(
        '</style>',
        '        .fi { display: inline-flex; align-items: center; justify-content: center; font-size: 1.1em; transform: translateY(1px); margin-right: 2px; }\n        .svg-icon { width: 1.1em; height: 1.1em; margin-right: 4px; filter: var(--icon-filter); }\n        [data-theme="light"] .sidebar-nav .tab.active .svg-icon { filter: invert(36%) sepia(91%) saturate(2360%) hue-rotate(211deg) brightness(98%) contrast(92%); }\n        .kanban-col-header .kch-actions button { font-size: 1rem; display: flex; align-items: center; justify-content: center; }\n</style>'
    );
}

// 3. Add Theme Toggle Button & Logic
if (!content.includes('toggleTheme()')) {
    const toggleBtnHTML = '<button id="themeToggle" class="btn btn-outline" style="padding: 6px 12px; margin-left: 10px; display: flex; align-items: center;" onclick="toggleTheme()" title="Mudar Tema"><i class="fi fi-rr-moon" id="themeIcon"></i></button>';
    content = content.replace(
        '<div class="header-right">',
        '<div class="header-right" style="flex-direction: row; align-items: center;">' + toggleBtnHTML
    );

    const themeScript = `
        <script>
            function toggleTheme() {
                const html = document.documentElement;
                const icon = document.getElementById('themeIcon');
                if (html.getAttribute('data-theme') === 'light') {
                    html.removeAttribute('data-theme');
                    localStorage.setItem('theme', 'dark');
                    icon.className = 'fi fi-rr-moon';
                } else {
                    html.setAttribute('data-theme', 'light');
                    localStorage.setItem('theme', 'light');
                    icon.className = 'fi fi-rr-sun';
                }
            }
            if (localStorage.getItem('theme') === 'light') {
                document.documentElement.setAttribute('data-theme', 'light');
                window.addEventListener('DOMContentLoaded', () => {
                    const icon = document.getElementById('themeIcon');
                    if(icon) icon.className = 'fi fi-rr-sun';
                });
            }
        </script>
    `;
    content = content.replace('<script src="api.js?v=2"></script>', themeScript + '\n    <script src="api.js?v=2"></script>');
}

// 4. Replace Emojis safely
const emojiMap = {
  '📋': '<i class="fi fi-rr-clipboard-list"></i>',
  '📄': '<i class="fi fi-rr-document"></i>',
  '💰': '<i class="fi fi-rr-sack-dollar"></i>',
  '🤖': '<img src="user-robot.svg" class="svg-icon">',
  '📊': '<i class="fi fi-rr-chart-histogram"></i>',
  '📈': '<i class="fi fi-rr-chart-line-up"></i>',
  '🔍': '<i class="fi fi-rr-search"></i>',
  '💬': '<i class="fi fi-rr-comment-alt"></i>',
  '🏢': '<i class="fi fi-rr-building"></i>',
  '⚙️': '<i class="fi fi-rr-settings"></i>',
  '🔔': '<i class="fi fi-rr-bell"></i>',
  '📅': '<i class="fi fi-rr-calendar"></i>',
  '💡': '<i class="fi fi-rr-lightbulb-on"></i>',
  '🚀': '<i class="fi fi-rr-rocket"></i>',
  '✍️': '<i class="fi fi-rr-edit"></i>',
  '✅': '<i class="fi fi-rr-check-circle"></i>',
  '⚠️': '<i class="fi fi-rr-triangle-warning"></i>',
  '👤': '<i class="fi fi-rr-user"></i>',
  '📱': '<i class="fi fi-rr-smartphone"></i>',
  '❌': '<i class="fi fi-rr-cross-circle"></i>',
  '💵': '<i class="fi fi-rr-dollar"></i>',
  '🛒': '<i class="fi fi-rr-shopping-cart"></i>',
  '📝': '<i class="fi fi-rr-memo"></i>',
  '📁': '<i class="fi fi-rr-folder"></i>',
  '🔧': '<i class="fi fi-rr-wrench"></i>',
  '⭐': '<i class="fi fi-rr-star"></i>'
};

for (const [emoji, icon] of Object.entries(emojiMap)) {
  content = content.split(emoji).join(icon);
}

fs.writeFileSync(file, content, 'utf8');

// Process wpp-crm.css for the translucent colors
let cssContent = fs.readFileSync('wpp-crm.css', 'utf8');
cssContent = cssContent.replace(/rgba\(255,\s*255,\s*255,/g, 'rgba(var(--opacity-color),');
fs.writeFileSync('wpp-crm.css', cssContent, 'utf8');

console.log('Transformation complete!');
