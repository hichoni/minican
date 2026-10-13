// 미니캔의 템플릿 6종: 표지 · 띠 제목 · 세 가지 · 말풍선 · 물음 · 마무리.
// 이름과 쓰임은 예전 그대로이고, 배치를 새로 짰다. DOM 을 쓰지 않는 자료와 순수 함수만 둔다(node 에서 그대로 읽힌다).
//
// 한 세트로 보이게 하는 규칙
//   - 큰 제목은 굵은 글씨체 하나(TITLE_FONT)로, 나머지 글은 기본 글꼴로 쓴다.
//   - 왼쪽·오른쪽 여백은 8(카드 너비를 100 으로 본 값). 글은 주로 왼쪽에 맞추고, 마무리만 가운데에 맞춘다.
//   - 꾸밈은 편집기의 요소(도형·캡슐 라벨·리본·밑줄 …)만 쓴다. 이모지나 그림 파일은 쓰지 않는다.
//     그래서 넣은 뒤에 글·도형 하나하나를 고르고, 옮기고, 색을 바꿀 수 있다.
//   - 글은 예시 문구다(어떤 내용을 어디에 쓰는지 보여 준다). 눌러서 내 글로 바꾼다.
//
// 그림의 모양(정사각형·세로·가로·길게)에 따라 배치가 달라진다: items(aspect) 가 그 모양에 맞는 요소들을 돌려준다.
//   - 세로 자리는 "위에서 얼마", "아래에서 얼마", "가운데에서 얼마"로 정해서, 세로로 길어져도 위·가운데·아래의 묶음이 제자리에 있다.
//   - 가로로 긴 그림(가로 ÷ 세로 ≥ 1.3)은 글자를 줄이고 배치를 따로 짠다.
// 미리보기(첫 화면 · 옆 칸)와 실제로 들어오는 것은 같은 자료에서 나온다(편집기의 layoutItems).
// 주제 테마(themes.js)도 여기의 도구(board · fs)로 짠다.

/**
 * 큰 제목에 쓰는 글씨체의 id(configure 의 fonts 가운데 하나). 미니캔을 들여 쓰는 곳이 setTitleFont 로 정한다.
 * 비어 있거나 목록에 없는 글씨체면 기본 글꼴로 보인다. 템플릿을 깔 때마다 지금 값을 읽는다.
 */
export let TITLE_FONT = '';
export function setTitleFont(id) { TITLE_FONT = typeof id === 'string' ? id : ''; }

const NAVY = '#26318f';
const INK = '#1d2433';
const YELLOW = '#ffd43b';
const WHITE = '#ffffff';
const M = 8;              // 왼쪽·오른쪽 여백
export const LINE = 1.25; // 글의 줄 높이(편집기의 글상자와 같다)
const SMALLEST = 2.6;     // 가장 작은 글자(편집기가 받는 가장 작은 크기 2.5 보다 조금 크게)
/** 글자 크기: 기본 크기 v 에 그 모양의 배율 k 를 곱하되, 너무 작아지지 않게 한다. */
export const fs = (v, k) => Math.max(SMALLEST, Math.round(v * k * 10) / 10);

/**
 * 그 모양(a = 가로 ÷ 세로)의 카드에 요소를 놓는 도구.
 * 길이는 모두 카드 너비를 100 으로 본 값으로 적는다(세로도 같은 단위: 정사각형이면 0~100, 가로 16:9 면 0~56.25).
 */
