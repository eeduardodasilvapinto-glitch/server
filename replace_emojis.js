const fs = require('fs');

const file = 'checklist.html';
let content = fs.readFileSync(file, 'utf8');

const emojiMap = {
  '📋': '<i class="fi fi-rr-clipboard-list"></i>',
  '📄': '<i class="fi fi-rr-document"></i>',
  '💰': '<i class="fi fi-rr-sack-dollar"></i>',
  '🤖': '<i class="fi fi-rr-robot"></i>',
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

// Add flaticon CDN if not present
if (!content.includes('cdn-uicons.flaticon.com')) {
    content = content.replace(
        '</head>',
        '    <link rel="stylesheet" href="https://cdn-uicons.flaticon.com/uicons-regular-rounded/css/uicons-regular-rounded.css">\n</head>'
    );
}

// Replace emojis
for (const [emoji, icon] of Object.entries(emojiMap)) {
  const regex = new RegExp(emoji, 'g');
  content = content.replace(regex, icon);
}

// Also adjust the sidebar CSS to align icons properly
if (!content.includes('.fi { display: inline-flex;')) {
    content = content.replace(
        '</style>',
        '        .fi { display: inline-flex; align-items: center; justify-content: center; font-size: 1.1em; transform: translateY(1px); margin-right: 2px; }\n</style>'
    );
}

fs.writeFileSync(file, content, 'utf8');

console.log('Emojis replaced with Flaticon UIcons.');
