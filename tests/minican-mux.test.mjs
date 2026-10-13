// 미니캔의 영상 파일 묶기(mux.js): 인코딩한 조각들을 MP4 · WebM 파일로 싸는 일. 만든 파일을 다시 읽어, 표와 자리가 맞는지 본다.
// (진짜 H.264 · VP8 · VP9 · AAC · Opus 조각을 넣어 재생기로 푸는 확인은 ffmpeg 이 있는 곳에서 따로 했다. 여기서는 파일의 짜임만 본다.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { muxMp4, muxWebm, mp4Parts, webmParts, opusHead } from '../src/mux.js';

const FPS = 30;
const SPAN = 1e6 / FPS;
// 가짜 조각: 속은 번호로 채운다(나중에 그 자리에 그 조각이 있는지 알아볼 수 있게).
const sample = (i, { size = 40 + (i % 7) * 13, key = i % 60 === 0, ts = Math.round(i * SPAN), dur = Math.round(SPAN) } = {}) => ({ data: new Uint8Array(size).fill((i % 250) + 1), key, ts, dur });
const samplesOf = (n, more) => Array.from({ length: n }, (_, i) => sample(i, more?.(i)));
const AVCC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, 0xee]);
const ascii = (b) => String.fromCharCode(...b);
// 머리말의 지문: [MP4 머리말의 길이, 지문, WebM 머리말의 길이, 지문] (맨 아래의 테스트가 쓴다)
const GOLDEN = [680, '8134ef47a3f9fbb9', 170, '10d38b092b4bc17f'];   // WebM: 만든 프로그램 이름을 'onbatang' 으로 바꾼 뒤 진짜 VP9 조각으로 ffmpeg 재생을 다시 확인함(2026-10-14)

// ---------- MP4 읽기 ----------
const KIDS = new Set(['moov', 'trak', 'mdia', 'minf', 'dinf', 'stbl']);
function boxes(bytes, from = 0, to = bytes.length) {
  const out = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  for (let at = from; at < to;) {
    const size = dv.getUint32(at);
    const type = ascii(bytes.subarray(at + 4, at + 8));
    assert.ok(size >= 8 && at + size <= to, `${type}: 크기 ${size} 가 맞지 않아요`);
    out.push({ type, at, size, body: bytes.subarray(at + 8, at + size), kids: KIDS.has(type) ? boxes(bytes, at + 8, at + size) : [] });
    at += size;
  }
  return out;
}
const find = (list, ...path) => path.reduce((cur, type) => { const hit = cur.kids.find((b) => b.type === type); assert.ok(hit, `${type} 가 없어요`); return hit; }, { kids: list });
const u32s = (body, from, n) => { const dv = new DataView(body.buffer, body.byteOffset); return Array.from({ length: n }, (_, i) => dv.getUint32(from + i * 4)); };

