// 인코딩한 영상 조각(프레임)들을 파일 하나로 묶는다: MP4(H.264) 와 WebM(VP8 · VP9). 바이트만 다루는 순수 함수다(node 에서 테스트한다).
//
// video.js 가 프레임을 한 장씩 그려 브라우저의 인코더(VideoEncoder)에 넣으면 조각들이 나온다. 그것을 재생기가 읽을 수 있는 파일로 싸는 일만 한다.
// 파일을 다 만든 뒤에 한꺼번에 쓰므로 길이 · 찾아가기 표가 머리말에 온전히 들어간다(브라우저가 녹화하며 흘려 쓴 파일에는 이것이 없어
// 재생기에 따라 길이가 안 보이거나 건너뛰기가 안 된다).
//
// 조각(sample): { data(Uint8Array), key(그 자체로 그릴 수 있는 장면인지), ts(시작하는 때. 마이크로초), dur(길이. 마이크로초) }
// 조각은 보이는 차례대로여야 한다(뒤의 장면을 먼저 담는 인코더 설정은 쓰지 않는다).
//
// 묶는 함수는 둘씩 있다: mp4Parts · webmParts 는 파일을 이루는 바이트 덩어리들의 목록을 돌려준다(조각의 속은 베끼지 않고 그대로 끼워 넣는다.
// new Blob(parts) 로 파일을 만들면 긴 영상도 메모리를 두 배로 쓰지 않는다). muxMp4 · muxWebm 은 그것을 하나로 이어 붙인 것이다.
//
// 소리도 함께 담을 수 있다(audio. 없으면 예전처럼 그림만 담는다):
//   audio = { codec: 'aac' | 'opus', rate(1초의 표본 수), channels, description(설정 기록: AAC 의 AudioSpecificConfig · Opus 의 OpusHead), samples: [{ data, ts, dur }] }
//   MP4 에는 AAC(어디서나 열린다)나 Opus 를, WebM 에는 Opus 를 담는다. 파일 안에서는 그림 조각과 소리 조각을 때의 차례대로 섞어 둔다.

const text = (s) => Uint8Array.from(String(s), (c) => c.charCodeAt(0) & 0xff);
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const u8 = (...v) => Uint8Array.from(v);
const u16 = (v) => u8((v >>> 8) & 0xff, v & 0xff);
const u32 = (v) => u8((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
const zeros = (n) => new Uint8Array(n);
// 32비트 수 여럿을 한 덩어리로(조각이 수만 개여도 한 번에 적는다)
function u32s(values) {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v));
  return out;
}
const total = (samples) => samples.reduce((n, s) => n + s.data.length, 0);

// 조각들이 묶을 수 있는 모양인지 본다(아니면 던진다): 하나 이상, 첫 조각은 그 자체로 그릴 수 있어야 하고, 때는 늘어나기만 한다.
function check(samples) {
  if (!Array.isArray(samples) || !samples.length) throw new Error('묶을 영상 조각이 없어요');
  if (!samples[0].key) throw new Error('첫 조각이 온전한 장면이 아니에요');
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!(s.data instanceof Uint8Array) || !s.data.length) throw new Error('빈 영상 조각이 있어요');
    if (!Number.isFinite(s.ts) || !Number.isFinite(s.dur) || s.dur <= 0) throw new Error('영상 조각의 때가 이상해요');
    if (i && s.ts <= samples[i - 1].ts) throw new Error('영상 조각의 차례가 뒤섞였어요');
  }
}

