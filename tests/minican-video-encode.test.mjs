// 미니캔의 영상 만들기 가운데 "한 장씩 인코딩하기"(video.js 의 encodeFilm)와, 만드는 길을 고르는 일(filmToVideo).
// 브라우저의 인코더(VideoEncoder) · 프레임(VideoFrame) · 녹화기(MediaRecorder) · 재생기를 가짜로 바꿔 node 에서 돌린다.
// 시계를 따라가지 않는 길이라, 가짜 시계가 없어도 프레임마다 "몇 번째 장의 언제"를 그렸는지 정확히 견줄 수 있다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmPlan } from '../src/film.js';
import { cleanDesign } from '../src/model.js';

// ---------- 가짜 브라우저 ----------
const AVCC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, 0xee]);
// 인코더의 규칙(테스트마다 바꾼다): supported(codec) · dieAt(이만큼 넣으면 오류) · skip(이 번째 프레임은 내보내지 않는다) · queue(밀린 척하는 수)
//   newConfigAt(이 번째 온전한 장면부터 설정 기록이 달라진다) · swap(이 번째와 다음 것을 뒤바꿔 내보낸다) · junk(codec): 풀리지 않는 조각을 낸다
//   noDecoder: 디코더가 없는 브라우저인 척
let rule = {};
const COLOR = { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false };
let waits = 0;                    // 인코더가 밀려서 기다린 횟수
const encoders = [];
let framesOpen = 0;
globalThis.VideoFrame = class {
  constructor(canvas, init) { this.canvas = canvas; this.timestamp = init.timestamp; this.duration = init.duration; this.alpha = init.alpha; framesOpen += 1; }

  close() { framesOpen -= 1; }
};
globalThis.VideoEncoder = class {
  constructor({ output, error }) { this.output = output; this.error = error; this.state = 'unconfigured'; this.fed = []; this.pending = []; this.encodeQueueSize = 0; this.listeners = new Set(); encoders.push(this); }

  static async isConfigSupported(config) { return { supported: (rule.supported || (() => true))(config.codec, config), config }; }

  configure(config) { this.config = config; this.state = 'configured'; }

  encode(frame, { keyFrame } = {}) {
    assert.equal(this.state, 'configured');
    const n = this.fed.length;
    this.fed.push({ ts: frame.timestamp, key: !!keyFrame });
    if (rule.dieAt === n) { queueMicrotask(() => this.error(new Error('encoder died'))); return; }
    if (rule.skip === n) return;
    const key = !!keyFrame || n === 0;
    const junk = rule.junk?.(this.config.codec);
    const chunk = { byteLength: 5, type: key ? 'key' : 'delta', timestamp: frame.timestamp, duration: frame.duration, copyTo: (dest) => dest.fill(junk ? 0 : (n % 200) + 1) };
    // 크롬처럼: 온전한 장면마다 설정 기록을 알려 준다(보통은 늘 같은 것이다)
    let meta = {};
    if (key) {
      const config = { codec: this.config.codec, colorSpace: COLOR };
      if (this.config.codec.startsWith('avc1')) {
        const d = AVCC.slice();
        if (rule.newConfigAt != null && n >= rule.newConfigAt) d[9] = 0x42;
        config.description = d.buffer;
      }
      meta = { decoderConfig: config };
    }
    // 조각을 내보내며 밀린 것이 풀렸다고 알린다(진짜 인코더처럼: 알릴 때는 이미 줄어 있다)
    const emit = () => { this.encodeQueueSize = 0; this.output(chunk, meta); for (const fn of [...this.listeners]) fn(); };
    let job;
    if (rule.swap === n) { this.held = emit; job = Promise.resolve(); } else if (this.held) { const first = this.held; this.held = null; job = Promise.resolve().then(() => { emit(); first(); }); } else job = Promise.resolve().then(emit);
    this.pending.push(job);
    if (rule.queue) this.encodeQueueSize = rule.queue;
  }

  addEventListener(type, fn) { if (type === 'dequeue') { this.listeners.add(fn); waits += 1; } }

  removeEventListener(type, fn) { this.listeners.delete(fn); }

  async flush() { await Promise.all(this.pending); }

  close() { this.state = 'closed'; }
};
// 가짜 디코더: 조각의 속이 0 으로 차 있으면(junk) 풀지 못한다.
const decoders = [];
globalThis.EncodedVideoChunk = class { constructor(init) { Object.assign(this, init); } };
class FakeDecoder {
  constructor({ output, error }) { this.output = output; this.error = error; this.state = 'unconfigured'; this.got = []; decoders.push(this); }

