// 작은 DOM 도우미: 요소 만들기, 토스트(잠깐 뜨는 알림), 창(모달).
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) node.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden') node[k] = !!v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let toastTimer = 0;
export function toast(message, ms = 2500) {
  let box = document.getElementById('toast');
  if (!box) { box = el('div', { id: 'toast', class: 'toast' }); document.body.append(box); }
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), ms);
}

let modalRoot = null;
export function closeModal() {
  if (!modalRoot) return;
  const onClose = modalRoot._onClose;
  modalRoot.remove();
  modalRoot = null;
  document.body.classList.remove('modal-open');
  if (onClose) onClose();
}
export function openModal(contentEl, { onClose, wide = false } = {}) {
  closeModal();
  const panel = el('div', { class: `modal-panel${wide ? ' wide' : ''}` },
    el('button', { class: 'modal-close', type: 'button', 'aria-label': '닫기', onClick: closeModal }, '✕'),
    contentEl);
  modalRoot = el('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target === modalRoot) closeModal(); } }, panel);
  modalRoot._onClose = onClose;
  document.body.append(modalRoot);
  document.body.classList.add('modal-open');
  return closeModal;
}
