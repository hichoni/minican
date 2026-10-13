// 디자인 그리기(브라우저): 요소 하나(itemView)와 디자인 한 장(designView). 편집기와 "보기 전용" 화면이 함께 쓴다.
import { el } from './dom.js';
import { backgroundOf, cleanDesign, fontFamilyOf, settings } from './model.js';
import { shapeAsset, shapeSvg } from './shapes.js';
import { artSvg, loadArt, artReady } from './art.js';
import { sceneView } from './scene.js';

/**
 * 요소 하나. 자리와 크기는 카드에 대한 비율이라 카드 크기를 따라간다.
 * item 은 model.js 의 cleanItem 을 거친 모양이어야 한다(여기서는 값을 그대로 믿고 그린다).
 */
export function itemView(item) {
  let node;
  if (item.t === 'text') {
    node = el('div', {
      class: `fi fi-text al-${item.align}${item.bold ? ' bold' : ''}${item.italic ? ' italic' : ''}${item.under ? ' under' : ''}${item.bgc ? ' boxed' : ''}`,
      text: item.text,
    });
    // 글꼴 파일을 받기 전이나 그 글꼴에 없는 글자는 기본 글꼴로 보인다.
    const family = fontFamilyOf(item.font);
    if (family) node.style.fontFamily = `"${family}", var(--fe-font, sans-serif)`;
    node.style.color = item.color;
    if (item.bgc) node.style.background = item.bgc;
  } else if (item.t === 'emoji') {
    node = el('div', { class: 'fi fi-emoji', text: item.ch });
  } else if (item.t === 'shape') {
    // 도형·꾸밈 요소: 그림은 shapes.js 의 것(색은 글자색을 따른다). CSS 로 그리는 것(네모·동그라미·선 …)은 속이 비어 있다.
    node = el('div', { class: `fi fi-shape sh-${item.shape}`, html: shapeSvg(item.shape) });
    node.style.color = item.color;
  } else if (item.t === 'art') {
    // 그림 묶음의 그림: 묶음을 아직 불러오지 않았으면 불러온 뒤에 채운다(그림으로 내보낼 때는 내보내기가 먼저 불러 둔다).
    node = el('div', { class: 'fi fi-art', html: artSvg(item.art) });
    if (item.color) node.style.color = item.color;
    if (!artReady()) loadArt().then(() => { node.innerHTML = artSvg(item.art); }).catch(() => node.classList.add('broken'));
  } else {
    node = el('img', { class: `fi fi-image mk-${item.mask}`, src: item.url, alt: '', draggable: 'false', onError: () => node.classList.add('broken') });
  }
  placeItem(node, item);
  return node;
}

/**
 * 고르는 칸에 보일 요소의 작은 그림. 카드에 놓일 때와 같은 그림·같은 색·같은 비율이다(칸의 크기는 CSS 가 정한다).
 * 모르는 이름이면 null.
 */
export function shapeThumb(id) {
  const a = shapeAsset(id);
  if (!a) return null;
  // 칸이 그 요소의 비율(--fe-shape-ratio)이라, 카드 위에서처럼 칸에 꽉 채워 그리면 놓일 모양 그대로다.
  const node = el('span', { class: `fe-shape-view sh-${a.id}`, 'aria-hidden': 'true', html: shapeSvg(a.id) });
  node.style.color = a.color;
  node.style.setProperty('--fe-shape-ratio', String(Math.round((a.w / a.h) * 1000) / 1000));
  return node;
}

