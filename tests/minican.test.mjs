// 온바탕 편집기 모듈(src/)을 "혼자" 쓸 때의 점검: 기본 설정, configure 로 바꾸기, 카드 비율 계산, 그리고 폴더 밖의 것을 쓰지 않는지.
// (카드뉴스 공방의 설정을 얹은 쪽은 digital-cardnews-studio.test.mjs 가 본다. 테스트 파일마다 따로 돌기 때문에 여기는 기본 설정에서 시작한다.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  configure, settings, fontList, fontFamilyOf, DEFAULT_FONT, DEFAULT_BG, BACKGROUNDS, LAYOUTS, MAX_ITEMS, MAX_PHOTOS, MAX_ITEM_TEXT,
  cleanImg, cleanItem, cleanDesign, emptyDesign, designTexts, designImages, backgroundOf, cleanBg,
  newText, newShape, newPhoto, fitPhoto, coverItem, layoutList, layoutItems, placeholderTexts, reshapeItems,
} from '../src/model.js';
import { removeBackground } from '../src/cutout.js';
import { searchStickers } from '../src/stickers.js';

const DIR = fileURLToPath(new URL('../src/', import.meta.url));
const DATA_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ---- 기본 설정(아무것도 정하지 않았을 때) ----

test('기본 설정: 정사각형 카드, 기본 글꼴 하나, 배경 8가지, 템플릿 6가지', () => {
  const s = settings();
  assert.equal(s.aspect, 1);
  assert.deepEqual(s.fonts.map((f) => f.id), [DEFAULT_FONT]);
  assert.equal(s.backgrounds, BACKGROUNDS);
  assert.equal(s.layouts, LAYOUTS);
  assert.deepEqual([s.maxItems, s.maxPhotos, s.maxText], [MAX_ITEMS, MAX_PHOTOS, MAX_ITEM_TEXT]);
  assert.equal(fontFamilyOf(DEFAULT_FONT), '');
  assert.equal(fontFamilyOf('jua'), '', '목록에 없는 글꼴은 기본 글꼴로');
  assert.equal(newText('가', { font: 'jua' }).font, DEFAULT_FONT);
});

test('기본 그림 주소: https · blob · 그림 data 주소만 받는다', () => {
  assert.deepEqual(cleanImg({ url: 'https://example.com/a.png' }), { url: 'https://example.com/a.png' });
  assert.deepEqual(cleanImg({ url: 'https://example.com/a.png', path: 'p/a.png' }), { path: 'p/a.png', url: 'https://example.com/a.png' });
  assert.deepEqual(cleanImg({ url: 'blob:http://localhost/1b2c' }), { url: 'blob:http://localhost/1b2c' });
  assert.deepEqual(cleanImg({ url: DATA_PNG }), { url: DATA_PNG });
  for (const bad of [
    'http://example.com/a.png', 'javascript:alert(1)', 'data:text/html;base64,PGI+', 'data:image/svg+xml;base64,PHN2Zz4=',
    'https://example.com/a.png" onerror="x', 'https://a b.com/x', '', null, 12,
  ]) {
    assert.equal(cleanImg({ url: bad }), null, String(bad));
  }
  assert.equal(cleanImg(null), null);
  assert.equal(cleanItem({ t: 'image', url: 'http://example.com/a.png' }), null, '믿을 수 없는 주소의 사진은 버린다');
});

