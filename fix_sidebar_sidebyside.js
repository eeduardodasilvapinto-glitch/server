const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// Replace the recently injected flex-direction: column rule
content = content.replace(
    /\.sidebar\.closed \.sidebar-brand\s*\{\s*flex-direction:\s*column;\s*justify-content:\s*center;\s*align-items:\s*center;\s*gap:\s*12px;\s*padding:\s*18px 0 10px 0;\s*\}/g,
    `.sidebar.closed .sidebar-brand {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            gap: 2px;
            padding: 16px 8px 10px 10px;
        }`
);

// We should also make sure the logo text isn't centered if we are using space-between,
// it should just naturally sit on the left.
content = content.replace(
    /text-align:\s*center;\s*margin:\s*0 auto;/g,
    'text-align: left; margin: 0;'
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Restored side-by-side brand layout.');
