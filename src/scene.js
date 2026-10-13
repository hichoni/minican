// 온바탕 편집기의 영상 장면(브라우저): 한 장의 바탕에 까는 영상(design.video)을 그리고, 틀고, 그 한 장면을 그림으로 꺼낸다.
// 영상 파일은 디자인에 들어 있지 않다. 디자인에 적힌 열쇠(src)로 프로젝트의 저장소에서 꺼낸다(configure({ loadVideo })).
//   - sceneView: 쓰는 구간의 첫 모습을 그림으로 보여 주는 요소. 작은 그림 · 내려받는 그림 · 영상으로 만들 때의 바탕이 된다(designView 가 깐다).
//   - scenePlayer: 그 요소 위에 진짜 영상을 얹어 트는 조종기. 꾸미기 판과 발표 화면이 쓴다.
// 파일이 이 기기에 없으면(다른 기기에서 넣은 영상) "영상이 없어요"로 보인다.
import { el } from './dom.js';
import { icon } from './icons.js';
import { settings, cleanVideo } from './model.js';

/** 영상 파일을 고를 때 받는 종류(틀 수 있는지는 골라 온 뒤에 probeVideo 로 본다). */
export const ACCEPT_VIDEOS = 'video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov';
const WAIT_MS = 10000;          // 영상을 읽는 일(첫 장면 · 찾아가기)을 기다리는 가장 긴 시간
const FRAMES = 30;              // 기억해 두는 장면 그림의 수
const END_SLACK = 0.03;         // 끝에서 이만큼(초) 안쪽이면 끝에 닿은 것으로 본다

const urls = new Map();         // 열쇠 → 파일을 꺼내는 약속({ blob, url(blob: 주소) } 또는 null)
const frames = new Map();       // '열쇠|시각|크기' → 장면 그림을 만드는 약속({ url, width, height } 또는 null)
const stills = new Map();       // 같은 이름 → 다 만들어진 장면 그림(기다리지 않고 바로 꺼내 쓸 수 있는 것)
const waits = new WeakMap();    // 장면 요소 → 그림이 놓이면(또는 없다고 정해지면) 풀리는 약속
let line = Promise.resolve();   // 장면 그림은 한 번에 하나씩 만든다(영상 여러 개를 한꺼번에 풀지 않게)

// 영상 파일을 꺼낸다: { blob, url(blob: 주소) }. 이 기기에 없으면 null. 꺼낸 것은 기억해 둔다(없던 것은 기억하지 않는다: 나중에 다시 넣을 수 있다).
function sceneFile(src) {
  if (urls.has(src)) return urls.get(src);
  const load = settings().loadVideo;
  const job = Promise.resolve().then(() => (load ? load(src) : null))
    .then((blob) => (blob instanceof Blob && blob.size ? { blob, url: URL.createObjectURL(blob) } : null))
    .catch((ex) => { console.warn(ex); return null; });
  urls.set(src, job);
  job.then((file) => { if (!file && urls.get(src) === job) urls.delete(src); });
  return job;
}
/** 영상 파일의 주소(blob:). 이 기기에 없으면 null. */
export const sceneUrl = (src) => sceneFile(src).then((file) => (file ? file.url : null));
/** 영상 파일 그 자체(Blob). 이 기기에 없으면 null. 영상으로 내려받을 때 조각을 직접 읽으려고 쓴다. */
export const sceneBlob = (src) => sceneFile(src).then((file) => (file ? file.blob : null));
/** 방금 넣은 영상을 바로 쓸 수 있게 기억해 둔다(저장소에서 다시 읽지 않는다). */
export function keepScene(src, blob) {
  dropScene(src);
  if (blob instanceof Blob && blob.size) urls.set(src, Promise.resolve({ blob, url: URL.createObjectURL(blob) }));
}
/** 그 영상의 주소와 장면 그림을 잊는다(파일을 지웠을 때). */
export function dropScene(src) {
  const job = urls.get(src);
  urls.delete(src);
  job?.then((file) => { if (file) URL.revokeObjectURL(file.url); });
  for (const key of [...frames.keys()]) if (key.startsWith(`${src}|`)) { frames.delete(key); stills.delete(key); }
}

