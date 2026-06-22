const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// 1. Change textContent to innerHTML for scoreImpact
content = content.replace(
    /document\.getElementById\('scoreImpact'\)\.textContent = scoreLabel\(score\);/g,
    `document.getElementById('scoreImpact').innerHTML = scoreLabel(score);`
);

// 2. Strip HTML tags from finMetrics string for the AI context
content = content.replace(
    /'Score: ' \+ scoreLabel\(calcScoreGeral\(\)\) \+ ' \(' \+ calcScoreGeral\(\) \+ '\/100\) \| '/g,
    `'Score: ' + scoreLabel(calcScoreGeral()).replace(/<[^>]*>?/gm, '') + ' (' + calcScoreGeral() + '/100) | '`
);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Fixed textContent to innerHTML for scoreLabel.');