// 소리(audio)가 묶을 수 있는 모양인지 본다(아니면 던진다). 설정 기록을 정리해 돌려준다.
const OPUS_MAGIC = text('OpusHead');
/** Opus 의 설정 기록(OpusHead). 인코더가 주지 않았을 때 만들어 쓴다. preskip: 풀 때 맨 앞에서 버릴 표본 수. */
export function opusHead({ channels = 2, preskip = 312, rate = 48000 } = {}) {
  return concat([OPUS_MAGIC, u8(1, channels, preskip & 0xff, (preskip >> 8) & 0xff, rate & 0xff, (rate >> 8) & 0xff, (rate >> 16) & 0xff, (rate >>> 24) & 0xff, 0, 0, 0)]);
}
function checkSound(audio, allowed) {
  const a = audio && typeof audio === 'object' ? audio : {};
  if (!allowed.includes(a.codec)) throw new Error('이 파일에 담을 수 없는 소리예요');
  if (!Array.isArray(a.samples) || !a.samples.length) throw new Error('묶을 소리 조각이 없어요');
  if (!(a.rate > 0) || !(a.channels >= 1 && a.channels <= 2)) throw new Error('소리의 설정이 이상해요');
  for (let i = 0; i < a.samples.length; i++) {
    const s = a.samples[i];
    if (!(s.data instanceof Uint8Array) || !s.data.length) throw new Error('빈 소리 조각이 있어요');
    if (!Number.isFinite(s.ts) || !Number.isFinite(s.dur) || s.dur <= 0) throw new Error('소리 조각의 때가 이상해요');
    if (i && s.ts <= a.samples[i - 1].ts) throw new Error('소리 조각의 차례가 뒤섞였어요');
  }
  let description = a.description instanceof Uint8Array ? a.description : null;
  if (a.codec === 'opus') {
    const ok = description && description.length >= 19 && OPUS_MAGIC.every((v, i) => description[i] === v);
    if (!ok) description = opusHead({ channels: a.channels, rate: a.rate });
  } else if (!description || description.length < 2 || description.length > 64) throw new Error('AAC 설정 기록이 없어요');
  return { codec: a.codec, rate: Math.round(a.rate), channels: a.channels, description, samples: a.samples, preskip: a.codec === 'opus' ? description[10] | (description[11] << 8) : 0 };
}
// 그림 조각과 소리 조각을 때의 차례대로 섞는다(같은 때면 그림이 먼저). [{ s(조각), sound(소리인지) }]
function interleave(video, sound) {
  const out = [];
  let v = 0;
  let a = 0;
  while (v < video.length || a < sound.length) {
    if (a >= sound.length || (v < video.length && video[v].ts <= sound[a].ts)) out.push({ s: video[v++], sound: false });
    else out.push({ s: sound[a++], sound: true });
  }
  return out;
}

// 색을 어떻게 읽을지(인코더가 알려 준 것: VideoEncoder 의 decoderConfig.colorSpace)를 파일에 적는 번호로 바꾼다. 모르는 값이 있으면 null(적지 않는다).
// 적어 두지 않으면 재생기가 짐작으로 읽어서, 색이 조금 다르게 나올 수 있다(특히 색 정보를 제 안에 담지 못하는 VP8).
const PRIMARIES = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
const TRANSFER = { bt709: 1, smpte170m: 6, linear: 8, 'iec61966-2-1': 13, pq: 16, hlg: 18 };
const MATRIX_CODE = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 };
function colorCodes(color) {
  const primaries = PRIMARIES[color?.primaries];
  const transfer = TRANSFER[color?.transfer];
  const matrix = MATRIX_CODE[color?.matrix];
  if (primaries == null || transfer == null || matrix == null) return null;
  return { primaries, transfer, matrix, full: color.fullRange === true };
}

// ---------- MP4 ----------

const MP4_SCALE = 90000;        // 영상 트랙의 시간 단위(1초를 이만큼으로 나눈다. 30 · 60 프레임이 정수로 떨어진다)
const MOVIE_SCALE = 1000;       // 파일 전체의 시간 단위(밀리초)
const MATRIX = concat([u32(0x00010000), zeros(12), u32(0x00010000), zeros(12), u32(0x40000000)]);     // 돌리거나 늘이지 않는다

const box = (type, ...parts) => { const body = concat(parts); return concat([u32(body.length + 8), text(type), body]); };
const fullBox = (type, version, flags, ...parts) => box(type, u8(version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff), ...parts);