  static async isConfigSupported(config) { return { supported: true, config }; }

  configure(config) { this.config = config; this.state = 'configured'; }

  decode(chunk) { this.got.push(chunk); if (chunk.data[0] === 0) queueMicrotask(() => this.error(new Error('decode error'))); else queueMicrotask(() => this.output({ close() {} })); }

  async flush() { await null; await null; }

  close() { this.state = 'closed'; }
}
globalThis.VideoDecoder = FakeDecoder;
// 만든 파일을 "틀어 보는" 가짜 재생기: canPlay(blob) 가 정한다(true · false, null 이면 끝내 답하지 않는다: 가려진 탭처럼).
let canPlay = () => true;
let plays = 0;
const blobOf = new Map();
const listeners = new Set();
globalThis.document = {
  hidden: false,
  addEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.add(fn); },
  removeEventListener: (type, fn) => { listeners.delete(fn); },
  createElement: (tag) => {
    if (tag !== 'video') return { getContext: () => ({}) };
    const v = { videoWidth: 0, removeAttribute() {}, load() {} };
    Object.defineProperty(v, 'src', { set(url) { const blob = blobOf.get(url); plays += 1; queueMicrotask(() => { const ok = blob ? canPlay(blob) : false; if (ok === null) return; if (ok) { v.videoWidth = 1280; v.onloadeddata?.(); } else v.onerror?.(); }); } });
    return v;
  },
};
// "제때 알 수 없음"(8초 기다림)을 테스트에서는 바로 끝나게 한다: 8초짜리 타이머만 곧바로 돌린다.
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => realTimeout(fn, ms === 8000 ? 0 : ms, ...rest);
let urlId = 0;
URL.createObjectURL = (blob) => { const url = `blob:fake/${++urlId}`; blobOf.set(url, blob); return url; };
URL.revokeObjectURL = (url) => { blobOf.delete(url); };
// 틀면서 녹화하는 길(마지막 수단): 불리면 바로 끝나는 가짜 녹화기. 화면 깜빡임은 바로 돌려준다.
let clock = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => (clock += 40) }, configurable: true });
globalThis.requestAnimationFrame = (cb) => setImmediate(() => cb(clock));
globalThis.cancelAnimationFrame = () => {};
globalThis.HTMLCanvasElement = class { captureStream() {} };
const recorders = [];
globalThis.MediaRecorder = class {
  constructor(stream, opts) { this.state = 'inactive'; this.mime = opts.mimeType; recorders.push(this); }

  start() { this.state = 'recording'; }

  pause() { this.state = 'paused'; }

  resume() { this.state = 'recording'; }

  stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['recorded'], { type: this.mime.split(';')[0] }) }); this.onstop?.(); }); }

  static isTypeSupported(mime) { return mime.startsWith('video/webm'); }
};

const { encodeFilm, encodeKinds, filmToVideo, canMakeVideo } = await import('../src/video.js');

