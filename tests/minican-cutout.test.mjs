// 온바탕 배경 제거의 다듬기(cutout.js): AI 나 단색 방식이 낸 거친 윤곽을 사진의 진짜 테두리에 맞추고,
// 부스러기 · 구멍을 치우고, 붓질을 얹고, 가장자리에 묻은 배경색을 걷어 내는지 본다. 모두 브라우저 없이 도는 계산이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  normalizeMask, resizeMask, grayOf, guidedFilter, snapEdges, cleanAlpha, alphaCurve, paintStrokes, decontaminate,
  applyAlpha, colorAlpha, prepareAlpha, finishCutout, refineCutout, plainBorder,
} from '../src/cutout.js';
import { toInput } from '../src/segment.js';

// w×h 사진: 바탕색 bg 위에 (x0,y0)-(x1,y1) 네모가 fg 색
function photo(w, h, bg, fg, [x0, y0, x1, y1]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = x >= x0 && x < x1 && y >= y0 && y < y1 ? fg : bg;
    d.set([...c, 255], (y * w + x) * 4);
  }
  return d;
}
const at = (a, w, x, y) => a[y * w + x];

test('normalizeMask: 가장 작은 값은 0, 가장 큰 값은 1 로 펼친다(모두 같으면 0)', () => {
  assert.deepEqual([...normalizeMask(new Float32Array([0.2, 0.4, 0.6]))].map((v) => +v.toFixed(3)), [0, 0.5, 1]);
  assert.deepEqual([...normalizeMask(new Float32Array([0.3, 0.3]))], [0, 0]);
});

test('resizeMask: 작은 마스크를 늘려도 안쪽 · 바깥쪽 값은 그대로이고 경계만 이어진다', () => {
  const m = new Float32Array([0, 0, 1, 1, 0, 0, 1, 1]);          // 4×2: 왼쪽 반 0, 오른쪽 반 1
  const big = resizeMask(m, 4, 2, 40, 20);
  assert.equal(big.length, 800);
  assert.equal(at(big, 40, 0, 0), 0);
  assert.equal(at(big, 40, 39, 19), 1);
  for (let x = 1; x < 40; x++) assert.ok(at(big, 40, x, 5) >= at(big, 40, x - 1, 5), '왼쪽에서 오른쪽으로 줄지 않는다');
});

test('guidedFilter: 흐릿한 윤곽에 사진의 실제 테두리 자리에서 "턱"을 만든다(기준선으로 자르면 테두리에 딱 붙는다)', () => {
  const w = 60, h = 30;
  const data = photo(w, h, [250, 250, 250], [30, 30, 30], [30, 0, 60, 30]);   // 실제 테두리는 x = 30
  const rough = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rough[y * w + x] = Math.min(1, Math.max(0, (x - 22) / 16));   // 22~38 사이 흐릿
  const q = guidedFilter(grayOf(data, w, h), rough, w, h, 4, 1e-3);
  const step = (x) => at(q, w, x, 15) - at(q, w, x - 1, 15);
  assert.ok(step(30) > 0.25, `테두리의 턱 ${step(30)}(거친 윤곽은 한 칸에 ${1 / 16})`);
  for (const x of [25, 27, 33, 35]) assert.ok(step(x) < step(30) / 3, `x=${x} 는 완만하다`);
  const cut = alphaCurve(q, 0.5, 0.1);
  assert.ok(at(cut, w, 29, 15) < 0.05 && at(cut, w, 30, 15) > 0.95, '기준선으로 자르면 x = 30 에서 갈린다');
  for (const v of q) assert.ok(v >= 0 && v <= 1);
});