/**
 * H.264 조각들을 MP4 파일로 묶는다. 머리말(moov)이 앞에 와서, 내려받는 중에도 바로 틀 수 있다.
 * - width · height: 그림의 크기(px)
 * - description: 인코더가 알려 준 설정 기록(avcC 의 속. VideoEncoder 의 decoderConfig.description)
 * - samples: 조각들(길이 붙은 NAL 묶음. VideoEncoder 를 avc: { format: 'avc' } 로 쓰면 이 모양으로 나온다)
 * - color: 색을 읽는 법 { primaries, transfer, matrix, fullRange }(없어도 된다. 인코더가 알려 준 것을 그대로 준다)
 * - audio: 함께 담을 소리(없어도 된다. 맨 위의 설명). AAC 나 Opus.
 * 돌려주는 것: 파일을 이루는 덩어리들 [Uint8Array …](차례대로 이으면 파일이다)
 */
export function mp4Parts({ width, height, description, samples, color = null, audio = null }) {
  check(samples);
  if (!(description instanceof Uint8Array) || description.length < 7 || description[0] !== 1) throw new Error('H.264 설정 기록(avcC)이 없어요');
  const sound = audio ? checkSound(audio, ['aac', 'opus']) : null;
  const ticks = (us) => Math.round((us * MP4_SCALE) / 1e6);
  // 조각마다의 길이: 다음 조각이 시작할 때까지(마지막은 제 길이). 이렇게 해야 때가 조금씩 어긋나 쌓이지 않는다.
  const spans = samples.map((s, i) => Math.max(1, i + 1 < samples.length ? ticks(samples[i + 1].ts) - ticks(s.ts) : ticks(s.dur)));
  const length = spans.reduce((a, b) => a + b, 0);
  const movieLength = Math.round((length * MOVIE_SCALE) / MP4_SCALE);
  // stts: 길이가 같은 조각들을 묶어 적는다(고른 프레임이면 한 줄이다)
  const runs = [];
  for (const d of spans) { if (runs.length && runs.at(-1)[1] === d) runs.at(-1)[0] += 1; else runs.push([1, d]); }
  const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
  const codes = colorCodes(color);

  const stsd = fullBox('stsd', 0, 0, u32(1), box('avc1',
    zeros(6), u16(1),                                   // 자리 채움 · 데이터 참조 번호
    zeros(16), u16(width), u16(height),
    u32(0x00480000), u32(0x00480000),                   // 72dpi
    zeros(4), u16(1),                                   // 조각 하나에 그림 한 장
    zeros(32),                                          // 인코더 이름(비움)
    u16(0x0018), u16(0xffff),                           // 색 깊이 24 · 색 표 없음
    box('avcC', description),
    ...(codes ? [box('colr', text('nclx'), u16(codes.primaries), u16(codes.transfer), u16(codes.matrix), u8(codes.full ? 0x80 : 0))] : [])));
  // 파일의 본문(mdat)에는 그림 조각과 소리 조각이 때의 차례대로 섞여 놓인다. 조각 하나가 한 덩어리(chunk)다:
  // 표가 가장 단순하고, 어느 조각이든 바로 찾아간다.
  const order = sound ? interleave(samples, sound.samples) : samples.map((s) => ({ s, sound: false }));
  const bytes = total(samples) + (sound ? total(sound.samples) : 0);
  const places = (firstOffset, wantSound) => {
    const offsets = [];
    let at = firstOffset;
    for (const e of order) { if (e.sound === wantSound) offsets.push(at); at += e.s.data.length; }
    return fullBox('stco', 0, 0, u32(offsets.length), u32s(offsets));
  };
  const tables = (firstOffset) => box('stbl', stsd,
    fullBox('stts', 0, 0, u32(runs.length), u32s(runs.flat())),
    fullBox('stss', 0, 0, u32(keys.length), u32s(keys)),
    fullBox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
    fullBox('stsz', 0, 0, u32(0), u32(samples.length), u32s(samples.map((s) => s.data.length))),
    places(firstOffset, false));
  // 소리 트랙: 시간 단위는 1초의 표본 수(조각의 길이가 표본 수로 딱 떨어진다).
  const soundTicks = (us) => Math.round((us * sound.rate) / 1e6);
  const soundSpans = sound ? sound.samples.map((s, i) => Math.max(1, i + 1 < sound.samples.length ? soundTicks(sound.samples[i + 1].ts) - soundTicks(s.ts) : soundTicks(s.dur))) : [];
  const soundLength = soundSpans.reduce((a, b) => a + b, 0);
  const soundRuns = [];
  for (const d of soundSpans) { if (soundRuns.length && soundRuns.at(-1)[1] === d) soundRuns.at(-1)[0] += 1; else soundRuns.push([1, d]); }
  const soundMovieLength = sound ? Math.round((soundLength * MOVIE_SCALE) / sound.rate) : 0;
  const wholeLength = Math.max(movieLength, soundMovieLength);
  const soundEntry = () => {
    // 꼬리표(descriptor): [이름표 · 길이 · 속]. 길이는 한 바이트로 적는다(설정 기록이 아주 짧다).
    const tag = (id, ...parts) => { const body = concat(parts); return concat([u8(id, body.length), body]); };
    const rate = sound.samples.reduce((n, x) => n + x.data.length, 0) * 8 / Math.max(0.001, soundLength / sound.rate);
    const config = sound.codec === 'aac'
      ? fullBox('esds', 0, 0, tag(0x03, u16(2), u8(0),
        tag(0x04, u8(0x40, 0x15), zeros(3), u32(Math.round(rate)), u32(Math.round(rate)), tag(0x05, sound.description)),
        tag(0x06, u8(2))))
      : box('dOps', u8(0, sound.channels), u16(sound.preskip), u32(sound.rate), u16(0), u8(0));
    return box(sound.codec === 'aac' ? 'mp4a' : 'Opus',
      zeros(6), u16(1),                                 // 자리 채움 · 데이터 참조 번호
      zeros(8), u16(sound.channels), u16(16), zeros(4), // 채널 수 · 표본 하나의 비트 수
      u32(sound.rate * 65536),
      config);
  };
  const soundTrak = (firstOffset) => box('trak',
    fullBox('tkhd', 0, 3, u32(0), u32(0), u32(2), zeros(4), u32(soundMovieLength), zeros(8), u16(0), u16(0), u16(0x0100), zeros(2), MATRIX, u32(0), u32(0)),
    box('mdia',
      fullBox('mdhd', 0, 0, u32(0), u32(0), u32(sound.rate), u32(soundLength), u16(0x55c4), u16(0)),
      fullBox('hdlr', 0, 0, u32(0), text('soun'), zeros(12), text('SoundHandler'), u8(0)),
      box('minf',
        fullBox('smhd', 0, 0, zeros(4)),
        box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
        box('stbl', fullBox('stsd', 0, 0, u32(1), soundEntry()),
          fullBox('stts', 0, 0, u32(soundRuns.length), u32s(soundRuns.flat())),
          fullBox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
          fullBox('stsz', 0, 0, u32(0), u32(sound.samples.length), u32s(sound.samples.map((x) => x.data.length))),
          places(firstOffset, true)))));
  const moov = (firstOffset) => box('moov',
    fullBox('mvhd', 0, 0, u32(0), u32(0), u32(MOVIE_SCALE), u32(wholeLength), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(sound ? 3 : 2)),
    box('trak',
      fullBox('tkhd', 0, 3, u32(0), u32(0), u32(1), zeros(4), u32(movieLength), zeros(8), u16(0), u16(0), u16(0), zeros(2), MATRIX, u32(width * 65536), u32(height * 65536)),
      box('mdia',
        fullBox('mdhd', 0, 0, u32(0), u32(0), u32(MP4_SCALE), u32(length), u16(0x55c4), u16(0)),       // 말: 정하지 않음(und)
        fullBox('hdlr', 0, 0, u32(0), text('vide'), zeros(12), text('VideoHandler'), u8(0)),
        box('minf',
          fullBox('vmhd', 0, 1, zeros(8)),
          box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
          tables(firstOffset)))),
    ...(sound ? [soundTrak(firstOffset)] : []));
  const ftyp = box('ftyp', text('isom'), u32(0x200), text('isom'), text('iso2'), text('avc1'), text('mp41'));
  // 머리말의 크기는 그 안에 적는 자리 값과 상관없이 같다. 한 번 만들어 크기를 알고, 진짜 자리로 다시 만든다.
  const first = ftyp.length + moov(0).length + 8;
  if (first + bytes > 0xffffffff) throw new Error('영상이 너무 커요');
  return [concat([ftyp, moov(first), u32(bytes + 8), text('mdat')]), ...order.map((e) => e.s.data)];
}
/** mp4Parts 와 같되, 파일 전체를 Uint8Array 하나로 돌려준다. */
export const muxMp4 = (options) => concat(mp4Parts(options));