/** 요소의 자리·크기·기울기·투명도를 화면에 반영한다(끌거나 막대를 움직이는 동안에는 이것만 다시 부른다). */
export function placeItem(node, item) {
  node.style.left = `${item.x}%`;
  node.style.top = `${item.y}%`;
  node.style.opacity = item.op < 100 ? String(item.op / 100) : '';
  // 가운데 점에 맞추고 → 돌리고 → (좌우·상하) 뒤집는다.
  node.style.transform = `translate(-50%, -50%) rotate(${item.rot}deg)${item.fx || item.fy ? ` scale(${item.fx ? -1 : 1}, ${item.fy ? -1 : 1})` : ''}`;
  if (item.t === 'text') { node.style.width = `${item.w}%`; node.style.fontSize = `${item.size}cqw`; }
  else if (item.t === 'emoji') node.style.fontSize = `${item.w}cqw`;
  else {
    node.style.width = `${item.w}%`;
    node.style.height = `${item.h}%`;
    if (item.t === 'shape') dressShape(node, item);
  }
}

// 도형의 꾸밈: 모서리 둥글기(r) · 테두리(line, lc) · 속 비움(hollow). 정하지 않은 것은 CSS 의 기본 모양 그대로 둔다.
// 둥글기와 테두리의 한도는 "짧은 변의 절반"을 따르므로 크기가 바뀔 때마다 다시 적는다(그래서 placeItem 이 부른다).
// 하양에 가까운 색인가. 두 톤으로 그린 그림 요소는 밝은 면을 하양으로 얹는데, 바탕까지 하얘지면 그 면이 사라진다.
// 그때는 밝은 면을 옅은 그늘로 바꿔 그린다(minicanva.css 의 .fi-shape.pale).
const pale = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 >= 240;
};
function dressShape(node, item) {
  node.classList.toggle('pale', pale(item.color));
  // 짧은 변의 절반(카드 너비 단위). 높이는 카드 "세로"에 대한 백분율이라, 카드의 비율(--fe-ratio)로 나눠 너비 단위로 바꾼다.
  const half = `min(${item.w / 2}cqw, ${item.h / 2}cqw / var(--fe-ratio, 1))`;
  node.style.borderRadius = item.r == null ? '' : `calc(${half} * ${item.r / 100})`;
  node.classList.toggle('edged', !!item.line);
  node.classList.toggle('hollow', !!item.hollow);
  if (item.line) {
    // 납작한 도형에 굵은 테두리를 둘러도 도형이 부풀지 않게, 짧은 변의 절반까지만 굵어진다.
    node.style.setProperty('--fe-edge', `min(${item.line}cqw, ${half})`);
    node.style.setProperty('--fe-edge-color', item.lc);
  } else {
    node.style.removeProperty('--fe-edge');
    node.style.removeProperty('--fe-edge-color');
  }
}

/** 카드 바탕(빈 카드 요소)에 배경 색과 비율을 입힌다. */
export function paintCard(node, bg) {
  const b = backgroundOf(bg);
  node.style.setProperty('--fe-bg', b.bg);
  node.style.setProperty('--fe-ink', b.ink);
  node.style.setProperty('--fe-ratio', String(settings().aspect));
  return node;
}

/**
 * 디자인 한 장을 그린 요소(보기 전용). 놓인 칸의 너비를 따라 커지고 작아진다.
 * 받은 값은 먼저 cleanDesign 으로 정리하므로, 저장소에서 읽어 온 값을 그대로 넘겨도 된다.
 * empty: 요소가 하나도 없을 때 가운데에 보일 안내 글(없으면 빈 카드).
 * 영상 장면(design.video)이 있으면 바탕에 그 첫 모습을 깐다(scene.js 의 sceneView. 그림은 조금 뒤에 채워진다). sceneEdge: 그 그림의 긴 쪽(px).
 * sceneNote: 거짓이면 영상 파일이 없을 때의 이름표를 넣지 않는다(내보낼 때).
 */
export function designView(design, { empty = '', sceneEdge = 640, sceneNote = true } = {}) {
  const d = cleanDesign(design, { keepSpaces: true });
  return paintCard(el('div', { class: 'fe-card' },
    d.video ? sceneView(d.video, { edge: sceneEdge, note: sceneNote }) : null,
    ...d.items.map(itemView),
    !d.items.length && !d.video && empty ? el('div', { class: 'fe-empty', text: empty }) : null), d.bg);
}
