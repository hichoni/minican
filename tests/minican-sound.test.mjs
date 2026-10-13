// 미니캔의 소리(sound.js): 바탕 영상의 소리를 영상의 시간표대로 한 줄로 섞는 계산. 풀기 · 인코딩은 브라우저에서만 돌므로 짜임새만 살핀다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOUND_RATE, soundTrack, mixSound, hasSound, canDecodeSound, soundKinds } from '../src/sound.js';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
// 값이 한결같은 소리 조각(길이: 초)
const flat = (seconds, left, right = left) => {
  const n = Math.round(seconds * SOUND_RATE);
  return { left: new Float32Array(n).fill(left), right: new Float32Array(n).fill(right) };
};
const FADE = Math.round(0.012 * SOUND_RATE);

test('큰 줄: 영상 길이만큼의 조용한 줄을 만든다(1초에 48000 표본 · 16비트)', () => {
  assert.equal(SOUND_RATE, 48000);
  const t = soundTrack(2.5);
  assert.ok(t.left instanceof Int16Array && t.right instanceof Int16Array);
  assert.deepEqual([t.left.length, t.right.length], [120000, 120000]);
  assert.equal(soundTrack(0.00001).left.length, 1, '모자라지 않게 올림한다');
  for (const bad of [0, -3, NaN, undefined, 'x']) assert.equal(soundTrack(bad).left.length, 0);
  assert.equal(hasSound(t), false);
});

test('섞기: 조각의 쓸 구간이 제때에 · 제 크기로 들어가고, 앞뒤는 서서히 커지고 줄어든다', () => {
  const master = soundTrack(4);
  // 3초짜리 조각의 1초 ~ 2초를, 큰 줄의 0.5초 자리에 절반 크기로
  const count = mixSound(master, flat(3, 0.5, -0.25), { at: 0.5, from: 1, to: 2, gain: 0.5 });
  assert.equal(count, SOUND_RATE);
  const at = 0.5 * SOUND_RATE;
  assert.equal(master.left[at - 1], 0, '그 앞은 조용하다');
  assert.equal(master.left[at + count], 0, '그 뒤도 조용하다');
  assert.equal(master.left[at], 0, '0 에서 시작해서');
  assert.equal(master.left[at + FADE], Math.round(0.25 * 32767), '0.012초 뒤에 제 크기가 된다');
  assert.equal(master.right[at + FADE], Math.round(-0.125 * 32767), '왼쪽 · 오른쪽을 따로 담는다');
  assert.equal(master.left[at + count / 2], Math.round(0.25 * 32767));
  assert.equal(master.left[at + count - 1], 0, '끝에서도 0 으로 줄어든다');
  assert.ok(master.left[at + 10] > 0 && master.left[at + 10] < master.left[at + FADE]);
  assert.equal(hasSound(master), true);
});

test('섞기: 겹치면 더하고(넘치면 끝값에서 멈춘다), 큰 줄 밖으로 나가는 부분은 버린다', () => {
  const master = soundTrack(1);
  mixSound(master, flat(1, 0.75));
  mixSound(master, flat(1, 0.75));
  assert.equal(master.left[SOUND_RATE / 2], 32767, '넘치는 것은 끝값');
  const low = soundTrack(1);
  mixSound(low, flat(1, -0.75));
  mixSound(low, flat(1, -0.75));
  assert.equal(low.left[SOUND_RATE / 2], -32768);
  // 큰 줄의 끝을 넘는 조각: 들어가는 데까지만
  const short = soundTrack(1);
  assert.equal(mixSound(short, flat(3, 0.5), { at: 0.75 }), SOUND_RATE / 4);
  assert.equal(short.left[SOUND_RATE - 1], 0, '잘린 끝도 서서히 줄어든다');
  assert.equal(mixSound(short, flat(3, 0.5), { at: 1 }), 0);
  assert.equal(mixSound(short, flat(3, 0.5), { at: -1 }), 0);
  // 쓸 구간이 조각보다 길면 조각의 끝까지만 · 구간이 비었으면 아무것도 넣지 않는다
  assert.equal(mixSound(soundTrack(5), flat(2, 0.5), { from: 1.5, to: 9 }), SOUND_RATE / 2);
  assert.equal(mixSound(soundTrack(5), flat(2, 0.5), { from: 3, to: 9 }), 0);
  assert.equal(mixSound(soundTrack(5), flat(2, 0.5), { from: 1, to: 1 }), 0);
});