export function board(a) {
  const H = 100 / a;                                  // 카드의 세로
  const pct = (v) => Math.round((v / H) * 1000) / 10; // 세로 자리 → 세로에 대한 백분율
  const out = [];
  return {
    H,
    wide: a >= 1.3,
    items: out,
    /** 도형·꾸밈 요소: 왼쪽 위 모서리(left, top)와 크기(w, h)로 놓는다. more 에는 꾸밈(r · line · lc)을 적는다. */
    shape(id, { left, top, w, h, color, rot = 0, op = 100, fx = false, ...more }) {
      out.push({ t: 'shape', shape: id, x: left + w / 2, y: pct(top + h / 2), w, h, color, rot, op, fx, ...more });
    },
    /** 글: 왼쪽(left)·위(top)·너비(w)로 놓는다. 줄 수는 글의 줄바꿈으로 센다(한 줄이 너비를 넘지 않게 짧게 쓴다). */
    text(text, { left, top, w, size, color = INK, bold = false, align = 'l', font, op = 100 }) {
      const lines = String(text).split('\n').length;
      out.push({ t: 'text', text, x: left + w / 2, y: pct(top + (lines * size * LINE) / 2), w, size, color, bold, align, op, ...(font ? { font } : {}) });
      return top + lines * size * LINE;               // 글의 아래쪽 끝(다음 것을 이어 놓을 때 쓴다)
    },
  };
}

// ---------- 표지: 작은 분류 → 큰 제목 → 밑줄 → 발표하는 사람. 오른쪽 아래에 동그라미 ----------
function cover(a) {
  const b = board(a);
  const { H, wide } = b;
  const k = wide ? 0.62 : 1;
  // 꾸밈(글 뒤에 깔린다): 오른쪽 아래의 큰 동그라미와 고리, 오른쪽 위의 반짝임
  const big = wide ? 34 : 46;
  b.shape('circle', { left: 100 - big * 0.72, top: H - big * 0.62, w: big, h: big, color: YELLOW });
  b.shape('ring', { left: 100 - big * 1.08, top: H - big * 0.44, w: big * 0.36, h: big * 0.36, color: '#8f9bff' });
  b.shape('spark', { left: wide ? 90 : 84, top: wide ? 6 : 9, w: wide ? 5 : 8, h: wide ? 5 : 8, color: YELLOW });
  // 분류(캡슐 라벨)
  const labelTop = wide ? 7 : Math.max(9, H * 0.5 - 39);
  const pill = { w: 30 * (wide ? 0.72 : 1), h: 7.6 * k };
  b.shape('pill', { left: M, top: labelTop, w: pill.w, h: pill.h, color: YELLOW });
  b.text('5학년 사회', { left: M, top: labelTop + pill.h / 2 - (fs(3.7, k) * LINE) / 2, w: pill.w, size: fs(3.7, k), bold: true, color: NAVY, align: 'c' });
  // 제목 · 밑줄 · 발표하는 사람
  const titleTop = labelTop + pill.h + (wide ? 4 : 7);
  const end = b.text('우리 고장의\n자랑거리', { left: M, top: titleTop, w: 84, size: fs(12.5, k), color: WHITE, font: TITLE_FONT });
  b.shape('round', { left: M, top: end + 3.5 * k, w: 16 * k, h: 1.8 * k, color: YELLOW });
  b.text('발표하는 사람: 이름을 써요', { left: M, top: end + 9.5 * k, w: 62, size: fs(4.3, k), color: '#cfd5ff' });
  return b.items;
}

// ---------- 띠 제목: 위의 짙은 띠에 제목, 아래 밝은 곳에 알릴 내용 ----------
function band(a) {
  const b = board(a);
  const { H, wide } = b;
  const k = wide ? 0.66 : 1;
  const bandH = wide ? 23 : Math.min(58, Math.max(36, H * 0.34));
  b.shape('rect', { left: 0, top: 0, w: 100, h: bandH, color: NAVY });
  // 띠의 오른쪽 아래 구석에 들어앉는 부채꼴(둥근 쪽이 왼쪽 위를 본다)
  b.shape('quarter', { left: 100 - bandH * 0.5, top: bandH * 0.5, w: bandH * 0.5, h: bandH * 0.5, color: '#3d4bc0', fx: true });
  const labelTop = wide ? 4.6 : bandH * 0.5 - 15;
  b.text('알립니다', { left: M, top: labelTop, w: 40, size: fs(3.8, k), bold: true, color: YELLOW });
  b.text(wide ? '도서관 이용 안내' : '도서관\n이용 안내', { left: M, top: labelTop + 6.6 * k, w: 80, size: fs(wide ? 10 : 9.6, k), color: WHITE, font: TITLE_FONT });
  // 본문: 왼쪽에 노란 세로 띠
  const bodyTop = bandH + (wide ? 5.5 : 9);
  const bodySize = 4.5 * k;
  const body = '알리고 싶은 내용을 써요.\n읽는 사람이 꼭 알아야 할 것을\n두세 줄로 적으면 좋아요.';
  b.shape('round', { left: M, top: bodyTop, w: 2, h: 3 * bodySize * LINE, color: YELLOW });
  b.text(body, { left: M + 5, top: bodyTop, w: 80, size: bodySize, color: INK });
  // 아래: 가는 줄과 만든 사람
  // 가는 줄: 편집기가 받는 가장 얇은 두께(세로의 0.6%)보다 얇아지지 않게 한다
  b.shape('rect', { left: M, top: H - (wide ? 8 : 13), w: 84, h: Math.max(0.4, 0.62 / a), color: '#dfe2ec' });
  b.text('만든 사람: 이름을 써요', { left: M, top: H - (wide ? 6.4 : 10.2), w: 60, size: fs(3.5, k), color: '#5a6376' });
  return b.items;
}

