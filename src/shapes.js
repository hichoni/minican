// 온바탕 편집기의 요소 애셋: 카드에 놓는 도형·화살표·말풍선·꾸밈 그림. DOM 을 쓰지 않는 자료만 둔다(node 에서 그대로 읽힌다).
// UI 단추에 쓰는 아이콘(icons.js)과는 따로 관리한다: 저쪽은 가는 선으로 절제하고, 이쪽은 면으로 채운 또렷한 그림이다.
//
// 출처: 모두 이 프로젝트에서 직접 그렸다(바깥 그림 묶음을 쓰지 않았다. 따를 사용 조건이 없다).
//
// 애셋 하나는 이렇게 적는다.
//   id     저장되는 이름(디자인의 { t: 'shape', shape: id }). 한 번 정하면 바꾸지 않는다(예전 디자인이 이 이름으로 저장돼 있다).
//   name   화면에 보이는 이름 · group 분류(SHAPE_GROUPS 의 id)
//   w, h   처음 놓일 때의 크기. 둘 다 카드 "너비"를 100 으로 본 값이다(카드가 정사각형이 아니어도 모양이 그대로 나오게 model.js 가 맞춘다).
//   color  처음 놓일 때의 색(COLORS 의 색 가운데 하나). 놓은 뒤에 도구 막대의 "색"으로 바꾼다.
//   css    참이면 SVG 없이 CSS 로 그린다(네모·둥근 네모·동그라미·캡슐·선: 어떤 비율로 늘여도 모서리가 찌그러지지 않는다).
//   box    그림을 그린 칸의 크기 [가로, 세로]. svg 는 이 칸 안에 그린 도형들이다.
//   edge   참이면 테두리를 두르거나 속을 비울 수 있다(면으로 그린 그림만. 선·점선·붓 밑줄처럼 가는 것과, 획으로 그린 것이 섞인
//          순환 화살표·체크·트로피는 색만 바꾼다: 테두리의 굵기가 그 획의 굵기를 덮어쓰기 때문이다).
//   thin   참이면 선이다(선·점선): 도구 막대에 높이 대신 "굵기"가 나온다.
//   corner 참이면 모서리 둥글기를 바꿀 수 있다(네모·둥근 네모). r 은 처음 놓일 때의 둥글기(0~100: 짧은 변의 절반에 대한 %).
//
// 그리는 규칙
//   - 색은 한 가지다: 글자색(currentColor)으로 채운다. 그래서 어떤 애셋이든 색을 바꿀 수 있다.
//   - 그림 요소(노트북·로봇·지구 …)는 "두 톤"으로 그린다: 바탕은 글자색, 밝은 곳은 하양(#ffffff)을, 어두운 곳은 검정(#000000)을 비치게 얹는다.
//     정해 둔 색은 하양과 검정뿐이라, 색 하나만 바꿔도 그림 전체가 그 색의 밝고 어두운 톤으로 함께 바뀐다.
//     흰 종이 위에서도 보이게, 하얀 면(카드·종이)에는 글자색의 옅은 테두리를 두른다.
//   - 가장자리에서 2~6 칸 안쪽에 그려서, 서로 다른 애셋을 나란히 놓아도 보이는 크기가 비슷하다.
//   - 요소는 가로·세로로 따로 늘일 수 있다(편집기의 손잡이). 그래서 box 에 꽉 차게 늘어난다(preserveAspectRatio="none").

/** 분류(요소 칸에 이 차례로 나온다). */
export const SHAPE_GROUPS = [
  { id: 'basic', name: '기본 도형' },
  { id: 'flow', name: '화살표와 선' },
  { id: 'mark', name: '말풍선과 강조' },
  { id: 'school', name: '학교와 성장' },
  { id: 'digital', name: '디지털' },
  { id: 'place', name: '자연과 장소' },
  { id: 'idea', name: '생각과 표현' },
];

const BLUE = '#1c7ed6';
const NAVY = '#26318f';
const YELLOW = '#ffd43b';
const GREEN = '#2f9e44';
const RED = '#e03131';
const ORANGE = '#f76707';
const PURPLE = '#7048e8';
const PINK = '#e64980';
const BROWN = '#8d5524';