test('snapEdges: AI 윤곽이 몇 픽셀 넉넉해도 둘레의 색으로 진짜 테두리에 맞춘다(색이 비슷하면 그대로)', () => {
  const w = 60, h = 30;
  const data = photo(w, h, [60, 170, 70], [210, 70, 40], [30, 0, 60, 30]);    // 초록 바탕 · 주황 물체, 테두리 x = 30
  const rough = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 27; x < w; x++) rough[y * w + x] = 1;   // 3칸 넉넉하게(x = 27 부터)
  const out = snapEdges(data, rough, w, h, 4);
  for (const x of [27, 28, 29]) assert.ok(at(out, w, x, 15) < 0.05, `x=${x} 는 배경색이라 지운다: ${at(out, w, x, 15)}`);
  for (const x of [30, 31, 40]) assert.ok(at(out, w, x, 15) > 0.95, `x=${x} 는 남긴다`);
  assert.equal(at(out, w, 5, 15), 0, '띠 밖은 그대로');
  // 주인공과 배경이 거의 같은 색이면 색으로 가르지 않는다
  const same = photo(w, h, [200, 200, 200], [205, 205, 205], [30, 0, 60, 30]);
  assert.deepEqual(snapEdges(same, rough, w, h, 4), rough);
});

test('cleanAlpha: 떨어진 작은 부스러기는 지우고, 주인공 안의 작은 구멍은 메운다', () => {
  const w = 50, h = 50;
  const a = new Float32Array(w * h);
  for (let y = 10; y < 40; y++) for (let x = 10; x < 40; x++) a[y * w + x] = 1;   // 주인공 30×30
  a[24 * w + 24] = 0; a[24 * w + 25] = 0;                                         // 안의 작은 구멍
  a[2 * w + 2] = 1; a[2 * w + 3] = 1;                                             // 떨어진 부스러기
  const out = cleanAlpha(a, w, h);
  assert.equal(at(out, w, 2, 2), 0, '부스러기는 지운다');
  assert.equal(at(out, w, 24, 24), 1, '구멍은 메운다');
  assert.equal(at(out, w, 20, 20), 1);
  assert.equal(at(out, w, 45, 45), 0, '바깥 배경(가장자리에 닿은 큰 빈 곳)은 그대로');
  assert.equal(a[2 * w + 2], 1, '받은 배열은 건드리지 않는다');
});

test('cleanAlpha: 비슷한 크기의 주인공 둘은 둘 다 남긴다', () => {
  const w = 40, h = 20;
  const a = new Float32Array(w * h);
  for (let y = 5; y < 15; y++) { for (let x = 2; x < 12; x++) a[y * w + x] = 1; for (let x = 25; x < 33; x++) a[y * w + x] = 1; }
  const out = cleanAlpha(a, w, h);
  assert.equal(at(out, w, 5, 8), 1);
  assert.equal(at(out, w, 28, 8), 1);
});

test('alphaCurve: 기준보다 아래는 0, 위는 1, 사이는 부드럽게(가장자리 막대가 기준을 옮긴다)', () => {
  const a = new Float32Array([0, 0.3, 0.5, 0.7, 1]);
  const mid = alphaCurve(a, 0.5, 0.2);
  assert.equal(mid[0], 0); assert.equal(mid[1], 0); assert.equal(mid[4], 1); assert.equal(mid[3], 1);
  assert.ok(Math.abs(mid[2] - 0.5) < 1e-6);
  // "바짝"(기준이 높음)이면 같은 값이 더 투명해진다
  assert.ok(alphaCurve(a, 0.7, 0.2)[2] < mid[2]);
  assert.ok(alphaCurve(a, 0.3, 0.2)[2] > mid[2]);
});

test('paintStrokes: 지우개는 투명하게, 살리개는 불투명하게, 빨리 그은 선도 끊기지 않는다', () => {
  const w = 100, h = 50;
  const a = new Float32Array(w * h).fill(1);
  const erased = paintStrokes(a, w, h, [{ mode: 'erase', size: 0.06, pts: [[0.1, 0.5], [0.9, 0.5]] }]);
  for (let x = 12; x < 88; x += 3) assert.equal(at(erased, w, x, 25), 0, `x=${x} 가 지워져야`);
  assert.equal(at(erased, w, 50, 5), 1, '붓 밖은 그대로');
  assert.equal(a[25 * w + 50], 1, '받은 배열은 건드리지 않는다');
  const kept = paintStrokes(new Float32Array(w * h), w, h, [{ mode: 'keep', size: 0.1, pts: [[0.5, 0.5]] }]);
  assert.equal(at(kept, w, 50, 25), 1);
  assert.equal(at(kept, w, 10, 10), 0);
  assert.equal(paintStrokes(a, w, h, []), a, '붓질이 없으면 그대로 돌려준다');
});