// ---------- WebM ----------

// EBML: 이름표(ID) + 크기 + 속. 크기는 맨 앞 비트로 제 길이를 알리는 가변 길이 수다(여기서는 계산이 쉽게 늘 8바이트로 적는다. 작은 속에는 1바이트).
const sized = (n) => (n < 127 ? u8(0x80 | n) : u8(0x01, 0, 0, 0, Math.floor(n / 2 ** 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff));
const idBytes = (id) => { const out = []; for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff); return Uint8Array.from(out); };
const el = (id, ...parts) => { const body = concat(parts); return concat([idBytes(id), sized(body.length), body]); };
const elHead = (id, length) => concat([idBytes(id), sized(length)]);      // 속을 따로 이어 붙일 때: 이름표와 크기만
const uint = (v) => { const out = []; let n = Math.max(0, Math.round(v)); do { out.unshift(n % 256); n = Math.floor(n / 256); } while (n > 0); return Uint8Array.from(out); };
const uint64 = (v) => { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, BigInt(Math.max(0, Math.round(v)))); return out; };
const float64 = (v) => { const out = new Uint8Array(8); new DataView(out.buffer).setFloat64(0, v); return out; };
const WEBM_CODECS = { vp8: 'V_VP8', vp9: 'V_VP9' };
const CLUSTER_MS = 30000;       // 한 묶음(cluster) 안에서 때는 16비트로 적으므로, 이보다 길어지기 전에 새 묶음을 연다

