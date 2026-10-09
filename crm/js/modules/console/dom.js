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

// toast(msg, opts) — opts 可为字符串（type）或对象 { type, onUndo, undoLabel, duration }
// onUndo 存在时显示「撤销」按钮，点击后不自动消失（由调用方决定后续）。
export function toast(msg, opts) {
  const cfg = typeof opts === 'string' ? { type: opts } : (opts || {});
  const type = cfg.type || 'ok';
  const duration = cfg.duration || (cfg.onUndo ? 5000 : 2600);
  const t = h('div', { class: 'toast toast-' + type }, [
    h('span', { class: 'toast-msg' }, msg),
    cfg.onUndo ? h('button', {
      class: 'toast-undo', type: 'button',
      onclick: () => { try { cfg.onUndo(); } finally { t.remove(); } },
    }, cfg.undoLabel || '撤销') : null,
  ]);
  document.getElementById('toast-root').appendChild(t);
  if (!cfg.onUndo) setTimeout(() => t.remove(), duration);
  else {
    // 带撤销的 toast 到点后只移除撤销按钮，消息继续显示短暂时间
    const timer = setTimeout(() => {
      const undo = t.querySelector('.toast-undo');
      if (undo) undo.remove();
      setTimeout(() => t.remove(), 800);
    }, duration);
    t._undoTimer = timer;
  }
}