test('decontaminate: 흰 바탕에서 오린 빨간 물체의 반투명 가장자리에서 흰빛(후광)을 걷어 낸다', () => {
  const w = 40, h = 20;
  const data = photo(w, h, [255, 255, 255], [220, 20, 20], [20, 0, 40, 20]);
  // 테두리 한 줄(x=20)은 흰색과 반쯤 섞인 분홍(카메라가 찍은 흐린 테두리)
  for (let y = 0; y < h; y++) data.set([238, 138, 138, 255], (y * w + 20) * 4);
  const alpha = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) alpha[y * w + x] = x > 20 ? 1 : x === 20 ? 0.5 : 0;
  const out = decontaminate(data, alpha, w, h, 3);
  const i = (10 * w + 20) * 4;
  assert.ok(out[i + 1] < 70 && out[i + 2] < 70, `초록 · 파랑(흰빛)이 빠져야: ${out[i]},${out[i + 1]},${out[i + 2]}`);
  assert.ok(out[i] > 180, '빨강은 남는다');
  assert.equal(out[(10 * w + 30) * 4 + 1], 20, '불투명한 곳은 그대로');
  assert.equal(data[i + 1], 138, '받은 배열은 건드리지 않는다');
});

test('applyAlpha: 알파를 입히고 지운 넓이의 비율을 센다(원래 투명한 곳은 투명한 채로)', () => {
  const data = new Uint8ClampedArray([1, 2, 3, 255, 1, 2, 3, 255, 1, 2, 3, 0, 1, 2, 3, 255]);
  const { data: out, cleared } = applyAlpha(data, new Float32Array([1, 0, 1, 0.5]));
  assert.deepEqual([out[3], out[7], out[11], out[15]], [255, 0, 0, 128]);
  assert.equal(cleared, 0.5);
});

test('colorAlpha · plainBorder: 흰 종이 위 그림은 단색 배경으로 알아보고, 사진은 아니다', () => {
  const w = 30, h = 30;
  const drawing = photo(w, h, [255, 255, 255], [20, 90, 200], [8, 8, 22, 22]);
  assert.equal(plainBorder(drawing, w, h), 1);
  const alpha = colorAlpha(drawing, w, h, { tolerance: 40 });
  assert.equal(at(alpha, w, 0, 0), 0);
  assert.equal(at(alpha, w, 15, 15), 1);
  // 가장자리가 여러 색(사진)이면 비율이 낮다
  const busy = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) busy.set([(p * 37) % 256, (p * 91) % 256, (p * 53) % 256, 255], p * 4);
  assert.ok(plainBorder(busy, w, h) < 0.5);
});

test('refineCutout: 거친 AI 윤곽 + 부스러기 → 테두리에 붙고 부스러기 없는 오려 낸 사진', () => {
  const w = 80, h = 60;
  const data = photo(w, h, [90, 160, 90], [200, 60, 40], [20, 15, 60, 45]);   // 초록 바탕 위 주황 물체
  const rough = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.max(17 - x, 0, x - 62), dy = Math.max(12 - y, 0, y - 47);  // 3칸 넉넉하게 · 흐릿하게
    rough[y * w + x] = Math.max(0, 1 - Math.hypot(dx, dy) / 4) * (x >= 17 && x < 63 && y >= 12 && y < 48 ? 1 : 0.6);
  }
  rough[3 * w + 3] = 1; rough[3 * w + 4] = 1;                                  // 엉뚱한 부스러기
  const res = refineCutout(data, w, h, rough, { edge: 0.5, soft: 0.2 });
  const A = (x, y) => res.data[(y * w + x) * 4 + 3];
  assert.equal(A(40, 30), 255, '주인공 가운데');
  assert.equal(A(3, 3), 0, '부스러기는 사라진다');
  assert.equal(A(18, 30), 0, '테두리 밖의 넉넉하던 곳도 지워진다');
  assert.equal(A(19, 30), 0, '테두리 바로 밖까지');
  assert.equal(A(20, 30), 255, '테두리 바로 안은 남는다');
  assert.ok(Math.abs(res.cleared - 0.75) < 0.02, `지운 넓이 ${res.cleared}`);
  // 두 단계로 나눠 해도 같다(편집기의 미리보기는 1단계를 기억해 두고 붓질만 다시 한다)
  const two = finishCutout(data, w, h, prepareAlpha(data, w, h, rough, { edge: 0.5, soft: 0.2 }));
  assert.deepEqual(two.data, res.data);
});

