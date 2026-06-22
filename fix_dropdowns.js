const fs = require('fs');

let content = fs.readFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', 'utf8');

// 1. Fix heavy shadows in dropdowns
content = content.replace(/box-shadow: 0 12px 40px rgba\(0, 0, 0, 0\.6\);/g, 'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);');

// 2. Make custom dropdowns use var(--surface) instead of var(--surface2) for a cleaner look
content = content.replace(/\.cs-drop \{\s*position: absolute;\s*top: calc\(100% \+ 4px\);\s*left: 0;\s*right: 0;\s*min-width: max-content;\s*background: var\(--surface2\);/g, 
                          '.cs-drop {\n            position: absolute;\n            top: calc(100% + 4px);\n            left: 0;\n            right: 0;\n            min-width: max-content;\n            background: var(--surface);');

content = content.replace(/\.bc-drop \{\s*position: absolute;\s*top: calc\(100% \+ 4px\);\s*left: 0;\s*right: 0;\s*background: var\(--surface2\);/g, 
                          '.bc-drop {\n            position: absolute;\n            top: calc(100% + 4px);\n            left: 0;\n            right: 0;\n            background: var(--surface);');

// 3. Make sure standard selects have var(--surface) as their explicit background to avoid them turning transparent inside standard controls and showing weird text overlap
content = content.replace(/select \{\s*appearance: none;/g, 'select {\n            appearance: none;\n            background-color: var(--surface);');

// 4. Update standard select dropdown arrow color (the SVG background) to adapt to light/dark
const darkArrow = 'stroke=\\\'rgba(255, 255, 255, 0.4)\\\'';
const lightArrow = 'stroke=\\\'rgba(0, 0, 0, 0.4)\\\'';
// Since we have data-theme, we can't easily change the inline SVG color via a variable in the URL.
// Instead, we can add a filter to the select element to invert it in light mode, or just use a generic gray arrow that works on both: stroke=\\\'#888888\\\'

content = content.replace(/stroke='rgba\(0, 0, 0, 0\.4\)'/g, "stroke='#888888'");

// 5. Enhance .cs-trigger and .bc-trigger (the button you click to open dropdowns)
// They should use var(--surface) and var(--border) nicely
content = content.replace(/background: rgba\(var\(--opacity-color\), 0\.04\);\s*border: 1px solid var\(--border\);/g, 
                          'background: var(--surface);\n            border: 1px solid var(--border);');

content = content.replace(/\.bc-trigger \{\s*width: 100%;\s*background: rgba\(var\(--opacity-color\), 0\.04\);/g, 
                          '.bc-trigger {\n            width: 100%;\n            background: var(--surface);');


fs.writeFileSync('C:/Users/eedua/OneDrive/Área de Trabalho/nova/Netlify - Copia/checklist.html', content, 'utf8');
console.log('Dropdowns standardized.');
