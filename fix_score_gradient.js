const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// The CSS rule has gradient and text-fill-color. We can override it in JS.
const scoreLabelLogic = `function scoreLabel(score) {
                  // Força o elemento a não usar o gradiente
                  document.getElementById('scoreImpact').style.background = 'none';
                  document.getElementById('scoreImpact').style.webkitTextFillColor = 'initial';

                  if (score >= 70) {
                      document.getElementById('scoreImpact').style.color = '#4ade80';
                      return '<span style="font-size: 1.25em;">●</span> Saudável';
                  }
                  if (score >= 40) {
                      document.getElementById('scoreImpact').style.color = '#facc15';
                      return '<span style="font-size: 1.25em;">●</span> Regular';
                  }
                  
                  document.getElementById('scoreImpact').style.color = '#ef4444';
                  return '<span style="font-size: 1.25em;">●</span> Crítico';
              }`;

content = content.replace(/function scoreLabel\(score\) \{[\s\S]*?return '<span style="color:#ef4444">●<\/span> Crítico';\s*\}/, scoreLabelLogic);

fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Fixed scoreImpact gradient and circle size.');
