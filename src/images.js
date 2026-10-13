// 그림 파일 다루기(브라우저): 올리기 전에 크기를 줄이고, 배경 제거를 위해 픽셀을 읽는다.
// 줄이면서 캔버스에 새로 그리기 때문에 사진 속에 숨어 있던 정보(찍은 곳·찍은 기기 같은 것)는 함께 지워진다.

/** 파일 고르기 창에서 받을 종류. */
export const ACCEPT_IMAGES = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
export const PHOTO_EDGE = 800;                  // 카드에 넣는 사진: 긴 쪽 800 이면 충분하다
const PNG_LIMIT = 700 * 1024;

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* 아래 방법으로 다시 */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * 그림을 캔버스에 그려 픽셀을 읽을 수 있게 한다(배경 제거용). 긴 쪽이 max 를 넘으면 줄인다.
 * { canvas, ctx, pixels(ImageData), ratio(세로 ÷ 가로) }
 */
export async function readPixels(blob, max = PHOTO_EDGE) {
  const src = await decode(blob);
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  if (!sw || !sh) throw new Error('bad-image');
  const k = Math.min(1, max / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  src.close?.();
  return { canvas, ctx, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height), ratio: canvas.height / canvas.width };
}

/** 캔버스를 투명한 곳이 살아 있는 PNG 파일로 만든다. { blob, ext, type, ratio } */
export async function canvasToPng(canvas) {
  const blob = await toBlob(canvas, 'image/png');
  if (!blob) throw new Error('bad-image');
  return { blob, ext: 'png', type: 'image/png', ratio: canvas.height / canvas.width };
}

/**
 * 그림을 줄여서 올릴 파일로 만든다. { blob, ext, type, ratio(세로 ÷ 가로) }
 * - max: 긴 쪽의 한도(px).
 * - alpha: true 면 PNG·WebP 였던 그림은 투명한 곳을 살리려고 PNG 로 만든다(너무 크면 더 줄여 보고, 그래도 크면 JPG). false 면 늘 JPG(흰 바탕).
 */
export async function shrinkImage(blob, { max = PHOTO_EDGE, alpha = true, quality = 0.85 } = {}) {
  const src = await decode(blob);
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  if (!sw || !sh) throw new Error('bad-image');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const size = (edge) => {
    const k = Math.min(1, edge / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * k));
    canvas.height = Math.max(1, Math.round(sh * k));
  };
  const ratio = sh / sw;

  if (alpha && /png|webp/.test(blob.type)) {
    // 투명한 곳을 살리려고 PNG 로 만들어 본다. 너무 크면 더 작게 줄여서 한 번 더 해 본다(바로 JPG 로 바꾸면 투명한 곳이 하얗게 된다).
    for (const edge of [...new Set([max, Math.min(max, PHOTO_EDGE), Math.min(max, 600)])]) {
      size(edge);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      const png = await toBlob(canvas, 'image/png');
      if (png && png.size <= PNG_LIMIT) { src.close?.(); return { blob: png, ext: 'png', type: 'image/png', ratio }; }
    }
  }
  size(max);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  src.close?.();
  const jpg = await toBlob(canvas, 'image/jpeg', quality);
  if (!jpg) throw new Error('bad-image');
  return { blob: jpg, ext: 'jpg', type: 'image/jpeg', ratio };
}
