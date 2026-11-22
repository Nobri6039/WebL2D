/** 通用小工具 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

export function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!patch || typeof patch !== 'object') return out;
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function loadSettings(defaults, key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return deepMerge(defaults, {});
    return deepMerge(defaults, JSON.parse(raw));
  } catch (err) {
    console.warn('[webl2d] 读取设置失败', err);
    return deepMerge(defaults, {});
  }
}

export function saveSettings(settings, key) {
  try {
    localStorage.setItem(key, JSON.stringify(settings));
    return true;
  } catch (err) {
    console.warn('[webl2d] 保存设置失败', err);
    return false;
  }
}

export function debounce(fn, wait = 200) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function throttle(fn, wait = 100) {
  let last = 0;
  return (...args) => {
    const now = performance.now();
    if (now - last >= wait) {
      last = now;
      fn(...args);
    }
  };
}

export function formatPercent(v) {
  return `${Math.round(v)}%`;
}

export function formatTime(ts = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${ts.getFullYear()}${p(ts.getMonth() + 1)}${p(ts.getDate())}-${p(ts.getHours())}${p(ts.getMinutes())}${p(ts.getSeconds())}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.94) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 把任意视频帧以 cover 方式画进画布。
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawVideoCover(ctx, video, w, h, mirror = true) {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.save();
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** 画一张图片，cover 模式 */
export function drawImageCover(ctx, img, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(w / iw, h / ih);
  ctx.drawImage(img, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

export function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function safeGet(obj, path, fallback = 0) {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur == null) return fallback;
    cur = cur[key];
  }
  return cur == null ? fallback : cur;
}
