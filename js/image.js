// 문제 이미지 — 브라우저에서 줄이고 압축해 Realtime Database에 넣는다.
// Firebase Storage는 결제 계정(Blaze)을 요구해 쓰지 않는다.
import * as db from './firebase.js';

export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;   // 원본 파일 상한
export const MAX_DATA_BYTES   = 400 * 1024;          // base64 문자열 상한
const SIZES     = [1280, 1024, 800];                 // 긴 변 후보 (큰 것부터)
const QUALITIES = [0.75, 0.6, 0.5];                  // JPEG 품질 후보

// 파일 → { dataUrl, w, h }. 400KB를 못 맞추면 Error를 던진다.
export async function prepareImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 넣을 수 있어요. (jpg, png, gif, webp)');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('파일이 너무 커요. 20MB 이하 이미지를 써 주세요.');
  }
  const bitmap = await loadBitmap(file);
  try {
    for (const maxSide of SIZES) {
      const { canvas, w, h } = drawScaled(bitmap, maxSide);
      for (const q of QUALITIES) {
        const dataUrl = canvas.toDataURL('image/jpeg', q);
        if (dataUrl.length <= MAX_DATA_BYTES) return { dataUrl, w, h };
      }
    }
  } finally {
    if (bitmap.close) bitmap.close();
  }
  throw new Error('이미지가 너무 복잡해요. 더 단순한 그림이나 작은 사진을 써 주세요.');
}

function loadBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요.')); };
    img.src = url;
  });
}

// 긴 변을 maxSide로 맞춰 흰 배경 위에 그린다 (투명 PNG가 검게 되지 않도록)
function drawScaled(bitmap, maxSide) {
  const sw = bitmap.width, sh = bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { canvas, w, h };
}

// ── 캐시 ──
// 같은 이미지를 두 번 받지 않는다. 방 구독(onValue)과 완전히 분리되어 있으므로
// 점수가 갱신되어도 이미지는 재전송되지 않는다.
const cache = new Map();                 // `${quizId}/${imgId}` → dataUrl
const inflight = new Map();              // 같은 이미지를 동시에 두 번 받지 않기 위해

export function cacheImage(quizId, imgId, dataUrl) {
  cache.set(`${quizId}/${imgId}`, dataUrl);
}

export async function getImage(quizId, imgId) {
  if (!quizId || !imgId) return null;
  const key = `${quizId}/${imgId}`;
  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);
  const p = db.loadQuizImage(quizId, imgId)
    .then(v => { cache.set(key, v); inflight.delete(key); return v; })
    .catch(e => { inflight.delete(key); throw e; });
  inflight.set(key, p);
  return p;
}

// 다음 문제 이미지를 미리 받아 둔다 — 문제가 시작되자마자 떠 있어야 20초가 공평하다
export function prefetchImage(quizId, imgId) {
  getImage(quizId, imgId).catch(() => {});
}