test('segment.toInput: 320×320 을 [3, 320, 320] 로, 가장 밝은 값으로 나눈 뒤 평균 · 표준편차로 맞춘다', () => {
  const n = 320 * 320;
  const rgba = new Uint8ClampedArray(n * 4).fill(255);
  const x = toInput(rgba);
  assert.equal(x.length, 3 * n);
  assert.ok(Math.abs(x[0] - (1 - 0.485) / 0.229) < 1e-5);
  assert.ok(Math.abs(x[n] - (1 - 0.456) / 0.224) < 1e-5);
  assert.ok(Math.abs(x[2 * n + 5] - (1 - 0.406) / 0.225) < 1e-5);
});

test('모델 파일: 온바탕 폴더 안에 있고 사용 조건이 적혀 있다', () => {
  const dir = new URL('../src/models/', import.meta.url);
  assert.equal(statSync(new URL('u2netp.onnx', dir)).size, 4574861);
  const note = readFileSync(new URL('README.md', dir), 'utf8');
  assert.match(note, /Apache/);
  const seg = readFileSync(new URL('../src/segment.js', import.meta.url), 'utf8');
  assert.match(seg, /onnxruntime-web@\$\{ORT_VERSION\}/);
  assert.match(seg, /ORT_VERSION = '\d+\.\d+\.\d+'/, '실행기는 고정 판으로 부른다');
});

test('얇은 것 살리기: 흐린 빨대로 이어진 장식은 지우지 않고 빨대를 잇는다 · 둘레의 흐린 띠와 떨어진 부스러기는 그대로', () => {
  const w = 100, h = 100;
  const make = () => new Float32Array(w * h);
  const fill = (a, x0, y0, x1, y1, v) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = v; };
  const cup = make();
  fill(cup, 20, 50, 80, 95, 0.95);       // 컵(단단함)
  fill(cup, 48, 20, 51, 50, 0.3);        // 빨대(모델이 흐리게 본다)
  fill(cup, 44, 12, 56, 20, 0.9);        // 빨대 끝 장식: 컵에 견주면 아주 작은 조각
  const out = cleanAlpha(cup, w, h);
  assert.ok(out[15 * w + 50] > 0.5, '장식이 남는다');
  assert.ok(out[35 * w + 49] > 0.5, '빨대가 이어진다');
  // 둘레의 흐린 띠(한 조각에만 닿는다)는 단단하게 바꾸지 않는다
  const ring = make();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot(x - 50, y - 50); ring[y * w + x] = d < 20 ? 0.95 : d < 26 ? 0.3 : 0; }
  assert.ok(Math.abs(cleanAlpha(ring, w, h)[50 * w + 73] - 0.3) < 1e-6);
  // 흐린 길 없이 떨어진 작은 부스러기는 여전히 지운다
  const speck = make();
  fill(speck, 20, 30, 80, 90, 0.95);
  fill(speck, 5, 5, 8, 8, 0.9);
  assert.equal(cleanAlpha(speck, w, h)[6 * w + 6], 0);
  // 넓은 흐린 곳(두 조각 사이의 큰 빈 곳)은 다리로 보지 않는다
  const two = make();
  fill(two, 5, 5, 30, 95, 0.95);
  fill(two, 70, 5, 95, 95, 0.95);
  fill(two, 30, 5, 70, 95, 0.3);
  assert.ok(Math.abs(cleanAlpha(two, w, h)[50 * w + 50] - 0.3) < 1e-6);
});