// 영상 요소에서 그 일(name)이 일어나기를 기다린다. 오류가 나거나 너무 오래 걸리면 그만둔다.
const heard = (node, name, ms = WAIT_MS) => new Promise((resolve, reject) => {
  const off = () => { clearTimeout(timer); node.removeEventListener(name, ok); node.removeEventListener('error', bad); };
  const ok = () => { off(); resolve(); };
  const bad = () => { off(); reject(new Error('영상을 읽지 못했어요')); };
  const timer = setTimeout(bad, ms);
  node.addEventListener(name, ok);
  node.addEventListener('error', bad);
});
const quiet = () => {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  return v;
};
const unload = (v) => { v.removeAttribute('src'); try { v.load(); } catch { /* 이미 비었다 */ } };
// 영상을 읽어 t 초의 모습이 그려질 수 있게 한다. 길이와 크기를 알게 된 뒤(loadedmetadata), 그 자리로 찾아가서 그 장면을 풀게 한다.
// (틀지 않은 영상은 첫 장면을 저절로 풀어 두지 않는 브라우저가 있다. 그때는 아주 조금 앞으로 찾아가면 첫 장면이 풀린다)
async function showFrame(v, t) {
  if (v.readyState < 1) await heard(v, 'loadedmetadata');
  if (t > 0.03 || v.readyState < 2) {
    v.currentTime = t > 0.03 ? t : 0.001;
    await heard(v, 'seeked');
  }
}

async function grab(src, t, edge) {
  const url = await sceneUrl(src);
  if (!url) return null;
  const v = quiet();
  try {
    v.src = url;
    await showFrame(v, t);
    if (!v.videoWidth || !v.videoHeight) return null;
    const k = Math.min(1, edge / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(v.videoWidth * k));
    canvas.height = Math.max(2, Math.round(v.videoHeight * k));
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    return { url: canvas.toDataURL('image/jpeg', 0.88), width: canvas.width, height: canvas.height };
  } finally {
    unload(v);
  }
}

/**
 * 영상 장면의 첫 모습(쓰는 구간의 시작)을 그림으로 꺼낸다. edge: 그림의 긴 쪽(px. 원본보다 키우지는 않는다).
 * 돌려주는 것: { url(data 주소), width, height }. 파일이 이 기기에 없거나 읽지 못하면 null.
 */
const frameKey = (v, edge) => `${v.src}|${v.in}|${Math.round(edge)}`;
export function sceneFrame(video, { edge = 640 } = {}) {
  const v = cleanVideo(video);
  if (!v) return Promise.resolve(null);
  const key = frameKey(v, edge);
  const had = frames.get(key);
  if (had) {
    frames.delete(key);          // 방금 쓴 것을 맨 뒤로(오래 안 쓴 것부터 잊는다)
    frames.set(key, had);
    return had;
  }
  const job = line.then(() => grab(v.src, v.in, edge)).catch((ex) => { console.warn(ex); return null; });
  line = job;
  frames.set(key, job);
  job.then((frame) => {
    if (frames.get(key) !== job) return;
    if (frame) stills.set(key, frame); else frames.delete(key);
  });
  while (frames.size > FRAMES) {
    const old = frames.keys().next().value;
    frames.delete(old);
    stills.delete(old);
  }
  return job;
}

/**
 * 영상 장면을 그린 요소(카드의 바탕에 깐다). 먼저 빈 채로 돌려주고, 첫 모습의 그림이 준비되면 채운다.
 * 파일이 이 기기에 없으면 "이 기기에는 영상이 없어요"가 보인다(.missing).
 * edge: 그림의 긴 쪽(px). 작은 그림에는 작게, 내려받을 때는 크게.
 * note: 거짓이면 "영상이 없어요" 이름표를 넣지 않는다(그림 · 영상으로 내보낼 때: 화면의 안내가 내보낸 것에 찍히지 않게. 그때는 카드의 바탕색만 나온다).
 */
