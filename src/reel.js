// 온바탕 편집기의 릴(브라우저): 영상 파일에서 "t 초에 보이는 장면"을 한 장씩 꺼내 준다. 영상으로 내려받을 때 바탕 영상을 프레임마다 그리려고 쓴다(video.js).
// 꺼내는 길은 둘이다.
//   가. 풀어서 꺼내기('codec'): 파일의 자리표를 읽고(demux.js) 조각을 차례로 브라우저의 디코더(VideoDecoder)에 넣는다.
//       그때의 장면이 정확히 나오고, 앞에서부터 차례로 꺼내면 한 장에 한 번만 풀므로 빠르다. 가려진 탭에서도 된다.
//   나. 찾아가서 꺼내기('seek'): <video> 를 그때로 찾아가게 하고 그 모습을 읽는다. 브라우저가 틀 수 있는 파일이면 무엇이든 되지만,
//       찾아갈 때마다 앞의 온전한 장면부터 다시 풀어서 느리다. 가의 길이 안 되는 파일(조각난 MP4 등)이나 브라우저에서 쓴다.
// openReel 이 가를 먼저 써 보고, 안 되면(또는 꺼내다 실패하면) 나로 바꾼다.
import { demuxVideo, blobReader } from './demux.js';

const WAIT_MS = 10000;          // 장면 하나를 기다리는 가장 긴 시간
const SLACK_US = 500;           // 때를 견줄 때의 여유(마이크로초): 0.0333…초 같은 값이 깎여 앞 장면이 나오지 않게
const AHEAD = 8;                // 디코더에 한꺼번에 넣어 두는 조각 수

const SEEK_SLACK = 0.002;       // 찾아갈 때 이만큼(초) 뒤를 가리킨다: 장면이 바뀌는 바로 그때를 가리키면 브라우저가 앞 장면을 보여 주기도 한다

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const infos = new WeakMap();    // 파일(Blob) → 자리표를 읽는 약속(같은 파일을 여러 번 읽지 않는다)
/** 영상 파일의 자리표(demux.js 의 demuxVideo 가 돌려주는 것). 읽을 수 없는 파일이면 null. 소리가 언제 시작하는지 알 때에도 쓴다. */
export function videoInfo(blob) {
  if (!infos.has(blob)) infos.set(blob, Promise.resolve().then(() => demuxVideo(blobReader(blob))).catch(() => null));
  return infos.get(blob);
}

// 조각을 읽을 때: 차례로 읽으므로 넉넉한 창으로 한꺼번에 읽어 두고 그 안에서 잘라 쓴다.
function chunkReader(blob, span = 4 * 1024 * 1024) {
  const reader = blobReader(blob);
  let base = 0;
  let buf = new Uint8Array(0);
  return async (pos, size) => {
    if (pos < base || pos + size > base + buf.length) {
      buf = await reader.read(pos, Math.min(blob.size - pos, Math.max(size, span)));
      base = pos;
    }
    return buf.subarray(pos - base, pos - base + size);
  };
}

