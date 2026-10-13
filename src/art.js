// 그림 묶음(오픈 라이선스 그림)의 그림: 카드에 { t: 'art', art: '묶음:이름' } 으로 놓는다. DOM 을 쓰지 않는다(node 에서도 읽힌다).
// 묶음의 자료(src/art/*.js)는 크기가 커서 처음 쓸 때 한 번 불러온다(loadArt). 그림의 내용(SVG)은 디자인에 저장하지 않고 이름만 저장한다:
// 다른 사람이 만든 디자인을 열어도 이 프로젝트가 가진 그림만 그려지게(바깥에서 들어온 SVG 를 그대로 넣지 않게) 하기 위해서다.
//
// 묶음마다의 출처와 사용 조건은 src/art/LICENSE-*.txt 에 있다(모두 상업적으로도 쓸 수 있다: MIT · CC0).
// 고른 그림과 한국어 낱말은 tools/art/*.txt, 다시 만드는 법은 tools/art/build.mjs.
//
// 묶음 하나: id(저장되는 앞 이름. 바꾸지 않는다) · name(화면 이름) · file(src/art/ 의 파일) · view(SVG 의 viewBox) ·
//            color(참이면 한 가지 색으로 그린 그림이라 색을 바꿀 수 있다) · w(처음 놓일 때의 너비) · credit(출처 한 줄)
export const ART_PACKS = [
  { id: 'fe', name: '컬러 그림', file: 'fluent.js', view: [0, 0, 32, 32], color: false, w: 22, credit: 'Fluent Emoji · Microsoft · MIT' },
  { id: 'tb', name: '선 아이콘', file: 'tabler.js', view: [0, 0, 24, 24], color: true, w: 20, credit: 'Tabler Icons · Paweł Kuna · MIT' },
  { id: 'px', name: '픽셀', file: 'pixel.js', view: [0, 0, 24, 24], color: true, w: 20, credit: 'Pixelarticons · Gerrit Halfmann · MIT' },
  { id: 'pp', name: '사람', file: 'peeps.js', view: [184.216, 210.787, 940.27, 1130.588], color: false, w: 30, credit: 'Open Peeps · Pablo Stanley · CC0' },
];

/** 그림 이름의 모양: 묶음:이름(영어 소문자·숫자·붙임표). */
export const ART_ID = /^(fe|tb|px|pp):[a-z0-9][a-z0-9-]{0,60}$/;
export const isArtId = (id) => typeof id === 'string' && ART_ID.test(id);
/** 그 그림의 묶음(모르는 이름이면 null). */
export const artPack = (id) => (isArtId(id) ? ART_PACKS.find((p) => p.id === id.slice(0, 2)) || null : null);
/** 그림의 가로 ÷ 세로. */
export const artAspect = (id) => {
  const p = artPack(id);
  return p ? p.view[2] / p.view[3] : 1;
};
/** 색을 바꿀 수 있는 그림인가(선 아이콘 · 픽셀). */
export const artColorable = (id) => !!artPack(id)?.color;

const found = new Map();            // 그림 이름 → { name(화면 이름), words(찾는 낱말), body(SVG 안쪽) }
let job = null;
/** 묶음들을 불러온다(한 번만). 실패하면 다음에 다시 시도한다. */
export function loadArt() {
  job ||= Promise.all(ART_PACKS.map((p) => import(`./art/${p.file}`))).then((mods) => {
    // 묶음의 차례(ART_PACKS)대로 넣는다: 찾기 결과도 컬러 그림 → 선 아이콘 → 픽셀 → 사람 차례로 나온다.
    mods.forEach((m, i) => {
      for (const [name, words, body] of m.default.items) found.set(`${ART_PACKS[i].id}:${name}`, { name: words.split(' ')[0], words, body });
    });
    return found.size;
  }).catch((ex) => { job = null; throw ex; });
  return job;
}
/** 묶음을 다 불러왔는가. */
export const artReady = () => found.size > 0 && !!job;
/** 그 그림의 화면 이름(불러오기 전이거나 모르는 그림이면 ''). */
export const artName = (id) => found.get(id)?.name || '';

/**
 * 요소 안에 넣을 SVG 글(불러오기 전이거나 모르는 그림이면 빈 글). fit: 'fill' 이면 칸에 꽉 차게 늘이고(카드 위의 요소),
 * 'meet' 이면 비율을 지켜 칸 안에 넣는다(고르는 칸의 작은 그림).
 */
export function artSvg(id, { fit = 'fill' } = {}) {
  const a = found.get(id);
  const p = artPack(id);
  if (!a || !p) return '';
  return `<svg viewBox="${p.view.join(' ')}" preserveAspectRatio="${fit === 'meet' ? 'xMidYMid meet' : 'none'}" aria-hidden="true" focusable="false">${a.body}</svg>`;
}

/**
 * 그림 찾기: 낱말(띄어 쓴 낱말이 모두 들어 있는 것)과 묶음(pack: 묶음 id. 비우면 모두)으로 고른다. 낱말이 없으면 그 묶음의 그림 모두.
 * 돌려주는 것: [{ id, name }] (묶음의 차례 그대로)
 */
export function searchArt(query = '', pack = '') {
  const words = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const [id, a] of found) {
    if (pack && !id.startsWith(`${pack}:`)) continue;
    if (words.every((w) => a.words.includes(w) || id.includes(w))) out.push({ id, name: a.name });
  }
  return out;
}