export function sceneView(video, { edge = 640, note = true } = {}) {
  const v = cleanVideo(video);
  const node = el('div', { class: `fe-scene fit-${v?.fit || 'cover'} loading`, dataset: { scene: v?.src || '' } },
    note ? el('span', { class: 'fe-scene-note' }, icon('video'), el('b', { text: '이 기기에는 영상이 없어요' })) : null);
  const still = (frame) => {
    const img = el('img', { class: 'fe-scene-still', alt: '', draggable: 'false' });
    img.src = frame.url;
    return img;
  };
  // 이미 만들어 둔 그림이 있으면 바로 놓는다(꾸밀 때마다 다시 그리는 작은 그림이 깜빡이지 않게).
  const made = v ? stills.get(frameKey(v, edge)) : null;
  if (made) {
    sceneFrame(v, { edge });       // 방금 썼다고 알린다(오래 안 쓴 것부터 잊으므로)
    node.classList.remove('loading');
    node.prepend(still(made));
    waits.set(node, Promise.resolve(true));
    return node;
  }
  waits.set(node, sceneFrame(v, { edge }).then(async (frame) => {
    node.classList.remove('loading');
    if (!frame) { node.classList.add('missing'); return false; }
    const img = still(frame);
    try { await img.decode(); } catch { /* 그려지기는 한다 */ }
    node.prepend(img);
    return true;
  }));
  return node;
}
/** root 안의 영상 장면들이 다 그려질 때까지 기다린다(그림으로 내보내기 전에 부른다). */
export function scenesReady(root) {
  const nodes = [...(root?.matches?.('.fe-scene') ? [root] : []), ...(root?.querySelectorAll?.('.fe-scene') || [])];
  return Promise.all(nodes.map((n) => waits.get(n)));
}

/**
 * 장면 요소(sceneView) 위에 진짜 영상을 얹어 트는 조종기. 쓰는 구간(in ~ out)만 튼다:
 * 처음에는 시작 모습에 멈춰 있고, 틀면 끝에 닿았을 때 마지막 모습에서 멈춘다.
 * 돌려주는 것: {
 *   node(<video>) · ready(약속: 틀 수 있으면 true. 파일이 이 기기에 없거나 읽지 못하면 false)
 *   play({ from }): 튼다(from 초부터. 안 주면 멈춘 자리에서, 끝에 있었으면 처음부터). 틀었으면 true
 *   pause() · seek(초): 그 모습을 보여 준다(멈춘 채) · set(video): 구간 · 소리 · 화면 맞춤을 바꾼다(다른 파일이면 새로 만든다)
 *   playing · time(): 지금 시각(초) · destroy()
 * }
 * onState(틀고 있는지): 틀기 · 멈춤이 바뀔 때 · onEnd(): 끝까지 틀었을 때 · onTime(초): 트는 동안 화면이 바뀔 때마다
 */