const text = (y, more = {}) => ({ t: 'text', text: '글', x: 50, y, w: 60, size: 5, ...more });
const DESIGNS = [
  { items: [text(20), text(50), text(80)], pa: 'rise' },
  { items: [text(50, { aw: true }), text(70)], tr: 'slide' },
  { items: [text(50)], tr: 'flip' },
  { items: [text(50)] },
].map((d) => cleanDesign(d, { keepSpaces: true }));
let filmWidth = 1200;
function fakeFilm() {
  const plan = filmPlan(DESIGNS, { stay: 3 });
  const film = {
    plan, width: (filmWidth += 2), height: 720, draws: [], readies: [], drops: [], built: new Set(), most: 0, canvas: { captureStream: () => ({ getTracks: () => [{ stop() {} }] }) },
    async ready(n) { if (!film.built.has(n)) { film.readies.push(n); await null; film.built.add(n); film.most = Math.max(film.most, film.built.size); } },
    draw(n, local) {
      assert.ok(film.built.has(n), `준비되지 않은 ${n} 번째 장을 그리지 않는다`);
      const turn = plan.slides[n].turn;
      if (turn && local < turn.ms) assert.ok(film.built.has(n - 1), `전환 효과가 도는 동안에는 앞 장(${n - 1})이 남아 있어야 한다`);
      film.draws.push({ n, local });
    },
    drop(n) { if (film.built.delete(n)) film.drops.push(n); },
  };
  return film;
}
// 가짜 필름은 1200×720 쯤이다: H.264 의 수준은 3.1(1f)이면 된다.
const AVC = { codec: 'avc1.64001f', family: 'avc', ext: 'mp4', type: 'video/mp4' };
const VP9 = { codec: 'vp09.00.40.08', family: 'vp9', ext: 'webm', type: 'video/webm' };
const fresh = () => { rule = {}; encoders.length = 0; decoders.length = 0; recorders.length = 0; canPlay = () => true; plays = 0; waits = 0; globalThis.VideoDecoder = FakeDecoder; document.hidden = false; };
const head = async (blob, n = 12) => new Uint8Array(await blob.slice(0, n).arrayBuffer());
const u32 = (b, at) => new DataView(b.buffer, b.byteOffset).getUint32(at);
// 그 프레임이 시간표에서 몇 번째 장의 언제인지(따로 계산한다)
function where(plan, ms) {
  let from = 0;
  for (let n = 0; n < plan.slides.length; n++) {
    if (ms < from + plan.slides[n].ms || n === plan.slides.length - 1) return { n, local: ms - from };
    from += plan.slides[n].ms;
  }
  return null;
}

test('한 장씩 인코딩하기: 영상의 f 번째 프레임은 정확히 f ÷ fps 초의 그림이다(빠지는 프레임이 없다)', async () => {
  fresh();
  const film = fakeFilm();
  const progress = [];
  const made = await encodeFilm(film, { kind: AVC, fps: 30, bitrate: 9000000, onProgress: (p) => progress.push(p) });
  const { plan } = film;
  const count = Math.round((plan.ms / 1000) * 30);
  assert.deepEqual({ ext: made.ext, type: made.type, mime: made.mime, frames: made.frames, width: made.width, height: 720 }, { ext: 'mp4', type: 'video/mp4', mime: AVC.codec, frames: count, width: film.width, height: 720 });
  assert.ok(Math.abs(made.seconds - plan.ms / 1000) <= 1 / 30 + 0.006, `길이 ${made.seconds}s · 시간표 ${plan.ms}ms`);
  // 프레임마다: 때는 f ÷ 30 초, 그림은 시간표의 그 순간
  const [enc] = encoders;
  assert.equal(enc.fed.length, count);
  assert.equal(film.draws.length, count);
  enc.fed.forEach((fed, f) => {
    assert.equal(fed.ts, Math.round((f * 1e6) / 30), `프레임 ${f} 의 때`);
    const want = where(plan, (f * 1000) / 30);
    assert.equal(film.draws[f].n, want.n, `프레임 ${f} 의 장`);
    assert.ok(Math.abs(film.draws[f].local - want.local) < 1e-6, `프레임 ${f}: ${film.draws[f].local} vs ${want.local}`);
    assert.equal(fed.key, f % 60 === 0, `프레임 ${f}: 2초마다 온전한 장면`);
  });
  // 인코더에는 화질을 먼저 생각하라고 하고, H.264 는 길이 붙은 조각으로 받는다
  assert.deepEqual(enc.config, { codec: AVC.codec, width: film.width, height: 720, bitrate: 9000000, framerate: 30, bitrateMode: 'variable', latencyMode: 'quality', avc: { format: 'avc' } });
  // 장은 차례대로 준비하고, 지나간 장은 버린다(전환 효과에 쓰이는 바로 앞 장만 남긴다): 한꺼번에 두 장을 넘지 않는다
  assert.deepEqual(film.readies, [0, 1, 2, 3]);
  assert.deepEqual(film.drops, [0, 1, 2]);
  assert.ok(film.most <= 2, `한꺼번에 ${film.most} 장`);
  // 뒷정리: 프레임은 모두 닫고, 인코더도 닫는다
  assert.equal(framesOpen, 0);
  assert.equal(enc.state, 'closed');
  // 진행은 늘어나기만 하고 1 로 끝난다
  assert.ok(progress.length > 3 && progress.every((p, i) => i === 0 || p >= progress[i - 1]) && progress.at(-1) === 1);
  // 묶은 파일: MP4 이고, 머리말이 앞에 있다
  const bytes = await head(made.blob, 40);
  assert.equal(String.fromCharCode(...bytes.subarray(4, 8)), 'ftyp');
  assert.equal(String.fromCharCode(...bytes.subarray(u32(bytes, 0) + 4, u32(bytes, 0) + 8)), 'moov');
});