test('MP4: 머리말이 앞에 오고, 길이 · 크기 · 조각의 표가 넣은 것과 맞는다', () => {
  const samples = samplesOf(150);
  const file = muxMp4({ width: 1920, height: 1080, description: AVCC, samples });
  const top = boxes(file);
  assert.deepEqual(top.map((b) => b.type), ['ftyp', 'moov', 'mdat'], '머리말(moov)이 영상 데이터보다 앞에 있다');
  assert.equal(ascii(top[0].body.subarray(0, 4)), 'isom');
  // 길이: 파일 전체는 밀리초로, 트랙은 1/90000 초로. 150 장 ÷ 30 = 5초
  const mvhd = find(top, 'moov', 'mvhd').body;
  assert.deepEqual(u32s(mvhd, 12, 2), [1000, 5000]);
  const mdhd = find(top, 'moov', 'trak', 'mdia', 'mdhd').body;
  assert.deepEqual(u32s(mdhd, 12, 2), [90000, 450000]);
  const tkhd = find(top, 'moov', 'trak', 'tkhd').body;
  assert.equal(u32s(tkhd, 20, 1)[0], 5000, '트랙의 길이');
  assert.deepEqual(u32s(tkhd, tkhd.length - 8, 2), [1920 * 65536, 1080 * 65536]);
  assert.equal(ascii(find(top, 'moov', 'trak', 'mdia', 'hdlr').body.subarray(8, 12)), 'vide');
  // 코덱 설명: avc1 안에 인코더가 준 기록(avcC)이 그대로 들어 있다
  const stbl = find(top, 'moov', 'trak', 'mdia', 'minf', 'stbl');
  const stsd = find([stbl], 'stbl', 'stsd').body;
  assert.equal(ascii(stsd.subarray(12, 16)), 'avc1');
  const entry = stsd.subarray(16);
  assert.deepEqual([new DataView(entry.buffer, entry.byteOffset).getUint16(24), new DataView(entry.buffer, entry.byteOffset).getUint16(26)], [1920, 1080]);
  const avcc = entry.subarray(78);
  assert.equal(ascii(avcc.subarray(4, 8)), 'avcC');
  assert.deepEqual([...avcc.subarray(8)], [...AVCC]);
  // 조각마다의 길이: 고른 프레임이면 한 줄(150 장 × 3000)
  const stts = find([stbl], 'stbl', 'stts').body;
  assert.deepEqual(u32s(stts, 4, 3), [1, 150, 3000]);
  // 온전한 장면(건너뛰어 갈 수 있는 곳): 1 · 61 · 121 번째
  const stss = find([stbl], 'stbl', 'stss').body;
  assert.deepEqual(u32s(stss, 4, 4), [3, 1, 61, 121]);
  // 조각의 크기와 자리: 그 자리에 정말 그 조각이 있다
  const stsz = find([stbl], 'stbl', 'stsz').body;
  assert.deepEqual(u32s(stsz, 4, 2), [0, 150]);
  assert.deepEqual(u32s(stsz, 12, 150), samples.map((s) => s.data.length));
  const stco = find([stbl], 'stbl', 'stco').body;
  assert.equal(u32s(stco, 4, 1)[0], 150);
  const offsets = u32s(stco, 8, 150);
  offsets.forEach((at, i) => {
    assert.ok(at >= top[2].at + 8 && at + samples[i].data.length <= file.length, `조각 ${i} 의 자리`);
    assert.deepEqual([file[at], file[at + samples[i].data.length - 1]], [samples[i].data[0], samples[i].data[0]], `조각 ${i} 의 속`);
  });
  assert.deepEqual(u32s(find([stbl], 'stbl', 'stsc').body, 4, 4), [1, 1, 1, 1], '조각 하나가 한 덩어리');
  assert.equal(top[2].size, 8 + samples.reduce((n, s) => n + s.data.length, 0));
});

test('MP4: 때가 조금씩 어긋나 쌓이지 않고, 고르지 않은 길이도 그대로 적는다', () => {
  // 30 프레임의 때는 마이크로초로 33333 · 66667 … 처럼 딱 떨어지지 않는다. 1,800 장(1분)을 묶어도 길이는 정확히 60초다.
  const long = boxes(muxMp4({ width: 640, height: 360, description: AVCC, samples: samplesOf(1800, () => ({ size: 8 })) }));
  assert.deepEqual(u32s(find(long, 'moov', 'trak', 'mdia', 'mdhd').body, 12, 2), [90000, 5400000]);
  assert.deepEqual(u32s(find(long, 'moov', 'mvhd').body, 12, 2), [1000, 60000]);
  assert.deepEqual(u32s(find(long, 'moov', 'trak', 'mdia', 'minf', 'stbl', 'stts').body, 4, 3), [1, 1800, 3000]);
  // 길이가 다른 조각들: 다음 조각이 시작할 때까지가 그 조각의 길이다(마지막은 제 길이)
  // (인코더가 알려 준 길이가 다음 조각의 때와 맞지 않아도, 다음 조각의 때를 믿는다: 그래야 화면에 나오는 때가 어긋나지 않는다)
  const odd = [sample(0, { ts: 0, dur: 100000 }), sample(1, { ts: 100000, dur: 33333, key: false }), sample(2, { ts: 200000, dur: 1, key: false }), sample(3, { ts: 700000, dur: 50000, key: true })];
  const stts = find(boxes(muxMp4({ width: 640, height: 360, description: AVCC, samples: odd })), 'moov', 'trak', 'mdia', 'minf', 'stbl', 'stts').body;
  assert.deepEqual(u32s(stts, 4, 7), [3, 2, 9000, 1, 45000, 1, 4500]);
});