// 가. 풀어서 꺼내기. 이 파일 · 이 브라우저에서 쓸 수 없으면 null.
async function codecReel(blob) {
  if (typeof VideoDecoder !== 'function' || typeof EncodedVideoChunk !== 'function') return null;
  const info = await videoInfo(blob);
  if (!info) return null;
  const config = { codec: info.codecString, codedWidth: info.width, codedHeight: info.height, ...(info.description ? { description: info.description } : {}) };
  // 색을 읽는 법이 파일에 적혀 있지 않으면, 브라우저의 재생기(<video>)가 하는 짐작을 그대로 알려 준다: 높이가 720 보다 작으면 옛 규격(BT.601), 아니면 BT.709.
  // 알려 주지 않으면 디코더는 늘 BT.709 로 읽어서, 작은 영상의 색이 발표 화면에서 보던 것과 조금 달라진다.
  if (info.color === 'untagged') {
    const kind = info.height < 720 ? 'smpte170m' : 'bt709';
    config.colorSpace = { primaries: kind, transfer: kind, matrix: kind, fullRange: false };
  }
  try {
    if (!(await VideoDecoder.isConfigSupported(config))?.supported) return null;
  } catch {
    return null;
  }
  const { samples } = info;                                    // 파일에 담긴 차례(푸는 차례)
  const shown = samples.map((_, i) => i).sort((a, b) => samples[a].ts - samples[b].ts || a - b);      // 보이는 차례
  const times = shown.map((i) => samples[i].ts);
  const read = chunkReader(blob);
  let decoder = null;
  let fed = 0;                 // 다음에 넣을 조각(푸는 차례의 번호)
  let queue = [];              // 디코더가 내놓은 장면들(보이는 차례대로 나온다)
  let held = null;             // 지금 보여 줄 장면
  let ended = false;           // 마지막 조각까지 다 풀었다
  let flushing = null;
  let broke = null;
  let closed = false;
  let wake = () => {};
  const signal = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 60);
    wake = () => { clearTimeout(timer); resolve(); };
  });
  const clear = () => {
    for (const f of queue) f.close();
    queue = [];
    held?.close();
    held = null;
    try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch { /* 이미 닫힘 */ }
    decoder = null;
  };
  // from 번째 조각(온전한 장면)부터 새로 풀기 시작한다.
  const restart = (from) => {
    clear();
    broke = null;
    ended = false;
    flushing = null;
    fed = from;
    const mine = decoder = new VideoDecoder({
      output: (frame) => { if (decoder === mine && !closed) { queue.push(frame); wake(); } else frame.close(); },
      error: (ex) => { if (decoder === mine) { broke = ex; wake(); } },
    });
    // 넣어 둔 조각이 줄면 다시 넣으러 간다(타이머만 믿으면 가려진 탭에서 한 번에 1초씩 걸린다).
    decoder.addEventListener?.('dequeue', () => { if (decoder === mine) wake(); });
    decoder.configure(config);
  };
  // i 번째 조각을 풀려면 여기서부터 넣어야 한다: 그 조각이거나 그 앞의, 가장 가까운 온전한 장면.
  const keyBefore = (i) => { let k = i; while (k > 0 && !samples[k].key) k -= 1; return k; };
  const pic = (frame) => ({ source: frame, width: frame.displayWidth, height: frame.displayHeight, rotation: info.rotation });

  async function frame(t) {
    if (closed) return null;
    // 그때 보이는 장면: 보이는 때가 t 이하인 것 가운데 마지막(첫 장면보다 앞이면 첫 장면).
    // (앞을 잘라 낸 영상에는 보이는 때가 0 보다 앞인 조각이 있다. 풀 때에만 쓰이고, 0초에는 0초의 장면이 골라진다.)
    const us = Math.round(t * 1e6) + SLACK_US;
    let lo = 0;
    let hi = times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= us) lo = mid + 1; else hi = mid; }
    const at = Math.max(0, lo - 1);
    const want = times[at];
    if (held && held.timestamp === want) return pic(held);
    const key = keyBefore(shown[at]);
    // 새로 시작해야 하는 때: 처음 · 앞으로 되돌아갈 때 · 사이에 온전한 장면이 있어 거기서부터 푸는 편이 빠를 때 · 디코더가 실패했을 때.
    const backwards = held ? want < held.timestamp : queue.length ? want < queue[0].timestamp : false;
    if (!decoder || broke || backwards || key > fed) restart(key);
    const until = performance.now() + WAIT_MS;
    for (;;) {
      if (closed) return null;
      if (broke) throw broke;
      while (queue.length && queue[0].timestamp <= want) { held?.close(); held = queue.shift(); }
      if (held && held.timestamp === want) break;
      if (queue.length || ended) break;      // 그보다 뒤의 장면이 이미 나왔다(또는 끝났다): 가장 가까운 앞의 장면을 쓴다
      if (performance.now() > until) throw new Error('영상의 장면을 제때 풀지 못했어요');
      if (fed < samples.length) {
        if (decoder.decodeQueueSize < AHEAD) {
          const s = samples[fed];
          const data = await read(s.pos, s.size);
          if (closed) return null;
          if (!decoder || decoder.state !== 'configured') continue;
          decoder.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: s.ts, data }));
          fed += 1;
          continue;
        }
      } else if (!flushing) {
        const mine = decoder;
        flushing = mine.flush().then(() => { if (decoder === mine) { ended = true; wake(); } }, (ex) => { if (decoder === mine) { broke = ex; wake(); } });
      }
      await signal();
    }
    return held ? pic(held) : queue.length ? pic(queue[0]) : null;
  }
  return {
    kind: 'codec', width: info.width, height: info.height, rotation: info.rotation, frame,
    close() { closed = true; clear(); wake(); },
  };
}

