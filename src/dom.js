// 작은 DOM 도우미: 요소 만들기와 잠깐 떴다 사라지는 알림. minicanva 는 다른 라이브러리 없이 이것만 쓴다.

/** 요소를 만든다. attrs: class · text · dataset · on<Event> · 그 밖의 속성. children: 요소나 글(null 은 건너뛴다). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;          // 모듈 안의 정해진 SVG 에만 쓴다
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
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

let timer = 0;
/** 화면 아래에 잠깐 뜨는 알림(프로젝트에 알림이 따로 있으면 편집기에 notify 를 넘겨 그것을 쓴다). */
export function toast(message, ms = 2500) {
  let box = document.getElementById('fe-toast');
  if (!box) {
    box = el('div', { id: 'fe-toast', class: 'fe-toast', role: 'status' });
    document.body.append(box);
  }
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => box.classList.remove('show'), ms);
}