test('MP4 · WebM: 묶을 수 없는 조각은 받지 않는다', () => {
  const ok = samplesOf(3);
  for (const mux of [(samples) => muxMp4({ width: 640, height: 360, description: AVCC, samples }), (samples) => muxWebm({ codec: 'vp9', width: 640, height: 360, samples })]) {
    assert.throws(() => mux([]), /조각이 없어요/);
    assert.throws(() => mux(null), /조각이 없어요/);
    assert.throws(() => mux([sample(0, { key: false }), sample(1)]), /첫 조각/);
    assert.throws(() => mux([ok[0], ok[2], ok[1]]), /차례/);
    assert.throws(() => mux([ok[0], { ...ok[1], ts: ok[0].ts }]), /차례/);
    assert.throws(() => mux([ok[0], { ...ok[1], data: new Uint8Array(0) }]), /빈 영상 조각/);
    assert.throws(() => mux([ok[0], { ...ok[1], dur: 0 }]), /때가 이상/);
    assert.doesNotThrow(() => mux(ok));
  }
  assert.throws(() => muxMp4({ width: 640, height: 360, description: null, samples: ok }), /avcC/);
  assert.throws(() => muxMp4({ width: 640, height: 360, description: new Uint8Array(20), samples: ok }), /avcC/);
  assert.throws(() => muxWebm({ codec: 'av1', width: 640, height: 360, samples: ok }), /코덱/);
});

// ---------- WebM 읽기 ----------
const MASTERS = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0xe1, 0x1f43b675, 0x1c53bb6b, 0xbb, 0xb7]);
function ebml(bytes, from = 0, to = bytes.length) {
  const out = [];
  for (let at = from; at < to;) {
    let idLen = 1;
    while (!(bytes[at] & (0x80 >> (idLen - 1)))) idLen += 1;
    let id = 0;
    for (let i = 0; i < idLen; i++) id = id * 256 + bytes[at + i];
    let p = at + idLen;
    let sizeLen = 1;
    while (!(bytes[p] & (0x80 >> (sizeLen - 1)))) sizeLen += 1;
    let size = bytes[p] & (0xff >> sizeLen);
    for (let i = 1; i < sizeLen; i++) size = size * 256 + bytes[p + i];
    p += sizeLen;
    assert.ok(p + size <= to, `0x${id.toString(16)}: 크기 ${size} 가 맞지 않아요`);
    out.push({ id, at, start: p, size, body: bytes.subarray(p, p + size), kids: MASTERS.has(id) ? ebml(bytes, p, p + size) : [] });
    at = p + size;
  }
  return out;
}
const num = (b) => b.reduce((n, v) => n * 256 + v, 0);
const kid = (node, id) => { const hit = node.kids.find((k) => k.id === id); assert.ok(hit, `0x${id.toString(16)} 가 없어요`); return hit; };
const kidsOf = (node, id) => node.kids.filter((k) => k.id === id);