export function scenePlayer(layer, video, { onState = () => {}, onEnd = () => {}, onTime = null } = {}) {
  let v = cleanVideo(video);
  // 쓸 수 없는 영상 장면: 아무것도 틀지 않는 조종기를 돌려준다(부르는 쪽이 따로 가리지 않아도 되게).
  if (!v) return { node: null, ready: Promise.resolve(false), play: async () => false, pause() {}, seek: async () => {}, set: () => false, playing: false, time: () => 0, destroy() {} };
  let alive = true;
  let playing = false;
  let tick = 0;
  const node = el('video', { class: 'fe-scene-live', playsinline: true, preload: 'auto', disablepictureinpicture: true, tabindex: '-1' });
  const loud = () => { node.volume = v.vol / 100; node.muted = v.vol === 0; };
  const fit = () => { layer.classList.remove('fit-cover', 'fit-contain'); layer.classList.add(`fit-${v.fit}`); };
  const halt = () => {
    cancelAnimationFrame(tick);
    if (!playing) return;
    playing = false;
    onState(false);
  };
  const check = () => {
    if (!alive || !playing) return;
    if (node.ended || node.currentTime >= v.out - END_SLACK) {
      node.pause();
      halt();
      // 마지막 모습에 멈춰 둔다(구간의 끝이 원본의 끝보다 앞이면 그 자리로 되돌린다)
      if (!node.ended) { try { node.currentTime = Math.max(v.in, v.out - END_SLACK); } catch { /* 그대로 둔다 */ } }
      onEnd();
    }
  };
  const loop = () => {
    cancelAnimationFrame(tick);
    const step = () => {
      if (!alive || !playing) return;
      check();
      if (!playing) return;
      onTime?.(node.currentTime);
      tick = requestAnimationFrame(step);
    };
    tick = requestAnimationFrame(step);
  };
  node.addEventListener('timeupdate', check);      // 창이 가려져 화면이 쉬는 동안에도 끝에서 멈추게
  node.addEventListener('ended', check);
  node.addEventListener('pause', () => { if (playing && !node.ended && node.currentTime < v.out - END_SLACK) halt(); });      // 브라우저가 멈췄다(창이 가려지는 등)
  // 조종기를 거치지 않고 틀어졌을 때(글자판의 재생 글쇠 · 브라우저의 미디어 단추): 틀고 있는 것으로 알고, 쓰는 구간의 끝에서 멈추게 한다.
  node.addEventListener('play', () => {
    if (!alive || playing) return;
    if (node.currentTime >= v.out - END_SLACK || node.currentTime < v.in - 0.05) node.currentTime = v.in;
    playing = true;
    onState(true);
    loop();
  });
  loud();
  fit();
  const ready = sceneUrl(v.src).then(async (url) => {
    if (!alive || !url) return false;
    try {
      node.src = url;
      await showFrame(node, v.in);
    } catch (ex) {
      console.warn(ex);
      return false;
    }
    if (!alive) return false;
    layer.append(node);
    layer.classList.add('live');
    return true;
  });
  const api = {
    node, ready,
    async play({ from = null } = {}) {
      if (!(await ready) || !alive) return false;
      const here = node.currentTime;
      const at = Number.isFinite(from) ? Math.min(v.out - 0.1, Math.max(v.in, from)) : here >= v.out - 0.15 || here < v.in - 0.05 ? v.in : here;
      if (Math.abs(here - at) > 0.03) node.currentTime = at;
      loud();
      try {
        await node.play();
      } catch (ex) {
        // 소리가 나는 영상을 브라우저가 저절로 틀지 못하게 막았다: 소리를 끄고 튼다(그림은 보이게)
        if (ex?.name !== 'NotAllowedError' || node.muted) return false;
        node.muted = true;
        try { await node.play(); } catch { return false; }
      }
      if (!alive) { node.pause(); return false; }
      // (틀어지는 순간 위의 'play' 가 먼저 알아챘을 수 있다)
      if (!playing) { playing = true; onState(true); }
      loop();
      return true;
    },
    pause() {
      if (!node.paused) node.pause();
      halt();
    },
    async seek(t) {
      if (!(await ready) || !alive) return;
      api.pause();
      node.currentTime = Math.min(v.dur, Math.max(0, Number(t) || 0));
    },
    set(next) {
      const n = cleanVideo(next);
      if (!n || n.src !== v.src) return false;
      v = n;
      loud();
      fit();
      return true;
    },
    get playing() { return playing; },
    time: () => node.currentTime,
    destroy() {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(tick);
      try { node.pause(); } catch { /* 이미 멈췄다 */ }
      playing = false;
      node.remove();
      unload(node);
      layer.classList.remove('live');
    },
  };
  return api;
}

/**
 * 영상 파일을 살펴본다: 이 브라우저에서 틀 수 있는지, 길이와 크기는 얼마인지.
 * 돌려주는 것: { seconds, width, height }. 틀 수 없는 파일이면 null.
 */
export async function probeVideo(blob) {
  const v = quiet();
  const url = URL.createObjectURL(blob);
  try {
    v.src = url;
    await heard(v, 'loadedmetadata');
    // 녹화하면서 흘려보낸 파일은 길이가 적혀 있지 않을 수 있다. 끝까지 건너뛰어 알아낸다.
    if (!Number.isFinite(v.duration)) {
      await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); v.removeEventListener('durationchange', seen); resolve(); };
        const seen = () => { if (Number.isFinite(v.duration)) done(); };
        const timer = setTimeout(done, 4000);
        v.addEventListener('durationchange', seen);
        v.currentTime = 1e7;
      });
    }
    if (!Number.isFinite(v.duration) || !v.videoWidth || !v.videoHeight) return null;
    return { seconds: Math.round(v.duration * 100) / 100, width: v.videoWidth, height: v.videoHeight };
  } catch {
    return null;
  } finally {
    unload(v);
    URL.revokeObjectURL(url);
  }
}
