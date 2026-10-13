// minicanva 의 영상 파일 읽기(demux): 영상 파일(WebM · MP4)에서 "영상 조각들이 파일의 어디에 있고 언제 보이는지"를 읽어 낸다.
// 바이트만 다루는 순수 함수다(DOM 을 쓰지 않는다. node 에서 테스트한다).
//
// 영상으로 내려받을 때 바탕 영상을 한 장씩 정확히 풀려고 쓴다: reel.js 가 이 자리표대로 조각을 꺼내 브라우저의 디코더(VideoDecoder)에 넣는다.
// 파일 전체를 메모리에 올리지 않는다. 필요한 곳만 읽는 reader 를 받는다:
//   reader = { size(파일의 크기), read(자리, 길이) → Uint8Array(약속이어도 된다. 파일 끝을 넘으면 있는 만큼만) }
//
// 돌려주는 것(demuxVideo): {
//   container: 'webm' | 'mp4'
//   codec:     'vp8' | 'vp9' | 'av1' | 'avc' | 'hevc' · codecString: 디코더에 줄 이름(예: 'avc1.640028')
//   description: 디코더에 줄 설정 기록(H.264 의 avcC 등. 없으면 null)
//   width · height: 풀었을 때의 그림 크기(px) · rotation: 보여 줄 때 시계 방향으로 돌릴 각도(0 · 90 · 180 · 270. 휴대폰으로 세워 찍은 MP4)
//   samples:   조각들 [{ pos(파일에서의 자리), size, ts(보이는 때. 마이크로초), key(그 자체로 풀 수 있는 장면인지) }] — 파일에 담긴 차례(푸는 차례)대로
//   color:     색을 읽는 법이 파일에 적혀 있는지: 'tagged'(적혀 있다) · 'untagged'(없다) · 'unknown'(알아보지 못했다)
//              적혀 있지 않은 영상을 브라우저의 재생기(<video>)는 크기로 짐작해 읽는다(reel.js 가 같은 짐작을 디코더에 알려 준다).
//   audio:     소리 트랙이 있는지 · audioStart: 소리가 시작되는 때(마이크로초. 소리가 영상보다 늦게 시작하는 파일에서 0 보다 크다)
// }
// 조각의 때(ts)는 재생기(<video>)가 보여 주는 때와 같다: MP4 의 편집표(elst: 앞을 잘라 낸 영상 · 늦게 시작하는 트랙)를 따른다.
// 그래서 0 보다 앞인(음수) 조각이 있을 수 있다: 풀 때에는 필요하지만 보이지 않는 장면이다.
// 읽을 수 없는 파일(모르는 모양 · 조각난 MP4 · 한 조각에 여러 장면을 묶은 WebM 등)이면 null. 그때는 부르는 쪽이 다른 방법(영상을 틀어 찾아가기)을 쓴다.

const MOOV_MAX = 64 * 1024 * 1024;      // 머리말(moov)이 이보다 크면 읽지 않는다
const TRACKS_MAX = 4 * 1024 * 1024;
const hex2 = (v) => v.toString(16).padStart(2, '0');

