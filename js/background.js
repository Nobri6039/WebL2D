/**
 * 背景管理：CSS 预设 + 摄像头虚化 + 上传图片 + 截图合成。
 */
import { BG_PRESETS } from './config.js';
import { clamp01, drawImageCover, drawVideoCover, loadImage } from './utils.js';

export class BackgroundManager {
  constructor(root) {
    this.root = root;
    this.fill = root.querySelector('.bg-fill');
    this.camCanvas = root.querySelector('#bgCam');
    this.camCtx = this.camCanvas?.getContext('2d') || null;
    this.settings = null;
    this.image = null;
    this.imageSrc = '';
    this.video = null;
    this._lastCamDraw = 0;
  }

  setSettings(settings) {
    this.settings = settings.background;
    this.apply();
  }

  setVideo(video) {
    this.video = video;
  }

  apply() {
    if (!this.settings) return;
    const s = this.settings;
    const preset = BG_PRESETS.has(s.preset) ? s.preset : 'aurora';
    this.root.dataset.preset = preset;
    this.root.style.setProperty('--bg-color', s.color || '#0d0a16');
    this.root.style.setProperty('--bg-dim', String(clamp01(s.dim ?? 0.24)));
    this.root.style.setProperty('--bg-blur', `${Math.max(0, s.blur || 0)}px`);

    if (s.image && s.image !== this.imageSrc) {
      this.imageSrc = s.image;
      this.root.style.setProperty('--bg-image', `url("${s.image}")`);
      loadImage(s.image)
        .then((img) => {
          this.image = img;
        })
        .catch(() => {
          this.image = null;
        });
    } else if (!s.image) {
      this.imageSrc = '';
      this.image = null;
      this.root.style.setProperty('--bg-image', 'none');
    }

    if (preset === 'camera' && this.camCanvas) {
      this.camCanvas.style.display = 'block';
    } else if (this.camCanvas) {
      this.camCanvas.style.display = 'none';
    }
  }

  async setImageDataUrl(dataUrl) {
    this.settings.image = dataUrl || '';
    if (dataUrl) {
      this.root.style.setProperty('--bg-image', `url("${dataUrl}")`);
      this.imageSrc = dataUrl;
      try {
        this.image = await loadImage(dataUrl);
      } catch {
        this.image = null;
      }
    } else {
      this.imageSrc = '';
      this.image = null;
      this.root.style.setProperty('--bg-image', 'none');
    }
    this.apply();
  }

  /** 停止摄像头后清掉残留的最后一帧，避免看起来像卡住 */
  clearCamera() {
    if (!this.camCtx) return;
    this.camCtx.clearRect(0, 0, this.camCanvas.width, this.camCanvas.height);
    this._lastCamDraw = 0;
  }

  /** 每帧更新摄像头背景 */
  update(now) {
    if (!this.camCtx || !this.video || this.settings?.preset !== 'camera') return;
    if (!this.video.videoWidth || this.video.readyState < 2) return;
    if (now - this._lastCamDraw < 33) return;
    this._lastCamDraw = now;
    const { width, height } = this.camCanvas;
    this.camCtx.clearRect(0, 0, width, height);
    drawVideoCover(this.camCtx, this.video, width, height, true);
  }

  /** 把背景画进截图用的画布 */
  render(ctx, w, h, now = performance.now()) {
    const s = this.settings || { preset: 'aurora', color: '#0d0a16', dim: 0.24, blur: 0 };
    const preset = BG_PRESETS.has(s.preset) ? s.preset : 'aurora';
    const time = now / 1000;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    if (preset === 'solid') {
      ctx.fillStyle = s.color || '#0d0a16';
      ctx.fillRect(0, 0, w, h);
    } else if (preset === 'image' && this.image) {
      ctx.fillStyle = '#0b0912';
      ctx.fillRect(0, 0, w, h);
      const blur = Math.max(0, s.blur || 0) * (w / 1280);
      if (blur > 0.5 && 'filter' in ctx) ctx.filter = `blur(${blur}px)`;
      drawImageCover(ctx, this.image, w, h);
      ctx.filter = 'none';
    } else if (preset === 'camera' && this.video?.srcObject && this.video.readyState >= 2) {
      ctx.fillStyle = '#0b0912';
      ctx.fillRect(0, 0, w, h);
      const blur = Math.max(0, s.blur || 0) * (w / 1280);
      if (blur > 0.5 && 'filter' in ctx) ctx.filter = `blur(${blur}px)`;
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      const scale = Math.max(w / vw, h / vh) * 1.08;
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.restore();
      ctx.filter = 'none';
    } else if (preset === 'camera') {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#0a1210');
      g.addColorStop(1, '#142422');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      this._blob(ctx, w * 0.3, h * 0.3, Math.max(w, h) * 0.5, 'rgba(66, 140, 124, 0.16)');
    } else if (preset === 'transparent') {
      const size = 16;
      for (let y = 0; y < h; y += size) {
        for (let x = 0; x < w; x += size) {
          ctx.fillStyle = (x / size + y / size) % 2 === 0 ? '#22202c' : '#171520';
          ctx.fillRect(x, y, size, size);
        }
      }
    } else if (preset === 'dusk') {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#24122e');
      g.addColorStop(0.5, '#713c50');
      g.addColorStop(1, '#f0a879');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      this._blob(ctx, w * 0.28, h * 0.24, w * 0.42, 'rgba(255,196,150,0.32)');
      this._blob(ctx, w * 0.8, h * 0.75, w * 0.5, 'rgba(94,38,100,0.4)');
    } else {
      this._aurora(ctx, w, h, time);
    }

    // 暗角 + 压暗
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    const dim = clamp01(s.dim ?? 0.24);
    if (dim > 0) {
      ctx.fillStyle = `rgba(7,5,14,${dim})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  _blob(ctx, x, y, r, color) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  _aurora(ctx, w, h, time) {
    const g = ctx.createLinearGradient(0, 0, w * 0.7, h);
    g.addColorStop(0, '#080d1e');
    g.addColorStop(0.45, '#0d2b36');
    g.addColorStop(1, '#2a1235');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const x1 = w * (0.2 + Math.sin(time * 0.12) * 0.06);
    const y1 = h * (0.25 + Math.cos(time * 0.1) * 0.05);
    this._blob(ctx, x1, y1, Math.max(w, h) * 0.55, 'rgba(52,224,190,0.24)');
    this._blob(ctx, w * (0.82 + Math.cos(time * 0.09) * 0.04), h * 0.3, Math.max(w, h) * 0.48, 'rgba(255,124,196,0.2)');
    this._blob(ctx, w * 0.55, h * (0.9 + Math.sin(time * 0.11) * 0.04), Math.max(w, h) * 0.5, 'rgba(108,86,255,0.18)');
  }
}
