// 사용법 안내(app/tour.js): 비추는 자리와 펼치는 도구가 실제 화면에 있는 것인지 살핀다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOME_STEPS, EDITOR_STEPS } from '../app/tour.js';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('안내의 단계: 제목과 설명이 있고, 비추는 자리는 앱이 그리는 것이다', () => {
  const app = read('../app/app.js'), editor = read('../src/editor.js');
  for (const s of [...HOME_STEPS, ...EDITOR_STEPS]) {
    assert.ok(s.title && s.text && s.text.length <= 140, s.title);
    const cls = s.target.match(/^\.([a-z-]+)$/)?.[1];
    assert.ok(cls, s.target);
    assert.ok(app.includes(cls) || editor.includes(cls), `${s.target} 는 화면에 있어야 해요`);
  }
  // 펼치는 도구는 편집기의 칸 이름이다
  const tabs = [...editor.matchAll(/\['([a-z]+)', '[a-zA-Z]+', '[^']+', '[^']+'\]/g)].map((m) => m[1]);
  for (const s of EDITOR_STEPS.filter((x) => x.view)) assert.ok(tabs.includes(s.view), s.view);
});

test('처음 꾸미는 화면을 열면 한 번 저절로 보여 주고, ? 단추로 언제든 다시 본다', () => {
  const app = read('../app/app.js');
  assert.match(app, /if \(!tourSeen\('editor'\)\) \{\n    markTourSeen\('editor'\);/);
  assert.match(app, /tourButton\('home'\)/);
  assert.match(app, /tourButton\('editor', O\)/);
  assert.match(app, /function setView\(view\) \{\n  stopTour\(\);/, '화면이 바뀌면 안내를 닫는다');
});