// H.264 의 설정 기록(avcC) 안의 첫 SPS 에 "색을 읽는 법"이 적혀 있는지 본다. 'tagged' · 'untagged', 읽다가 어긋나면 'unknown'.
function avcColor(avcC) {
  try {
    if (!(avcC[5] & 0x1f)) return 'unknown';
    const len = (avcC[6] << 8) | avcC[7];
    const raw = avcC.subarray(8, 8 + len);
    if (raw.length < 4 || (raw[0] & 0x1f) !== 7) return 'unknown';
    // 사이사이에 끼워 넣은 0x03(가짜 시작 표시를 막는 바이트)을 뺀다
    const b = [];
    for (let i = 1; i < raw.length; i++) { if (i >= 3 && raw[i] === 3 && raw[i - 1] === 0 && raw[i - 2] === 0) continue; b.push(raw[i]); }
    let at = 0;
    const bit = () => { if (at >= b.length * 8) throw new Error('끝'); const v = (b[at >> 3] >> (7 - (at & 7))) & 1; at += 1; return v; };
    const u = (n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + bit(); return v; };
    const ue = () => { let zeros = 0; while (!bit()) { zeros += 1; if (zeros > 31) throw new Error('수'); } return (2 ** zeros - 1) + u(zeros); };
    const se = () => { const k = ue(); return k & 1 ? (k + 1) / 2 : -k / 2; };
    const profile = u(8);
    u(16);
    ue();
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
      const chroma = ue();
      if (chroma === 3) u(1);
      ue(); ue(); u(1);
      if (u(1)) {
        for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
          if (!u(1)) continue;
          let last = 8;
          let next = 8;
          for (let j = 0; j < (i < 6 ? 16 : 64); j++) { if (next) next = (last + se() + 256) % 256; last = next || last; }
        }
      }
    }
    ue();
    const poc = ue();
    if (poc === 0) ue();
    else if (poc === 1) { u(1); se(); se(); for (let i = ue(); i > 0; i--) se(); }
    ue(); u(1); ue(); ue();
    if (!u(1)) u(1);
    u(1);
    if (u(1)) { ue(); ue(); ue(); ue(); }
    if (!u(1)) return 'untagged';                  // 덧붙인 정보(VUI)가 없다
    if (u(1)) { if (u(8) === 255) u(32); }
    if (u(1)) u(1);
    if (!u(1)) return 'untagged';                  // 영상 신호의 종류가 없다
    u(4);
    if (!u(1)) return 'untagged';                  // 색에 대한 설명이 없다
    u(16);
    return u(8) === 2 ? 'untagged' : 'tagged';     // 2: "정하지 않음"
  } catch {
    return 'unknown';
  }
}
const fourcc = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

// 파일을 앞에서부터 훑을 때: 한 번에 넉넉히 읽어 두고(창), 그 안에서 꺼내 쓴다.
function windowed(reader, span = 1 << 20) {
  let base = 0;
  let buf = new Uint8Array(0);
  return {
    size: reader.size,
    /** 파일의 pos 부터 len 바이트가 들어 있는 { bytes, off, left(off 부터 남은 길이. 파일 끝이면 len 보다 짧다) } */
    async at(pos, len) {
      if (pos < base || pos + len > base + buf.length) {
        const want = Math.min(reader.size - pos, Math.max(len, span));
        buf = want > 0 ? await reader.read(pos, want) : new Uint8Array(0);
        base = pos;
      }
      return { bytes: buf, off: pos - base, left: base + buf.length - pos };
    },
  };
}

// VP9 장면의 머리: 표시 2비트(=2) 뒤에 프로필의 낮은 비트 · 높은 비트가 있다(프로필 2 · 3 은 10비트 색).
const vp9Profile = (b) => (b.length && (b[0] >> 6) === 2 ? ((b[0] >> 5) & 1) | (((b[0] >> 4) & 1) << 1) : 0);
// 온전한 장면(key)의 머리에는 색 공간이 3비트로 적혀 있다(0 = 모름). 프로필 0 · 1 의 흔한 모양만 읽는다.
function vp9Color(b) {
  if (b.length < 5 || (b[0] >> 6) !== 2) return 'unknown';
  const profile = vp9Profile(b);
  if (profile > 1) return 'unknown';
  if (b[0] & 0x08 || b[0] & 0x04) return 'unknown';           // 다른 장면을 다시 보여 주는 것이거나, 온전한 장면이 아니다
  if (b[1] !== 0x49 || b[2] !== 0x83 || b[3] !== 0x42) return 'unknown';
  return (b[4] >> 5) === 0 ? 'untagged' : 'tagged';
}

// ---------- WebM(Matroska) ----------

const EBML_HEAD = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TRACKS = 0x1654ae6b;
const CLUSTER = 0x1f43b675;
const WEBM_CODECS = { V_VP8: 'vp8', V_VP9: 'vp9', V_AV1: 'av1', 'V_MPEG4/ISO/AVC': 'avc' };

