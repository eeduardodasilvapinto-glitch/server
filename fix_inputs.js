const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

content = content.replace(/background: rgba\(var\(--opacity-color\), 0\.04\);/g, 'background: var(--surface);');

// The arrow for .cs-arrow is `?` because of previous encoding corruption maybe? Or maybe it's just a text character.
// Let's ensure the arrow is a flaticon or a nice chevron.
content = content.replace(/<span class="cs-arrow" id=".*?">\?<\/span>/g, match => {
    return match.replace('?', '<i class="fi fi-rr-angle-down" style="font-size:0.7em"></i>');
});
content = content.replace(/<span class="bc-arrow">\?<\/span>/g, '<span class="bc-arrow"><i class="fi fi-rr-angle-down" style="font-size:0.7em"></i></span>');

// Also fix the select native arrow to match
content = content.replace(/stroke='%23888888'/g, "stroke='%2364748b'"); // standard slate-500 color

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Inputs and selects backgrounds standardized to var(--surface).');