test('WebM: 길이 · 코덱 · 크기가 머리말에 있고, 묶음(cluster)과 찾아가기 표가 조각들과 맞는다', () => {
  const samples = samplesOf(150);
  for (const [codec, name] of [['vp9', 'V_VP9'], ['vp8', 'V_VP8']]) {
    const file = muxWebm({ codec, width: 1280, height: 720, fps: 30, samples });
    const [head, segment] = ebml(file);
    assert.equal(head.id, 0x1a45dfa3);
    assert.equal(ascii(kid(head, 0x4282).body), 'webm');
    assert.equal(segment.id, 0x18538067);
    assert.equal(segment.start + segment.size, file.length, '조각 전체의 크기가 파일 끝과 맞는다');
    assert.deepEqual(segment.kids.map((k) => k.id.toString(16)), ['1549a966', '1654ae6b', '1c53bb6b', '1f43b675', '1f43b675', '1f43b675'], '정보 · 트랙 · 찾아가기 표 다음에 묶음들');
    const info = kid(segment, 0x1549a966);
    assert.equal(num(kid(info, 0x2ad7b1).body), 1000000, '때의 단위는 밀리초');
    assert.equal(new DataView(kid(info, 0x4489).body.buffer, kid(info, 0x4489).body.byteOffset).getFloat64(0), 5000, '길이 5초');
    const track = kid(kid(segment, 0x1654ae6b), 0xae);
    assert.equal(ascii(kid(track, 0x86).body), name);
    assert.equal(num(kid(track, 0x83).body), 1, '영상 트랙');
    assert.deepEqual([num(kid(kid(track, 0xe0), 0xb0).body), num(kid(kid(track, 0xe0), 0xba).body)], [1280, 720]);
    // 묶음: 온전한 장면에서 새로 연다(0 · 2 · 4초). 그 안의 조각은 묶음의 때에서 얼마나 지났는지로 적힌다.
    const clusters = kidsOf(segment, 0x1f43b675);
    assert.deepEqual(clusters.map((c) => num(kid(c, 0xe7).body)), [0, 2000, 4000]);
    assert.equal(num(kid(clusters[0], 0xe7).body) + ((kidsOf(clusters[0], 0xa3)[2].body[1] << 8) | kidsOf(clusters[0], 0xa3)[2].body[2]), 66, '셋째 프레임(66.667ms)은 66 으로 적힌다');
    let i = 0;
    for (const c of clusters) {
      const at = num(kid(c, 0xe7).body);
      for (const b of kidsOf(c, 0xa3)) {
        const rel = (b.body[1] << 8) | b.body[2];
        assert.equal(b.body[0], 0x81, '트랙 1');
        assert.equal(at + rel, Math.floor(samples[i].ts / 1000 + 1e-6), `조각 ${i} 의 때(밀리초로 내림: 진짜보다 늦게 적지 않는다)`);
        assert.equal(b.body[3], samples[i].key ? 0x80 : 0, `조각 ${i} 가 온전한 장면인지`);
        assert.deepEqual([b.body.length - 4, b.body[4]], [samples[i].data.length, samples[i].data[0]], `조각 ${i} 의 속`);
        i += 1;
      }
    }
    assert.equal(i, 150, '모든 조각이 담겼다');
    // 찾아가기 표: 적힌 자리(조각 전체의 속이 시작되는 곳에서 센다)에 정말 그 묶음이 있다
    const cues = kidsOf(kid(segment, 0x1c53bb6b), 0xbb);
    assert.deepEqual(cues.map((c) => num(kid(c, 0xb3).body)), [0, 2000, 4000]);
    cues.forEach((c, n) => {
      const pos = kid(c, 0xb7);
      assert.equal(num(kid(pos, 0xf7).body), 1);
      assert.equal(segment.start + num(kid(pos, 0xf1).body), clusters[n].at, `${n} 번째 묶음의 자리`);
    });
  }
});

test('WebM: 온전한 장면이 오래 없어도 묶음이 30초를 넘지 않는다(그 안의 때는 16비트로 적는다)', () => {
  const samples = samplesOf(2000, (i) => ({ key: i === 0, size: 6 }));          // 66초 동안 온전한 장면이 처음 한 번뿐
  const [, segment] = ebml(muxWebm({ codec: 'vp9', width: 640, height: 360, samples }));
  const clusters = kidsOf(segment, 0x1f43b675);
  assert.deepEqual(clusters.map((c) => num(kid(c, 0xe7).body)), [0, 30000, 60000]);
  // 찾아가기 표에는 온전한 장면으로 시작하는 묶음만 적는다(다른 곳으로는 건너뛸 수 없다)
  assert.deepEqual(kidsOf(kid(segment, 0x1c53bb6b), 0xbb).map((c) => num(kid(c, 0xb3).body)), [0]);
  for (const c of clusters) for (const b of kidsOf(c, 0xa3)) assert.ok(((b.body[1] << 8) | b.body[2]) < 30000);
  assert.equal(clusters.reduce((n, c) => n + kidsOf(c, 0xa3).length, 0), 2000);
});