// 이름표(ID): 맨 앞 바이트의 앞쪽 0 의 수로 길이를 안다(1~4바이트). 표시 비트를 포함한 값이 이름표다.
function ebmlId(b, at) {
  const first = b[at];
  const len = first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : first & 0x10 ? 4 : 0;
  if (!len) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[at + i];
  return { id, len };
}
// 크기: 가변 길이 수(1~8바이트). 모든 비트가 1 이면 "크기를 모른다"(-1. 녹화하며 흘려 쓴 파일).
function ebmlSize(b, at) {
  const first = b[at];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len += 1;
  if (len > 8) return null;
  let value = first & (0xff >> len);
  let ones = value === (0xff >> len);
  for (let i = 1; i < len; i++) { value = value * 256 + b[at + i]; ones = ones && b[at + i] === 0xff; }
  return { size: ones ? -1 : value, len };
}
const ebmlUint = (b, at, len) => { let v = 0; for (let i = 0; i < len; i++) v = v * 256 + b[at + i]; return v; };
// 메모리에 올린 덩어리 안의 요소들을 차례로 낸다.
function* ebmlChildren(b, start, end) {
  let at = start;
  while (at < end) {
    const id = ebmlId(b, at);
    if (!id) return;
    const size = ebmlSize(b, at + id.len);
    if (!size || size.size < 0) return;
    const from = at + id.len + size.len;
    if (from + size.size > end) return;
    yield { id: id.id, start: from, end: from + size.size };
    at = from + size.size;
  }
}

