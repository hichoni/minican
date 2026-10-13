// 미니캔의 영상 녹화(video.js 의 recordFilm · filmToVideo): 시간이 흐르는 대로 장을 넘기고, 다음 장을 미리 준비하고,
// 다른 탭으로 가면 쉬고, 녹화기가 죽으면 바로 알고, MP4 가 안 되면 WebM 으로 다시 만드는지.
// 브라우저의 시계 · 화면 깜빡임(requestAnimationFrame) · 녹화기(MediaRecorder)를 가짜로 바꿔 node 에서 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmPlan } from '../src/film.js';
import { cleanDesign } from '../src/model.js';

// ---------- 가짜 브라우저 ----------
let clock = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true });
let frames = [];
let frameId = 0;
globalThis.requestAnimationFrame = (cb) => { frames.push({ id: ++frameId, cb }); return frameId; };
globalThis.cancelAnimationFrame = (id) => { frames = frames.filter((f) => f.id !== id); };
const listeners = new Set();
const blobOf = new Map();          // 주소 → Blob (만든 파일을 "틀어 보는" 가짜 재생기가 읽는다)
const GOOD = 'good';              // 틀어지는 파일의 속(가짜 재생기는 파일의 크기로 알아본다: 녹화한 조각을 새 Blob 으로 묶어도 크기는 그대로다)
const BAD = 'bad';
globalThis.document = {
  hidden: false,
  addEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.add(fn); },
  removeEventListener: (type, fn) => { listeners.delete(fn); },
  createElement: (tag) => {
    if (tag !== 'video') return { getContext: () => ({}) };
    const v = { videoWidth: 0, removeAttribute() {}, load() {} };
    Object.defineProperty(v, 'src', { set(url) { const blob = blobOf.get(url); queueMicrotask(() => { if (blob && blob.size === GOOD.length) { v.videoWidth = 1280; v.onloadeddata?.(); } else v.onerror?.(); }); } });
    return v;
  },
};
// 틀면서 녹화할 수 있는 브라우저(canvas.captureStream 이 있다). 한 장씩 인코딩하는 것(VideoEncoder)은 없는 브라우저로 둔다:
// 그 길은 tests/minican-video-encode.test.mjs 가 본다.
globalThis.HTMLCanvasElement = class { captureStream() {} };
let urlId = 0;
URL.createObjectURL = (blob) => { const url = `blob:fake/${++urlId}`; blobOf.set(url, blob); return url; };
URL.revokeObjectURL = (url) => { blobOf.delete(url); };
const setHidden = (hidden) => { document.hidden = hidden; for (const fn of [...listeners]) fn(); };

// 가짜 녹화기: 무엇을 했는지 적어 둔다. rules(mime) 로 종류마다 다르게 굴게 한다.
//   supported: 그 종류를 쓸 수 있다고 답할지 · dieAt: 시작하고 이만큼(ms) 지나면 오류를 내고 멈춘다 · bad: 만든 파일이 틀어지지 않는다
const recorders = [];
let rules = () => ({});
globalThis.MediaRecorder = class {
  constructor(stream, opts) { this.state = 'inactive'; this.mime = opts.mimeType; this.bitrate = opts.videoBitsPerSecond; this.log = []; this.rule = rules(this.mime); recorders.push(this); }

  start() { this.state = 'recording'; this.began = clock; this.log.push('start'); }

  pause() { assert.equal(this.state, 'recording'); this.state = 'paused'; this.log.push('pause'); }

  resume() { assert.equal(this.state, 'paused'); this.state = 'recording'; this.log.push('resume'); }

  stop() {
    assert.notEqual(this.state, 'inactive', '멈춘 녹화기를 또 멈추지 않는다');
    this.state = 'inactive';
    this.log.push('stop');
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob([this.rule.bad ? BAD : GOOD], { type: this.mime.split(';')[0] }) });
      this.onstop?.();
    });
  }

  // 인코더가 죽은 흉내: 오류를 알리고 저절로 멈춘다.
  die() { this.state = 'inactive'; this.log.push('died'); this.onerror?.({ error: new Error('encoder died') }); this.onstop?.(); }

  static isTypeSupported(mime) { return rules(mime).supported !== false; }
};

const { recordFilm, filmToVideo, videoTypes } = await import('../src/video.js');

