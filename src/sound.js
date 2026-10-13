// minicanva 의 소리: 바탕 영상의 소리를 풀어서(표본들의 줄) 영상의 시간표대로 한 줄로 섞고, 파일에 담을 수 있게 인코딩한다.
// 영상으로 내려받을 때 쓴다(video.js). 섞는 계산(mixSound · soundTrack)은 순수 함수라 node 에서 테스트하고, 풀기 · 인코딩은 브라우저의 것을 쓴다.
//
// 풀어 낸 소리 조각(clip): { left, right } — 왼쪽 · 오른쪽 귀의 표본들(Float32Array. 1초에 SOUND_RATE 개, 값은 -1 ~ 1)
// 섞어 넣는 큰 줄(track): { left, right } — 같은 것을 16비트 정수(Int16Array)로 둔다. 영상 전체 길이만큼이라, 메모리를 절반만 쓰려고 그렇게 한다.

/** 1초의 표본 수. 브라우저의 인코더(Opus)가 쓰는 값이라, 풀 때부터 이것으로 맞춘다. */
export const SOUND_RATE = 48000;
const FADE = 0.012;             // 붙여 넣는 소리의 앞뒤를 이만큼(초) 서서히 키우고 줄인다(뚝 끊기는 "틱" 소리가 나지 않게)
const BLOCK = 4800;             // 인코더에 한 번에 넣는 표본 수(0.1초)
const SOUND_CODECS = { aac: 'mp4a.40.2', opus: 'opus' };

/** 길이가 seconds 초인 빈(조용한) 큰 줄. */
export function soundTrack(seconds) {
  const n = Math.max(0, Math.ceil((Number(seconds) || 0) * SOUND_RATE));
  return { left: new Int16Array(n), right: new Int16Array(n) };
}
// -1 ~ 1 의 값을 16비트 정수로(넘치는 것은 끝값에서 멈춘다). 이미 들어 있는 값에 더한다.
const add16 = (had, v) => { const sum = had + Math.round(v * 32767); return sum > 32767 ? 32767 : sum < -32768 ? -32768 : sum; };

/**
 * 소리 조각(clip)의 한 구간을 큰 줄(master)에 더해 넣는다.
 * - at: 큰 줄에서 넣기 시작할 때(초) · from ~ to: 조각에서 쓸 구간(초) · gain: 크기(0 ~ 1)
 * 큰 줄 밖으로 나가는 부분은 버린다. 넣은 표본 수를 돌려준다.
 */
export function mixSound(master, clip, { at = 0, from = 0, to = Infinity, gain = 1 } = {}) {
  const g = Math.min(1, Math.max(0, Number(gain) || 0));
  if (!g || !clip?.left?.length) return 0;
  const start = Math.max(0, Math.round(from * SOUND_RATE));
  const end = Math.min(clip.left.length, Number.isFinite(to) ? Math.round(to * SOUND_RATE) : clip.left.length);
  const dst = Math.round(at * SOUND_RATE);
  const count = Math.min(end - start, master.left.length - dst);
  if (!(count > 0) || dst < 0) return 0;
  const fade = Math.min(Math.round(FADE * SOUND_RATE), Math.floor(count / 2));
  const right = clip.right?.length === clip.left.length ? clip.right : clip.left;
  for (let i = 0; i < count; i++) {
    const k = g * (i < fade ? i / fade : i >= count - fade ? (count - 1 - i) / fade : 1);
    master.left[dst + i] = add16(master.left[dst + i], clip.left[start + i] * k);
    master.right[dst + i] = add16(master.right[dst + i], right[start + i] * k);
  }
  return count;
}

/** 큰 줄에 소리가 들릴 만큼 들어 있는지(모든 표본이 아주 작으면 조용한 것이다). */
export function hasSound(track, floor = 16) {
  for (const side of [track?.left, track?.right]) {
    if (!side) continue;
    for (let i = 0; i < side.length; i += 7) if (side[i] > floor || side[i] < -floor) return true;
  }
  return false;
}

const Offline = () => globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext || null;
/** 이 브라우저에서 영상 파일의 소리를 풀 수 있는지. */
export const canDecodeSound = () => !!Offline();

