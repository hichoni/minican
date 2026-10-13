// 그림 묶음(src/art/*.js, art.js)의 점검: 묶음 정보와 자료가 맞는지, 그림에 위험한 것이 없는지, 사용 조건 파일이 있는지,
// 요소로 놓고 정리하고 찾는 규칙.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ART_PACKS, isArtId, artPack, artAspect, artColorable, loadArt, searchArt, artSvg, artName, artReady } from '../src/art.js';
import { cleanItem, newArt, itemLabel, configure, settings } from '../src/model.js';

const ART = new URL('../src/art/', import.meta.url);

test('묶음 넷: 파일의 묶음 정보가 art.js 와 같고, 이름은 겹치지 않으며 모든 그림에 한국어 낱말이 있다', async () => {
  assert.deepEqual(ART_PACKS.map((p) => p.id), ['fe', 'tb', 'px', 'pp']);
  for (const p of ART_PACKS) {
    const { default: data } = await import(new URL(p.file, ART));
    assert.equal(data.id, p.id);
    assert.equal(data.view, p.view.join(' '), `${p.id} 의 그림 칸`);
    assert.equal(data.color, p.color);
    assert.ok(data.items.length >= 20, `${p.id} 는 그림이 넉넉하다`);
    const names = data.items.map(([n]) => n);
    assert.equal(new Set(names).size, names.length, `${p.id} 에 같은 이름이 없다`);
    for (const [name, words, body] of data.items) {
      assert.ok(isArtId(`${p.id}:${name}`), `${p.id}:${name}`);
      assert.match(words, /[가-힣]/, `${p.id}:${name} 의 한국어 낱말`);
      // 바깥 그림을 그대로 넣으므로: 스크립트 · 이벤트 · 링크 · 서로 겹칠 id 가 없어야 한다
      assert.doesNotMatch(body, /<script|<foreignObject|\son\w+=|href=|url\(|\sid=/i, `${p.id}:${name}`);
    }
  }
});

test('묶음마다 사용 조건(MIT · CC0) 파일과 고른 목록이 있다', () => {
  for (const f of ['LICENSE-fluent-emoji.txt', 'LICENSE-tabler-icons.txt', 'LICENSE-pixelarticons.txt']) assert.match(readFileSync(new URL(f, ART), 'utf8'), /MIT License/);
  assert.match(readFileSync(new URL('LICENSE-open-peeps.txt', ART), 'utf8'), /CC0/);
  for (const f of ['fluent.txt', 'tabler.txt', 'pixel.txt', 'build.mjs', 'peeps.cjs']) assert.ok(existsSync(new URL(`../tools/art/${f}`, import.meta.url)), f);
  assert.match(readFileSync(new URL('../NOTICE', import.meta.url), 'utf8'), /Fluent Emoji[\s\S]*Tabler Icons[\s\S]*Pixelarticons[\s\S]*Open Peeps/);
});

test('그림 이름: 묶음:이름 모양만 받고, 비율과 색 바꾸기는 묶음을 따른다', () => {
  for (const id of ['fe:red-apple', 'tb:book', 'px:heart', 'pp:teacher']) assert.ok(isArtId(id), id);
  for (const id of ['xx:apple', 'fe:', 'fe:Red', 'fe:../x', 'fe:a"b', 'tb:<svg>', 42, null]) assert.equal(isArtId(id), false, String(id));
  assert.equal(artPack('tb:book').name, '선 아이콘');
  assert.equal(artAspect('fe:red-apple'), 1);
  assert.ok(artAspect('pp:teacher') < 1, '사람은 세로로 길다');
  assert.equal(artColorable('tb:book'), true);
  assert.equal(artColorable('px:heart'), true);
  assert.equal(artColorable('fe:red-apple'), false);
  assert.equal(artColorable('pp:teacher'), false);
});

test('요소 정리: 이름만 저장하고, 색은 한 가지 색 묶음에만 적는다. 모르는 이름이나 SVG 를 넣으면 버린다', () => {
  configure({ aspect: 1 });
  const line = cleanItem({ t: 'art', x: 10, y: 20, w: 30, h: 30, art: 'tb:book', color: '#e03131', svg: '<script>alert(1)</script>' });
  assert.deepEqual(Object.keys(line).filter((k) => ['art', 'color', 'svg', 'body'].includes(k)).sort(), ['art', 'color']);
  assert.equal(line.color, '#e03131');
  const colorful = cleanItem({ t: 'art', w: 30, h: 30, art: 'fe:red-apple', color: '#e03131' });
  assert.equal(colorful.color, undefined, '컬러 그림은 원래 색 그대로');
  assert.equal(cleanItem({ t: 'art', w: 30, h: 30, art: 'zz:apple' }), null);
  assert.equal(cleanItem({ t: 'art', w: 30, h: 30, art: 'fe:<b>' }), null);
  assert.equal(cleanItem({ t: 'art', w: 30, h: 30 }), null);
  assert.equal(newArt('nope'), null);
});

test('새로 놓기: 묶음의 기본 너비로, 그림의 비율을 카드 비율에 맞춰 지킨다', () => {
  configure({ aspect: 1 });
  const apple = newArt('fe:red-apple');
  assert.equal(apple.t, 'art');
  assert.equal(apple.w, 22);
  assert.equal(apple.h, 22);
  const person = newArt('pp:teacher');
  assert.ok(Math.abs(person.h - 30 / artAspect('pp:teacher')) < 0.06);
  assert.equal(newArt('tb:book').color, '#1d2433');
  assert.equal(newArt('tb:book', { color: '#ffffff' }).color, '#ffffff');
  configure({ aspect: 16 / 9 });
  const wide = newArt('fe:red-apple');
  assert.ok(Math.abs(wide.h - 22 * settings().aspect) < 0.06, '가로로 긴 카드에서도 정사각형으로 보인다');
  configure({ aspect: 1 });
});

test('불러오기 · 찾기 · 그리기: 한국어 낱말과 묶음으로 찾고, 이름과 SVG 를 돌려준다', async () => {
  assert.equal(artSvg('fe:red-apple'), '', '불러오기 전에는 빈 글');
  const n = await loadArt();
  assert.ok(n > 900, `그림이 ${n}개`);
  assert.equal(artReady(), true);
  assert.equal(artName('fe:red-apple'), '사과');
  assert.equal(itemLabel(newArt('fe:red-apple')), '그림: 사과');
  assert.ok(searchArt('사과').some((a) => a.id === 'fe:red-apple'));
  assert.ok(searchArt('학교').length >= 2);
  assert.ok(searchArt('', 'pp').every((a) => a.id.startsWith('pp:')));
  assert.equal(searchArt('', 'pp').length, 32);
  assert.ok(searchArt('선생님').some((a) => a.id.startsWith('pp:')), '사람 묶음도 낱말로 찾는다');
  assert.deepEqual(searchArt('없는낱말쿼크'), []);
  const svg = artSvg('tb:book', { fit: 'meet' });
  assert.match(svg, /^<svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet"/);
  assert.match(artSvg('tb:book'), /preserveAspectRatio="none"/);
});

test('찾기 결과는 묶음의 차례(컬러 그림 → 선 아이콘 → 픽셀 → 사람)로 나온다', async () => {
  await loadArt();
  const order = [...new Set(searchArt('').map((a) => a.id.slice(0, 2)))];
  assert.deepEqual(order, ['fe', 'tb', 'px', 'pp']);
});