test('색을 읽는 법: 인코더가 알려 준 것을 파일에 적는다(적지 않으면 재생기가 짐작해서 색이 달라질 수 있다)', () => {
  const samples = samplesOf(4);
  const bt601 = { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false };
  // WebM: Video 안의 Colour(행렬 · 범위 · 전달 · 원색)
  const colourOf = (file) => { const [, segment] = ebml(file); const video = kid(kid(kid(segment, 0x1654ae6b), 0xae), 0xe0); return video.kids.find((k) => k.id === 0x55b0); };
  const c = colourOf(muxWebm({ codec: 'vp8', width: 640, height: 360, samples, color: bt601 }));
  assert.ok(c, 'Colour 가 있다');
  const field = (id) => { const at = c.body.findIndex((v, i) => v === (id >> 8) && c.body[i + 1] === (id & 0xff)); return c.body[at + 3]; };
  assert.deepEqual([field(0x55b1), field(0x55b9), field(0x55ba), field(0x55bb)], [6, 1, 6, 6], 'BT.601 · 좁은 범위');
  const full = colourOf(muxWebm({ codec: 'vp9', width: 640, height: 360, samples, color: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: true } }));
  const fullField = (id) => { const at = full.body.findIndex((v, i) => v === (id >> 8) && full.body[i + 1] === (id & 0xff)); return full.body[at + 3]; };
  assert.deepEqual([fullField(0x55b1), fullField(0x55b9), fullField(0x55ba), fullField(0x55bb)], [1, 2, 13, 1]);
  // 모르거나 없는 값이면 적지 않는다(틀리게 적느니 비워 둔다)
  assert.equal(colourOf(muxWebm({ codec: 'vp8', width: 640, height: 360, samples })), undefined);
  assert.equal(colourOf(muxWebm({ codec: 'vp8', width: 640, height: 360, samples, color: { primaries: 'bt709', transfer: '?', matrix: 'bt709' } })), undefined);
  // MP4: avc1 안의 colr(nclx)
  const colrOf = (file) => {
    const stsd = find(boxes(file), 'moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd').body;
    const inside = boxes(stsd, 16 + 78, stsd.length);      // 조각 설명의 정해진 칸(78바이트) 다음부터
    return [inside.map((b) => b.type), inside.find((b) => b.type === 'colr')?.body];
  };
  const [types, colr] = colrOf(muxMp4({ width: 640, height: 360, description: AVCC, samples, color: bt601 }));
  assert.deepEqual(types, ['avcC', 'colr']);
  assert.deepEqual([...colr], [...'nclx'].map((ch) => ch.charCodeAt(0)).concat([0, 6, 0, 6, 0, 6, 0]));
  assert.deepEqual(colrOf(muxMp4({ width: 640, height: 360, description: AVCC, samples }))[0], ['avcC']);
});

test('덩어리로 돌려주기: 조각의 속을 베끼지 않고, 이어 붙이면 같은 파일이다. 조각이 아주 많아도 된다', () => {
  const samples = samplesOf(90);
  for (const [parts, whole] of [
    [mp4Parts({ width: 640, height: 360, description: AVCC, samples }), muxMp4({ width: 640, height: 360, description: AVCC, samples })],
    [webmParts({ codec: 'vp9', width: 640, height: 360, samples }), muxWebm({ codec: 'vp9', width: 640, height: 360, samples })],
  ]) {
    assert.deepEqual(Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length))), Buffer.from(whole));
    for (const s of samples) assert.ok(parts.includes(s.data), '조각의 속은 받은 그대로(같은 것)다');
  }
  // 1시간이 넘는 영상(12만 장)도 묶는다: 표를 한꺼번에 적는다(조각 하나하나를 인자로 넘기지 않는다)
  const many = samplesOf(120000, () => ({ size: 1 }));
  assert.equal(boxes(muxMp4({ width: 640, height: 360, description: AVCC, samples: many })).length, 3);
  assert.ok(muxWebm({ codec: 'vp9', width: 640, height: 360, samples: many }).length > 120000 * 5);
});

test('머리말의 바이트가 바뀌지 않았다(재생기가 읽는 틀은 진짜 인코더의 조각으로 ffmpeg 와 견줘 확인해 둔 것이다)', () => {
  // 조각 표와 자리 값까지 포함한, 영상 데이터 앞의 모든 바이트. 일부러 고쳤다면 진짜 조각으로 다시 확인하고 이 값을 바꾼다.
  const samples = samplesOf(4, (i) => ({ size: 10 + i }));
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const mp4 = mp4Parts({ width: 1920, height: 1080, description: AVCC, samples })[0];
  const webm = webmParts({ codec: 'vp9', width: 1920, height: 1080, fps: 30, samples })[0];
  assert.deepEqual([mp4.length, sha(mp4), webm.length, sha(webm)], GOLDEN);
});

// ---------- 소리를 함께 담기 ----------
// 가짜 소리 조각: 0.02초짜리(Opus 가 내는 길이). 속은 그림 조각과 겹치지 않는 값으로 채운다.
const tone = (i, { size = 30 + (i % 5), dur = 20000 } = {}) => ({ data: new Uint8Array(size).fill(0xd0 + (i % 32)), ts: i * dur, dur });
const soundOf = (n, more = {}) => ({ codec: 'opus', rate: 48000, channels: 2, description: null, samples: Array.from({ length: n }, (_, i) => tone(i)), ...more });
const ASC = Uint8Array.from([0x11, 0x90]);        // AAC 의 설정 기록(AAC-LC · 48000 · 2채널)