test('한 장씩 인코딩하기: VP9 는 WebM 으로 묶고, 초당 60장도 정확히 센다', async () => {
  fresh();
  const film = fakeFilm();
  const made = await encodeFilm(film, { kind: VP9, fps: 60 });
  assert.deepEqual([made.ext, made.type, made.frames], ['webm', 'video/webm', Math.round((film.plan.ms / 1000) * 60)]);
  assert.equal(encoders[0].config.avc, undefined);
  assert.equal(encoders[0].fed[7].ts, Math.round((7 * 1e6) / 60));
  assert.deepEqual([...(await head(made.blob, 4))], [0x1a, 0x45, 0xdf, 0xa3]);
});

test('한 장씩 인코딩하기: 인코더가 밀리면 기다렸다가 넣는다(결과는 같다)', async () => {
  fresh();
  const calm = await encodeFilm(fakeFilm(), { kind: VP9, fps: 30 });
  assert.equal(waits, 0, '밀리지 않으면 기다리지 않는다');
  fresh();
  rule = { queue: 9 };
  const film = fakeFilm();
  const made = await encodeFilm(film, { kind: VP9, fps: 30 });
  assert.equal(made.frames, calm.frames);
  assert.ok(waits >= made.frames - 1, `프레임마다 인코더가 비워질 때까지 기다렸다(${waits} 번)`);
  assert.equal(encoders[0].listeners.size, 0, '기다리던 것을 남기지 않는다');
});

test('한 장씩 인코딩하기: 그만두면 곧바로 끝나고, 인코더가 죽거나 프레임을 빠뜨리면 실패한다', async () => {
  fresh();
  const stop = new AbortController();
  const film = fakeFilm();
  let calls = 0;
  const gone = await encodeFilm(film, { kind: AVC, signal: stop.signal, onProgress: () => { calls += 1; if (calls === 3) stop.abort(); } });
  assert.equal(gone, null);
  assert.ok(encoders[0].fed.length < Math.round((film.plan.ms / 1000) * 30) / 2, '끝까지 가지 않는다');
  assert.deepEqual([encoders[0].state, framesOpen], ['closed', 0]);
  fresh();
  rule = { dieAt: 40 };
  await assert.rejects(encodeFilm(fakeFilm(), { kind: AVC }), /encoder died/);
  assert.ok(encoders[0].fed.length < 60, `${encoders[0].fed.length} 장 만에 알았다`);
  assert.deepEqual([encoders[0].state, framesOpen], ['closed', 0]);
  fresh();
  rule = { skip: 100 };
  await assert.rejects(encodeFilm(fakeFilm(), { kind: VP9 }), /프레임 수가 맞지 않아요/);
  // 앞의 몇 장만 만들 수도 있다(되는지 짧게 알아볼 때)
  fresh();
  const few = await encodeFilm(fakeFilm(), { kind: AVC, frames: 4 });
  assert.deepEqual([few.frames, encoders[0].fed.length], [4, 4]);
});

test('한 장씩 인코딩하기: 인코더가 이상하게 굴면 조용히 넘어가지 않는다(설정이 도중에 바뀜 · 차례가 뒤바뀜 · 설정 기록이 없음)', async () => {
  // 설정 기록(avcC)은 파일에 하나만 담는다. 도중에 다른 것이 오면 그 뒤의 장면을 풀 수 없다.
  fresh();
  rule = { newConfigAt: 60 };
  await assert.rejects(encodeFilm(fakeFilm(), { kind: AVC }), /설정이 도중에 바뀌었어요/);
  assert.ok(encoders[0].fed.length < 80, '바뀐 것을 알자마자 그만둔다');
  // 같은 기록이 온전한 장면마다 다시 오는 것은 괜찮다(크롬이 그렇게 한다)
  fresh();
  assert.ok((await encodeFilm(fakeFilm(), { kind: AVC })).frames > 100);
  // 뒤의 장면을 먼저 내보내면(차례가 뒤바뀌면) 담지 못한다: 몰래 줄을 다시 세우지 않는다
  fresh();
  rule = { swap: 30 };
  await assert.rejects(encodeFilm(fakeFilm(), { kind: VP9 }), /차례가 뒤섞였어요/);
  // 초당 장수가 정수가 아니어도 온전한 장면은 2초마다
  fresh();
  await encodeFilm(fakeFilm(), { kind: VP9, fps: 29.97 });
  assert.deepEqual(encoders[0].fed.map((x, f) => (x.key ? f : -1)).filter((f) => f >= 0).slice(0, 4), [0, 60, 120, 180]);
});