const text = (y, more = {}) => ({ t: 'text', text: '글', x: 50, y, w: 60, size: 5, ...more });
const DESIGNS = [
  { items: [text(20), text(50), text(80)], pa: 'rise' },
  { items: [text(50, { aw: true }), text(70)], tr: 'slide' },
  { items: [text(50)], tr: 'flip' },
].map((d) => cleanDesign(d, { keepSpaces: true }));
const tick = () => new Promise((resolve) => { setImmediate(resolve); });

// 가짜 필름: 그리라고 한 것 · 준비한 것 · 버린 것을 적어 둔다. readyDelay(n): n 번째 장을 준비하는 데 걸리는 시간(ms).
let filmWidth = 1000;
function fakeFilm({ readyDelay = () => 0, failAt = -1 } = {}) {
  const plan = filmPlan(DESIGNS, { stay: 3 });
  const film = {
    plan, width: (filmWidth += 2), height: 720, draws: [], drops: [], readies: [], built: new Set(), streams: 0, tracksStopped: 0,
    canvas: { captureStream: () => { film.streams += 1; return { getTracks: () => [{ stop() { film.tracksStopped += 1; } }] }; } },
    jobs: new Map(),
    ready(n) {
      if (!film.jobs.has(n)) {
        film.readies.push([n, clock]);
        const until = clock + readyDelay(n);
        const job = (async () => { while (clock < until) await tick(); if (n === failAt) throw new Error('준비 실패'); film.built.add(n); })();
        job.catch(() => {});
        film.jobs.set(n, job);
      }
      return film.jobs.get(n);
    },
    draw(n, local) { assert.ok(film.built.has(n), `준비되지 않은 ${n} 번째 장을 그리지 않는다`); film.draws.push({ at: clock, n, local }); },
    drop(n) { if (film.built.has(n)) { film.built.delete(n); film.jobs.delete(n); film.drops.push([n, clock]); } },
  };
  return film;
}
// 시간을 한 프레임(1/60초)씩 흘려보낸다. 화면이 가려져 있으면 깜빡임이 오지 않는다(브라우저와 같다).
async function drive(promise, { hook = () => {}, maxMs = 60000 } = {}) {
  const out = { done: false };
  promise.then((v) => { out.done = true; out.result = v; }, (e) => { out.done = true; out.error = e; });
  const from = clock;
  while (!out.done && clock - from < maxMs) {
    clock += 1000 / 60;
    await hook(clock - from);
    for (const rec of recorders) if (rec.state !== 'inactive' && rec.rule.dieAt != null && clock - rec.began >= rec.rule.dieAt) rec.die();
    if (!document.hidden) { const now = frames; frames = []; for (const f of now) f.cb(clock); }
    await tick();
    await tick();
  }
  out.took = clock - from;
  return out;
}
const WEBM = { mime: 'video/webm;codecs=vp8', ext: 'webm', type: 'video/webm' };
const fresh = () => { recorders.length = 0; rules = () => ({}); document.hidden = false; };
const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(e?.message || String(e)));