test('MP4 + 소리: 트랙이 둘이고, 소리 조각의 표와 자리가 맞고, 그림 조각과 때의 차례대로 섞여 있다', () => {
  const samples = samplesOf(150);
  const audio = soundOf(250);                       // 5초
  const file = muxMp4({ width: 1280, height: 720, description: AVCC, samples, audio });
  const top = boxes(file);
  assert.deepEqual(top.map((b) => b.type), ['ftyp', 'moov', 'mdat']);
  const moov = top[1];
  const traks = moov.kids.filter((b) => b.type === 'trak');
  assert.equal(traks.length, 2);
  assert.deepEqual(traks.map((t) => ascii(find([t], 'trak', 'mdia', 'hdlr').body.subarray(8, 12))), ['vide', 'soun']);
  assert.equal(u32s(find([moov], 'moov', 'mvhd').body, find([moov], 'moov', 'mvhd').body.length - 4, 1)[0], 3, '다음 트랙 번호');
  const [, snd] = traks;
  assert.equal(u32s(find([snd], 'trak', 'tkhd').body, 12, 1)[0], 2, '소리는 트랙 2');
  // 시간 단위는 1초의 표본 수: 250 조각 × 960 표본 = 5초
  assert.deepEqual(u32s(find([snd], 'trak', 'mdia', 'mdhd').body, 12, 2), [48000, 240000]);
  assert.ok(find([snd], 'trak', 'mdia', 'minf').kids.some((b) => b.type === 'smhd'), '소리 트랙의 머리(smhd)');
  const stbl = find([snd], 'trak', 'mdia', 'minf', 'stbl');
  assert.deepEqual(u32s(find([stbl], 'stbl', 'stts').body, 4, 3), [1, 250, 960]);
  assert.ok(!stbl.kids.some((b) => b.type === 'stss'), '소리 조각은 모두 그 자체로 풀린다(표가 없다)');
  assert.deepEqual(u32s(find([stbl], 'stbl', 'stsz').body, 12, 250), audio.samples.map((x) => x.data.length));
  // Opus: 'Opus' 칸 안에 dOps(채널 수 · 맨 앞에서 버릴 표본 수 · 표본 수)가 있다
  const stsd = find([stbl], 'stbl', 'stsd').body;
  assert.equal(ascii(stsd.subarray(12, 16)), 'Opus');
  const entry = stsd.subarray(16);
  const dv = new DataView(entry.buffer, entry.byteOffset);
  assert.deepEqual([dv.getUint16(16), dv.getUint16(18), dv.getUint32(24)], [2, 16, 48000 * 65536], '채널 수 · 비트 수 · 표본 수');
  assert.equal(ascii(entry.subarray(32, 36)), 'dOps');
  assert.deepEqual([entry[36], entry[37], dv.getUint16(38), dv.getUint32(40)], [0, 2, 312, 48000]);
  // 조각의 자리: 그림 · 소리 모두 적힌 자리에 정말 그 조각이 있고, 파일 안에서 때의 차례대로 놓여 있다
  const places = (trak, list) => u32s(find([trak], 'trak', 'mdia', 'minf', 'stbl', 'stco').body, 8, list.length);
  const at = [...places(traks[0], samples).map((pos, i) => ({ pos, s: samples[i], sound: false })), ...places(snd, audio.samples).map((pos, i) => ({ pos, s: audio.samples[i], sound: true }))];
  for (const e of at) assert.deepEqual([file[e.pos], file[e.pos + e.s.data.length - 1]], [e.s.data[0], e.s.data[0]]);
  at.sort((a, b) => a.pos - b.pos);
  assert.equal(at[0].pos, top[2].at + 8);
  at.forEach((e, i) => {
    if (!i) return;
    assert.equal(e.pos, at[i - 1].pos + at[i - 1].s.data.length, '빈틈없이 이어진다');
    assert.ok(e.s.ts >= at[i - 1].s.ts, '때의 차례');
  });
  assert.equal(at[0].sound, false, '같은 때면 그림이 먼저');
  assert.equal(top[2].size, 8 + [...samples, ...audio.samples].reduce((n, x) => n + x.data.length, 0));
});

