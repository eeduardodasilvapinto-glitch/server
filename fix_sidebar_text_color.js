const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

content = content.replace(
    /\.sidebar-nav \.tab:hover\s*\{[\s\S]*?\}/,
    `.sidebar-nav .tab:hover {
            color: var(--accent);
            opacity: 0.7;
            background: transparent;
        }`
);

// Remove the specific hover icon rule we added
content = content.replace(
    /\.sidebar-nav \.tab:hover i,\s*\.sidebar-nav \.tab:hover \.svg-icon\s*\{[\s\S]*?\}/,
    ``
);

// Active state updates
content = content.replace(
    /\.sidebar-nav \.tab\.active\s*\{[\s\S]*?\}/,
    `.sidebar-nav .tab.active {
            background: transparent;
            color: var(--accent);
            opacity: 1;
            box-shadow: none;
        }`
);

// Remove the specific active icon rule
content = content.replace(
    /\.sidebar-nav \.tab\.active i,\s*\.sidebar-nav \.tab\.active \.svg-icon\s*\{[\s\S]*?\}/,
    ``
);

// Ensure smooth transition on the entire tab so text and icon fade nicely together
content = content.replace(
    /\.sidebar-nav \.tab i, \.sidebar-nav \.tab \.svg-icon \{ transition: all 0\.2s ease; \}\n        \.sidebar-nav \.tab \{/,
    `.sidebar-nav .tab {`
); // remove the specific transition

content = content.replace(
    /\.sidebar-nav \.tab\s*\{([\s\S]*?)transition:\s*all\s*0\.2s\s*ease;/g,
    `.sidebar-nav .tab {$1transition: all 0.2s ease, opacity 0.2s ease, color 0.2s ease;`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Hover and active states updated to include text.');
