const fs = require('fs');

const files = ['checklist.html', 'wpp-crm.css'];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Replace translucent whites with translucent blacks
  content = content.replace(/rgba\(255,\s*255,\s*255,\s*(0\.\d+)\)/g, 'rgba(0, 0, 0, $1)');

  // Change specific hardcoded colors
  content = content.replace(/color:\s*#fff/g, 'color: var(--text)');
  // Exception: if it's the logo or primary button, we might want to keep white
  // Let's just fix the logo specifically
  content = content.replace(/\.brand \.logo \{[\s\S]*?\}/g, match => {
    return match.replace(/color: var\(--text\)/g, 'color: #fff');
  });
  
  // Also fix Flaticon UIcons integration
  // Replace the iconify script with Flaticon UIcons
  if (file === 'checklist.html') {
    content = content.replace(
      '<script src="https://code.iconify.design/iconify-icon/2.0.0/iconify-icon.min.js"></script>',
      '<link rel="stylesheet" href="https://cdn-uicons.flaticon.com/uicons-regular-rounded/css/uicons-regular-rounded.css">'
    );
  }

  // Remove box-shadow glows completely to make it cleaner
  content = content.replace(/box-shadow: 0 0 \d+px var\(--accent-glow\);/g, 'box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);');

  fs.writeFileSync(file, content, 'utf8');
}
