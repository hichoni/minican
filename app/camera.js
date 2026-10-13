// 카메라로 장면 찍기. 화면에 보여 줄 미리 보기(<video>)와, 찍기·멈추기를 맡는다.
// 찍는 것은 카메라가 주는 그림 그대로다(화면 모양에 맞춰 자르는 일은 편집기가 그릴 때 한다). 그래서 나중에 화면 모양을 바꿔도 된다.
import { fixWebmBlob } from './webm.js';

// 찍을 때 쓸 파일 종류: 가벼운 것부터(느린 기기에서도 끊기지 않게).
const RECORD_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];
const pickType = () => (typeof MediaRecorder === 'function' ? RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : '') || '';

/** 이 기기에서 카메라로 찍을 수 있는지. */
export function canRecord() {
  return !!(navigator.mediaDevices?.getUserMedia && pickType());
}

// 찍은 파일의 진짜 길이를 잰다(머리말에 길이가 없으면 끝까지 건너뛰어 알아낸다). 못 재면 0.
async function measure(blob) {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'metadata';
  const url = URL.createObjectURL(blob);
  try {
    v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; setTimeout(rej, 6000); });
    if (!Number.isFinite(v.duration)) {
      await new Promise((res) => { v.ondurationchange = () => { if (Number.isFinite(v.duration)) res(); }; v.currentTime = 1e7; setTimeout(res, 4000); });
    }
    return { seconds: Number.isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight };
  } catch {
    return { seconds: 0, width: 0, height: 0 };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * 카메라를 만든다. 돌려주는 것:
 *   video(미리 보기 요소) · open() · close() · flip() · start({ maxSeconds, onTick }) · stop() · recording · facing · canFlip()
 */
export function createCamera() {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  let stream = null;
  let facing = 'user';
  let recorder = null;
  let chunks = [];
  let began = 0;
  let tick = 0;
  let limit = 0;
  let finish = null;
  let turn = 0;                 // 카메라를 켜는 사이에 닫거나 또 켜면, 늦게 켜진 쪽은 바로 끈다(카메라가 켜진 채 남지 않게)

  /** 카메라를 켠다. { audio: 마이크도 켜졌는지 } 켜는 사이에 닫혔으면 null. */
  async function open() {
    close();
    const mine = turn;
    const wantVideo = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: facing };
    let got = null;
    try {
      got = await navigator.mediaDevices.getUserMedia({ video: wantVideo, audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (ex) {
      // 마이크가 없거나 막혀 있으면 그림만이라도 찍는다. 카메라까지 안 되면 그 오류를 그대로 알린다.
      if (mine !== turn) return null;
      if (ex?.name === 'NotAllowedError' || ex?.name === 'SecurityError') throw ex;
      got = await navigator.mediaDevices.getUserMedia({ video: wantVideo, audio: false });
    }
    if (mine !== turn) { got.getTracks().forEach((t) => t.stop()); return null; }
    stream = got;
    video.srcObject = stream;
    video.classList.toggle('mirror', facing === 'user');
    try { await video.play(); } catch { /* 보이게 되면 저절로 튼다 */ }
    return { audio: stream.getAudioTracks().length > 0 };
  }

  function close() {
    turn += 1;
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* 이미 멈춤 */ } }
    recorder = null;
    clearInterval(tick);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }

  async function canFlip() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'videoinput').length > 1;
    } catch { return false; }
  }
  /** 앞 카메라 ↔ 뒤 카메라. */
  let flipping = false;
  async function flip() {
    if (recorder || flipping) return;
    flipping = true;
    facing = facing === 'user' ? 'environment' : 'user';
    try { await open(); } finally { flipping = false; }
  }

  /** 찍기 시작. maxSeconds 가 지나면 저절로 멈춘다. onTick(지난 초)를 0.1초마다 부른다. 끝나면 stop() 과 같은 것을 onDone 으로 알린다. */
  function start({ maxSeconds, onTick = () => {}, onDone = () => {} }) {
    if (!stream || recorder) return false;
    const mime = pickType();
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3000000, audioBitsPerSecond: 128000 });
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    limit = maxSeconds;
    const rec = recorder;
    finish = new Promise((resolve) => {
      rec.onstop = async () => {
        clearInterval(tick);
        const timed = (performance.now() - began) / 1000;
        const type = (mime.split(';')[0]) || 'video/webm';
        let blob = new Blob(chunks, { type });
        chunks = [];
        recorder = null;
        if (!blob.size) { resolve(null); return; }
        blob = await fixWebmBlob(blob, timed);
        const real = await measure(blob);
        // 파일에서 잰 길이를 믿되, 못 쟀으면 시계로 잰 길이를 쓴다.
        const seconds = real.seconds > 0 ? real.seconds : timed;
        resolve({ blob, type, seconds: Math.round(seconds * 100) / 100, width: real.width, height: real.height });
      };
    });
    finish.then(onDone);
    recorder.start(1000);
    began = performance.now();
    tick = setInterval(() => {
      const s = (performance.now() - began) / 1000;
      onTick(Math.min(s, limit));
      if (s >= limit) stop();
    }, 100);
    return true;
  }

  /** 찍기를 멈춘다. 찍은 것 { blob, type, seconds, width, height } 을 돌려준다(아무것도 안 찍혔으면 null). */
  function stop() {
    if (!recorder) return finish || Promise.resolve(null);
    clearInterval(tick);
    if (recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* 이미 멈춤 */ } }
    return finish;
  }

  return {
    video, open, close, flip, canFlip, start, stop,
    get recording() { return !!recorder; },
    get facing() { return facing; },
    get opened() { return !!stream; },
  };
}
