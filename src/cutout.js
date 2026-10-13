// 사진 배경 지우기(배경 제거). 가장자리와 이어진 "배경색과 비슷한 색"을 투명하게 만든다.
// 흰 종이 위의 그림, 한 가지 색 배경의 사진처럼 배경이 단순할 때 잘 된다(사람이 찍힌 복잡한 사진은 깔끔하지 않을 수 있다).
// 여기에는 계산만 둔다(DOM 없음). 픽셀은 RGBA 가 차례로 들어 있는 배열이다(canvas 의 ImageData.data 와 같다).

export const TOLERANCE = { min: 8, max: 150, start: 44 };

const SOFT = 0.6;          // 경계를 부드럽게 할 폭(지우는 정도의 60%만큼 더)

/**
 * 가장자리에서 가장 많이 보이는 색(배경색으로 본다). { r, g, b }
 * 가장자리가 이미 거의 투명하면 null(더 지울 배경이 없다).
 */
export function borderColor(data, w, h) {
  const buckets = new Map();
  let total = 0;
  let clear = 0;
  const see = (x, y) => {
    const i = (y * w + x) * 4;
    total++;
    if (data[i + 3] < 16) { clear++; return; }
    const key = (data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3);
    const b = buckets.get(key) || [0, 0, 0, 0];
    b[0] += data[i]; b[1] += data[i + 1]; b[2] += data[i + 2]; b[3]++;
    buckets.set(key, b);
  };
  for (let x = 0; x < w; x++) { see(x, 0); if (h > 1) see(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { see(0, y); if (w > 1) see(w - 1, y); }
  if (!total || clear / total > 0.9) return null;
  let best = null;
  for (const b of buckets.values()) if (!best || b[3] > best[3]) best = b;
  return { r: best[0] / best[3], g: best[1] / best[3], b: best[2] / best[3] };
}

/**
 * 배경을 지운 새 픽셀 배열을 돌려준다. { data, removed(지운 픽셀 수), total }
 * - tolerance: 지우는 정도(배경색과 이만큼까지 다른 색도 배경으로 본다). 클수록 많이 지운다.
 * - inside: true 면 가장자리와 이어지지 않은 안쪽(글자 "ㅇ" 속 같은 곳)의 같은 색도 지운다.
 * 받은 배열은 건드리지 않는다.
 */
export function removeBackground(data, w, h, { tolerance = TOLERANCE.start, inside = false } = {}) {
  const out = new Uint8ClampedArray(data);
  const total = w * h;
  const ref = borderColor(data, w, h);
  if (!ref || !total) return { data: out, removed: 0, total };
  const tol = Math.min(TOLERANCE.max, Math.max(1, tolerance));
  const tol2 = tol * tol;
  // 배경색과 얼마나 다른지(거리의 제곱). 이미 투명한 곳은 배경으로 본다.
  const far2 = (p) => {
    const i = p * 4;
    if (data[i + 3] < 16) return 0;
    const dr = data[i] - ref.r;
    const dg = data[i + 1] - ref.g;
    const db = data[i + 2] - ref.b;
    return dr * dr + dg * dg + db * db;
  };

  const gone = new Uint8Array(total);
  let removed = 0;
  if (inside) {
    for (let p = 0; p < total; p++) if (far2(p) <= tol2) { gone[p] = 1; removed++; }
  } else {
    // 가장자리에서 시작해 이어진 곳으로 번져 간다.
    const stack = new Int32Array(total);
    let top = 0;
    const push = (p) => { if (!gone[p] && far2(p) <= tol2) { gone[p] = 1; removed++; stack[top++] = p; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (top) {
      const p = stack[--top];
      const x = p % w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (p >= w) push(p - w);
      if (p < total - w) push(p + w);
    }
  }

  // 지운 곳은 투명하게, 지운 곳 바로 옆(경계)은 색이 배경과 비슷한 만큼 반투명하게 해서 테두리가 거칠지 않게 한다.
  for (let p = 0; p < total; p++) {
    if (gone[p]) { out[p * 4 + 3] = 0; continue; }
    const x = p % w;
    const edge = (x > 0 && gone[p - 1]) || (x < w - 1 && gone[p + 1]) || (p >= w && gone[p - w]) || (p < total - w && gone[p + w]);
    if (!edge) continue;
    const d = Math.sqrt(far2(p));
    const keep = (d - tol) / (tol * SOFT);
    if (keep < 1) out[p * 4 + 3] = Math.round(data[p * 4 + 3] * Math.max(0.15, keep));
  }
  return { data: out, removed, total };
}

// ======================================================================
// 정교한 배경 제거(2026-10-13)
//   ① 주인공을 찾고(AI 모델 segment.js, 또는 단색 배경이면 colorAlpha)
//   ② 거친 윤곽을 사진의 실제 경계에 맞춰 붙이고(snapEdges — 둘레의 주인공 색 · 배경색으로 가르기,
//      guidedFilter — 밝기가 바뀌는 곳을 따라 머리카락·털 같은 가는 경계까지)
//   ③ 떨어진 부스러기 · 작은 구멍을 치우고(cleanAlpha)
//   ④ 가장자리를 단단하게/부드럽게(alphaCurve)
//   ⑤ 지우개 · 살리개 붓질을 얹고(paintStrokes)
//   ⑥ 가장자리에 묻은 배경색(흰 테두리 · 후광)을 걷어 낸다(decontaminate)
// 모두 DOM 없는 계산이다. 알파(alpha)는 0~1 의 Float32Array(픽셀마다 하나).
// ======================================================================

/** 모델이 낸 값을 0~1 로 펼친다(가장 작은 값 0, 가장 큰 값 1 — rembg 와 같은 정규화). */
export function normalizeMask(pred) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pred.length; i++) { const v = pred[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const out = new Float32Array(pred.length);
  const span = hi - lo;
  if (!(span > 1e-6)) return out;
  for (let i = 0; i < pred.length; i++) out[i] = (pred[i] - lo) / span;
  return out;
}

/** 작은 마스크(mw×mh)를 사진 크기(w×h)로 늘린다(두 방향 선형). */
export function resizeMask(mask, mw, mh, w, h) {
  const out = new Float32Array(w * h);
  const sx = mw / w, sy = mh / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(mh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(mh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(mw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(mw - 1, x0 + 1), tx = fx - x0;
      const a = mask[y0 * mw + x0] * (1 - tx) + mask[y0 * mw + x1] * tx;
      const b = mask[y1 * mw + x0] * (1 - tx) + mask[y1 * mw + x1] * tx;
      out[y * w + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/** 사진의 밝기(0~1). 경계를 따라가는 안내판으로 쓴다. */
export function grayOf(data, w, h) {
  const out = new Float32Array(w * h);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) out[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  return out;
}

// 반지름 r 네모 안의 평균(적분 영상으로 픽셀마다 한 번에). 가장자리는 들어오는 칸만 센다.
function boxMean(src, w, h, r) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += src[y * w + x]; sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const s = sum[(y1 + 1) * W + x1 + 1] - sum[y0 * W + x1 + 1] - sum[(y1 + 1) * W + x0] + sum[y0 * W + x0];
      out[y * w + x] = s / ((x1 - x0 + 1) * (y1 - y0 + 1));
    }
  }
  return out;
}

/**
 * 안내 필터(guided filter, He 외 2010): 거친 마스크 p 를 사진 I 의 경계에 맞춰 다시 그린다.
 * 사진에서 밝기가 갑자기 바뀌는 곳(진짜 테두리)에서 마스크도 갑자기 바뀌고, 평평한 곳에서는 부드럽게 이어진다.
 */
export function guidedFilter(I, p, w, h, r = 4, eps = 1e-3) {
  const n = w * h;
  const Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r), mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIp[i] - mI[i] * mp[i];
    const v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = Math.min(1, Math.max(0, ma[i] * I[i] + mb[i]));
  return q;
}

/**
 * 색으로 테두리 붙이기: AI 윤곽은 몇 픽셀 넉넉하거나 모자랄 수 있다. 윤곽 둘레 band 픽셀 띠 안에서만,
 * 띠 밖의 "확실한 주인공 색"(F)과 "확실한 배경색"(B)을 둘레에서 어림해 픽셀 색 C 가 어느 쪽에 가까운지로 알파를 다시 정한다
 * (a = (C-B)·(F-B) / |F-B|², 매팅의 간단한 판). 두 색이 비슷하면(흰 옷 · 흰 벽) 색으로는 못 가르므로 원래 값을 둔다.
 */
export function snapEdges(data, alpha, w, h, band = 3) {
  const n = w * h;
  const solid = new Float32Array(n);
  for (let p = 0; p < n; p++) solid[p] = alpha[p] >= 0.5 ? 1 : 0;
  const near = boxMean(solid, w, h, band);                // 0 < near < 1 이면 윤곽에서 band 안
  const fgW = new Float32Array(n), bgW = new Float32Array(n);
  const ch = [0, 1, 2].map(() => [new Float32Array(n), new Float32Array(n)]);
  for (let p = 0; p < n; p++) {
    const f = near[p] >= 1 - 1e-6 ? 1 : 0, b = near[p] <= 1e-6 ? 1 : 0;
    fgW[p] = f; bgW[p] = b;
    for (let c = 0; c < 3; c++) { ch[c][0][p] = data[p * 4 + c] * f; ch[c][1][p] = data[p * 4 + c] * b; }
  }
  const R = band * 3;
  const mf = boxMean(fgW, w, h, R), mb = boxMean(bgW, w, h, R);
  const sums = ch.map(([f, b]) => [boxMean(f, w, h, R), boxMean(b, w, h, R)]);
  const out = new Float32Array(alpha);
  for (let p = 0; p < n; p++) {
    if (near[p] <= 1e-6 || near[p] >= 1 - 1e-6 || mf[p] < 0.02 || mb[p] < 0.02) continue;
    let dot = 0, len = 0;
    for (let c = 0; c < 3; c++) {
      const F = sums[c][0][p] / mf[p], B = sums[c][1][p] / mb[p];
      dot += (data[p * 4 + c] - B) * (F - B); len += (F - B) * (F - B);
    }
    const gap = Math.sqrt(len);
    if (gap < 24) continue;
    const a = Math.min(1, Math.max(0, dot / len));
    const sure = Math.min(1, (gap - 24) / 56);             // 두 색이 멀수록 색을 더 믿는다
    out[p] = alpha[p] * (1 - sure) + a * sure;
  }
  return out;
}

/**
 * 부스러기 치우기: 주인공(알파 ≥ 0.5)에서 떨어진 작은 조각은 지우고, 주인공 안의 작은 구멍은 메운다.
 * minPart: 가장 큰 조각의 이 비율보다 작은 조각은 지운다. hole: 사진 넓이의 이 비율보다 작은 구멍은 메운다.
 * 얇은 것 살리기: 모델은 작은 그림(320×320)으로 보므로 빨대 · 끈 · 안테나처럼 가는 것은 흐리게(0.5 아래) 나온다.
 *   - weak 이상의 흐린 길로 이어진 조각들은 한 덩어리로 본다(빨대 끝의 장식이 "떨어진 부스러기"로 지워지지 않게).
 *   - 단단한 조각 둘 이상을 잇는 흐린 길(다리)이 작으면(사진 넓이의 bridge 비율보다 작으면) 단단하게 바꾼다.
 *     주인공 둘레의 흐린 띠(한 조각에만 닿는다)나, 손잡이 안쪽처럼 넓은 빈 곳은 건드리지 않는다.
 */
export function cleanAlpha(alpha, w, h, { minPart = 0.04, hole = 0.002, weak = 0.15, bridge = 0.01 } = {}) {
  const n = w * h;
  const out = new Float32Array(alpha);
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const flood = (start, inside, id) => {
    let top = 0, size = 0, border = false;
    stack[top++] = start; label[start] = id;
    while (top) {
      const p = stack[--top]; size++;
      const x = p % w, y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      const look = (q) => { if (label[q] === -1 && (alpha[q] >= 0.5) === inside) { label[q] = id; stack[top++] = q; } };
      if (x > 0) look(p - 1);
      if (x < w - 1) look(p + 1);
      if (y > 0) look(p - w);
      if (y < h - 1) look(p + w);
    }
    return { size, border };
  };
  const parts = [], holes = [];
  for (let p = 0; p < n; p++) {
    if (label[p] !== -1) continue;
    const inside = alpha[p] >= 0.5;
    const id = parts.length + holes.length;
    const info = { id, ...flood(p, inside, id) };
    (inside ? parts : holes).push(info);
  }
  // 흐린 길(weak ≤ 알파 < 0.5)을 덩어리로 나누고, 그 길이 닿는 단단한 조각들을 모은다.
  const isPart = new Uint8Array(parts.length + holes.length);
  for (const c of parts) isPart[c.id] = 1;
  const root = new Int32Array(parts.length + holes.length).map((_, i) => i);
  const find = (i) => { while (root[i] !== i) { root[i] = root[root[i]]; i = root[i]; } return i; };
  const weakLabel = new Int32Array(n).fill(-1);
  const paths = [];
  for (let p = 0; p < n; p++) {
    if (weakLabel[p] !== -1 || alpha[p] >= 0.5 || alpha[p] < weak) continue;
    const id = paths.length;
    const touch = new Set();
    let top = 0, size = 0;
    stack[top++] = p; weakLabel[p] = id;
    while (top) {
      const q = stack[--top]; size++;
      const x = q % w, y = (q - x) / w;
      const look = (r) => {
        if (alpha[r] >= 0.5) { touch.add(label[r]); return; }
        if (weakLabel[r] === -1 && alpha[r] >= weak) { weakLabel[r] = id; stack[top++] = r; }
      };
      if (x > 0) look(q - 1);
      if (x < w - 1) look(q + 1);
      if (y > 0) look(q - w);
      if (y < h - 1) look(q + w);
    }
    paths.push({ size, touch: [...touch].filter((t) => isPart[t]) });
  }
  // 흐린 길로 이어진 조각들은 한 덩어리: 덩어리의 크기로 "부스러기"인지 정한다.
  for (const path of paths) for (let k = 1; k < path.touch.length; k++) root[find(path.touch[k])] = find(path.touch[0]);
  const lump = new Map();
  for (const c of parts) lump.set(find(c.id), (lump.get(find(c.id)) || 0) + c.size);
  const biggest = Math.max(0, ...lump.values());
  const drop = new Set(parts.filter((c) => lump.get(find(c.id)) < biggest * minPart).map((c) => c.id));
  const fill = new Set(holes.filter((c) => !c.border && c.size < n * hole).map((c) => c.id));
  // 남는 조각 둘 이상을 잇는 작은 흐린 길은 다리: 단단하게 바꿔 끊기지 않게 한다.
  const bridges = new Set();
  paths.forEach((path, id) => { if (path.size < n * bridge && path.touch.filter((t) => !drop.has(t)).length >= 2) bridges.add(id); });
  if (!drop.size && !fill.size && !bridges.size) return out;
  // 조각은 투명하게, 구멍은 불투명하게(가장자리의 부드러움은 다음 단계 alphaCurve 가 다시 만든다)
  for (let p = 0; p < n; p++) {
    if (drop.has(label[p])) out[p] = 0;
    else if (fill.has(label[p])) out[p] = 1;
    if (weakLabel[p] !== -1 && bridges.has(weakLabel[p])) out[p] = Math.max(out[p], 0.85);
  }
  return out;
}

/** 가장자리의 단단함: threshold(0~1) 를 가운데로 softness 폭만큼 부드럽게 넘어간다. */
export function alphaCurve(alpha, threshold = 0.5, softness = 0.25) {
  const out = new Float32Array(alpha.length);
  const lo = threshold - softness / 2, hi = threshold + softness / 2;
  const span = Math.max(1e-4, hi - lo);
  for (let i = 0; i < alpha.length; i++) {
    const t = Math.min(1, Math.max(0, (alpha[i] - lo) / span));
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}

/**
 * 붓질: strokes = [{ mode: 'erase'|'keep', size(사진 너비에 대한 비율), pts: [[x, y], …](0~1) }]
 * 지우개는 투명하게, 살리개는 원래대로(불투명) 칠한다. 붓 끝은 살짝 부드럽다.
 */
export function paintStrokes(alpha, w, h, strokes = []) {
  if (!strokes.length) return alpha;
  const out = new Float32Array(alpha);
  for (const s of strokes) {
    const r = Math.max(1, (s.size || 0.04) * w / 2);
    const target = s.mode === 'keep' ? 1 : 0;
    const pts = Array.isArray(s.pts) ? s.pts : [];
    for (let k = 0; k < pts.length; k++) {
      // 점 사이를 붓 반지름의 1/3 간격으로 메운다(빨리 그어도 끊기지 않게)
      const [ax, ay] = pts[Math.max(0, k - 1)], [bx, by] = pts[k];
      const dist = Math.hypot((bx - ax) * w, (by - ay) * h);
      const steps = Math.max(1, Math.ceil(dist / (r / 3)));
      for (let j = k === 0 ? 0 : 1; j <= steps; j++) {
        const cx = (ax + (bx - ax) * (j / steps)) * w, cy = (ay + (by - ay) * (j / steps)) * h;
        const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
        const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
          if (d >= 1) continue;
          const f = d < 0.7 ? 1 : (1 - d) / 0.3;          // 바깥 30% 는 부드럽게
          const i = y * w + x;
          out[i] = out[i] + (target - out[i]) * f;
        }
      }
    }
  }
  return out;
}

/**
 * 색 걷어 내기: 반투명 가장자리 픽셀은 배경색이 섞여 있다(흰 배경이면 하얀 테두리).
 * 둘레의 주인공 색(F)과 배경색(B)을 어림해 C = aF + (1-a)B 에서 F 를 되찾는다. 받은 배열은 건드리지 않는다.
 */
export function decontaminate(data, alpha, w, h, r = 3) {
  const n = w * h;
  const out = new Uint8ClampedArray(data);
  const fgW = new Float32Array(n), bgW = new Float32Array(n);
  const ch = [0, 1, 2].map(() => [new Float32Array(n), new Float32Array(n)]);
  for (let p = 0; p < n; p++) {
    const a = alpha[p];
    const f = a > 0.95 ? 1 : 0, b = a < 0.05 ? 1 : 0;
    fgW[p] = f; bgW[p] = b;
    for (let c = 0; c < 3; c++) { ch[c][0][p] = data[p * 4 + c] * f; ch[c][1][p] = data[p * 4 + c] * b; }
  }
  const mf = boxMean(fgW, w, h, r), mb = boxMean(bgW, w, h, r);
  const sums = ch.map(([f, b]) => [boxMean(f, w, h, r), boxMean(b, w, h, r)]);
  for (let p = 0; p < n; p++) {
    const a = alpha[p];
    if (a <= 0.02 || a >= 0.98) continue;
    const i = p * 4;
    for (let c = 0; c < 3; c++) {
      const F = mf[p] > 0 ? sums[c][0][p] / mf[p] : null;
      const B = mb[p] > 0 ? sums[c][1][p] / mb[p] : null;
      let v = data[i + c];
      if (B != null) v = (data[i + c] - (1 - a) * B) / a;           // 배경색을 빼고 주인공 색을 되찾는다
      if (F != null) v = a < 0.3 ? F : v * 0.6 + F * 0.4;           // 거의 투명한 곳은 주인공 색 그대로
      out[i + c] = Math.round(Math.min(255, Math.max(0, v)));
    }
  }
  return out;
}

/** 알파를 픽셀에 입힌다(원래 투명한 곳은 그대로 투명). 지운 넓이의 비율도 돌려준다. */
export function applyAlpha(data, alpha) {
  const out = new Uint8ClampedArray(data);
  let cleared = 0;
  for (let p = 0; p < alpha.length; p++) {
    const a = Math.round(data[p * 4 + 3] * Math.min(1, Math.max(0, alpha[p])));
    out[p * 4 + 3] = a;
    if (a < 128) cleared++;
  }
  return { data: out, cleared: cleared / (alpha.length || 1) };
}

/** 단색 배경 방식의 알파(가장자리와 이어진 배경색 = 0, 경계는 색 차이만큼 부드럽게). */
export function colorAlpha(data, w, h, { tolerance = TOLERANCE.start, inside = false } = {}) {
  const res = removeBackground(data, w, h, { tolerance, inside });
  const alpha = new Float32Array(w * h);
  for (let p = 0; p < alpha.length; p++) alpha[p] = data[p * 4 + 3] ? res.data[p * 4 + 3] / data[p * 4 + 3] : 0;
  return alpha;
}

/**
 * 다듬기 1단계(느린 것: 막대를 바꿀 때만): 거친 알파 → 경계 맞추기 · 부스러기 치우기 · 가장자리 곡선.
 *   edge(0~1, 클수록 주인공을 좁게) · soft(가장자리 부드러움 0~1) · refine(경계 맞추기) · clean(부스러기 치우기)
 */
export function prepareAlpha(data, w, h, rough, { edge = 0.5, soft = 0.3, refine = true, clean = true } = {}) {
  const r = Math.max(2, Math.round(Math.min(w, h) / 120));
  let alpha = rough;
  if (refine) alpha = guidedFilter(grayOf(data, w, h), snapEdges(data, rough, w, h, r + 1), w, h, r, 1e-3);
  if (clean) alpha = cleanAlpha(alpha, w, h);
  return alphaCurve(alpha, 0.25 + edge * 0.5, 0.05 + soft * 0.4);
}

/** 다듬기 2단계(빠른 것: 붓질할 때마다): 붓질을 얹고 가장자리 색을 걷어 내 픽셀에 입힌다. */
export function finishCutout(data, w, h, alpha, { strokes = [], fix = true } = {}) {
  const a = paintStrokes(alpha, w, h, strokes);
  const colors = fix ? decontaminate(data, a, w, h, Math.max(2, Math.round(Math.min(w, h) / 120))) : data;
  return { ...applyAlpha(colors, a), alpha: a };
}

/** 한 번에(두 단계를 차례로). */
export function refineCutout(data, w, h, rough, { strokes = [], fix = true, ...opts } = {}) {
  return finishCutout(data, w, h, prepareAlpha(data, w, h, rough, opts), { strokes, fix });
}

/** 가장자리가 한 가지 색인지(그림 · 로고처럼 단색 배경이면 색 방식이 더 깔끔하다). 0~1(같은 색 비율). */
export function plainBorder(data, w, h, near = 30) {
  const ref = borderColor(data, w, h);
  if (!ref) return 1;
  let same = 0, total = 0;
  const see = (x, y) => {
    const i = (y * w + x) * 4;
    total++;
    if (data[i + 3] < 16 || Math.hypot(data[i] - ref.r, data[i + 1] - ref.g, data[i + 2] - ref.b) <= near) same++;
  };
  for (let x = 0; x < w; x++) { see(x, 0); see(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { see(0, y); see(w - 1, y); }
  return total ? same / total : 1;
}