test('MP4 + 소리: AAC 는 mp4a 칸에 설정 기록(esds)과 함께 담고, 소리가 더 길면 파일의 길이도 그만큼이다', () => {
  const samples = samplesOf(30);                    // 1초
  // AAC 한 조각은 1024 표본(약 21.333ms): 94 조각 ≈ 2.005초
  const audio = { codec: 'aac', rate: 48000, channels: 2, description: ASC, samples: Array.from({ length: 94 }, (_, i) => ({ data: new Uint8Array(20 + (i % 3)).fill(0xd0), ts: Math.round((i * 1024 * 1e6) / 48000), dur: Math.round((1024 * 1e6) / 48000) })) };
  const file = muxMp4({ width: 640, height: 360, description: AVCC, samples, audio });
  const moov = boxes(file)[1];
  const snd = moov.kids.filter((b) => b.type === 'trak')[1];
  const stbl = find([snd], 'trak', 'mdia', 'minf', 'stbl');
  const stsd = find([stbl], 'stbl', 'stsd').body;
  assert.equal(ascii(stsd.subarray(12, 16)), 'mp4a');
  const entry = stsd.subarray(16);
  assert.equal(ascii(entry.subarray(32, 36)), 'esds');
  // 꼬리표들: 0x03(ES) > 0x04(디코더 설정: 0x40 = AAC) > 0x05(설정 기록 그대로)
  const esds = entry.subarray(40);
  assert.equal(esds[0], 0x03);
  const dcd = esds.indexOf(0x04, 2);
  assert.deepEqual([esds[dcd + 2], esds[dcd + 3]], [0x40, 0x15]);
  const dsi = esds.indexOf(0x05, dcd + 15);
  assert.deepEqual([...esds.subarray(dsi, dsi + 4)], [0x05, 2, ...ASC]);
  // 때가 딱 떨어지지 않아도(21.333ms) 표본 수로는 딱 1024 씩이다: 조금씩 어긋나 쌓이지 않는다
  assert.deepEqual(u32s(find([stbl], 'stbl', 'stts').body, 4, 3), [1, 94, 1024]);
  assert.deepEqual(u32s(find([snd], 'trak', 'mdia', 'mdhd').body, 12, 2), [48000, 94 * 1024]);
  // 파일의 길이: 그림(1초)보다 긴 소리(2.005초)를 따른다
  assert.deepEqual(u32s(find([moov], 'moov', 'mvhd').body, 12, 2), [1000, Math.round((94 * 1024 * 1000) / 48000)]);
});

test('WebM + 소리: Opus 트랙이 더해지고, 소리 조각이 제때의 묶음에 그림 조각과 섞여 들어간다', () => {
  const samples = samplesOf(150);
  const audio = soundOf(250);
  const file = muxWebm({ codec: 'vp9', width: 1280, height: 720, fps: 30, samples, audio });
  const [, segment] = ebml(file);
  assert.equal(segment.start + segment.size, file.length);
  const tracks = kidsOf(kid(segment, 0x1654ae6b), 0xae);
  assert.equal(tracks.length, 2);
  const snd = tracks[1];
  assert.deepEqual([num(kid(snd, 0xd7).body), num(kid(snd, 0x83).body), ascii(kid(snd, 0x86).body)], [2, 2, 'A_OPUS']);
  assert.deepEqual([...kid(snd, 0x63a2).body], [...opusHead({ channels: 2, preskip: 312, rate: 48000 })], '설정 기록(OpusHead)');
  assert.equal(num(kid(snd, 0x56aa).body), 6500000, '맨 앞에서 버릴 만큼(312 표본 = 6.5ms)을 나노초로');
  assert.equal(num(kid(snd, 0x56bb).body), 80000000);
  const sound = kid(snd, 0xe1);
  assert.equal(new DataView(kid(sound, 0xb5).body.buffer, kid(sound, 0xb5).body.byteOffset).getFloat64(0), 48000);
  assert.equal(num(kid(sound, 0x9f).body), 2);
  // 묶음은 그림의 온전한 장면에서 연다(소리 때문에 더 잘게 나뉘지 않는다)
  const clusters = kidsOf(segment, 0x1f43b675);
  assert.deepEqual(clusters.map((c) => num(kid(c, 0xe7).body)), [0, 2000, 4000]);
  let v = 0;
  let a = 0;
  let before = -1;
  for (const c of clusters) {
    const at = num(kid(c, 0xe7).body);
    for (const b of kidsOf(c, 0xa3)) {
      const when = at + ((b.body[1] << 8) | b.body[2]);
      assert.ok(when >= before, '때의 차례대로');
      before = when;
      if (b.body[0] === 0x82) {
        assert.equal(b.body[3], 0x80, '소리 조각은 모두 그 자체로 풀린다');
        assert.deepEqual([when, b.body.length - 4, b.body[4]], [a * 20, audio.samples[a].data.length, audio.samples[a].data[0]], `소리 조각 ${a}`);
        a += 1;
      } else {
        assert.equal(b.body[0], 0x81);
        assert.deepEqual([b.body.length - 4, b.body[4]], [samples[v].data.length, samples[v].data[0]], `그림 조각 ${v}`);
        v += 1;
      }
    }
  }
  assert.deepEqual([v, a], [150, 250], '모든 조각이 담겼다');
  // 찾아가기 표는 그림 트랙의 것이다
  for (const c of kidsOf(kid(segment, 0x1c53bb6b), 0xbb)) assert.equal(num(kid(kid(c, 0xb7), 0xf7).body), 1);
  // 소리가 그림보다 길면 길이도 그만큼이다
  const long = muxWebm({ codec: 'vp8', width: 640, height: 360, samples: samplesOf(30), audio: soundOf(100) });
  const info = kid(ebml(long)[1], 0x1549a966);
  assert.equal(new DataView(kid(info, 0x4489).body.buffer, kid(info, 0x4489).body.byteOffset).getFloat64(0), 2000);
});