test('한 장씩 인코딩하기: 그림을 준비하거나 그리지 못한 것은 "필름의 오류"라고 알린다', async () => {
  fresh();
  const film = fakeFilm();
  const ready = film.ready;
  film.ready = async (n) => { if (n === 2) throw new Error('그림으로 바꾸지 못했어요'); return ready(n); };
  await assert.rejects(encodeFilm(film, { kind: VP9 }), (ex) => ex.fromFilm === true && /그림으로 바꾸지 못했어요/.test(ex.message));
  assert.equal(encoders[0].state, 'closed');
  fresh();
  const broken = fakeFilm();
  const draw = broken.draw;
  broken.draw = (n, local) => { if (n === 1 && local > 500) throw new Error('그리기 실패'); draw(n, local); };
  await assert.rejects(encodeFilm(broken, { kind: VP9 }), (ex) => ex.fromFilm === true);
  // 인코더의 오류에는 그 표시가 없다
  fresh();
  rule = { dieAt: 10 };
  await assert.rejects(encodeFilm(fakeFilm(), { kind: VP9 }), (ex) => ex.fromFilm === undefined);
});

test('만드는 길: 인코더가 받아 주는 것들을, 그림의 크기에 맞는 수준으로 물어본다', async () => {
  fresh();
  assert.equal(canMakeVideo(), true);
  // 1200×720 쯤: 화질 좋은 설정(High)부터 · 수준 3.1
  assert.deepEqual((await encodeKinds(fakeFilm())).map((k) => [k.codec, k.ext]), [['avc1.64001f', 'mp4'], ['avc1.4d001f', 'mp4'], ['avc1.42e01f', 'mp4'], ['vp09.00.40.08', 'webm'], ['vp8', 'webm']]);
  // 1920×1080 · 1080×1920 은 수준 4.0, 초당 60장이면 4.2, 더 크면 그에 맞게
  const sized = (width, height) => ({ ...fakeFilm(), width, height });
  assert.equal((await encodeKinds(sized(1920, 1080)))[0].codec, 'avc1.640028');
  assert.equal((await encodeKinds(sized(1080, 1920)))[0].codec, 'avc1.640028');
  assert.equal((await encodeKinds(sized(1280, 720)))[0].codec, 'avc1.64001f');
  assert.equal((await encodeKinds(sized(1920, 1080), 60))[0].codec, 'avc1.64002a');
  assert.deepEqual((await encodeKinds(sized(3840, 2160))).map((k) => k.codec).filter((c) => !c.startsWith('avc1.4') && c !== 'vp8'), ['avc1.640033', 'vp09.00.51.08']);
  rule = { supported: (codec) => !codec.startsWith('avc1.64') };       // 화질 좋은 설정(High)은 안 되는 기기
  assert.deepEqual((await encodeKinds(fakeFilm())).map((k) => k.codec), ['avc1.4d001f', 'avc1.42e01f', 'vp09.00.40.08', 'vp8']);
  rule = { supported: (codec) => !codec.startsWith('avc1') };          // H.264 가 아예 없는 기기
  assert.deepEqual((await encodeKinds(fakeFilm())).map((k) => k.family), ['vp9', 'vp8']);
  const seen = [];
  rule = { supported: (codec, config) => { seen.push(config); return true; } };
  const film = fakeFilm();
  await encodeKinds(film, 30, 7000000);
  assert.deepEqual([seen[0].width, seen[0].height, seen[0].bitrate, seen[0].framerate], [film.width, 720, 7000000, 30], '진짜로 쓸 크기 · 화질로 물어본다');
});