// ---------- 세 가지: 번호 · 한 줄 제목 · 설명이 세 번 ----------
// [한 줄 제목, 설명]. 가로로 긴 그림에서는 좁은 카드 세 장에 나눠 담으므로 ' / ' 자리에서 줄을 바꾼다.
const THREE = [
  ['양치할 때 / 컵 쓰기', '물을 틀어 / 놓지 않아요'],
  ['빨래는 / 모아서 하기', '한 번에 돌리면 / 물이 줄어요'],
  ['샤워는 / 짧게 하기', '노래 한 곡이면 / 충분해요'],
];
const oneLine = (t) => t.replace(' / ', ' ');
const twoLines = (t) => t.replace(' / ', '\n');
function list(a) {
  const b = board(a);
  const { H, wide } = b;
  const dark = '#12305a';
  if (wide) {
    // 가로: 제목 한 줄 + 흰 카드 세 장
    const end = b.text('물을 아끼는 세 가지 방법', { left: M, top: 6, w: 84, size: 6, color: dark, font: TITLE_FONT });
    b.shape('underline', { left: M, top: end + 0.6, w: 22, h: 2.6, color: '#1c7ed6' });
    const top = end + 6.5;
    const w = 26.4;
    const h = H - top - 6;
    THREE.forEach(([head, desc], i) => {
      const left = M + i * (w + 2.4);
      b.shape('round', { left, top, w, h, color: WHITE });
      b.shape('round', { left: left + 2.6, top: top + 2.6, w: 6.4, h: 6.4, color: NAVY });
      b.text(String(i + 1), { left: left + 2.6 + 3.2 - 5, top: top + 2.6 + 3.2 - (3.6 * LINE) / 2, w: 10, size: 3.6, bold: true, color: WHITE, align: 'c' });
      const e = b.text(twoLines(head), { left: left + 2.6, top: top + 11, w: w - 5.2, size: 3.3, bold: true, color: dark });
      b.text(twoLines(desc), { left: left + 2.6, top: e + 1.4, w: w - 5.2, size: 2.6, color: '#42597a' });
    });
    return b.items;
  }
  const k = a < 0.7 ? 1.1 : 1;
  const end = b.text('물을 아끼는\n세 가지 방법', { left: M, top: 9, w: 84, size: fs(8.8, k), color: dark, font: TITLE_FONT });
  b.shape('underline', { left: M, top: end + 1.2, w: 34, h: 4, color: '#1c7ed6' });
  const box = 11 * k;
  const first = end + 11;
  const gap = Math.max(box + 6, Math.min(40, (H - 9 - first - box) / 2));
  THREE.forEach(([head, desc], i) => {
    const top = first + i * gap;
    b.shape('round', { left: M, top, w: box, h: box, color: NAVY });
    b.text(String(i + 1), { left: M, top: top + box / 2 - (fs(5.8, k) * LINE) / 2, w: box, size: fs(5.8, k), bold: true, color: WHITE, align: 'c' });
    const e = b.text(oneLine(head), { left: M + box + 4, top: top - 0.2, w: 100 - M * 2 - box - 4, size: fs(5, k), bold: true, color: dark });
    b.text(oneLine(desc), { left: M + box + 4, top: e + 0.6, w: 100 - M * 2 - box - 4, size: fs(3.7, k), color: '#42597a' });
  });
  return b.items;
}