// 톱니 배지: 꼭짓점이 n 개인 별 모양(바깥 반지름 r1, 안쪽 반지름 r2).
function burst(n, r1, r2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = (Math.PI * i) / n - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
}
const SQUARE = [100, 100];
// 선으로 그리는 애셋(순환 화살표·체크): 선도 글자색을 따르고, 크기를 따라 굵어진다.
const stroke = (width, body) => `<g fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
// 두 톤 그림의 붓: 밝은 면(하양) · 그늘(검정을 비치게) · 옅은 면(글자색을 비치게) · 하얀 선 · 하얀 면의 옅은 테두리.
const light = (o = 1) => `fill="#ffffff"${o < 1 ? ` fill-opacity="${o}"` : ''}`;
const shade = (o) => `fill="#000000" fill-opacity="${o}"`;
const tint = (o) => `fill="currentColor" fill-opacity="${o}"`;
const whiteLine = (width, body, o = 1) => `<g fill="none" stroke="#ffffff"${o < 1 ? ` stroke-opacity="${o}"` : ''} stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
const paper = 'fill="#ffffff" stroke="currentColor" stroke-opacity=".3" stroke-width="2"';
// 점무늬: 가로 n 개 · 세로 m 개의 점.
function dotGrid(n, m) {
  const out = [];
  for (let y = 0; y < m; y++) for (let x = 0; x < n; x++) out.push(`<circle cx="${10 + x * 20}" cy="${10 + y * 20}" r="${(x + y) % 2 ? 4 : 6}"/>`);
  return out.join('');
}
const CURSOR = 'M12 10V84L29 69 42 95 54 89 41 63H66z';
const CLOUD = 'M30 68a22 22 0 0 1-3-43.8A30 30 0 0 1 84 20a24 24 0 0 1 6 47.5z';
const HAIR = 'M24 42C20 22 33 8 50 8s30 14 26 34c-5-9-14-15-27-15-9 0-18 5-25 15z';
const HAIR2 = 'M20 66C12 34 28 8 50 8s38 26 30 58c-2-16-6-27-13-33-9 4-22 5-32 3-6 7-11 17-15 30z';
const BUST = (hair) => `<path d="M10 98c0-22 16-34 40-34s40 12 40 34z"/><path d="M10 98c0-22 16-34 40-34s40 12 40 34z" ${shade(0.12)}/>`
  + `<circle cx="50" cy="40" r="24"/><circle cx="50" cy="40" r="24" ${light(0.82)}/>`
  + `<path d="${hair}"/><path d="${hair}" ${shade(0.45)}/>`
  + `<circle cx="41" cy="44" r="3" ${shade(0.6)}/><circle cx="59" cy="44" r="3" ${shade(0.6)}/>`
  + '<path d="M42 52a9 9 0 0 0 16 0" fill="none" stroke="#000000" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>';
const RECYCLE = '<path d="M29.2 38A24 24 0 0 1 62 29.2"/><path d="M59.2 18.6 62 29.2 51.4 32"/>';