test('디자인 한 장: 빈 디자인, 정리, 글과 사진 찾기', () => {
  assert.deepEqual(emptyDesign(), { bg: DEFAULT_BG, items: [] });
  assert.deepEqual(emptyDesign('#ABCDEF'), { bg: '#abcdef', items: [] });
  assert.deepEqual(cleanDesign(null), { bg: DEFAULT_BG, items: [] });
  assert.deepEqual(cleanDesign({ bg: 'url(x)', items: 'no' }), { bg: DEFAULT_BG, items: [] });

  const d = cleanDesign({
    bg: 'navy', extra: 1,
    items: [
      { t: 'text', text: '  안녕  \n\n\n\n하세요 ', x: 500, onclick: 'x' },
      { t: 'unknown' }, null, 'x',
      { t: 'image', url: 'https://example.com/a.png', path: 'p/a.png', w: 40, h: 30 },
      { t: 'image', url: 'ftp://example.com/a.png' },
      { t: 'emoji', ch: '🙂' },
    ],
  });
  assert.deepEqual(Object.keys(d), ['bg', 'items']);
  assert.deepEqual(d.items.map((it) => it.t), ['text', 'image', 'emoji']);
  assert.equal(d.items[0].text, '안녕\n\n하세요');
  assert.equal(d.items[0].x, 100);
  assert.equal('onclick' in d.items[0], false);
  assert.deepEqual(designTexts(d), ['안녕\n\n하세요']);
  assert.deepEqual(designImages(d), [{ url: 'https://example.com/a.png', path: 'p/a.png' }]);
  assert.deepEqual(designTexts(null), []);
  assert.deepEqual(designImages({ items: [{ t: 'image', url: DATA_PNG }] }), [{ url: DATA_PNG }]);
  // 정리한 것을 다시 정리해도 그대로다(저장했다 읽어도 모양이 바뀌지 않는다)
  assert.deepEqual(cleanDesign(JSON.parse(JSON.stringify(d))), d);
});

// ---- configure 로 바꾸기 (이 아래부터는 설정이 바뀐 채로 이어진다) ----

test('configure — 글꼴: 기본 글꼴 뒤에 붙고, 옛 이름을 이어 주며, 화면 이름을 정한다', () => {
  const s = configure({
    fonts: [
      { id: 'jua', name: '주아', url: './jua.ttf' },
      { id: 'hand', name: '손글씨', family: 'My Hand' },
      { id: DEFAULT_FONT, name: '기본을 덮으려는 것' },
      { id: 'bad id"', name: '이상한 이름' },
      null,
    ],
    fontAliases: { old: 'jua' },
  });
  assert.deepEqual(s.fonts.map((f) => f.id), [DEFAULT_FONT, 'jua', 'hand']);
  assert.deepEqual(fontList().map((f) => f.name), ['기본', '주아', '손글씨']);
  assert.equal(fontFamilyOf('jua'), 'mc-jua');
  assert.equal(fontFamilyOf('hand'), 'My Hand');
  assert.equal(newText('가', { font: 'jua' }).font, 'jua');
  assert.equal(newText('가', { font: 'old' }).font, 'jua');
  assert.equal(newText('가', { font: 'toString' }).font, DEFAULT_FONT, '객체의 기본 속성 이름에 속지 않는다');
  fontList().push({ id: 'x' });
  assert.equal(fontList().length, 3, '돌려준 목록을 바꿔도 설정은 그대로');
  configure({});
  assert.equal(fontList().length, 3, '주지 않은 것은 바뀌지 않는다');
});