// ---------- 말풍선: 흰 말풍선 안에 하고 싶은 말, 그 아래에 말한 사람 ----------
function bubble(a) {
  const b = board(a);
  const { H, wide } = b;
  const green = '#2f9e44';
  const dark = '#123d1c';
  const k = wide ? 0.7 : 1;
  const who = wide ? 12 : 20;                        // 아래에 말한 사람이 들어갈 높이
  const h = wide ? H - 5 - who : Math.min(96, H - 10 - who - 6);
  // 세로로 긴 그림에서는 말풍선과 말한 사람의 묶음을 가운데쯤에 둔다(위로 조금 올려서)
  const top = wide ? 5 : Math.max(10, (H - h - who) * 0.42);
  b.shape('bubble', { left: M, top, w: 84, h, color: WHITE });
  const bodyH = h * 0.72;                             // 말풍선의 몸통(꼬리를 뺀 높이)
  const size = 7.8 * k;
  const blockH = 9 * k + 4 * k + 2 * size * LINE;     // 따옴표 + 사이 + 두 줄
  const y0 = top + (bodyH - blockH) / 2;
  b.shape('quote', { left: M + 7, top: y0, w: 11.5 * k, h: 9 * k, color: green });
  b.text('작은 실천이 모여\n지구를 지켜요', { left: M + 7, top: y0 + 13 * k, w: 70, size, color: dark, font: TITLE_FONT });
  // 말한 사람: 초록 동그라미 안에 새싹 + 이름
  const face = wide ? 9 : 14;
  const faceTop = top + h + (wide ? 1.5 : 3);
  b.shape('circle', { left: M + 2, top: faceTop, w: face, h: face, color: green });
  b.shape('sprout', { left: M + 2 + face * 0.22, top: faceTop + face * 0.2, w: face * 0.56, h: face * 0.56, color: WHITE });
  const e = b.text('말한 사람', { left: M + face + 6, top: faceTop + face * 0.1, w: 60, size: fs(4.4, k), bold: true, color: dark });
  b.text('5학년 1반 이름을 써요', { left: M + face + 6, top: e + 0.6, w: 60, size: fs(3.5, k), color: '#3f6b49' });
  return b.items;
}

// ---------- 물음: 질문 문장이 가장 크다. 위에 Q 표시, 아래에 다음 장으로 이끄는 말 ----------
function question(a) {
  const b = board(a);
  const { H, wide } = b;
  const k = wide ? 0.62 : 1;
  const brown = '#5c4700';
  // 뒤에 깔리는 큰 물음표(바탕보다 조금 짙은 노랑)
  b.text('?', { left: wide ? 70 : 62, top: wide ? H / 2 - 20 : 4, w: 32, size: 30, color: '#f2bb0b', align: 'c', font: TITLE_FONT });
  const box = 15 * k;
  const top = wide ? 7 : Math.max(10, H * 0.5 - 40);
  b.shape('round', { left: M, top, w: box, h: box, color: NAVY });
  b.text('Q', { left: M + box / 2 - Math.max(10, box) / 2, top: top + box / 2 - (fs(8.6, k) * LINE) / 2, w: Math.max(10, box), size: fs(8.6, k), color: WHITE, align: 'c', font: TITLE_FONT });
  b.text('함께 생각해 볼 질문', { left: M + box + 4, top: top + box / 2 - (fs(3.9, k) * LINE) / 2, w: 60, size: fs(3.9, k), bold: true, color: brown });
  // 글상자를 글에 맞게 좁혀서, 오른쪽의 큰 물음표를 눌러 고를 수 있게 한다
  const end = b.text('비는 왜\n내릴까요?', { left: M, top: top + box + 6 * k, w: wide ? 56 : 74, size: fs(13.5, k), color: INK, font: TITLE_FONT });
  b.shape('underline', { left: M, top: end + 1.5 * k, w: 44 * k, h: 5 * k, color: WHITE });
  // 아래: 다음 장으로
  const foot = H - (wide ? 9 : 15);
  b.text('답은 다음 장에서 알려 줘요', { left: M, top: foot, w: 66, size: fs(4.2, k), bold: true, color: brown });
  b.shape('arrow2', { left: 100 - M - 13 * k, top: foot + (fs(4.2, k) * LINE) / 2 - 2.6 * k, w: 13 * k, h: 5.2 * k, color: NAVY });
  return b.items;
}