test('만드는 길: 먼저 몇 장만 만들어 풀리는지 보고, 되면 그 길로 한 번에 만든다. 한 번 알아본 것은 다시 알아보지 않는다', async () => {
  fresh();
  const film = fakeFilm();
  const retries = [];
  const fixed = [];
  const made = await filmToVideo(film, { onRetry: () => retries.push(1), fixBlob: async (blob, seconds) => { fixed.push([blob.type, seconds]); return blob; } });
  assert.deepEqual([made.ext, made.mime, retries.length], ['mp4', AVC.codec, 0]);
  assert.deepEqual(encoders.map((e) => e.fed.length), [4, made.frames], '짧게 한 번 + 진짜 한 번');
  // 짧게 만든 조각은 디코더에 넣어 풀어 본다(설정 기록도 함께 준다)
  assert.equal(decoders.length, 1);
  assert.deepEqual([decoders[0].got.length, decoders[0].config.codec, decoders[0].config.codedWidth, decoders[0].config.description.length, decoders[0].state], [4, AVC.codec, film.width, AVCC.length, 'closed']);
  assert.deepEqual(fixed, [['video/mp4', made.seconds]]);
  assert.equal(recorders.length, 0, '녹화하는 길은 쓰지 않는다');
  encoders.length = 0;
  decoders.length = 0;
  const same = fakeFilm();
  same.width = film.width;
  await filmToVideo(same);
  assert.deepEqual([encoders.length, decoders.length], [1, 0], '같은 크기로 또 만들 때는 바로 만든다');
});

test('만드는 길: 짧게 만든 조각이 풀리지 않는 인코더는 건너뛴다(H.264 세 가지 → VP9)', async () => {
  fresh();
  rule = { junk: (codec) => codec.startsWith('avc1') };
  const retries = [];
  const film = fakeFilm();
  const made = await filmToVideo(film, { onRetry: () => retries.push(1) });
  assert.deepEqual([made.ext, made.mime, retries.length], ['webm', 'vp09.00.40.08', 0], '처음부터 다시 만든 것이 아니므로 알리지 않는다');
  assert.deepEqual(encoders.map((e) => [e.config.codec, e.fed.length]), [['avc1.64001f', 4], ['avc1.4d001f', 4], ['avc1.42e01f', 4], ['vp09.00.40.08', 4], ['vp09.00.40.08', made.frames]]);
  // 화질 좋은 설정만 안 되는 기기에서는 다음 H.264 설정으로 MP4 를 만든다
  fresh();
  rule = { junk: (codec) => codec.startsWith('avc1.64') };
  const main = await filmToVideo(fakeFilm());
  assert.deepEqual([main.ext, main.mime], ['mp4', 'avc1.4d001f']);
});

test('만드는 길: 가려진 탭에서도 만든다 — 틀어 봐서 알 수 없는 것은 "안 됨"이 아니다', async () => {
  // 가려진 탭에서는 브라우저가 <video> 읽기를 미뤄서, 다 만든 파일을 틀어 볼 수 없다(끝내 답이 없다).
  fresh();
  canPlay = () => null;
  const film = fakeFilm();
  const retries = [];
  const made = await filmToVideo(film, { onRetry: () => retries.push(1) });
  assert.deepEqual([made.ext, made.mime, retries.length], ['mp4', AVC.codec, 0], '다 만든 파일을 버리지 않는다');
  assert.equal(recorders.length, 0);
  // 그리고 그 인코더를 "안 되는 것"으로 적어 두지 않는다: 다음에도 같은 길로 만든다
  encoders.length = 0;
  canPlay = () => true;
  const same = fakeFilm();
  same.width = film.width;
  assert.equal((await filmToVideo(same)).mime, AVC.codec);
  assert.equal(encoders.length, 1);
  // 디코더가 없는 브라우저에서는 묶은 파일을 틀어 보는 것으로 알아본다. 그것도 알 수 없으면 된다고 보고 간다.
  fresh();
  globalThis.VideoDecoder = undefined;
  canPlay = (blob) => blob.type !== 'video/mp4';
  const old = await filmToVideo(fakeFilm());
  assert.equal(old.ext, 'webm', '틀어 봐서 안 되는 것은 건너뛴다');
  fresh();
  globalThis.VideoDecoder = undefined;
  canPlay = () => null;
  assert.equal((await filmToVideo(fakeFilm())).ext, 'mp4');
});