/** WebM 파일을 읽는다. 읽을 수 없으면 null. */
export async function demuxWebm(reader) {
  const win = windowed(reader);
  const head = async (pos) => {
    const { bytes, off, left } = await win.at(pos, 12);
    if (left < 2) return null;
    const id = ebmlId(bytes, off);
    if (!id || left < id.len + 1) return null;
    const size = ebmlSize(bytes, off + id.len);
    if (!size || left < id.len + size.len) return null;
    return { id: id.id, size: size.size, start: pos + id.len + size.len };
  };
  let h = await head(0);
  if (!h || h.id !== EBML_HEAD || h.size < 0) return null;
  let pos = h.start + h.size;
  h = await head(pos);
  while (h && h.id !== SEGMENT) {            // 머리말과 본문 사이에 빈 칸(Void)이 있을 수 있다
    if (h.size < 0) return null;
    pos = h.start + h.size;
    h = await head(pos);
  }
  if (!h) return null;
  const segEnd = h.size < 0 ? reader.size : Math.min(reader.size, h.start + h.size);
  pos = h.start;
  let scale = 1000000;                       // 때의 단위(나노초). 기본은 1밀리초
  let track = null;
  let soundTrack = 0;                        // 소리 트랙의 번호(없으면 0)
  let soundDelay = 0;                        // 소리 조각의 때에 얹혀 있는 인코더의 준비 구간(CodecDelay. 나노초): 들리는 때는 그만큼 앞이다
  let soundStart = null;                     // 첫 소리 조각의 때(마이크로초)
  const samples = [];
  let laced = false;
  // 조각 하나(SimpleBlock · Block)의 머리: 트랙 번호 · 묶음 안에서의 때 · 표시
  const block = async (start, size, clusterTime, keyOverride) => {
    const { bytes, off, left } = await win.at(start, Math.min(size, 12));
    if (left < 4) return;
    const num = ebmlSize(bytes, off);        // 트랙 번호도 같은 가변 길이 수다
    if (!num || left < num.len + 3) return;
    const rel = ((bytes[off + num.len] << 8) | bytes[off + num.len + 1]) << 16 >> 16;      // 부호 있는 16비트
    if (num.size === soundTrack && soundStart === null) soundStart = Math.max(0, Math.round(((clusterTime + rel) * scale) / 1000));
    if (num.size !== track.number) return;
    const flags = bytes[off + num.len + 2];
    if (flags & 0x06) { laced = true; return; }
    const headLen = num.len + 3;
    if (size <= headLen || start + size > reader.size) return;      // 빈 조각 · 파일 끝에서 잘린 조각은 담지 않는다
    samples.push({ pos: start + headLen, size: size - headLen, ts: Math.round(((clusterTime + rel) * scale) / 1000), key: keyOverride ?? !!(flags & 0x80) });
  };
  while (pos < segEnd) {
    const e = await head(pos);
    if (!e) break;
    if (e.id === CLUSTER) {
      if (!track) return null;               // 트랙을 알기 전에 조각이 나온다: 읽지 않는다
      const end = e.size < 0 ? segEnd : Math.min(segEnd, e.start + e.size);
      let at = e.start;
      let clusterTime = 0;
      while (at < end) {
        const c = await head(at);
        if (!c) { at = end; break; }
        if (c.id >= 0x10000000) {            // 큰 요소(다음 묶음 · 찾아가기 표 등)가 나왔다: 크기를 모르는 묶음은 여기서 끝난다
          if (e.size < 0) break;
          return null;
        }
        if (c.size < 0) return null;
        if (c.id === 0xe7) {
          const { bytes, off } = await win.at(c.start, c.size);
          clusterTime = ebmlUint(bytes, off, c.size);
        } else if (c.id === 0xa3) {
          await block(c.start, c.size, clusterTime, null);
        } else if (c.id === 0xa0) {
          // 조각 묶음(BlockGroup): 앞 장면을 가리키는 표시(ReferenceBlock)가 없으면 그 자체로 풀 수 있는 장면이다
          if (c.size > TRACKS_MAX) return null;
          const { bytes, off } = await win.at(c.start, c.size);
          let found = null;
          let refs = false;
          for (const g of ebmlChildren(bytes, off, off + c.size)) {
            if (g.id === 0xa1) found = { start: c.start + (g.start - off), size: g.end - g.start };
            else if (g.id === 0xfb) refs = true;
          }
          if (found) await block(found.start, found.size, clusterTime, !refs);
        }
        at = c.start + c.size;
      }
      pos = at;
      continue;
    }
    if (e.size < 0) break;                   // 크기를 모르는 다른 요소는 건너뛸 수 없다
    if (e.id === INFO || e.id === TRACKS) {
      if (e.size > TRACKS_MAX) return null;
      const { bytes, off, left } = await win.at(e.start, e.size);
      if (left < e.size) return null;
      if (e.id === INFO) {
        for (const c of ebmlChildren(bytes, off, off + e.size)) if (c.id === 0x2ad7b1) scale = ebmlUint(bytes, c.start, c.end - c.start) || scale;
      } else {
        for (const entry of ebmlChildren(bytes, off, off + e.size)) {
          if (entry.id !== 0xae) continue;
          const t = { number: 0, type: 0, codecId: '', priv: null, width: 0, height: 0, tagged: false, delay: 0 };
          for (const c of ebmlChildren(bytes, entry.start, entry.end)) {
            if (c.id === 0xd7) t.number = ebmlUint(bytes, c.start, c.end - c.start);
            else if (c.id === 0x83) t.type = ebmlUint(bytes, c.start, c.end - c.start);
            else if (c.id === 0x86) t.codecId = String.fromCharCode(...bytes.subarray(c.start, c.end)).replace(/\0+$/, '');
            else if (c.id === 0x63a2) t.priv = bytes.slice(c.start, c.end);
            else if (c.id === 0x56aa) t.delay = ebmlUint(bytes, c.start, c.end - c.start);
            else if (c.id === 0xe0) {
              for (const v of ebmlChildren(bytes, c.start, c.end)) {
                if (v.id === 0xb0) t.width = ebmlUint(bytes, v.start, v.end - v.start);
                else if (v.id === 0xba) t.height = ebmlUint(bytes, v.start, v.end - v.start);
                else if (v.id === 0x55b0) {
                  // 색을 읽는 법(Colour): 행렬이 적혀 있으면(2 = "정하지 않음"이 아니면) 적혀 있는 것으로 본다
                  for (const k of ebmlChildren(bytes, v.start, v.end)) if (k.id === 0x55b1 && ebmlUint(bytes, k.start, k.end - k.start) !== 2) t.tagged = true;
                }
              }
            }
          }
          if (t.type === 1 && t.number > 0 && !track) track = t;
          else if (t.type === 2 && t.number > 0 && !soundTrack) { soundTrack = t.number; soundDelay = t.delay; }
        }
      }
    }
    pos = e.start + e.size;
  }
  if (!track || laced || !samples.length) return null;
  const codec = WEBM_CODECS[track.codecId];
  if (!codec) return null;
  let codecString = 'vp8';
  let description = null;
  let color = 'untagged';                    // VP8 은 제 안에 색 정보를 담지 못한다
  if (codec === 'vp9') {
    const first = await reader.read(samples[0].pos, 5);
    const profile = vp9Profile(first);
    codecString = `vp09.0${profile}.10.${profile >= 2 ? '10' : '08'}`;
    color = vp9Color(first);
  } else if (codec === 'av1') {
    codecString = 'av01.0.08M.08';
    description = track.priv && track.priv.length >= 4 ? track.priv : null;
    color = 'unknown';
  } else if (codec === 'avc') {
    if (!track.priv || track.priv.length < 7 || track.priv[0] !== 1) return null;
    codecString = `avc1.${hex2(track.priv[1])}${hex2(track.priv[2])}${hex2(track.priv[3])}`;
    description = track.priv;
    color = avcColor(track.priv);
  }
  if (track.tagged) color = 'tagged';
  return { container: 'webm', codec, codecString, description, width: track.width, height: track.height, rotation: 0, samples, color, audio: soundTrack > 0, audioStart: Math.max(0, (soundStart || 0) - Math.round(soundDelay / 1000)) };
}

