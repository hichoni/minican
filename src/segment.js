// 배경 제거의 "주인공 찾기"(AI). U²-Net(작은 판)을 onnxruntime-web 으로 브라우저 안에서 돌린다.
// 사진은 기기 밖으로 나가지 않는다. 모델(약 4.4MB)과 실행기(약 11MB)는 처음 한 번 받고 브라우저가 기억한다.
// 결과는 320×320 의 0~1 마스크(1 = 주인공). 사진 크기에 맞추고 경계를 다듬는 일은 cutout.js 의 refineCutout.
import { normalizeMask } from './cutout.js';

export const MODEL_SIZE = 320;
const ORT_VERSION = '1.29.0';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MODEL_URL = new URL('./models/u2netp.onnx', import.meta.url).href;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let loading = null;

/** 모델을 한 번만 불러온다. onProgress(0~1) 로 받는 정도를 알린다. */
export function loadSegmenter(onProgress = () => {}) {
  loading ||= (async () => {
    const ort = await import(/* 묶지 않는다 */ `${ORT_BASE}ort.wasm.min.mjs`);
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`model ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 4574861;
    const reader = res.body?.getReader?.();
    let bytes;
    if (reader) {
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        onProgress(Math.min(1, got / total));
      }
      bytes = new Uint8Array(got);
      let at = 0;
      for (const c of chunks) { bytes.set(c, at); at += c.length; }
    } else bytes = new Uint8Array(await res.arrayBuffer());
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { ort, session };
  })();
  loading.catch(() => { loading = null; });          // 실패하면 다음에 다시 받아 본다
  return loading;
}

/** 모델 입력: 사진을 320×320 으로 줄여 [1,3,320,320] 로(rembg 와 같은 정규화: 가장 밝은 값으로 나눈 뒤 평균 · 표준편차). */
export function toInput(rgba, size = MODEL_SIZE) {
  const n = size * size;
  let max = 1;
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) if (rgba[p * 4 + c] > max) max = rgba[p * 4 + c];
  const out = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) out[c * n + p] = (rgba[p * 4 + c] / max - MEAN[c]) / STD[c];
  return out;
}

/** source(canvas · ImageBitmap 등)에서 주인공 마스크를 찾는다. { mask: Float32Array(320×320), size } */
export async function findSubject(source, onProgress) {
  const { ort, session } = await loadSegmenter(onProgress);
  const c = document.createElement('canvas');
  c.width = MODEL_SIZE; c.height = MODEL_SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';                                  // 투명한 곳은 흰 바탕으로 본다
  ctx.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
  ctx.drawImage(source, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const input = new ort.Tensor('float32', toInput(ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data), [1, 3, MODEL_SIZE, MODEL_SIZE]);
  const out = await session.run({ [session.inputNames[0]]: input });
  const first = out[session.outputNames[0]];
  return { mask: normalizeMask(first.data), size: MODEL_SIZE };
}