test('만드는 길: 만들다 인코더가 실패하면 다음 길로 처음부터 다시 만들고(알린다), 그 길은 다시 써 보지 않는다', async () => {
  fresh();
  rule = { dieAt: 200 };           // 짧게는 되고, 길게 만들다가(첫 장을 지난 뒤에) 죽는다
  const film = fakeFilm();
  const retries = [];
  // H.264 가 죽고 → VP9 도 죽고 → VP8 도 죽으면 → 틀면서 녹화하는 길로(첫 장이 버려져 있어도 다시 준비해서).
  // 끝까지 만들다 죽은 H.264 는 다른 화질 설정으로 또 만들어 보지 않는다(같은 까닭으로 죽기 쉽고, 그때마다 오래 걸린다).
  const made = await filmToVideo(film, { onRetry: () => retries.push(1) });
  assert.equal(made.ext, 'webm');
  assert.equal(made.mime.startsWith('video/webm'), true, '녹화하는 길로 만들었다');
  assert.deepEqual(encoders.map((e) => e.config.codec.slice(0, 7)), ['avc1.64', 'avc1.64', 'vp09.00', 'vp09.00', 'vp8', 'vp8']);
  assert.equal(retries.length, 3, '다시 만들기 시작할 때마다 알린다');
  assert.equal(recorders.length, 1);
  assert.ok(film.most <= 2, `다시 만들 때 앞에서 남은 장을 버린다(한꺼번에 ${film.most} 장)`);
  // 같은 크기로 또 만들면: 안 됐던 인코더들은 건너뛰고 바로 녹화한다
  encoders.length = 0;
  recorders.length = 0;
  rule = {};
  const same = fakeFilm();
  same.width = film.width;
  const again = await filmToVideo(same);
  assert.deepEqual([again.ext, encoders.length, recorders.length], ['webm', 0, 1]);
});

test('만드는 길: 그림을 준비하지 못한 것은 길을 바꿔 다시 만들지 않는다(인코더를 탓하지 않는다)', async () => {
  fresh();
  const film = fakeFilm();
  const ready = film.ready;
  film.ready = async (n) => { if (n === 2) throw new Error('그림으로 바꾸지 못했어요'); return ready(n); };
  const retries = [];
  await assert.rejects(filmToVideo(film, { onRetry: () => retries.push(1) }), /그림으로 바꾸지 못했어요/);
  assert.deepEqual([encoders.length, retries.length, recorders.length], [2, 0, 0], '한 번 만들다 멈춘다');
  // 다음에 멀쩡한 그림으로 만들면 같은 길(H.264)로 만든다
  encoders.length = 0;
  const same = fakeFilm();
  same.width = film.width;
  assert.equal((await filmToVideo(same)).mime, AVC.codec);
});

test('만드는 길: 다 만든 파일이 틀어지지 않는 것이 분명하면 다음 길로 넘어간다. 그만두면 다시 만들지 않는다', async () => {
  fresh();
  canPlay = (blob) => blob.type !== 'video/mp4';        // 조각은 풀리는데, 묶은 MP4 가 틀어지지 않는다
  const retries = [];
  const made = await filmToVideo(fakeFilm(), { onRetry: () => retries.push(1) });
  assert.deepEqual([made.ext, made.mime, retries.length], ['webm', 'vp09.00.40.08', 1]);
  fresh();
  rule = { dieAt: 50 };
  const stop = new AbortController();
  let calls = 0;
  const gone = await filmToVideo(fakeFilm(), { signal: stop.signal, onProgress: () => { calls += 1; if (calls === 2) stop.abort(); } });
  assert.equal(gone, null);
  assert.equal(recorders.length, 0);
  assert.ok(encoders.every((e) => e.state === 'closed'));
});

test('만드는 길: 인코더도 녹화기도 다 안 되면 실패한다', async () => {
  fresh();
  rule = { supported: () => false };
  const keep = globalThis.HTMLCanvasElement;
  globalThis.HTMLCanvasElement = class {};
  await assert.rejects(filmToVideo(fakeFilm()), /영상으로 만들 수 없어요/);
  globalThis.HTMLCanvasElement = keep;
});