// ---------- 마무리: 가운데에 고마움의 말, 그 아래 흰 칸에 꼭 기억할 한 문장 ----------
function end(a) {
  const b = board(a);
  const { H, wide } = b;
  const k = wide ? 0.66 : 1;
  const dark = '#5c1a1a';
  const c = H / 2;
  // 꾸밈
  b.shape('spark', { left: 11, top: wide ? 9 : c - 30, w: 6 * k, h: 6 * k, color: '#ffa8a8' });
  b.shape('spark', { left: wide ? 90 : 84, top: wide ? 8 : c - 6, w: 4.5 * k, h: 4.5 * k, color: '#ffa8a8' });
  // 리본 라벨
  const ribbon = { w: 34 * k, h: 9.2 * k };
  const ribbonTop = wide ? 5 : c - 40;
  b.shape('ribbon', { left: 50 - ribbon.w / 2, top: ribbonTop, w: ribbon.w, h: ribbon.h, color: '#e03131' });
  b.text('마무리', { left: 50 - ribbon.w / 2, top: ribbonTop + ribbon.h / 2 - (fs(4, k) * LINE) / 2, w: ribbon.w, size: fs(4, k), bold: true, color: WHITE, align: 'c' });
  // 고마움의 말
  const thanks = wide ? '끝까지 들어 줘서 고마워요' : '끝까지 들어 줘서\n고마워요';
  const thanksEnd = b.text(thanks, { left: M, top: ribbonTop + ribbon.h + (wide ? 4.5 : 9), w: 84, size: fs(wide ? 9.4 : 9.6, k), color: dark, align: 'c', font: TITLE_FONT });
  // 꼭 기억할 한 문장(흰 칸 + 하트)
  const panel = { left: wide ? 20 : 10, w: wide ? 60 : 80, h: 20 * k };
  const panelTop = thanksEnd + (wide ? 4.5 : 9);
  b.shape('round', { left: panel.left, top: panelTop, w: panel.w, h: panel.h, color: WHITE });
  const heart = 6.4 * k;
  b.shape('heart', { left: panel.left + 5 * k, top: panelTop + panel.h / 2 - heart * 0.46, w: heart, h: heart * 0.92, color: '#e64980' });
  b.text('꼭 기억할 한 문장을 써요', { left: panel.left + 14 * k, top: panelTop + panel.h / 2 - (fs(4.5, k) * LINE) / 2, w: panel.w - 18 * k, size: fs(4.5, k), bold: true, color: dark });
  b.text('5학년 1반 이름을 써요', { left: M, top: H - (wide ? 7 : 10.5), w: 84, size: fs(3.5, k), color: '#9a5b5b', align: 'c' });
  return b.items;
}

/** 템플릿 목록(편집기의 configure({ layouts }) 에 넘긴다). id 와 이름은 예전과 같다. */
export const CANVA_LAYOUTS = [
  { id: 'cover', name: '표지', bg: 'navy', items: cover },
  { id: 'band', name: '띠 제목', bg: 'paper', items: band },
  { id: 'list', name: '세 가지', bg: 'sky', items: list },
  { id: 'bubble', name: '말풍선', bg: 'mint', items: bubble },
  { id: 'question', name: '물음', bg: 'sun', items: question },
  { id: 'end', name: '마무리', bg: 'rose', items: end },
];