// ---------- MP4(ISO BMFF) ----------

const VIDEO_ENTRIES = { avc1: 'avc', avc3: 'avc', hvc1: 'hevc', hev1: 'hevc', vp09: 'vp9', vp08: 'vp8', av01: 'av1' };

// 상자들을 차례로 낸다: { type, start(속의 시작), end }
function* boxes(b, start, end) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = fourcc(b, at + 4);
    let head = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = Number(view.getBigUint64(at + 8));
      head = 16;
    } else if (size === 0) size = end - at;
    if (size < head || at + size > end) return;
    yield { type, start: at + head, end: at + size };
    at += size;
  }
}
const child = (b, parent, type) => { for (const x of boxes(b, parent.start, parent.end)) if (x.type === type) return x; return null; };
const path = (b, parent, ...types) => { let cur = parent; for (const t of types) { cur = cur && child(b, cur, t); } return cur; };

// HEVC 의 설정 기록(hvcC)에서 디코더에 줄 이름을 만든다(예: 'hvc1.1.6.L93.B0').
function hevcString(format, c) {
  const space = ['', 'A', 'B', 'C'][c[1] >> 6];
  const tier = (c[1] >> 5) & 1 ? 'H' : 'L';
  const profile = c[1] & 0x1f;
  let compat = 0;
  for (let i = 0; i < 32; i++) if ((c[2 + (i >> 3)] >> (7 - (i & 7))) & 1) compat |= 1 << i;      // 비트의 차례를 뒤집어 적는다
  const flags = [...c.subarray(6, 12)];
  while (flags.length && flags.at(-1) === 0) flags.pop();
  return `${format}.${space}${profile}.${(compat >>> 0).toString(16)}.${tier}${c[12]}${flags.map((f) => `.${f.toString(16).toUpperCase()}`).join('')}`;
}