export const SHAPE_ASSETS = [
  // ---- 기본 도형 ----
  { id: 'rect', name: '네모', group: 'basic', w: 32, h: 32, color: BLUE, edge: true, corner: true, css: true },
  { id: 'round', name: '둥근 네모', group: 'basic', w: 32, h: 32, color: BLUE, edge: true, corner: true, r: 25, css: true },
  { id: 'circle', name: '동그라미', group: 'basic', w: 32, h: 32, color: BLUE, edge: true, css: true },
  { id: 'tri', name: '세모', group: 'basic', w: 32, h: 32, color: BLUE, edge: true, box: SQUARE, svg: '<polygon points="50,2 98,98 2,98"/>' },
  {
    id: 'star', name: '별', group: 'basic', w: 32, h: 32, color: YELLOW, edge: true, box: SQUARE,
    svg: '<polygon points="50,2 61.8,35.6 97.6,36.6 69.1,58.2 79.4,92.5 50,72 20.6,92.5 30.9,58.2 2.4,36.6 38.2,35.6"/>',
  },
  {
    id: 'heart', name: '하트', group: 'basic', w: 32, h: 32, color: '#e64980', edge: true, box: SQUARE,
    svg: '<path d="M50 94 C18 68 2 50 2 30 C2 14 14 4 27 4 C37 4 46 10 50 19 C54 10 63 4 73 4 C86 4 98 14 98 30 C98 50 82 68 50 94 Z"/>',
  },
  { id: 'diamond', name: '마름모', group: 'basic', w: 30, h: 30, color: BLUE, edge: true, box: SQUARE, svg: '<polygon points="50,2 98,50 50,98 2,50"/>' },
  { id: 'hexagon', name: '육각형', group: 'basic', w: 34, h: 30, color: BLUE, edge: true, box: [100, 88], svg: '<polygon points="26,2 74,2 98,44 74,86 26,86 2,44"/>' },
  {
    id: 'ring', name: '고리', group: 'basic', w: 30, h: 30, color: BLUE, edge: true, box: SQUARE,
    svg: '<path fill-rule="evenodd" d="M50 2a48 48 0 1 0 0 96 48 48 0 0 0 0-96zm0 20a28 28 0 1 1 0 56 28 28 0 0 1 0-56z"/>',
  },
  { id: 'quarter', name: '부채꼴', group: 'basic', w: 30, h: 30, color: BLUE, edge: true, box: SQUARE, svg: '<path d="M2 98V2A96 96 0 0 1 98 98z"/>' },

  // ---- 화살표와 선 ----
  { id: 'arrow', name: '화살표', group: 'flow', w: 40, h: 22, color: NAVY, edge: true, box: SQUARE, svg: '<polygon points="2,32 62,32 62,6 98,50 62,94 62,68 2,68"/>' },
  { id: 'arrow2', name: '가는 화살표', group: 'flow', w: 40, h: 16, color: NAVY, edge: true, box: [100, 40], svg: '<path d="M2 15h64V3l32 17-32 17V25H2z"/>' },
  { id: 'both', name: '양쪽 화살표', group: 'flow', w: 44, h: 17.6, color: NAVY, edge: true, box: [100, 40], svg: '<path d="M2 20L30 3v12h40V3l28 17-28 17V25H30v12z"/>' },
  { id: 'curve', name: '곡선 화살표', group: 'flow', w: 36, h: 25.2, color: NAVY, edge: true, box: [100, 70], svg: '<path d="M4 66C4 32 32 10 68 10V2l30 14-30 14v-8C42 22 16 40 16 66z"/>' },
  {
    id: 'elbow', name: '꺾인 화살표', group: 'flow', w: 34, h: 27.2, color: NAVY, edge: true, box: [100, 80],
    svg: '<path d="M6 4h12v40a6 6 0 0 0 6 6h46V38l28 18-28 18V62H24A18 18 0 0 1 6 44z"/>',
  },
  {
    id: 'cycle', name: '순환 화살표', group: 'flow', w: 28, h: 28, color: NAVY, box: SQUARE,
    svg: stroke(10, '<path d="M14 50A36 36 0 0 1 75.5 24.5L86 35"/><path d="M86 14v21H65"/><path d="M86 50a36 36 0 0 1-61.5 25.5L14 65"/><path d="M14 86V65h21"/>'),
  },
  { id: 'line', name: '선', group: 'flow', w: 60, h: 1.6, color: NAVY, thin: true, css: true },
  {
    id: 'dash', name: '점선', group: 'flow', w: 60, h: 1.6, color: NAVY, thin: true, box: [300, 8],
    svg: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${(i * 39.4).toFixed(1)}" y="0" width="24" height="8" rx="4"/>`).join(''),
  },

  // ---- 말풍선과 강조 ----
  {
    id: 'bubble', name: '말풍선', group: 'mark', w: 60, h: 40, color: BLUE, edge: true, box: SQUARE,
    svg: '<path d="M12 2 H88 A10 10 0 0 1 98 12 V62 A10 10 0 0 1 88 72 H46 L24 98 L28 72 H12 A10 10 0 0 1 2 62 V12 A10 10 0 0 1 12 2 Z"/>',
  },
  {
    id: 'bubble2', name: '둥근 말풍선', group: 'mark', w: 56, h: 50.4, color: BLUE, edge: true, box: [100, 90],
    svg: '<path d="M50 3C24 3 3 19 3 40c0 12 7 23 18 30l-6 17 22-11c4 1 9 1.5 13 1.5 26 0 47-16.5 47-37.5S76 3 50 3z"/>',
  },
  { id: 'pill', name: '캡슐 라벨', group: 'mark', w: 44, h: 13, color: NAVY, edge: true, css: true },
  { id: 'ribbon', name: '리본', group: 'mark', w: 56, h: 15.7, color: RED, edge: true, box: [100, 28], svg: '<polygon points="0,0 100,0 93,14 100,28 0,28 7,14"/>' },
  { id: 'badge', name: '톱니 배지', group: 'mark', w: 28, h: 28, color: ORANGE, edge: true, box: SQUARE, svg: burst(14, 48, 41) },
  {
    id: 'note', name: '메모지', group: 'mark', w: 38, h: 38, color: YELLOW, edge: true, box: SQUARE,
    // 접힌 귀퉁이는 같은 색에 그늘을 얹어 그린다(색을 바꿔도 따라 바뀐다).
    svg: '<path d="M6 2h88a4 4 0 0 1 4 4v62L68 98H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z"/><path d="M68 98V72a4 4 0 0 1 4-4h26z" fill="#000000" fill-opacity=".2"/>',
  },
  {
    id: 'underline', name: '붓 밑줄', group: 'mark', w: 46, h: 6.4, color: YELLOW, box: [100, 14],
    svg: '<path d="M2 9C22 3 42 2.5 62 3.5c12 .6 24 0 36-1.5 1 2.500 0 5.500-2 6.500-14 2.200-30 1.500-46 1.800-17 .3-33 .7-47 3.200-2-1-2.500-3-1-4.500z"/>',
  },
  { id: 'highlight', name: '형광펜', group: 'mark', w: 50, h: 15, color: YELLOW, edge: true, box: [100, 30], svg: '<polygon points="5,0 100,0 95,30 0,30"/>' },
  { id: 'check', name: '체크', group: 'mark', w: 22, h: 22, color: GREEN, box: SQUARE, svg: stroke(15, '<path d="M14 54l24 24 48-56"/>') },
  {
    id: 'quote', name: '따옴표', group: 'mark', w: 22, h: 17.2, color: NAVY, edge: true, box: [100, 78],
    svg: '<path d="M4 76V46C4 22 15 8 38 2v14C27 20 21 28 20 40h18v36z"/><path d="M62 76V46c0-24 11-38 34-44v14c-11 4-17 12-18 24h18v36z"/>',
  },
  { id: 'spark', name: '반짝임', group: 'mark', w: 22, h: 22, color: YELLOW, edge: true, box: SQUARE, svg: '<path d="M50 2c4 28 20 44 48 48-28 4-44 20-48 48-4-28-20-44-48-48 28-4 44-20 48-48z"/>' },

  // ---- 학교와 성장 ----
  {
    id: 'book', name: '책', group: 'school', w: 32, h: 26.9, color: BLUE, edge: true, box: [100, 84],
    svg: '<path d="M4 10c15-6 29-5 42 3v64c-13-8-27-9-42-3z"/><path d="M96 10c-15-6-29-5-42 3v64c13-8 27-9 42-3z"/>',
  },
  {
    id: 'pencil', name: '연필', group: 'school', w: 26, h: 26, color: ORANGE, edge: true, box: SQUARE,
    svg: '<g transform="rotate(45 50 50)"><rect x="39" y="-8" width="22" height="14" rx="4"/><rect x="39" y="11" width="22" height="65"/><path d="M39 81h22L50 108z"/></g>',
  },
  {
    id: 'bulb', name: '전구', group: 'school', w: 24, h: 24, color: YELLOW, edge: true, box: SQUARE,
    svg: '<path d="M50 3a31 31 0 0 0-19 55.5c4 3.500 6 8 6 13.500h26c0-5.500 2-10 6-13.500A31 31 0 0 0 50 3z"/><rect x="37" y="77" width="26" height="8" rx="4"/><rect x="42" y="89" width="16" height="8" rx="4"/>',
  },
  {
    id: 'sprout', name: '새싹', group: 'school', w: 26, h: 26, color: GREEN, edge: true, box: SQUARE,
    svg: '<rect x="46" y="50" width="8" height="48" rx="4"/><path d="M48 56C22 58 7 44 5 18c26 0 42 13 43 38z"/><path d="M53 64c1-23 16-36 42-36-1 23-16 36-42 36z"/>',
  },
  {
    id: 'flag', name: '깃발', group: 'school', w: 26, h: 26, color: RED, edge: true, box: SQUARE,
    svg: '<rect x="12" y="3" width="9" height="94" rx="4.500"/><path d="M25 9c13-6 25 5 39 2 8-1.500 15-4 22-4v46c-7 0-14 2.500-22 4-14 3-26-8-39-2z"/>',
  },
  {
    id: 'trophy', name: '트로피', group: 'school', w: 26, h: 26, color: YELLOW, box: SQUARE,
    svg: '<path d="M27 5h46v27a23 23 0 0 1-46 0z"/>'
      + '<path fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" d="M27 14H13v6a15 15 0 0 0 15 15M73 14h14v6a15 15 0 0 1-15 15"/>'
      + '<rect x="45" y="54" width="10" height="20"/><path d="M30 78a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6v6H30z"/><rect x="24" y="88" width="52" height="9" rx="3"/>',
  },
  {
    id: 'magnifier', name: '돋보기', group: 'school', w: 26, h: 26, color: NAVY, edge: true, box: SQUARE,
    svg: '<path fill-rule="evenodd" d="M42 6a36 36 0 1 0 0 72 36 36 0 0 0 0-72zm0 13a23 23 0 1 1 0 46 23 23 0 0 1 0-46z"/><path d="M65 74l9-9 21 21a6.360 6.360 0 0 1-9 9z"/>',
  },
  // ---- 디지털 ---- (여기부터는 두 톤으로 그린 그림 요소다)
  {
    id: 'laptop', name: '노트북', group: 'digital', w: 40, h: 28, color: NAVY, box: [120, 84],
    svg: `<rect x="14" y="4" width="92" height="62" rx="7"/><rect x="21" y="11" width="78" height="48" rx="3" ${light(0.88)}/>`
      + `<path d="M4 70h112v4a8 8 0 0 1-8 8H12a8 8 0 0 1-8-8z"/><path d="M4 70h112v4a8 8 0 0 1-8 8H12a8 8 0 0 1-8-8z" ${light(0.3)}/><path d="M48 70h24v2a3 3 0 0 1-3 3H51a3 3 0 0 1-3-3z" ${shade(0.25)}/>`,
  },
  {
    id: 'phone', name: '휴대폰', group: 'digital', w: 16, h: 27.7, color: NAVY, box: [60, 104],
    svg: `<rect x="4" y="2" width="52" height="100" rx="10"/><rect x="9" y="8" width="42" height="88" rx="5" ${light(0.9)}/><rect x="23" y="11" width="14" height="4" rx="2"/>`,
  },
  {
    id: 'shield', name: '방패', group: 'digital', w: 24, h: 26.9, color: BLUE, box: [100, 112],
    svg: `<path d="M50 3 92 17v36c0 26-17 44-42 56C25 97 8 79 8 53V17z"/><path d="M50 3 92 17v36c0 26-17 44-42 56z" ${shade(0.14)}/>`
      + `<rect x="33" y="52" width="34" height="28" rx="5" ${light()}/>${whiteLine(6, '<path d="M39 53v-9a11 11 0 0 1 22 0v9"/>')}`
      + '<circle cx="50" cy="63" r="4"/><rect x="48" y="64" width="4" height="9" rx="2"/>',
  },
  {
    id: 'globe', name: '지구본', group: 'digital', w: 24, h: 24, color: BLUE, box: SQUARE,
    svg: `<circle cx="50" cy="50" r="46"/>${whiteLine(4, '<ellipse cx="50" cy="50" rx="20" ry="45"/><path d="M5 50h90M50 5v90M11 28h78M11 72h78"/>', 0.8)}`,
  },
  {
    id: 'wifi', name: '와이파이', group: 'digital', w: 22, h: 17.6, color: BLUE, box: [100, 80],
    svg: `${stroke(11, '<path d="M10 30a58 58 0 0 1 80 0"/><path d="M26 47a35 35 0 0 1 48 0"/>')}<circle cx="50" cy="66" r="9"/>`,
  },
  {
    id: 'cursor', name: '마우스', group: 'digital', w: 16, h: 20.8, color: NAVY, box: [80, 104],
    svg: `<path d="${CURSOR}" fill="#ffffff" stroke="#ffffff" stroke-width="13" stroke-linejoin="round"/><path d="${CURSOR}" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>`,
  },
  {
    id: 'chat', name: '채팅 말풍선', group: 'digital', w: 22, h: 18.5, color: BLUE, box: [100, 84],
    svg: '<path d="M16 4h68a12 12 0 0 1 12 12v36a12 12 0 0 1-12 12H44L24 80l3-16H16A12 12 0 0 1 4 52V16A12 12 0 0 1 16 4z"/>'
      + `<circle cx="30" cy="34" r="6" ${light()}/><circle cx="50" cy="34" r="6" ${light()}/><circle cx="70" cy="34" r="6" ${light()}/>`,
  },
  {
    id: 'idcard', name: '이름 카드', group: 'digital', w: 30, h: 15, color: GREEN, box: [120, 60],
    svg: `<rect x="3" y="3" width="114" height="54" rx="12" ${paper}/><circle cx="30" cy="30" r="17"/>`
      + `<circle cx="30" cy="25" r="6" ${light()}/><path d="M19.5 41a10.5 9 0 0 1 21 0z" ${light()}/>`
      + `<rect x="56" y="18" width="48" height="7" rx="3.5" ${tint(0.4)}/><rect x="56" y="34" width="34" height="7" rx="3.5" ${tint(0.4)}/>`,
  },
  {
    id: 'checkcard', name: '확인 카드', group: 'digital', w: 30, h: 15, color: ORANGE, box: [120, 60],
    svg: `<rect x="3" y="3" width="114" height="54" rx="12" ${paper}/><circle cx="30" cy="30" r="17"/>`
      + whiteLine(5, '<path d="M22 30l6 6 11-12"/>')
      + `<rect x="56" y="18" width="48" height="7" rx="3.5" ${tint(0.4)}/><rect x="56" y="34" width="34" height="7" rx="3.5" ${tint(0.4)}/>`,
  },
  {
    id: 'codewin', name: '코드 창', group: 'digital', w: 30, h: 21, color: BLUE, box: [120, 84],
    svg: `<rect x="4" y="4" width="112" height="76" rx="9"/><circle cx="16" cy="15" r="3.5" ${light(0.9)}/><circle cx="27" cy="15" r="3.5" ${light(0.9)}/><circle cx="38" cy="15" r="3.5" ${light(0.9)}/>`
      + `<rect x="14" y="30" width="34" height="6" rx="3" ${light(0.9)}/><rect x="14" y="43" width="24" height="6" rx="3" ${light(0.55)}/><rect x="14" y="56" width="40" height="6" rx="3" ${light(0.9)}/><rect x="14" y="68" width="18" height="6" rx="3" ${light(0.55)}/>`
      + whiteLine(5, '<path d="M76 42 66 52l10 10M100 42l10 10-10 10M93 36 83 68"/>'),
  },
  {
    id: 'robot', name: '로봇', group: 'digital', w: 26, h: 28.6, color: BLUE, box: [100, 110],
    svg: '<rect x="47" y="8" width="6" height="14" rx="3"/><circle cx="50" cy="9" r="6"/><rect x="5" y="38" width="10" height="18" rx="5"/><rect x="85" y="38" width="10" height="18" rx="5"/>'
      + `<rect x="14" y="20" width="72" height="54" rx="20"/><rect x="24" y="31" width="52" height="32" rx="14" ${light()}/>`
      + stroke(5, '<path d="M35 50a6 6 0 0 1 12 0M53 50a6 6 0 0 1 12 0"/>')
      + `<path d="M30 80h40a10 10 0 0 1 10 10v16H20V90a10 10 0 0 1 10-10z"/><path d="M30 80h40a10 10 0 0 1 10 10v16H20V90a10 10 0 0 1 10-10z" ${shade(0.14)}/><circle cx="50" cy="94" r="5" ${light(0.9)}/>`,
  },
  {
    id: 'nodes', name: '연결망', group: 'digital', w: 22, h: 22, color: PURPLE, box: SQUARE,
    svg: `${stroke(5, '<path d="M26 26 76 40 40 78z"/>')}<circle cx="26" cy="26" r="14"/><circle cx="76" cy="40" r="12"/><circle cx="40" cy="78" r="14"/>`
      + `<circle cx="26" cy="26" r="6" ${light(0.85)}/><circle cx="76" cy="40" r="5" ${light(0.85)}/><circle cx="40" cy="78" r="6" ${light(0.85)}/>`,
  },
  {
    id: 'block', name: '코딩 블록', group: 'digital', w: 26, h: 14.3, color: ORANGE, box: [120, 66],
    svg: '<path d="M8 4h20l6 8h14l6-8h58a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H54l-6 8H34l-6-8H8a6 6 0 0 1-6-6V10a6 6 0 0 1 6-6z"/>'
      + `<rect x="16" y="26" width="50" height="8" rx="4" ${light(0.9)}/><circle cx="96" cy="30" r="8" ${light(0.9)}/>`,
  },

  // ---- 자연과 장소 ----
  { id: 'cloud', name: '구름', group: 'place', w: 30, h: 18, color: BLUE, edge: true, box: [120, 72], svg: `<path d="${CLOUD}"/>` },
  { id: 'hill', name: '언덕', group: 'place', w: 60, h: 21, color: GREEN, edge: true, box: [200, 70], svg: '<path d="M0 70C30 30 70 6 110 6c36 0 66 22 90 64z"/>' },
  {
    id: 'plant', name: '풀잎', group: 'place', w: 24, h: 21.6, color: GREEN, box: [100, 90],
    svg: '<path d="M48 88C22 80 8 60 4 34c24 6 42 24 44 54z"/><path d="M52 88c26-8 40-28 44-54-24 6-42 24-44 54z"/>'
      + `<path d="M48 88C22 80 8 60 4 34c24 6 42 24 44 54z" ${shade(0.14)}/><path d="M52 88c26-8 40-28 44-54-24 6-42 24-44 54z" ${light(0.22)}/>`
      + '<path d="M50 88C38 62 38 30 50 4c12 26 12 58 0 84z"/>',
  },
  {
    id: 'leaf', name: '나뭇잎', group: 'place', w: 16, h: 20, color: GREEN, box: [80, 100],
    svg: `<path d="M40 4C66 26 74 52 62 76 56 88 48 94 40 96 32 94 24 88 18 76 6 52 14 26 40 4z"/>${whiteLine(3, '<path d="M40 24v68M40 48 29 38M40 48l11-10M40 66 27 54M40 66l13-12"/>', 0.6)}`,
  },
  {
    id: 'sun', name: '해', group: 'place', w: 22, h: 22, color: YELLOW, box: SQUARE,
    svg: `<circle cx="50" cy="50" r="22"/>${stroke(7, '<path d="M82 50h12M6 50h12M50 6v12M50 82v12M72.6 27.400l8.5-8.500M18.9 81.100l8.5-8.500M27.4 27.400l-8.5-8.500M81.1 81.100l-8.5-8.5"/>')}`,
  },
  {
    id: 'tree', name: '나무', group: 'place', w: 18, h: 22.5, color: GREEN, box: [80, 100],
    svg: `<rect x="35" y="60" width="10" height="38" rx="3"/><rect x="35" y="60" width="10" height="38" rx="3" ${shade(0.35)}/>`
      + '<path d="M40 2c15 0 26 11 26 24 9 4 12 12 12 20 0 14-12 24-26 24H28C14 70 2 60 2 46c0-8 3-16 12-20C14 13 25 2 40 2z"/>',
  },
  {
    id: 'earth', name: '지구', group: 'place', w: 28, h: 28, color: BLUE, box: SQUARE,
    svg: `<circle cx="50" cy="50" r="46"/><path d="M20 32c8-12 24-16 33-9 6 5 2 12-5 15-6 3-5 9-11 12-9 4-19-1-19-9 0-4 0-6 2-9z" ${light(0.8)}/>`
      + `<path d="M61 46c9-4 21-1 26 8 3 9-3 21-11 26-8 4-14-3-14-11 0-6-6-8-6-14 0-4 2-7 5-9z" ${light(0.8)}/><path d="M31 68c6-2 12 2 12 9s-6 12-12 10c-6-3-6-16 0-19z" ${light(0.8)}/>`,
  },
  {
    id: 'drop', name: '물방울', group: 'place', w: 16, h: 20, color: BLUE, box: [80, 100],
    svg: `<path d="M40 4C56 28 72 46 72 64a32 32 0 0 1-64 0C8 46 24 28 40 4z"/>${whiteLine(5, '<path d="M24 64a16 16 0 0 0 12 15"/>', 0.7)}`,
  },
  {
    id: 'recycle', name: '다시 쓰기', group: 'place', w: 20, h: 20, color: GREEN, box: SQUARE,
    svg: `<circle cx="50" cy="50" r="46"/>${whiteLine(7, `${RECYCLE}<g transform="rotate(120 50 50)">${RECYCLE}</g><g transform="rotate(240 50 50)">${RECYCLE}</g>`)}`,
  },
  {
    id: 'map', name: '지도', group: 'place', w: 34, h: 25.5, color: GREEN, box: [120, 90],
    svg: `<path d="M4 16 40 6l40 10 36-10v68L80 84 40 74 4 84z"/><path d="M40 6l40 10v68L40 74z" ${light(0.3)}/>`
      + whiteLine(6, '<path d="M8 62c14-12 22 4 34-6s20-22 38-12 22-10 32-16"/>', 0.85),
  },
  {
    id: 'pin', name: '위치 핀', group: 'place', w: 16, h: 20.8, color: RED, box: [80, 104],
    svg: `<path d="M40 4A32 32 0 0 0 8 36c0 24 22 44 32 64 10-20 32-40 32-64A32 32 0 0 0 40 4z"/><circle cx="40" cy="36" r="13" ${light()}/>`,
  },
  {
    id: 'school', name: '학교', group: 'place', w: 34, h: 27.2, color: ORANGE, box: [120, 96],
    svg: '<rect x="58.5" y="2" width="3" height="20"/><path d="M61.5 3l14 4.5-14 5z"/><rect x="8" y="46" width="104" height="46" rx="3"/>'
      + `<rect x="8" y="46" width="104" height="46" rx="3" ${light(0.35)}/><rect x="4" y="42" width="112" height="8" rx="4"/><path d="M38 36 60 18l22 18v56H38z"/>`
      + `<circle cx="60" cy="42" r="7" ${light()}/><path d="M52 92V72a8 8 0 0 1 16 0v20z" ${light(0.9)}/>`
      + [16, 84].map((x) => `<rect x="${x}" y="58" width="8" height="12" rx="2"/><rect x="${x + 12}" y="58" width="8" height="12" rx="2"/><rect x="${x}" y="76" width="8" height="12" rx="2"/><rect x="${x + 12}" y="76" width="8" height="12" rx="2"/>`).join(''),
  },
  { id: 'trail', name: '오솔길', group: 'place', w: 18, h: 30, color: YELLOW, edge: true, box: [60, 100], svg: '<path d="M14 98C2 78 46 70 34 50 26 36 44 26 36 6h8c10 20-10 30-2 44 14 22-22 28-4 48z"/>' },

  // ---- 생각과 표현 ----
  {
    id: 'openbook', name: '펼친 책', group: 'idea', w: 36, h: 24, color: NAVY, box: [120, 80],
    svg: `<path d="M4 20h112v52a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M10 12c16-8 34-6 48 4v54c-14-9-32-10-48-4z" ${paper}/><path d="M110 12c-16-8-34-6-48 4v54c14-9 32-10 48-4z" ${paper}/>`
      + '<path d="M18 28c10-3 22-2 32 3M18 41c10-3 22-2 32 3M70 31c10-5 22-6 32-3M70 44c10-5 22-6 32-3" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>',
  },
  {
    id: 'books', name: '책 더미', group: 'idea', w: 32, h: 19.2, color: BLUE, box: [120, 72],
    svg: `<rect x="6" y="48" width="108" height="20" rx="4"/><rect x="86" y="52" width="26" height="12" rx="2" ${light(0.9)}/>`
      + `<rect x="14" y="26" width="96" height="20" rx="4"/><rect x="14" y="26" width="96" height="20" rx="4" ${light(0.35)}/><rect x="16" y="30" width="24" height="12" rx="2" ${light(0.9)}/>`
      + `<rect x="8" y="4" width="92" height="20" rx="4"/><rect x="8" y="4" width="92" height="20" rx="4" ${shade(0.22)}/><rect x="74" y="8" width="24" height="12" rx="2" ${light(0.9)}/>`,
  },
  {
    id: 'notepad', name: '메모장', group: 'idea', w: 22, h: 26.9, color: BLUE, box: [90, 110],
    svg: `<rect x="6" y="12" width="78" height="94" rx="8" ${paper}/><path d="M6 32V20a8 8 0 0 1 8-8h62a8 8 0 0 1 8 8v12z"/>`
      + [20, 36, 52, 68].map((x) => `<rect x="${x}" y="3" width="5" height="17" rx="2.5"/><rect x="${x}" y="3" width="5" height="17" rx="2.5" ${shade(0.3)}/>`).join('')
      + [46, 60, 74].map((y) => `<rect x="18" y="${y}" width="54" height="5" rx="2.5" ${tint(0.35)}/>`).join('') + `<rect x="18" y="88" width="34" height="5" rx="2.5" ${tint(0.35)}/>`,
  },
  {
    id: 'palette', name: '팔레트', group: 'idea', w: 34, h: 27.2, color: BROWN, box: [120, 96],
    svg: '<path d="M60 6C28 6 4 26 4 52c0 22 18 38 42 38 8 0 12-5 12-11 0-5-3-8-3-13 0-6 5-10 12-10h17c18 0 32-12 32-28C116 16 92 6 60 6z"/>'
      + `<circle cx="28" cy="42" r="9" ${light(0.9)}/><circle cx="50" cy="25" r="9" ${light(0.7)}/><circle cx="77" cy="24" r="9" ${light(0.9)}/><circle cx="98" cy="38" r="8" ${light(0.7)}/><circle cx="29" cy="66" r="8" ${light(0.7)}/>`,
  },
  {
    id: 'brush', name: '붓', group: 'idea', w: 26, h: 26, color: RED, box: SQUARE,
    svg: `<g transform="rotate(45 50 50)"><rect x="44" y="-10" width="12" height="64" rx="6"/><rect x="42" y="52" width="16" height="14"/><rect x="42" y="52" width="16" height="14" ${shade(0.35)}/><path d="M42 66h16c2 14-2 26-8 40-6-14-10-26-8-40z"/><path d="M42 66h16c2 14-2 26-8 40-6-14-10-26-8-40z" ${light(0.3)}/></g>`,
  },
  { id: 'curl', name: '꼬불선', group: 'idea', w: 24, h: 14.4, color: BLUE, box: [100, 60], svg: stroke(6, '<path d="M6 44c10-28 30-40 36-24s-12 28-16 14 16-34 34-28 6 34-4 28 10-26 38-22"/>') },
  { id: 'person', name: '사람', group: 'idea', w: 22, h: 22, color: BLUE, box: SQUARE, svg: BUST(HAIR) },
  { id: 'person2', name: '긴머리 사람', group: 'idea', w: 22, h: 22, color: PINK, box: SQUARE, svg: BUST(HAIR2) },
  {
    id: 'sign', name: '팻말', group: 'idea', w: 24, h: 26.4, color: BROWN, box: [100, 110],
    svg: `<rect x="45" y="60" width="10" height="48" rx="3"/><rect x="45" y="60" width="10" height="48" rx="3" ${shade(0.3)}/><rect x="6" y="6" width="88" height="60" rx="8"/><rect x="13" y="13" width="74" height="46" rx="4" ${light(0.82)}/>`,
  },
  {
    id: 'frame', name: '사진 틀', group: 'idea', w: 24, h: 26.4, color: BLUE, box: [100, 110],
    svg: `<rect x="4" y="4" width="92" height="102" rx="8" ${paper}/><rect x="12" y="12" width="76" height="70" rx="4" ${tint(0.28)}/>`,
  },
  {
    id: 'pause', name: '멈춤', group: 'idea', w: 20, h: 20, color: RED, box: SQUARE,
    svg: `<circle cx="50" cy="50" r="46"/><rect x="33" y="30" width="12" height="40" rx="5" ${light()}/><rect x="55" y="30" width="12" height="40" rx="5" ${light()}/>`,
  },
  { id: 'blob', name: '얼룩', group: 'idea', w: 40, h: 33.3, color: YELLOW, edge: true, box: [120, 100], svg: '<path d="M62 4c22-2 44 8 52 28 8 22-4 46-24 58-22 12-54 10-72-8C2 66 0 40 14 24 26 10 44 6 62 4z"/>' },
  { id: 'thought', name: '생각 구름', group: 'idea', w: 34, h: 28.3, color: BLUE, edge: true, box: [120, 100], svg: `<path d="${CLOUD}"/><circle cx="30" cy="83" r="8"/><circle cx="15" cy="94" r="4"/>` },
  { id: 'dots', name: '점무늬', group: 'idea', w: 20, h: 20, color: ORANGE, box: [80, 80], svg: dotGrid(4, 4) },
  { id: 'rays', name: '강조선', group: 'idea', w: 20, h: 20, color: YELLOW, box: SQUARE, svg: stroke(9, '<path d="M17 55.600l6.9-39.400M35.7 64.400l25.7-30.700M47.6 81.300l37.6-13.7"/>') },
];

const byId = new Map(SHAPE_ASSETS.map((a) => [a.id, a]));
/** 그 이름의 애셋(모르는 이름이면 undefined). */
export const shapeAsset = (id) => byId.get(id);

/**
 * 요소 안에 넣을 SVG 글(CSS 로 그리는 애셋이면 빈 글). fit: 'fill' 이면 칸에 꽉 차게 늘이고(카드 위의 요소),
 * 'meet' 이면 비율을 지켜 칸 안에 넣는다(고르는 칸의 작은 그림).
 */
export function shapeSvg(id, { fit = 'fill' } = {}) {
  const a = byId.get(id);
  if (!a || a.css) return '';
  return `<svg viewBox="0 0 ${a.box[0]} ${a.box[1]}" preserveAspectRatio="${fit === 'meet' ? 'xMidYMid meet' : 'none'}" aria-hidden="true" focusable="false">${a.svg}</svg>`;
}
