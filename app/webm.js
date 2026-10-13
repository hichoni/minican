// 브라우저가 찍은 WebM 파일에 "길이"를 적어 넣는다. 순수 함수(바이트만 다룬다).
//
// MediaRecorder 가 만든 WebM 은 찍으면서 흘려보내는 파일이라 머리말(Info)에 길이(Duration)가 빠져 있다.
// 그러면 재생기가 길이를 모르고(Infinity), 끝으로 건너뛰기나 진행 막대가 이상해진다.
// 여기서는 머리말에 길이 한 칸만 끼워 넣는다. 영상 데이터는 건드리지 않는다.
// 모양이 예상과 다르면(이미 길이가 있거나, 조각 크기가 정해져 있어 끼워 넣을 수 없으면) 아무것도 바꾸지 않고 그대로 돌려준다.

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

// 요소의 이름표(ID): 첫 바이트의 맨 앞 1 의 자리가 길이를 말해 준다(1~4바이트). 이름표는 그 표시까지 포함한 값이다.
function readId(bytes, pos) {
  const first = bytes[pos];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len += 1;
  if (len > 4 || pos + len > bytes.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + bytes[pos + i];
  return { id, len };
}
// 요소의 크기: 맨 앞 1 의 자리가 길이를(1~8바이트), 나머지 비트가 값을 말한다. 나머지가 모두 1 이면 "크기를 모른다".
function readSize(bytes, pos) {
  const first = bytes[pos];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len += 1;
  if (len > 8 || pos + len > bytes.length) return null;
  let value = first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + bytes[pos + i];
    if (bytes[pos + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: allOnes };
}
// 크기를 적는다. 적어도 minLen 바이트로(원래 쓰던 폭을 지킨다).
function writeSize(value, minLen = 1) {
  let len = Math.max(1, minLen);
  while (len < 8 && value >= 2 ** (7 * len) - 1) len += 1;
  const out = new Uint8Array(len);
  let v = value;
  for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

/** WebM 머리말을 읽는다. { infoStart, infoSizePos, infoSizeLen, infoDataStart, infoDataEnd, scale, hasDuration } 못 읽으면 null. */
export function readWebmInfo(bytes) {
  let pos = 0;
  const head = readId(bytes, pos);
  if (!head || head.id !== ID_EBML) return null;
  const headSize = readSize(bytes, pos + head.len);
  if (!headSize || headSize.unknown) return null;
  pos += head.len + headSize.len + headSize.value;

  const seg = readId(bytes, pos);
  if (!seg || seg.id !== ID_SEGMENT) return null;
  const segSize = readSize(bytes, pos + seg.len);
  if (!segSize) return null;
  pos += seg.len + segSize.len;
  const segEnd = segSize.unknown ? bytes.length : Math.min(bytes.length, pos + segSize.value);

  // 조각(Segment) 안에서 Info 를 찾는다(보통 맨 앞에 있다). 크기를 모르는 요소(클러스터)를 만나면 그만둔다.
  for (let guard = 0; guard < 32 && pos < segEnd; guard++) {
    const el = readId(bytes, pos);
    if (!el) return null;
    const size = readSize(bytes, pos + el.len);
    if (!size || size.unknown) return null;
    const dataStart = pos + el.len + size.len;
    const dataEnd = dataStart + size.value;
    if (dataEnd > bytes.length) return null;
    if (el.id === ID_INFO) {
      let scale = 1000000;
      let hasDuration = false;
      let p = dataStart;
      while (p < dataEnd) {
        const child = readId(bytes, p);
        if (!child) return null;
        const cs = readSize(bytes, p + child.len);
        if (!cs || cs.unknown) return null;
        const cStart = p + child.len + cs.len;
        if (cStart + cs.value > dataEnd) return null;
        if (child.id === ID_TIMECODE_SCALE) {
          scale = 0;
          for (let i = 0; i < cs.value; i++) scale = scale * 256 + bytes[cStart + i];
        }
        if (child.id === ID_DURATION) hasDuration = true;
        p = cStart + cs.value;
      }
      return {
        infoStart: pos, infoSizePos: pos + el.len, infoSizeLen: size.len, infoDataStart: dataStart, infoDataEnd: dataEnd,
        scale: scale || 1000000, hasDuration, segmentUnknown: segSize.unknown,
      };
    }
    pos = dataEnd;
  }
  return null;
}

/**
 * WebM 파일(Uint8Array)의 머리말에 길이(초)를 적어 넣은 새 바이트 배열을 돌려준다.
 * 끼워 넣을 수 없는 모양이면 받은 것을 그대로 돌려준다.
 */
export function fixWebmDuration(bytes, seconds) {
  if (!(bytes instanceof Uint8Array) || !Number.isFinite(seconds) || seconds <= 0) return bytes;
  const info = readWebmInfo(bytes);
  // 조각의 크기가 정해져 있으면 안에 무언가를 끼워 넣을 때 그 크기도 고쳐야 한다. 그런 파일은 건드리지 않는다.
  if (!info || info.hasDuration || !info.segmentUnknown) return bytes;
  // Duration: 이름표 2바이트 + 크기 1바이트(0x88 = 8바이트) + 8바이트 실수. 단위는 TimecodeScale(나노초) 몇 개인지.
  const duration = new Uint8Array(11);
  duration[0] = 0x44; duration[1] = 0x89; duration[2] = 0x88;
  new DataView(duration.buffer).setFloat64(3, (seconds * 1e9) / info.scale);
  const oldDataLen = info.infoDataEnd - info.infoDataStart;
  const size = writeSize(oldDataLen + duration.length, info.infoSizeLen);
  const out = new Uint8Array(bytes.length - info.infoSizeLen + size.length + duration.length);
  let o = 0;
  out.set(bytes.subarray(0, info.infoSizePos), o); o += info.infoSizePos;
  out.set(size, o); o += size.length;
  out.set(bytes.subarray(info.infoDataStart, info.infoDataEnd), o); o += oldDataLen;
  out.set(duration, o); o += duration.length;
  out.set(bytes.subarray(info.infoDataEnd), o);
  return out;
}

/** WebM 머리말에 적힌 길이(초). 없으면 0. */
export function webmDuration(bytes) {
  const info = readWebmInfo(bytes);
  if (!info || !info.hasDuration) return 0;
  let p = info.infoDataStart;
  while (p < info.infoDataEnd) {
    const child = readId(bytes, p);
    const cs = child && readSize(bytes, p + child.len);
    if (!cs) return 0;
    const cStart = p + child.len + cs.len;
    if (child.id === ID_DURATION) {
      if (cs.value !== 4 && cs.value !== 8) return 0;      // 길이는 4바이트나 8바이트 실수로만 적힌다
      const view = new DataView(bytes.buffer, bytes.byteOffset + cStart, cs.value);
      const ticks = cs.value === 4 ? view.getFloat32(0) : view.getFloat64(0);
      return Number.isFinite(ticks) && ticks > 0 ? (ticks * info.scale) / 1e9 : 0;
    }
    p = cStart + cs.value;
  }
  return 0;
}

/** Blob 으로 된 WebM 에 길이를 적어 넣는다(브라우저에서 쓴다). WebM 이 아니면 그대로. */
export async function fixWebmBlob(blob, seconds) {
  if (!blob || !/webm/i.test(blob.type || '')) return blob;
  try {
    // 머리말은 맨 앞 몇백 바이트 안에 있다. 그 부분만 고치고 나머지는 그대로 이어 붙인다(큰 파일을 통째로 읽지 않는다).
    const HEAD = 4096;
    const head = new Uint8Array(await blob.slice(0, HEAD).arrayBuffer());
    const info = readWebmInfo(head);
    if (!info || info.hasDuration || !info.segmentUnknown) return blob;
    const cut = info.infoDataEnd;                      // 여기까지만 고친다
    const fixed = fixWebmDuration(head.subarray(0, cut), seconds);
    if (fixed.length === cut) return blob;
    return new Blob([fixed, blob.slice(cut)], { type: blob.type });
  } catch {
    return blob;
  }
}