// 트랙의 편집표(edts > elst)를 읽는다: { lead(앞의 빈 구간. 영화의 시간 단위), media(쓰기 시작하는 곳. 트랙의 시간 단위) }. 없으면 둘 다 0.
// 앞의 빈 구간들과, 그 뒤 첫 구간이 어디서 시작하는지만 본다(여러 구간으로 이어 붙인 파일은 드물다. 첫 구간의 것으로 본다).
function editOf(b, view, trak) {
  const elst = path(b, trak, 'edts', 'elst');
  const out = { lead: 0, media: 0 };
  if (!elst) return out;
  const wide = b[elst.start] === 1;
  const count = view.getUint32(elst.start + 4);
  const step = wide ? 20 : 12;
  for (let i = 0; i < count && elst.start + 8 + (i + 1) * step <= elst.end; i++) {
    const at = elst.start + 8 + i * step;
    const length = wide ? Number(view.getBigUint64(at)) : view.getUint32(at);
    const media = wide ? Number(view.getBigInt64(at + 8)) : view.getInt32(at + 4);
    if (media < 0) { out.lead += length; continue; }      // 빈 구간: 그만큼 늦게 시작한다
    out.media = media;
    break;
  }
  return out;
}

// 머리말(moov) 안에서 영상 트랙을 찾아 조각들의 자리표를 만든다.
function parseMoov(b) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const moov = { start: 8, end: b.length };
  const mvhd = child(b, moov, 'mvhd');
  const movieScale = mvhd ? view.getUint32(mvhd.start + (b[mvhd.start] === 1 ? 20 : 12)) : 0;
  // 소리 트랙: 있는지와, 얼마나 늦게 시작하는지(앞의 빈 구간)
  let audio = false;
  let audioStart = 0;
  for (const trak of boxes(b, moov.start, moov.end)) {
    if (trak.type !== 'trak' || audio) continue;
    const hdlr = path(b, trak, 'mdia', 'hdlr');
    if (!hdlr || fourcc(b, hdlr.start + 8) !== 'soun') continue;
    audio = true;
    if (movieScale) audioStart = Math.round((editOf(b, view, trak).lead * 1e6) / movieScale);
  }
  for (const trak of boxes(b, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const hdlr = path(b, trak, 'mdia', 'hdlr');
    if (!hdlr || fourcc(b, hdlr.start + 8) !== 'vide') continue;
    const mdhd = path(b, trak, 'mdia', 'mdhd');
    const stbl = path(b, trak, 'mdia', 'minf', 'stbl');
    const tkhd = child(b, trak, 'tkhd');
    if (!mdhd || !stbl || !tkhd) return null;
    const timescale = view.getUint32(mdhd.start + (b[mdhd.start] === 1 ? 20 : 12));
    if (!timescale) return null;
    // 돌려서 보여 주라는 표(휴대폰으로 세워 찍은 영상): 행렬의 앞 네 값으로 안다.
    const m = tkhd.start + (b[tkhd.start] === 1 ? 52 : 40);
    const [ma, mb, mc, md] = [0, 4, 12, 16].map((o) => view.getInt32(m + o) / 65536);
    const rotation = ma === 0 && mb === 1 && mc === -1 && md === 0 ? 90 : ma === -1 && md === -1 ? 180 : ma === 0 && mb === -1 && mc === 1 && md === 0 ? 270 : 0;
    const stsd = child(b, stbl, 'stsd');
    if (!stsd || view.getUint32(stsd.start + 4) < 1) return null;
    const entry = boxes(b, stsd.start + 8, stsd.end).next().value;
    const codec = entry && VIDEO_ENTRIES[entry.type];
    if (!codec) return null;
    const width = view.getUint16(entry.start + 24);
    const height = view.getUint16(entry.start + 26);
    let codecString = '';
    let description = null;
    let tagged = false;
    for (const c of boxes(b, entry.start + 78, entry.end)) {
      const body = b.subarray(c.start, c.end);
      // 색을 읽는 법(colr): 행렬이 적혀 있으면(2 = "정하지 않음"이 아니면) 적혀 있는 것으로 본다
      if (c.type === 'colr' && body.length >= 10 && ['nclx', 'nclc'].includes(fourcc(body, 0)) && ((body[8] << 8) | body[9]) !== 2) tagged = true;
      if (c.type === 'avcC' && codec === 'avc' && body.length >= 7) { description = body.slice(); codecString = `avc1.${hex2(body[1])}${hex2(body[2])}${hex2(body[3])}`; }
      else if (c.type === 'hvcC' && codec === 'hevc' && body.length >= 23) { description = body.slice(); codecString = hevcString(entry.type === 'hev1' ? 'hev1' : 'hvc1', body); }
      else if (c.type === 'vpcC' && codec === 'vp9' && body.length >= 8) codecString = `vp09.${String(body[4]).padStart(2, '0')}.${String(body[5]).padStart(2, '0')}.${String(body[6] >> 4).padStart(2, '0')}`;
      else if (c.type === 'av1C' && codec === 'av1' && body.length >= 4) {
        description = body.slice();
        const depth = (body[2] >> 6) & 1 ? ((body[2] >> 5) & 1 ? 12 : 10) : 8;
        codecString = `av01.${body[1] >> 5}.${String(body[1] & 0x1f).padStart(2, '0')}${body[2] >> 7 ? 'H' : 'M'}.${String(depth).padStart(2, '0')}`;
      }
    }
    if (codec === 'vp8') codecString = 'vp8';
    if (!codecString) return null;
    const color = tagged ? 'tagged' : codec === 'vp8' ? 'untagged' : codec === 'avc' ? avcColor(description) : 'unknown';
    // 표들: 길이(stts) · 보이는 때의 차이(ctts) · 덩어리마다의 조각 수(stsc) · 조각의 크기(stsz) · 덩어리의 자리(stco · co64) · 온전한 장면(stss)
    const stsz = child(b, stbl, 'stsz');
    const stts = child(b, stbl, 'stts');
    const stsc = child(b, stbl, 'stsc');
    const stco = child(b, stbl, 'stco');
    const co64 = child(b, stbl, 'co64');
    if (!stsz || !stts || !stsc || !(stco || co64)) return null;
    const fixed = view.getUint32(stsz.start + 4);
    const count = view.getUint32(stsz.start + 8);
    if (!count || count > 2000000) return null;
    const sizeOf = (i) => fixed || view.getUint32(stsz.start + 12 + i * 4);
    const chunks = view.getUint32((stco || co64).start + 4);
    const chunkAt = (c) => (stco ? view.getUint32(stco.start + 8 + c * 4) : Number(view.getBigUint64(co64.start + 8 + c * 8)));
    const runs = view.getUint32(stsc.start + 4);
    const samples = new Array(count);
    let i = 0;
    for (let r = 0; r < runs && i < count; r++) {
      const first = view.getUint32(stsc.start + 8 + r * 12);
      const per = view.getUint32(stsc.start + 12 + r * 12);
      const until = r + 1 < runs ? view.getUint32(stsc.start + 8 + (r + 1) * 12) : chunks + 1;
      if (!per || first < 1) return null;
      for (let c = first; c < until && c <= chunks && i < count; c++) {
        let at = chunkAt(c - 1);
        for (let k = 0; k < per && i < count; k++) {
          const size = sizeOf(i);
          samples[i] = { pos: at, size, ts: 0, key: false };
          at += size;
          i += 1;
        }
      }
    }
    if (i !== count) return null;
    // 푸는 때(dts): 길이를 차례로 더한다. 보이는 때(pts) = 푸는 때 + 차이.
    let n = 0;
    let dts = 0;
    for (let r = 0, total = view.getUint32(stts.start + 4); r < total && n < count; r++) {
      const many = view.getUint32(stts.start + 8 + r * 8);
      const delta = view.getUint32(stts.start + 12 + r * 8);
      for (let k = 0; k < many && n < count; k++) { samples[n].ts = dts; dts += delta; n += 1; }
    }
    if (n !== count) return null;
    const ctts = child(b, stbl, 'ctts');
    if (ctts) {
      n = 0;
      for (let r = 0, total = view.getUint32(ctts.start + 4); r < total && n < count; r++) {
        const many = view.getUint32(ctts.start + 8 + r * 8);
        const shift = view.getInt32(ctts.start + 12 + r * 8);
        for (let k = 0; k < many && n < count; k++) { samples[n].ts += shift; n += 1; }
      }
    }
    // 재생기가 보여 주는 때로 맞춘다: 편집표가 "여기서부터 쓴다"고 한 곳이 0초이고, 앞에 빈 구간이 있으면 그만큼 늦게 시작한다.
    // (편집표가 없으면 파일에 적힌 때 그대로다.)
    const edit = editOf(b, view, trak);
    const lead = movieScale ? (edit.lead * 1e6) / movieScale : 0;
    for (const s of samples) s.ts = Math.round(((s.ts - edit.media) * 1e6) / timescale + lead);
    const stss = child(b, stbl, 'stss');
    if (stss) {
      for (let r = 0, total = view.getUint32(stss.start + 4); r < total; r++) {
        const k = view.getUint32(stss.start + 8 + r * 4);
        if (k >= 1 && k <= count) samples[k - 1].key = true;
      }
    } else for (const s of samples) s.key = true;
    return { container: 'mp4', codec, codecString, description, width, height, rotation, samples, color, audio, audioStart };
  }
  return null;
}

