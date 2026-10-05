// Console DOM 工具：与 admin.html 的 el() 同约定（仅追加真实 Node，防止非法入参导致整页白屏）。
export function h(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v; // 仅用于本模块内的静态 SVG
      else if (k === 'text') node.textContent = String(v);
      else if (k.startsWith('on') && typeof v === 'function') node[k.toLowerCase()] = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (children != null) {
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
  }
  return node;
}

export function toast(msg, type) {
  const t = h('div', { class: 'toast ' + (type || 'ok') }, msg);
  document.getElementById('toast-root').appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