/**
 * 영상 파일(Blob)의 소리를 푼다. 돌려주는 것: { left, right }(1초에 SOUND_RATE 개). 소리가 없는 파일이거나 풀지 못하면 null.
 * 파일을 통째로 읽어 브라우저에 맡긴다(어떤 종류의 파일이든 브라우저가 틀 수 있으면 풀린다).
 */
export async function decodeSound(blob) {
  const Ctx = Offline();
  if (!Ctx) return null;
  try {
    const bytes = await blob.arrayBuffer();
    const got = await new Ctx(2, 1, SOUND_RATE).decodeAudioData(bytes);
    if (!got || !got.length) return null;
    const left = got.getChannelData(0);
    return { left, right: got.numberOfChannels > 1 ? got.getChannelData(1) : left };
  } catch {
    return null;        // 소리 트랙이 없는 영상 · 풀 수 없는 소리
  }
}

const encoderConfig = (codec, bitrate) => ({
  codec: SOUND_CODECS[codec], sampleRate: SOUND_RATE, numberOfChannels: 2, bitrate,
  ...(codec === 'aac' ? { aac: { format: 'aac' } } : {}),       // 머리 없는 조각으로 받는다(MP4 에 그대로 담긴다)
});
/** 이 브라우저의 인코더가 받아 주는 소리 종류들(wanted 가운데, 그 차례대로). 'aac' | 'opus' */
export async function soundKinds(wanted = ['aac', 'opus'], bitrate = 128000) {
  if (typeof AudioEncoder !== 'function' || typeof AudioData !== 'function') return [];
  const out = [];
  for (const codec of wanted) {
    try {
      if (SOUND_CODECS[codec] && (await AudioEncoder.isConfigSupported(encoderConfig(codec, bitrate)))?.supported) out.push(codec);
    } catch { /* 모르는 코덱 */ }
  }
  return out;
}

/**
 * 큰 줄(16비트 정수)을 인코딩한다. codec: 'aac' | 'opus'
 * 돌려주는 것: { codec, rate, channels, description(설정 기록. 없으면 null), samples: [{ data, ts, dur }] } — mux.js 의 audio 로 그대로 넘긴다.
 * 그만뒀으면 null.
 */
export async function encodeSound(track, { codec = 'opus', bitrate = 128000, signal = null } = {}) {
  if (!SOUND_CODECS[codec]) throw new Error('모르는 소리 종류예요');
  const samples = [];
  let description = null;
  let broke = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, ts: chunk.timestamp, dur: chunk.duration || 20000 });
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = new Uint8Array(d instanceof ArrayBuffer ? d.slice(0) : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
    },
    error: (ex) => { broke ||= ex; },
  });
  try {
    encoder.configure(encoderConfig(codec, bitrate));
    const total = track.left.length;
    for (let at = 0; at < total; at += BLOCK) {
      if (signal?.aborted) return null;
      if (broke) throw broke;
      const n = Math.min(BLOCK, total - at);
      const data = new Float32Array(n * 2);          // 왼쪽 표본들 다음에 오른쪽 표본들(planar)
      for (let i = 0; i < n; i++) { data[i] = track.left[at + i] / 32768; data[n + i] = track.right[at + i] / 32768; }
      const block = new AudioData({ format: 'f32-planar', sampleRate: SOUND_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at * 1e6) / SOUND_RATE), data });
      try { encoder.encode(block); } finally { block.close(); }
      // 인코더가 밀리면 기다린다. 줄이 줄었다는 알림(dequeue)을 듣는다: 타이머만 믿으면 가려진 탭에서 한 번에 1초씩 걸린다.
      while (encoder.encodeQueueSize > 20 && !broke && !signal?.aborted) {
        await new Promise((resolve) => {
          const done = () => { clearTimeout(timer); encoder.removeEventListener?.('dequeue', done); resolve(); };
          const timer = setTimeout(done, 40);
          encoder.addEventListener?.('dequeue', done);
        });
      }
    }
    await encoder.flush();
    if (broke) throw broke;
    if (signal?.aborted) return null;
    if (!samples.length) throw new Error('소리가 인코딩되지 않았어요');
    // 때가 뒤섞이거나 겹친 조각이 있으면 담지 못한다(묶는 쪽이 던진다). 차례대로 나오는 것이 보통이다.
    return { codec, rate: SOUND_RATE, channels: 2, description, samples };
  } finally {
    try { if (encoder.state !== 'closed') encoder.close(); } catch { /* 이미 닫힘 */ }
  }
}