test('configure — 그림 주소를 좁히면 그 밖의 주소는 버려진다', () => {
  configure({ cleanImage: (img) => (String(img.url).startsWith('https://my.example/') ? { url: img.url } : null) });
  assert.deepEqual(cleanImg({ url: 'https://my.example/a.png', path: 'x' }), { url: 'https://my.example/a.png' });
  assert.equal(cleanImg({ url: 'https://other.example/a.png' }), null);
  assert.equal(cleanDesign({ items: [{ t: 'image', url: DATA_PNG }] }).items.length, 0);
  assert.equal(newPhoto({ url: 'https://other.example/a.png', ratio: 1 }), null);
  configure({ cleanImage: () => ({ nope: true }) });
  assert.equal(cleanImg({ url: 'https://my.example/a.png' }), null, 'url 을 돌려주지 않으면 버린다');
  configure({ cleanImage: (img) => (/^https:\/\/my[.]example\//.test(img.url) ? { url: img.url } : null) });
});

test('configure — 한도: 요소 수·사진 수·글자 수', () => {
  configure({ maxItems: 5, maxPhotos: 1, maxText: 10 });
  const many = Array.from({ length: 9 }, (_, i) => ({ t: 'text', text: `글 ${i}` }));
  assert.equal(cleanDesign({ items: many }).items.length, 5);
  const photos = [1, 2, 3].map((n) => ({ t: 'image', url: `https://my.example/${n}.png` }));
  assert.equal(cleanDesign({ items: photos }).items.length, 1);
  assert.equal(newText('가나다라마바사아자차카타파하').text.length, 10);
  configure({ maxItems: -1, maxPhotos: 1.5, maxText: 'x' });
  assert.deepEqual([settings().maxItems, settings().maxPhotos, settings().maxText], [5, 1, 10], '이상한 값은 받지 않는다');
  configure({ maxItems: MAX_ITEMS, maxPhotos: MAX_PHOTOS, maxText: MAX_ITEM_TEXT });
});

test('configure — 배경과 템플릿 목록', () => {
  const mine = [{ id: 'cream', name: '크림', bg: '#fff8e1', ink: '#3e2723' }, { id: 'ink', name: '먹', bg: '#212121', ink: '#ffffff' }];
  configure({ backgrounds: mine });
  assert.equal(backgroundOf('ink').bg, '#212121');
  assert.equal(cleanBg('navy'), 'cream', '목록에 없는 이름은 기본 배경(없으면 첫 배경)으로');
  assert.equal(backgroundOf('navy').id, 'cream');
  assert.equal(cleanBg('#123456'), '#123456');
  assert.equal(emptyDesign('ink').bg, 'ink');
  configure({ backgrounds: [] });
  assert.equal(settings().backgrounds, mine, '빈 목록은 받지 않는다');
  configure({ backgrounds: BACKGROUNDS });

  configure({ layouts: [{ id: 'one', name: '하나', bg: 'paper', items: [{ t: 'text', text: '여기에 제목을 써요', x: 50, y: 50 }, { t: 'shape', shape: 'rect', w: 40, h: 20 }] }] });
  assert.deepEqual(layoutList().map((l) => l.id), ['one']);
  assert.equal(layoutItems('one').length, 2);
  assert.deepEqual(layoutItems('cover'), []);
  assert.ok(placeholderTexts().includes('여기에 제목을 써요'));
  assert.ok(!placeholderTexts().includes('한 줄로 소개해요'));
});

test('카드 모양 바꾸기(reshapeItems): 크기는 그대로(도형·사진이 찌그러지지 않는다) · 통째로 맞추기(같은 비율로 줄여 가운데에)', () => {
  // 화면에서의 실제 세로 ÷ 가로 = (h% ÷ aspect) ÷ w%
  const shape = (it, aspect) => (it.h / aspect) / it.w;
  configure({ aspect: 1 });
  const url = 'https://my.example/a.png';
  const items = [
    newShape('circle'), newPhoto({ url, ratio: 0.5 }), coverItem(newPhoto({ url, ratio: 2 })),
    newText('제목', { x: 30, y: 20, w: 60, size: 9 }), { ...newShape('rect'), x: 20, y: 80, rot: 30 },
  ];
  const before = items.map((it) => (it.t === 'text' ? null : shape(it, 1)));
  let from = 1;
  let now = items;
  for (const to of [16 / 9, 9 / 16, 0.8, 1]) {
    configure({ aspect: to });
    now = reshapeItems(now, from, to);
    now.forEach((it, i) => {
      if (it.t === 'text') return;
      assert.ok(Math.abs(shape(it, to) - before[i]) < 0.02, `${it.t} ${i}: 모양이 그대로 (${from} → ${to}) ${shape(it, to)} vs ${before[i]}`);
    });
    assert.deepEqual([now[0].x, now[0].y, now[0].w, now[4].x, now[4].y, now[4].rot], [50, 50, items[0].w, 20, 80, 30], '자리·너비·기울기는 그대로');
    assert.deepEqual(now[3], items[3], '글은 건드리지 않는다');
    const cover = now[2];
    assert.ok(cover.w >= 99.9 && cover.h >= 99.9 && cover.x === 50 && cover.y === 50, `깔아 둔 사진은 새 모양에서도 꽉 찬다: ${cover.w}x${cover.h} @ ${to}`);
    from = to;
  }
  // 정사각형 → 가로 → 길게 → 세로 → 정사각형: 깔아 둔 사진 말고는 처음과 같다(크기를 소수 첫째 자리까지만 적어서 그만큼만 다르다)
  for (const i of [0, 1, 4]) {
    assert.ok(Math.abs(now[i].h - items[i].h) <= 0.2 && now[i].w === items[i].w, `되돌아온 ${i}: ${now[i].h} vs ${items[i].h}`);
  }
  // ---- 통째로 맞추기(fit): 지금 그림을 한 장의 사진처럼 줄여서 새 모양 안의 가운데에 놓는다 ----
  const flat = [
    newShape('circle', { x: 20, y: 30, w: 20 }), newText('제목', { x: 80, y: 90, w: 30, size: 10 }),
    { t: 'emoji', x: 10, y: 10, w: 16, ch: '😀', rot: 0, op: 100, lock: false, fx: false, fy: false }, newPhoto({ url, ratio: 0.5 }), coverItem(newPhoto({ url, ratio: 2 })),
  ];
  // 정사각형 → 가로(16:9): 모두 9/16 배로 작아지고, 왼쪽·오른쪽에 같은 여백이 생긴다. 세로 자리(%)는 그대로다.
  configure({ aspect: 16 / 9 });
  const s = 9 / 16;
  const wide = reshapeItems(flat, 1, 16 / 9, { fit: true });
  const near = (x, y, tol = 0.11) => Math.abs(x - y) <= tol;
  assert.ok(near(wide[0].w, 20 * s) && near(wide[0].x, (0.5 - s / 2 + s * 0.2) * 100) && near(wide[0].y, 30), `동그라미 ${JSON.stringify(wide[0])}`);
  assert.ok(near(shape(wide[0], 16 / 9), shape(flat[0], 1), 0.03), '동그라미는 여전히 동그랗다');
  assert.ok(near(wide[1].size, 10 * s) && near(wide[1].w, 30 * s) && near(wide[1].y, 90), `글 ${JSON.stringify(wide[1])}`);
  assert.ok(near(wide[2].w, 16 * s) && near(wide[2].y, 10) && wide[2].x > 50 - 50 * s, `그래픽 ${JSON.stringify(wide[2])}`);
  assert.ok(near(shape(wide[3], 16 / 9), shape(flat[3], 1), 0.03), '사진 비율');
  assert.ok(wide[4].w >= 99.9 && wide[4].h >= 99.9, '깔아 둔 사진은 줄이지 않고 다시 깐다');
  // 요소끼리의 관계가 그대로다: 가로 간격 ÷ 너비가 같다
  assert.ok(near((wide[1].x - wide[0].x) / wide[0].w, (flat[1].x - flat[0].x) / flat[0].w, 0.05));
  // 정사각형 → 길게(9:16): 크기는 그대로이고, 위아래에 여백이 생긴다(가운데로 모인다)
  configure({ aspect: 9 / 16 });
  const tallCard = reshapeItems(flat, 1, 9 / 16, { fit: true });
  assert.ok(near(tallCard[0].w, 20) && near(tallCard[0].x, 20) && near(tallCard[1].size, 10), '크기와 가로 자리는 그대로');
  assert.ok(near(tallCard[0].y, (0.5 - s / 2 + s * 0.3) * 100) && near(tallCard[1].y, (0.5 - s / 2 + s * 0.9) * 100), `세로 자리는 가운데로 모인다 ${tallCard[0].y}, ${tallCard[1].y}`);
  assert.ok(near(shape(tallCard[0], 9 / 16), shape(flat[0], 1), 0.03));
  // 크기는 그대로(fit: false)와 견주면: 세로 자리가 다르다
  assert.equal(reshapeItems(flat, 1, 9 / 16)[0].y, 30);
  // 한가운데에 하나만 있고 더 길쭉해질 때는 두 방법의 결과가 같다(이럴 때 화면은 묻지 않는다)
  const one = [newShape('circle')];
  configure({ aspect: 1 });
  const center = [cleanItem({ ...one[0], h: one[0].h })];
  configure({ aspect: 9 / 16 });
  assert.deepEqual(reshapeItems(center, 1, 9 / 16, { fit: true }), reshapeItems(center, 1, 9 / 16, { fit: false }));

  // 같은 모양이거나 이상한 값이면 그대로 돌려준다
  assert.equal(reshapeItems(items, 1, 1), items);
  assert.equal(reshapeItems(items, 0, 2), items);
  assert.equal(reshapeItems(items, 1, NaN), items);
  assert.deepEqual(reshapeItems(null, 1, 2), []);
  configure({ aspect: 1 });
});

test('configure — 카드 비율: 도형은 모양을, 사진은 가로세로 비율을 지킨다', () => {
  // 화면에서의 실제 가로:세로 = (w% × 카드 너비) : (h% × 카드 높이) = w × aspect : h
  const looks = (it, aspect) => (it.w * aspect) / it.h;
  for (const aspect of [16 / 9, 0.8, 1]) {
    configure({ aspect });
    assert.equal(settings().aspect, aspect);
    const circle = newShape('circle');
    assert.ok(Math.abs(looks(circle, aspect) - aspect * (circle.w / circle.h)) < 1e-9);
    assert.ok(Math.abs(circle.h / circle.w - aspect) < 0.01, `동그라미가 동그랗게: ${aspect}`);
    // 가로로 긴 사진(세로 ÷ 가로 = 0.5)과 세로로 긴 사진(2)
    for (const ratio of [0.5, 2]) {
      const p = newPhoto({ url: 'https://my.example/a.png', ratio });
      assert.ok(Math.abs((p.h / aspect) / p.w - ratio) < 0.03, `사진 비율 ${ratio} @ ${aspect}: ${p.w}x${p.h}`);
      assert.ok(p.w <= 50.01 && p.h <= 50.01, '카드의 절반 안에 들어간다');
      const fit = fitPhoto({ url: 'https://my.example/a.png', ratio });
      assert.ok(fit.w <= 100.01 && fit.h <= 100.01 && (Math.abs(fit.w - 100) < 0.1 || Math.abs(fit.h - 100) < 0.1), `꽉 맞게: ${fit.w}x${fit.h}`);
      const cover = coverItem(p);
      assert.ok(cover.w >= 99.9 && cover.h >= 99.9 && cover.x === 50 && cover.y === 50, `배경으로 깔기: ${cover.w}x${cover.h}`);
      assert.ok(Math.abs((cover.h / aspect) / cover.w - ratio) < 0.03, '깔아도 비율은 그대로');
    }
    // 템플릿의 도형 높이도 비율을 따른다
    const rect = layoutItems('one').find((it) => it.t === 'shape');
    assert.ok(Math.abs(rect.h - 20 * aspect) < 0.06, `템플릿 도형 ${rect.h}`);
  }
  configure({ aspect: 100 });
  assert.equal(settings().aspect, 4);
  configure({ aspect: 0.01 });
  assert.equal(settings().aspect, 0.25);
  configure({ aspect: 0 });
  configure({ aspect: NaN });
  configure({ aspect: '2' });
  assert.equal(settings().aspect, 0.25, '이상한 값은 받지 않는다');
  configure({ aspect: 1 });
});

// ---- 폴더 하나로 옮겨 쓸 수 있는지 ----

test('옮겨 쓰기: 모듈의 어떤 파일도 폴더 밖의 것을 가져오지 않는다', () => {
  const files = readdirSync(DIR);
  for (const need of ['index.js', 'model.js', 'editor.js', 'render.js', 'export.js', 'images.js', 'fonts.js', 'dom.js', 'cutout.js', 'stickers.js', 'editor.css']) {
    assert.ok(files.includes(need), `${need} 가 있어야 한다`);
  }
  // 이 저장소에서는 설명서와 시연 화면이 src/ 바깥(저장소 맨 위, demo/)에 있다.
  for (const need of ['../README.md', '../demo/index.html']) {
    assert.ok(readdirSync(DIR + need.slice(0, need.lastIndexOf('/') + 1)).includes(need.slice(need.lastIndexOf('/') + 1)), `${need} 가 있어야 한다`);
  }
  for (const name of files.filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(DIR + name, 'utf8');
    const froms = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const dynamic = [...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of [...froms, ...dynamic]) {
      assert.match(spec, /^[.]\/[\w-]+[.]js$/, `${name} → ${spec}`);
      assert.ok(files.includes(spec.slice(2)), `${name} → ${spec} 파일이 없다`);
    }
    assert.doesNotMatch(src, /firebase|gstatic|googleapis/i, `${name}: 저장소는 모듈 밖에서 연결한다`);
  }
  const css = readFileSync(DIR + 'editor.css', 'utf8');
  assert.doesNotMatch(css, /@import|url\(/, 'CSS 도 바깥 파일을 부르지 않는다');
  // 프로젝트의 색 변수에 기대지 않는다(--fe- 로 시작하는 것만 쓴다)
  const vars = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  for (const v of vars) assert.match(v, /^--fe-/, `CSS 변수 ${v}`);
});

test('옮겨 쓰기: 규칙 파일들은 브라우저 없이도 읽힌다(index.js 가 내보내는 이름들)', async () => {
  const index = readFileSync(DIR + 'index.js', 'utf8');
  for (const name of ['createEditor', 'designView', 'registerFonts', 'shrinkImage', 'removeBackground', 'searchStickers', 'toast']) {
    assert.match(index, new RegExp(`\\b${name}\\b`), name);
  }
  assert.match(index, /export \* from '\.\/model\.js'/);
  // 브라우저가 필요한 파일도 읽는 것만으로는 화면을 건드리지 않는다(서버에서 그리는 프로젝트에서 import 만 해도 깨지지 않게)
  const all = await import('../src/index.js');
  for (const name of ['createEditor', 'designView', 'designToBlob', 'designToCanvas', 'itemView', 'configure', 'cleanDesign', 'registerFonts', 'fontReady', 'shrinkImage', 'readPixels', 'removeBackground', 'searchStickers', 'toast']) {
    assert.equal(typeof all[name], 'function', name);
  }
  assert.equal(typeof removeBackground, 'function');
  assert.ok(searchStickers('').length > 20);
});

// ---- 여럿 고르기: 서로에게 맞춰 정렬 · 간격을 고르게 · 함께 옮기기 ----
test('여럿 정렬: 고른 것들을 감싸는 상자의 변과 가운데에 맞춘다', async () => {
  const { alignBoxes } = await import('../src/model.js');
  const boxes = [{ x: 20, y: 30, hw: 5, hh: 10 }, { x: 60, y: 50, hw: 15, hh: 5 }, { x: 40, y: 80, hw: 10, hh: 10 }];
  assert.deepEqual(alignBoxes(boxes, 'left').map((b) => b.x), [20, 30, 25]);
  assert.deepEqual(alignBoxes(boxes, 'right').map((b) => b.x), [70, 60, 65]);
  assert.deepEqual(alignBoxes(boxes, 'center').map((b) => b.x), [45, 45, 45]);
  assert.deepEqual(alignBoxes(boxes, 'top').map((b) => b.y), [30, 25, 30]);
  assert.deepEqual(alignBoxes(boxes, 'bottom').map((b) => b.y), [80, 85, 80]);
  assert.deepEqual(alignBoxes(boxes, 'middle').map((b) => b.y), [55, 55, 55]);
  assert.deepEqual(alignBoxes(boxes, 'left').map((b) => b.y), [30, 50, 80], '가로로 맞출 때 세로 자리는 그대로');
  assert.deepEqual(alignBoxes([], 'left'), []);
});

test('간격을 고르게: 양 끝은 그대로, 사이의 빈칸이 같아진다(셋보다 적으면 그대로)', async () => {
  const { distributeBoxes } = await import('../src/model.js');
  const boxes = [{ x: 90, y: 0, hw: 5, hh: 1 }, { x: 10, y: 0, hw: 5, hh: 1 }, { x: 20, y: 0, hw: 2, hh: 1 }];
  const out = distributeBoxes(boxes, 'x');
  assert.deepEqual(out.map((b) => b.x), [90, 10, 50], '받은 차례대로 돌려준다');
  const edges = [[out[1].x - 5, out[1].x + 5], [out[2].x - 2, out[2].x + 2], [out[0].x - 5, out[0].x + 5]];
  assert.equal(edges[1][0] - edges[0][1], edges[2][0] - edges[1][1]);
  assert.deepEqual(distributeBoxes(boxes.slice(0, 2), 'x').map((b) => b.x), [90, 10]);
  assert.deepEqual(distributeBoxes(boxes, 'y').map((b) => b.y), [0, 0, 0]);
});

test('함께 옮기기: 가운데가 카드 밖으로 나가지 않을 만큼만 옮긴다', async () => {
  const { clampShift } = await import('../src/model.js');
  const items = [{ x: 5, y: 40 }, { x: 70, y: 90 }];
  assert.deepEqual(clampShift(items, -10, 0), [-5, 0]);
  assert.deepEqual(clampShift(items, 50, 50), [30, 10]);
  assert.deepEqual(clampShift(items, 3, -4), [3, -4]);
});
