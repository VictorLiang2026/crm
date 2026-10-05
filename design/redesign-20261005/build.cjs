/**
 * 打包 iPad.html / iPhone.html 两个自包含单文件原型
 * 运行：node build.cjs
 */
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const css = fs.readFileSync(path.join(dir, 'src', 'app.css'), 'utf8');
const js  = fs.readFileSync(path.join(dir, 'src', 'data.js'), 'utf8')
          + '\n' + fs.readFileSync(path.join(dir, 'src', 'views.js'), 'utf8');

function tpl(device){
  const phone = device === 'iPhone';
  const shellOpen = phone
    ? '<div class="device-frame"><div class="device-screen"><div id="app"></div></div></div>'
    : '<div id="app"></div>';
return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Victor's CRM 界面重设计 · ${device}</title>
<style>
${css}
</style>
</head>
<body data-device="${device}">
${shellOpen}
<script>
${js}
</script>
</body>
</html>`;
}

for (const d of ['iPad','iPhone']) {
  const out = path.join(dir, d + '.html');
  fs.writeFileSync(out, tpl(d));
  console.log('已生成:', d + '.html', (fs.statSync(out).size/1024).toFixed(1) + ' KB');
}