test('녹화: 시간표대로 장을 넘기고, 다음 장은 요소가 다 나온 뒤에 준비하고, 지나간 장은 버린다', async () => {
  fresh();
  const film = fakeFilm();
  const progress = [];
  const r = await drive(recordFilm(film, { kind: WEBM, bitrate: 3000000, onProgress: (p) => progress.push(p) }));
  assert.equal(r.error, undefined);
  const { plan } = film;
  assert.deepEqual({ ext: r.result.ext, type: r.result.type, mime: r.result.mime, width: r.result.width, height: 720 }, { ext: 'webm', type: 'video/webm', mime: WEBM.mime, width: film.width, height: 720 });
  assert.ok(r.result.blob.size > 0);
  assert.ok(Math.abs(r.result.seconds * 1000 - plan.ms) < 400, `길이 ${r.result.seconds}s · 시간표 ${plan.ms}ms`);
  // 장은 차례대로, 한 장 안에서 시간은 뒤로 가지 않는다
  for (let i = 1; i < film.draws.length; i++) {
    const a = film.draws[i - 1]; const b = film.draws[i];
    assert.ok(b.n === a.n ? b.local >= a.local : b.n === a.n + 1 && b.local < 60, `그림 ${i}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
  assert.deepEqual([...new Set(film.draws.map((d) => d.n))], [0, 1, 2]);
  assert.ok(Math.abs(film.draws.at(-1).local - plan.slides[2].ms) < 1, '마지막 그림은 마지막 장의 끝');
  // 한 장의 길이만큼 보인 뒤에 넘어간다
  for (const n of [0, 1]) {
    const shown = film.draws.filter((d) => d.n === n);
    assert.ok(Math.abs(shown.at(-1).local - plan.slides[n].ms) < 50, `${n} 번째 장: ${shown.at(-1).local} / ${plan.slides[n].ms}`);
  }
  // 영상에 담기는 것보다 자주 그리지 않는다(1초에 30장쯤. 화면은 60번 깜빡인다)
  const perSecond = film.draws.length / (r.took / 1000);
  assert.ok(perSecond > 26 && perSecond < 33, `${perSecond}`);
  // 다음 장은 지금 장의 요소가 다 나온 뒤에 준비한다(움직이는 동안에는 그리기를 방해하지 않게)
  assert.deepEqual(film.readies.map(([n]) => n), [0, 1, 2]);
  const startOf = (n) => film.draws.find((d) => d.n === n).at;
  assert.ok(film.readies[1][1] - startOf(0) >= plan.slides[0].settle - 40, '둘째 장의 준비');
  assert.ok(film.readies[2][1] - startOf(1) >= plan.slides[1].settle - 40, '셋째 장의 준비');
  // 지나간 장은 전환 효과가 끝나면 버린다(그 전에는 전환에 쓰인다)
  assert.deepEqual(film.drops.map(([n]) => n), [0, 1]);
  assert.ok(film.drops[0][1] - startOf(1) >= plan.slides[1].turn.ms - 40 && film.drops[0][1] - startOf(1) < plan.slides[1].turn.ms + 80);
  // 진행은 늘어나기만 하고 1 로 끝난다. 가끔만 알린다.
  assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]) && progress.at(-1) === 1 && progress[0] < 0.05);
  assert.ok(progress.length < film.draws.length / 3);
  // 뒷정리
  assert.deepEqual(recorders.map((x) => [x.mime, x.bitrate, x.log]), [[WEBM.mime, 3000000, ['start', 'stop']]]);
  assert.deepEqual([listeners.size, film.tracksStopped, frames.length], [0, 1, 0]);
});

test('녹화: 다음 장의 준비가 늦으면 지금 장을 더 보여 주다가, 준비되면 그때부터 다음 장을 시작한다', async () => {
  fresh();
  const film = fakeFilm({ readyDelay: (n) => (n === 1 ? 6000 : 0) });
  const r = await drive(recordFilm(film, { kind: WEBM }));
  assert.equal(r.error, undefined);
  const { plan } = film;
  const first = film.draws.filter((d) => d.n === 0);
  const waited = first.at(-1).at - first[0].at;
  assert.ok(waited > plan.slides[0].settle + 5900, `첫 장을 ${waited}ms 동안 보여 줬다`);
  assert.ok(first.every((d) => d.local <= plan.slides[0].ms + 0.001), '기다리는 동안에는 끝 모습에 머문다');
  const second = film.draws.find((d) => d.n === 1);
  assert.ok(second.local < 60, `다음 장은 처음부터 시작한다(${second.local})`);
  assert.ok(r.result.seconds * 1000 > plan.ms + 2000, '영상이 그만큼 길어진다');
});

test('녹화: 다른 탭으로 가면 녹화를 쉬고, 돌아오면 그 자리에서 이어 간다', async () => {
  fresh();
  const film = fakeFilm();
  const r = await drive(recordFilm(film, { kind: WEBM }), {
    hook: (t) => {
      if (t >= 500 && t < 5500 && !document.hidden) setHidden(true);          // 요소가 나오는 도중에
      if (t >= 5500 && t < 5600 && document.hidden) setHidden(false);
      if (t >= 8700 && t < 8800 && !document.hidden) setHidden(true);          // 장이 넘어가는 즈음에
      if (t >= 12000 && document.hidden) setHidden(false);
    },
  });
  assert.equal(r.error, undefined);
  assert.deepEqual(recorders[0].log, ['start', 'pause', 'resume', 'pause', 'resume', 'stop']);
  assert.ok(Math.abs(r.result.seconds * 1000 - film.plan.ms) < 500, `쉰 시간은 영상에 들어가지 않는다(${r.result.seconds}s)`);
  assert.ok(r.took > film.plan.ms + 8000);
  for (let i = 1; i < film.draws.length; i++) {
    const a = film.draws[i - 1]; const b = film.draws[i];
    if (a.n === b.n) assert.ok(b.local >= a.local && b.local - a.local < 120, `쉬었다 와도 건너뛰지 않는다: ${a.local} → ${b.local}`);
  }
  assert.equal(listeners.size, 0);
});

test('녹화: 처음부터 가려져 있으면 보일 때까지 기다리고, 그동안 그만두면 아무것도 하지 않는다', async () => {
  fresh();
  document.hidden = true;
  const film = fakeFilm();
  const stop = new AbortController();
  const job = recordFilm(film, { kind: WEBM, signal: stop.signal });
  setTimeout(() => stop.abort(), 400);
  assert.equal(await job, null);
  assert.deepEqual([recorders.length, listeners.size, film.draws.length], [0, 0, 0]);
  document.hidden = false;
});

test('녹화: 그만두면 어느 때든 깨끗이 끝난다', async () => {
  for (const at of [0, 60, 1000, 3250, 3400, 7000, 9500]) {
    fresh();
    const film = fakeFilm({ readyDelay: (n) => (n === 1 ? 1500 : 0) });
    const stop = new AbortController();
    const r = await drive(recordFilm(film, { kind: WEBM, signal: stop.signal }), { hook: (t) => { if (t >= at && !stop.signal.aborted) stop.abort(); } });
    assert.ok(r.done && r.error === undefined && r.result === null, `@${at}: ${r.error?.message}`);
    assert.ok(r.took < at + 400, `@${at}: 곧바로 끝난다(${r.took})`);
    assert.deepEqual([listeners.size, film.tracksStopped, frames.length], [0, film.streams, 0], `@${at}: 연 것은 모두 닫는다`);
    assert.ok(film.streams <= 1 && recorders.every((x) => x.state === 'inactive'), `@${at}: 녹화기를 멈춘다`);
  }
});

test('녹화: 녹화기가 도중에 죽으면 끝까지 기다리지 않고 바로 실패한다', async () => {
  fresh();
  rules = () => ({ dieAt: 2000 });
  const film = fakeFilm();
  const r = await drive(recordFilm(film, { kind: WEBM }));
  assert.equal(r.error?.message, 'encoder died');
  assert.ok(r.took < 2200, `${r.took}ms 만에 알았다(영상은 ${film.plan.ms}ms)`);
  assert.deepEqual([listeners.size, film.tracksStopped, frames.length], [0, 1, 0]);
  // 가려졌다 돌아와도 멈춘 채로 남지 않는다
  fresh();
  rules = () => ({ dieAt: 2000 });
  const again = await drive(recordFilm(fakeFilm(), { kind: WEBM }), { hook: (t) => { if (t >= 1900 && t < 2500 && !document.hidden) setHidden(true); if (t >= 2500 && document.hidden) setHidden(false); } });
  assert.ok(again.done && again.error && again.took < 2700, `${again.took}`);
  document.hidden = false;
});

test('녹화: 다음 장을 준비하지 못하면 실패하고, 녹화기도 멈춘다', async () => {
  fresh();
  const film = fakeFilm({ failAt: 2 });
  const r = await drive(recordFilm(film, { kind: WEBM }));
  assert.equal(r.error?.message, '준비 실패');
  assert.ok(r.took < film.plan.ms);
  assert.deepEqual([recorders[0].state, listeners.size, film.tracksStopped], ['inactive', 0, 1]);
});

test('파일 종류: MP4 를 먼저 짧게 찍어 보고, 되면 MP4 로 한 번만 만든다. 한 번 알아본 것은 다시 찍어 보지 않는다', async () => {
  fresh();
  assert.deepEqual(videoTypes().map((k) => k.ext), ['mp4', 'mp4', 'webm', 'webm']);
  const film = fakeFilm();
  const fixed = [];
  const r = await drive(filmToVideo(film, { bitrate: 5000000, fixBlob: async (blob, seconds) => { fixed.push([blob.type, seconds]); return blob; } }));
  assert.equal(r.error, undefined);
  assert.equal(r.result.ext, 'mp4');
  assert.equal(recorders.length, 2, '짧게 찍어 본 것 + 진짜');
  assert.deepEqual(recorders.map((x) => x.mime.split(';')[0]), ['video/mp4', 'video/mp4']);
  assert.equal(recorders[1].bitrate, 5000000);
  // 다 만든 파일은 종류가 무엇이든 손볼 함수에 넘긴다(손볼 수 없으면 그대로 돌려주면 된다)
  assert.deepEqual(fixed, [['video/mp4', r.result.seconds]]);
  // 같은 크기로 또 만들면 찍어 보지 않고 바로 만든다
  recorders.length = 0;
  const same = fakeFilm();
  same.width = film.width;
  const again = await drive(filmToVideo(same));
  assert.equal(again.result.ext, 'mp4');
  assert.equal(recorders.length, 1);
});

test('파일 종류: MP4 가 짧게 찍어 봐도 안 되면 바로 WebM 으로 만든다', async () => {
  fresh();
  rules = (mime) => (mime.startsWith('video/mp4') ? { bad: true } : {});
  const retries = [];
  const r = await drive(filmToVideo(fakeFilm(), { onRetry: () => retries.push(1) }));
  assert.equal(r.error, undefined);
  assert.equal(r.result.ext, 'webm');
  assert.deepEqual(recorders.map((x) => x.mime.split(';')[0]), ['video/mp4', 'video/mp4', 'video/webm'], 'MP4 두 가지를 찍어 보고 WebM 으로 한 번');
  assert.equal(retries.length, 0, '처음부터 다시 만든 것이 아니다');
  // 쓸 수 없는 종류는 써 보지도 않는다
  fresh();
  rules = (mime) => ({ supported: !mime.startsWith('video/mp4') });
  const only = await drive(filmToVideo(fakeFilm()));
  assert.equal(only.result.ext, 'webm');
  assert.equal(recorders.length, 1);
});

test('파일 종류: MP4 로 만들다 녹화기가 죽으면 WebM 으로 한 번 더 만들고, 그 뒤로는 MP4 를 다시 써 보지 않는다', async () => {
  fresh();
  rules = (mime) => (mime.startsWith('video/mp4') ? { dieAt: 2500 } : {});     // 짧게 찍을 때는 되고, 길게 찍으면 죽는다
  const film = fakeFilm();
  const retries = [];
  const progress = [];
  const r = await drive(filmToVideo(film, { onRetry: () => retries.push(progress.length), onProgress: (p) => progress.push(p) }));
  assert.equal(r.error, undefined);
  assert.equal(r.result.ext, 'webm');
  assert.equal(retries.length, 1);
  assert.deepEqual(recorders.map((x) => x.mime.split(';')[0]), ['video/mp4', 'video/mp4', 'video/webm']);
  assert.ok(r.took < film.plan.ms + 3500, `죽은 것을 바로 알고 다시 시작한다(${r.took}ms · 영상 ${film.plan.ms}ms)`);
  assert.ok(progress[retries[0]] < 0.1, '다시 만들 때 진행은 처음부터');
  // 같은 크기로 다시 만들면: 다른 MP4 종류도 써 보지 않고 바로 WebM
  recorders.length = 0;
  const same = fakeFilm();
  same.width = film.width;
  const again = await drive(filmToVideo(same));
  assert.equal(again.result.ext, 'webm');
  assert.deepEqual(recorders.map((x) => x.mime.split(';')[0]), ['video/webm']);
});

test('파일 종류: 다 만든 MP4 가 틀어지지 않으면 WebM 으로 한 번 더 만든다. WebM 도 안 되면 실패한다', async () => {
  fresh();
  let made = 0;
  rules = (mime) => (mime.startsWith('video/mp4') ? { get bad() { made += 1; return made > 1; } } : {});      // 짧게 찍은 것만 틀어진다
  const retries = [];
  const r = await drive(filmToVideo(fakeFilm(), { onRetry: () => retries.push(1) }));
  assert.equal(r.error, undefined);
  assert.deepEqual([r.result.ext, retries.length], ['webm', 1]);
  fresh();
  rules = () => ({ bad: true });
  const none = await drive(filmToVideo(fakeFilm()));
  assert.equal(none.error?.message, '만든 영상을 틀 수 없어요');
  assert.equal(unhandled.length, 0, `놓친 오류가 없다: ${unhandled}`);
});

test('파일 종류: 그만두면 다시 만들지 않는다', async () => {
  fresh();
  rules = (mime) => (mime.startsWith('video/mp4') ? { dieAt: 4000 } : {});
  const stop = new AbortController();
  const r = await drive(filmToVideo(fakeFilm(), { signal: stop.signal }), { hook: (t) => { if (t >= 3000 && !stop.signal.aborted) stop.abort(); } });
  assert.ok(r.done && r.result === null && r.error === undefined);
  assert.ok(recorders.every((x) => !x.mime.startsWith('video/webm')));
  assert.equal(listeners.size, 0);
});