test('소리: 인코더가 준 설정 기록(OpusHead)은 그대로 쓰고, 담을 수 없는 소리는 받지 않는다', () => {
  const samples = samplesOf(30);
  const head = opusHead({ channels: 2, preskip: 3840, rate: 48000 });
  assert.equal(head.length, 19);
  assert.equal(ascii(head.subarray(0, 8)), 'OpusHead');
  assert.deepEqual([head[8], head[9], head[10] | (head[11] << 8)], [1, 2, 3840]);
  const webm = muxWebm({ codec: 'vp9', width: 640, height: 360, samples, audio: soundOf(50, { description: head }) });
  const snd = kidsOf(kid(ebml(webm)[1], 0x1654ae6b), 0xae)[1];
  assert.deepEqual([...kid(snd, 0x63a2).body], [...head]);
  assert.equal(num(kid(snd, 0x56aa).body), 80000000, '3840 표본 = 80ms');
  const mp4 = muxMp4({ width: 640, height: 360, description: AVCC, samples, audio: soundOf(50, { description: head }) });
  const entry = find(boxes(mp4), 'moov').kids.filter((b) => b.type === 'trak')[1];
  const stsd = find([entry], 'trak', 'mdia', 'minf', 'stbl', 'stsd').body.subarray(16);
  assert.equal(new DataView(stsd.buffer, stsd.byteOffset).getUint16(38), 3840);
  // 받지 않는 것들
  const ok = soundOf(5);
  const both = [(audio) => muxMp4({ width: 640, height: 360, description: AVCC, samples, audio }), (audio) => muxWebm({ codec: 'vp9', width: 640, height: 360, samples, audio })];
  for (const mux of both) {
    assert.doesNotThrow(() => mux(ok));
    assert.throws(() => mux({ ...ok, codec: 'mp3' }), /담을 수 없는 소리/);
    assert.throws(() => mux({ ...ok, samples: [] }), /소리 조각이 없어요/);
    assert.throws(() => mux({ ...ok, samples: [ok.samples[1], ok.samples[0]] }), /차례/);
    assert.throws(() => mux({ ...ok, samples: [{ ...ok.samples[0], data: new Uint8Array(0) }] }), /빈 소리 조각/);
    assert.throws(() => mux({ ...ok, samples: [{ ...ok.samples[0], dur: 0 }] }), /때가 이상/);
    assert.throws(() => mux({ ...ok, rate: 0 }), /설정이 이상/);
    assert.throws(() => mux({ ...ok, channels: 6 }), /설정이 이상/);
  }
  assert.throws(() => both[1]({ codec: 'aac', rate: 48000, channels: 2, description: ASC, samples: ok.samples }), /담을 수 없는 소리/, 'WebM 에는 Opus 만');
  assert.throws(() => both[0]({ codec: 'aac', rate: 48000, channels: 2, description: null, samples: ok.samples }), /AAC 설정 기록/);
  // 소리를 주지 않으면 예전과 한 바이트도 다르지 않다(맨 아래의 지문 테스트가 지킨다) · null 도 같다
  assert.deepEqual(muxMp4({ width: 640, height: 360, description: AVCC, samples, audio: null }), muxMp4({ width: 640, height: 360, description: AVCC, samples }));
});