// 나. 찾아가서 꺼내기. 브라우저가 틀 수 없는 파일이면 던진다.
async function seekReel(blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  const heard = (name) => new Promise((resolve, reject) => {
    const off = () => { clearTimeout(timer); v.removeEventListener(name, ok); v.removeEventListener('error', bad); };
    const ok = () => { off(); resolve(); };
    const bad = () => { off(); reject(new Error('영상을 읽지 못했어요')); };
    const timer = setTimeout(bad, WAIT_MS);
    v.addEventListener(name, ok);
    v.addEventListener('error', bad);
  });
  const close = () => {
    v.removeAttribute('src');
    try { v.load(); } catch { /* 이미 비었다 */ }
    URL.revokeObjectURL(url);
  };
  try {
    v.src = url;
    await heard('loadedmetadata');
    if (!v.videoWidth || !v.videoHeight) throw new Error('영상이 아니에요');
  } catch (ex) {
    close();
    throw ex;
  }
  let shown = -1;
  return {
    kind: 'seek', width: v.videoWidth, height: v.videoHeight, rotation: 0, close,
    async frame(t) {
      const end = Number.isFinite(v.duration) ? v.duration : t;
      const at = Math.min(Math.max(0, t) + SEEK_SLACK, Math.max(SEEK_SLACK, end - 0.001));
      if (shown !== at || v.readyState < 2) {
        v.currentTime = at;                       // (늘 0 보다 크다: 틀지 않은 영상은 0초의 장면을 풀어 두지 않는 브라우저가 있다)
        await heard('seeked');
        shown = at;
      }
      return { source: v, width: v.videoWidth, height: v.videoHeight, rotation: 0 };
    },
  };
}

/**
 * 영상 파일(Blob)의 릴을 연다. 돌려주는 것: {
 *   kind: 'codec'(풀어서 꺼낸다) | 'seek'(찾아가서 꺼낸다)
 *   frame(t): t 초에 보이는 장면 { source(canvas 에 그릴 수 있는 것: VideoFrame 또는 <video>), width, height, rotation(시계 방향으로 돌려 그릴 각도) }
 *             source 는 다음 frame() 을 부르기 전까지만 쓸 수 있다(오래 둘 것은 createImageBitmap 으로 베껴 둔다)
 *   close(): 다 썼을 때
 * }
 * 브라우저가 틀 수 없는 파일이면 던진다.
 */
export async function openReel(blob) {
  let reel = null;
  try { reel = await codecReel(blob); } catch (ex) { console.warn(ex); }
  if (!reel) reel = await seekReel(blob);
  let closed = false;
  return {
    get kind() { return reel.kind; },
    async frame(t) {
      try {
        return await reel.frame(t);
      } catch (ex) {
        // 풀다가 실패했다(디코더가 그 파일을 끝까지 받아 주지 않는다 등): 찾아가서 꺼내는 길로 바꿔 이어 간다.
        if (closed || reel.kind === 'seek') throw ex;
        console.warn(ex);
        reel.close();
        reel = await seekReel(blob);
        if (closed) { reel.close(); return null; }
        await pause(0);
        return reel.frame(t);
      }
    },
    close() { closed = true; reel.close(); },
  };
}