/**
 * VP8 · VP9 조각들을 WebM 파일로 묶는다. 길이와 찾아가기 표(Cues)가 앞에 들어간다.
 * - codec: 'vp8' 또는 'vp9' · width · height: 그림의 크기(px) · fps: 초당 그림 수(알려 주기만 한다)
 * - color: 색을 읽는 법 { primaries, transfer, matrix, fullRange }(없어도 된다. 인코더가 알려 준 것을 그대로 준다)
 * - audio: 함께 담을 소리(없어도 된다. 맨 위의 설명). Opus 만.
 * 돌려주는 것: 파일을 이루는 덩어리들 [Uint8Array …](차례대로 이으면 파일이다)
 */
export function webmParts({ codec, width, height, fps = 30, samples, color = null, audio = null }) {
  check(samples);
  const codecId = WEBM_CODECS[codec];
  if (!codecId) throw new Error('WebM 에 담을 수 없는 코덱이에요');
  const sound = audio ? checkSound(audio, ['opus']) : null;
  // 때는 밀리초로 적는다. 내림한다: 반올림하면 그 프레임의 때가 진짜보다 조금 늦게 적혀, 딱 그때로 건너뛰면 앞 프레임이 나온다.
  const ms = (us) => Math.floor(us / 1000 + 1e-6);
  // 묶음 나누기: 그림의 온전한 장면(key)에서 새로 열고, 너무 길어지면 그 전에도 연다. 소리 조각은 제때의 묶음에 그림 조각과 섞여 들어간다.
  const groups = [];
  for (const e of sound ? interleave(samples, sound.samples) : samples.map((s) => ({ s, sound: false }))) {
    const at = ms(e.s.ts);
    const cur = groups.at(-1);
    if (!cur || (!e.sound && e.s.key) || at - cur.at >= CLUSTER_MS) groups.push({ at, key: !e.sound && !!e.s.key, blocks: [] });
    groups.at(-1).blocks.push(e);
  }
  // 묶음 하나: [묶음의 이름표 · 크기 · 때] 다음에 조각마다 [조각의 이름표 · 크기 · 트랙 · 때 · 표시] + 조각의 속(베끼지 않는다).
  // 트랙 1 은 그림, 2 는 소리다. 소리 조각은 모두 그 자체로 풀 수 있다.
  const clusters = groups.map((g) => {
    const stamp = el(0xe7, uint(g.at));
    const blocks = g.blocks.map(({ s, sound: isSound }) => { const rel = ms(s.ts) - g.at; return [concat([elHead(0xa3, 4 + s.data.length), u8(isSound ? 0x82 : 0x81, (rel >> 8) & 0xff, rel & 0xff, isSound || s.key ? 0x80 : 0)]), s.data]; });
    const size = stamp.length + blocks.reduce((n, [h, d]) => n + h.length + d.length, 0);
    const parts = [concat([elHead(0x1f43b675, size), stamp]), ...blocks.flat()];
    return { parts, length: parts.reduce((n, p) => n + p.length, 0) };
  });
  const last = samples.at(-1);
  const lastSound = sound ? sound.samples.at(-1) : null;
  const codes = colorCodes(color);
  const info = el(0x1549a966, el(0x2ad7b1, uint(1000000)), el(0x4d80, text('minicanva')), el(0x5741, text('minicanva')),
    el(0x4489, float64(Math.max(last.ts + last.dur, lastSound ? lastSound.ts + lastSound.dur : 0) / 1000)));
  const tracks = el(0x1654ae6b, el(0xae,
    el(0xd7, uint(1)), el(0x73c5, uint(1)), el(0x9c, uint(0)), el(0x22b59c, text('und')), el(0x86, text(codecId)), el(0x83, uint(1)),
    el(0x23e383, uint(Math.round(1e9 / fps))),
    el(0xe0, el(0xb0, uint(width)), el(0xba, uint(height)),
      ...(codes ? [el(0x55b0, el(0x55b1, uint(codes.matrix)), el(0x55b9, uint(codes.full ? 2 : 1)), el(0x55ba, uint(codes.transfer)), el(0x55bb, uint(codes.primaries)))] : []))),
    // 소리 트랙(Opus): 풀 때 맨 앞에서 버릴 만큼(CodecDelay)과, 건너뛴 뒤 미리 풀어야 하는 만큼(SeekPreRoll)을 나노초로 적는다.
    ...(sound ? [el(0xae,
      el(0xd7, uint(2)), el(0x73c5, uint(2)), el(0x9c, uint(0)), el(0x22b59c, text('und')), el(0x86, text('A_OPUS')), el(0x83, uint(2)),
      el(0x56aa, uint(Math.round((sound.preskip * 1e9) / 48000))), el(0x56bb, uint(80000000)),
      el(0xe1, el(0xb5, float64(sound.rate)), el(0x9f, uint(sound.channels))),
      el(0x63a2, sound.description))] : []));
  // 찾아가기 표: 온전한 장면으로 시작하는 묶음마다 "몇 초의 것이 어디에 있는지"(그런 곳으로만 건너뛸 수 있다).
  // 자리는 8바이트로 적어, 표의 크기가 자리 값에 따라 달라지지 않게 한다.
  const cues = (offsets) => el(0x1c53bb6b, concat(groups.map((g, i) => (g.key ? el(0xbb, el(0xb3, uint(g.at)), el(0xb7, el(0xf7, uint(1)), el(0xf1, uint64(offsets[i])))) : new Uint8Array(0)))));
  const head = info.length + tracks.length + cues(groups.map(() => 0)).length;
  const offsets = [];
  let at = head;
  for (const c of clusters) { offsets.push(at); at += c.length; }
  if (at > 0xffffffff) throw new Error('영상이 너무 커요');
  const ebml = el(0x1a45dfa3, el(0x4286, uint(1)), el(0x42f7, uint(1)), el(0x42f2, uint(4)), el(0x42f3, uint(8)), el(0x4282, text('webm')), el(0x4287, uint(4)), el(0x4285, uint(2)));
  return [concat([ebml, elHead(0x18538067, at), info, tracks, cues(offsets)]), ...clusters.flatMap((c) => c.parts)];
}
/** webmParts 와 같되, 파일 전체를 Uint8Array 하나로 돌려준다. */
export const muxWebm = (options) => concat(webmParts(options));