/** MP4 파일을 읽는다. 읽을 수 없으면(조각난 MP4 등) null. */
export async function demuxMp4(reader) {
  let pos = 0;
  let moov = null;
  while (pos + 8 <= reader.size) {
    const h = await reader.read(pos, 16);
    if (h.length < 8) break;
    const view = new DataView(h.buffer, h.byteOffset, h.byteLength);
    let size = view.getUint32(0);
    const type = fourcc(h, 4);
    if (size === 1) { if (h.length < 16) break; size = Number(view.getBigUint64(8)); if (size < 16) return null; }
    else if (size === 0) size = reader.size - pos;
    else if (size < 8) return null;
    if (type === 'moof') return null;        // 조각난 MP4: 자리표가 머리말에 없다
    if (type === 'moov') {
      if (size > MOOV_MAX) return null;
      moov = await reader.read(pos, size);
      if (moov.length < size) return null;
    }
    pos += size;
  }
  if (!moov) return null;
  const out = parseMoov(moov);
  if (!out) return null;
  // 자리표가 파일 밖을 가리키면(잘린 파일) 읽지 않는다.
  for (const s of out.samples) if (!(s.size > 0) || s.pos + s.size > reader.size) return null;
  // MP4 에 담긴 VP9: 색 정보는 첫 장면의 머리에 있다.
  if (out.codec === 'vp9' && out.color === 'unknown') {
    const key = out.samples.find((s) => s.key);
    if (key) out.color = vp9Color(await reader.read(key.pos, 5));
  }
  return out;
}

/** 영상 파일을 읽는다(WebM 인지 MP4 인지는 머리의 표시로 안다). 읽을 수 없으면 null. */
export async function demuxVideo(reader) {
  try {
    if (!reader || !(reader.size >= 16)) return null;
    const head = await reader.read(0, 12);
    if (head.length < 12) return null;
    const out = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3 ? await demuxWebm(reader)
      : ['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide'].includes(fourcc(head, 4)) ? await demuxMp4(reader) : null;
    if (!out || !out.samples.length || !(out.width > 0) || !(out.height > 0)) return null;
    if (!out.samples.some((s) => s.key)) return null;
    return out;
  } catch {
    return null;       // 모양이 어긋난 파일(읽다가 범위를 벗어남 등)
  }
}

/** 메모리에 있는 바이트를 reader 로 만든다(테스트 · 작은 파일). */
export const bytesReader = (bytes) => ({ size: bytes.length, read: (pos, len) => bytes.subarray(pos, Math.min(bytes.length, pos + len)) });
/** Blob 을 reader 로 만든다(브라우저). */
export const blobReader = (blob) => ({ size: blob.size, read: async (pos, len) => new Uint8Array(await blob.slice(pos, pos + len).arrayBuffer()) });