test('섞기: 크기 0 · 빈 조각은 넣지 않고, 한쪽 귀만 있는 조각은 양쪽에 같은 소리를 넣는다', () => {
  const master = soundTrack(1);
  assert.equal(mixSound(master, flat(1, 0.5), { gain: 0 }), 0);
  assert.equal(mixSound(master, null), 0);
  assert.equal(mixSound(master, { left: new Float32Array(0) }), 0);
  assert.equal(hasSound(master), false);
  mixSound(master, { left: new Float32Array(SOUND_RATE).fill(0.5) });
  assert.equal(master.right[SOUND_RATE / 2], master.left[SOUND_RATE / 2]);
  assert.equal(master.left[SOUND_RATE / 2], Math.round(0.5 * 32767));
  // 크기는 0 ~ 1 사이로만 쓴다
  const loud = soundTrack(1);
  mixSound(loud, flat(1, 0.5), { gain: 7 });
  assert.equal(loud.left[SOUND_RATE / 2], Math.round(0.5 * 32767));
});

test('들리는 소리가 있는지: 아주 작은 값만 있으면 조용한 것으로 본다(소리 없는 트랙을 파일에 담지 않는다)', () => {
  const t = soundTrack(1);
  t.left.fill(3);
  t.right.fill(-3);
  assert.equal(hasSound(t), false);
  t.right.fill(-200, 7000, 9000);
  assert.equal(hasSound(t), true);
  assert.equal(hasSound(null), false);
  assert.equal(hasSound({}), false);
});

test('브라우저가 아닌 곳: 풀기 · 인코딩을 할 수 없다고 답한다(던지지 않는다)', async () => {
  assert.equal(canDecodeSound(), false);
  assert.deepEqual(await soundKinds(), []);
});

test('짜임새: 소리 모듈은 아무것도 가져다 쓰지 않고, 영상 파일에 맞는 소리를 고른다', () => {
  const sound = read('sound.js');
  assert.doesNotMatch(sound, /^import /m);
  // AAC 는 머리 없는 조각으로 받는다(MP4 에 그대로 담긴다) · 인코더가 밀리면 기다린다
  assert.match(sound, /codec === 'aac' \? \{ aac: \{ format: 'aac' \} \} : \{\}/);
  assert.match(sound, /while \(encoder\.encodeQueueSize > 20 && !broke && !signal\?\.aborted\)/);
  const video = read('video.js');
  // MP4 에는 AAC(어디서나 열린다)를 먼저, 없으면 Opus. WebM 에는 Opus.
  assert.match(video, /await soundKinds\(kind\.family === 'avc' \? \['aac', 'opus'\] : \['opus'\]\)/);
  // 소리를 담지 못해도 영상은 만든다(그림만 담고 그렇다고 알린다)
  assert.match(video, /try \{ parts = pack\(sound\); \} catch \(ex\) \{ console\.warn\(ex\); sound = null; \}\n  \}\n  parts \|\|= pack\(null\);/);
  assert.match(video, /if \(\(hadSound && !made\.sound\) \|\| unheard\) made\.soundLost = true;/);
  assert.match(video, /return done\(\{ \.\.\.made, sound: '', soundLost: hadSound \|\| unheard \}\);/);
  // 소리 트랙이 있는 파일인데 풀지 못하면 빠졌다고 알린다 · Opus 로 인코딩하고 나면 큰 줄을 놓아준다(메모리)
  assert.match(video, /if \(!clip && info\?\.audio\) lost = true;/);
  assert.match(video, /if \(got && codec === 'opus'\) track = null;/);
  // 소리를 줄인(0) 영상 장면 · 틀지 않는(멈춘 그림으로 담는) 장면의 소리는 풀지도 않는다
  assert.match(video, /const heard = \(n\) => \(plan\.slides\[n\]\.scene && list\[n\]\.video && list\[n\]\.video\.vol > 0 \? list\[n\]\.video : null\);/);
  // 소리가 영상보다 늦게 시작하는 파일: 풀어 낸 소리는 첫 소리 조각부터이므로 그만큼(lead) 밀어서 넣는다
  assert.match(video, /clips\.set\(video\.src, clip \? \{ clip, lead: \(info\?\.audioStart \|\| 0\) \/ 1e6 \} : null\);/);
  assert.match(video, /const from = video\.in - got\.lead;/);
  assert.match(video, /mixSound\(master, got\.clip, \{ at: \(base \+ slide\.scene\.start\) \/ 1000 \+ late, from: Math\.max\(0, from\), to: video\.out - got\.lead, gain: video\.vol \/ 100 \}\);/);
  assert.match(video, /return \{ track: master && hasSound\(master\) \? master : null, lost \};/);
});
