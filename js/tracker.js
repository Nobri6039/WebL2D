/**
 * 摄像头 + MediaPipe FaceLandmarker 封装。
 * 所有推理在浏览器本地完成，不上传任何画面。
 */

const VISION_URL = new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href;
const WASM_DIR = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL_URL = new URL('../assets/models/face_landmarker.task', import.meta.url).href;

export class FaceTracker {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.landmarker = null;
    this.vision = null;
    this.loading = null;
    this.running = false;
    this.lastVideoTime = -1;
    this.lastResult = null;
    this.lastAt = 0;
    this.detections = 0;
    this.delegate = '';
    this.engineError = null;
    this._detectErrors = 0;
  }

  get videoEl() {
    return this.video;
  }

  get hasStream() {
    return !!this.stream;
  }

  async openCamera(deviceId = '') {
    if (!window.isSecureContext) {
      const err = new Error('INSECURE_CONTEXT');
      err.name = 'SecurityError';
      throw err;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('MEDIA_UNSUPPORTED');
      err.name = 'NotSupportedError';
      throw err;
    }

    const base = {
      audio: false,
      video: {
        width: { ideal: 960 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
        facingMode: deviceId ? undefined : 'user',
      },
    };
    if (deviceId) base.video.deviceId = { exact: deviceId };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(base);
    } catch (err) {
      // 某些摄像头不支持指定分辨率 / 帧率，退回最宽松的约束再试一次。
      if (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError') {
        const relaxed = { audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : true };
        stream = await navigator.mediaDevices.getUserMedia(relaxed);
      } else {
        throw err;
      }
    }

    this.stopStream();
    this.stream = stream;
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    if (!this.video.videoWidth) {
      await new Promise((resolve) => {
        const done = () => {
          this.video.removeEventListener('loadedmetadata', done);
          resolve();
        };
        this.video.addEventListener('loadedmetadata', done);
        setTimeout(done, 1500);
      });
    }
    this.running = true;
    this.lastVideoTime = -1;
    return stream;
  }

  /**
   * GitHub Pages 对 .mjs 的 MIME 处理不一定正确（可能返回 octet-stream）。
   * 直接 import 失败时，把脚本当文本取回，用 text/javascript 的 Blob 再 import。
   * vision_bundle.mjs 是自包含的（没有相对 import），所以 Blob 方式安全。
   */
  async _importVision() {
    try {
      return await import(VISION_URL);
    } catch (directError) {
      return this._importVisionBlob(directError);
    }
  }

  async _importVisionBlob(directError) {
    console.warn('[webl2d] 直接加载 MediaPipe 模块失败，尝试 Blob 回退', directError);
    const res = await fetch(VISION_URL, { cache: 'no-cache' });
    if (!res.ok) throw directError;
    const code = await res.text();
    if (!code.includes('FaceLandmarker')) throw directError;
    const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      return await import(blobUrl);
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    }
  }

  async ensureEngine(onStage = () => {}) {
    if (this.landmarker) {
      try {
        this.landmarker.setOptions({ runningMode: 'VIDEO' });
      } catch {
        /* ignore */
      }
      return;
    }
    if (this.loading) return this.loading;

    this.loading = (async () => {
      onStage('wasm');
      this.vision = await this._importVision();
      const fileset = await this.vision.FilesetResolver.forVisionTasks(WASM_DIR);
      onStage('model');
      const options = {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };
      try {
        this.landmarker = await this.vision.FaceLandmarker.createFromOptions(fileset, options);
        this.delegate = 'GPU';
      } catch (err) {
        console.warn('[webl2d] GPU 面捕初始化失败，改用 CPU', err);
        onStage('cpu');
        this.landmarker = await this.vision.FaceLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'CPU' },
        });
        this.delegate = 'CPU';
      }
      this.engineError = null;
      return this.landmarker;
    })();

    try {
      return await this.loading;
    } catch (err) {
      this.engineError = err;
      this.loading = null;
      throw err;
    }
  }

  /**
   * 有新视频帧时推理一次。
   * @returns {{result: object, at: number}|null}
   */
  poll() {
    if (!this.running || !this.landmarker || !this.stream) return null;
    if (this.video.readyState < 2) return null;

    const t = this.video.currentTime;
    if (t === this.lastVideoTime) return null;
    this.lastVideoTime = t;

    try {
      const at = performance.now();
      const result = this.landmarker.detectForVideo(this.video, at);
      this.lastResult = result;
      this.lastAt = at;
      this.detections++;
      this._detectErrors = 0;
      return { result, at };
    } catch (err) {
      this._detectErrors++;
      if (this._detectErrors <= 3) console.warn('[webl2d] 面捕推理失败', err);
      return null;
    }
  }

  stopStream() {
    this.running = false;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video.srcObject) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.lastVideoTime = -1;
    this.lastResult = null;
  }

  async listCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }
}

export function describeCameraError(err) {
  const name = err?.name || '';
  const raw = err?.message || String(err);
  if (name === 'NotAllowedError' || name === 'SecurityError' || raw === 'INSECURE_CONTEXT') {
    if (!window.isSecureContext) {
      return {
        title: '当前页面不是安全环境',
        text: '浏览器只在 https 或 127.0.0.1 / localhost 下允许调用摄像头。请用 start.cmd 启动，然后访问 http://127.0.0.1:5180。',
      };
    }
    return {
      title: '摄像头权限被拒绝',
      text: '点击地址栏左侧的相机图标，允许本站使用摄像头，然后再次点击「开启面捕」。',
    };
  }
  if (name === 'NotFoundError') {
    return {
      title: '没有找到摄像头',
      text: '请确认摄像头已连接，并且没有被禁用。笔记本请检查键盘上的摄像头开关。',
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      title: '摄像头被占用了',
      text: '另一个程序（会议、录制、相机应用）正在使用摄像头，关闭它之后重试。',
    };
  }
  if (name === 'NotSupportedError') {
    return {
      title: '浏览器不支持摄像头',
      text: '请使用最新版的 Chrome、Edge 或 Firefox 打开本站。',
    };
  }
  return { title: '摄像头启动失败', text: raw };
}

/**
 * 音频口型：独立于摄像头麦克风，只在用户打开开关时申请权限。
 * 输出 0..1 的平滑音量，交给 mapper 与摄像头 jawOpen 合并。
 */
export class AudioTracker {
  constructor() {
    this.stream = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.data = null;
    this.freq = null;
    this.vowels = { A: 0, I: 0, U: 0, E: 0, O: 0 };
    this.profiles = {};
    this.weights = { A: 0.6, I: 0.75, U: 1.55, E: 0.55, O: 1.55 };
    this.vowelSmoothing = 0.045;
    this._calibration = null;
    this.rawLevel = 0;
    this.level = 0;
    this.gain = 1;
    this.noiseGate = 0.05;
    this._lastAt = 0;
    this._startedAt = 0;
    this._floor = 0;
    this._calibrating = false;
  }

  get active() {
    return !!this.stream;
  }

  setOptions({ gain, noiseGate } = {}) {
    if (Number.isFinite(Number(gain))) this.gain = Math.max(0.1, Math.min(4, Number(gain)));
    if (Number.isFinite(Number(noiseGate))) this.noiseGate = Math.max(0, Math.min(0.4, Number(noiseGate)));
  }

  setProfiles(profiles) {
    this.profiles = profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
  }

  setWeights(weights) {
    const base = { A: 0.6, I: 0.75, U: 1.55, E: 0.55, O: 1.55 };
    this.weights = {};
    for (const key of Object.keys(base)) {
      const v = Number(weights?.[key]);
      this.weights[key] = Number.isFinite(v) ? Math.max(0.1, Math.min(3, v)) : base[key];
    }
  }

  setVowelSmoothing(ms) {
    const v = Number(ms);
    this.vowelSmoothing = Number.isFinite(v) ? Math.max(0, Math.min(150, v)) / 1000 : 0.045;
  }

  /** 采集一个元音的频段包络；用户对着麦克风持续发音即可。 */
  calibrate(key, duration = 1200) {
    if (!this.analyser || !key) return Promise.resolve(null);
    return new Promise((resolve) => {
      this._calibration = {
        key,
        end: performance.now() + Math.max(500, duration),
        sums: new Float64Array(6),
        count: 0,
        resolve,
      };
    });
  }

  async start() {
    if (this.stream) return this.stream;
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('MIC_UNSUPPORTED');
      err.name = 'NotSupportedError';
      throw err;
    }
    if (!window.isSecureContext) {
      const err = new Error('MIC_INSECURE');
      err.name = 'SecurityError';
      throw err;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
    } catch (err) {
      if (err?.name === 'OverconstrainedError') {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        throw err;
      }
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      stream.getTracks().forEach((t) => t.stop());
      const err = new Error('AUDIO_UNSUPPORTED');
      err.name = 'NotSupportedError';
      throw err;
    }
    const context = new Ctx();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.12;
    source.connect(analyser);
    if (context.state === 'suspended') await context.resume().catch(() => {});
    this.stream = stream;
    this.context = context;
    this.source = source;
    this.analyser = analyser;
    this.data = new Uint8Array(analyser.fftSize);
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.vowels = { A: 0, I: 0, U: 0, E: 0, O: 0 };
    this.rawLevel = 0;
    this.level = 0;
    this._lastAt = 0;
    this._startedAt = performance.now();
    this._floor = 0;
    this._calibrating = true;
    return stream;
  }

  update(now = performance.now()) {
    if (!this.analyser) {
      this.level = Math.max(0, this.level - 0.08);
      return this.level;
    }
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.data.length);

    // 启动后短暂采样环境底噪；说话时的高音量不会被记成底噪。
    if (this._calibrating) {
      if (now - this._startedAt < 550) {
        if (rms < 0.03) this._floor = this._floor ? Math.min(this._floor, rms) : rms;
        this.level = 0;
        return 0;
      }
      this._calibrating = false;
      this._floor = Math.min(this._floor || 0, 0.02);
    }

    // 噪声门 = 用户门限、环境底噪的余量、一个绝对下限，三者取最大。
    const gate = Math.max(this.noiseGate * 0.25, this._floor * 2.5, 0.005);
    const signal = rms - gate;
    let target = signal > 0 ? Math.min(1, signal * 9 * this.gain) : 0;
    if (target < 0.01) target = 0;
    this.rawLevel = target;

    const dt = this._lastAt ? Math.max(0.001, Math.min(0.1, (now - this._lastAt) / 1000)) : 0.016;
    this._lastAt = now;
    const attack = 1 - Math.exp(-dt / 0.006);
    const release = 1 - Math.exp(-dt / 0.025);
    this.level += (target - this.level) * (target > this.level ? attack : release);
    if (this.level < 0.008) this.level = 0;

    // 元音 A/I/U/E/O：频段包络 + 原始音量，不做帧间平滑。
    if (this.rawLevel > 0.015 && this.freq) {
      this.analyser.getByteFrequencyData(this.freq);
      if (this._calibration) {
        const profile = this._bandProfile();
        if (profile && this.rawLevel > 0.02) {
          for (let i = 0; i < 6; i++) this._calibration.sums[i] += profile[i];
          this._calibration.count += 1;
        }
        if (now >= this._calibration.end) {
          const c = this._calibration;
          this._calibration = null;
          if (c.count) {
            const sums = c.sums;
            const total = sums.reduce((a, b) => a + b, 0);
            const profile = total > 0 ? [...sums].map((v) => v / total) : null;
            if (profile) this.profiles[c.key] = profile;
            c.resolve(profile);
          } else {
            c.resolve(null);
          }
        }
      }
      const scores = this._vowelScores(this.context?.sampleRate || 48000, this.rawLevel);
      // 极短交叉过渡：保留连续说话的衔接，但不能拖成慢动作。
      const vowelAlpha = 1 - Math.exp(-dt / Math.max(0.001, this.vowelSmoothing));
      for (const key of Object.keys(this.vowels)) {
        const target = scores[key] || 0;
        this.vowels[key] += (target - this.vowels[key]) * vowelAlpha;
        if (this.vowels[key] < 0.004) this.vowels[key] = 0;
      }
    } else {
      for (const key of Object.keys(this.vowels)) this.vowels[key] = 0;
    }
    return this.level;
  }

  _bandProfile() {
    if (!this.freq) return null;
    const sr = this.context?.sampleRate || 48000;
    const bins = this.freq.length;
    const hzPerBin = sr / 2 / bins;
    const bands = [
      [200, 450],
      [450, 700],
      [700, 1100],
      [1100, 1600],
      [1600, 2400],
      [2400, 3300],
    ];
    const energy = bands.map(() => 0);
    for (let i = 1; i < bins; i++) {
      const hz = i * hzPerBin;
      for (let b = 0; b < bands.length; b++) {
        if (hz >= bands[b][0] && hz < bands[b][1]) {
          energy[b] += this.freq[i] / 255;
          break;
        }
      }
    }
    const total = energy.reduce((a, b) => a + b, 0);
    if (total < 0.05) return null;
    return energy.map((v) => v / total);
  }

  _vowelScores(sampleRate, level) {
    const profile = this._bandProfile();
    if (!profile) return { A: 0, I: 0, U: 0, E: 0, O: 0 };
    const keys = ['A', 'I', 'U', 'E', 'O'];
    const calibrated = keys.every((k) => Array.isArray(this.profiles[k]) && this.profiles[k].length === 6);
    const weights = {};
    let sum = 0;
    if (calibrated) {
      // 已逐个校准：余弦相似度，最接近的元音权重最高。
      const sims = keys.map((k) => {
        const p = this.profiles[k];
        let dot = 0;
        let na = 0;
        let nb = 0;
        for (let i = 0; i < 6; i++) {
          dot += profile[i] * p[i];
          na += profile[i] * profile[i];
          nb += p[i] * p[i];
        }
        return dot / Math.max(1e-9, Math.sqrt(na) * Math.sqrt(nb));
      });
      const max = Math.max(...sims);
      keys.forEach((k, i) => {
        const w = Math.exp((sims[i] - max) * 7);
        weights[k] = w;
        sum += w;
      });
    } else {
      // 未校准：先用固定频段模板；校准后会自动切换到个人声线。
      const templates = {
        A: [0.16, 0.28, 0.30, 0.17, 0.07, 0.02],
        I: [0.28, 0.08, 0.07, 0.14, 0.30, 0.13],
        U: [0.42, 0.30, 0.13, 0.08, 0.05, 0.02],
        E: [0.18, 0.26, 0.21, 0.18, 0.13, 0.04],
        O: [0.22, 0.35, 0.25, 0.10, 0.05, 0.03],
      };
      const distance = {};
      for (const [key, t] of Object.entries(templates)) {
        distance[key] = Math.sqrt(profile.reduce((s, v, i) => s + (v - t[i]) ** 2, 0));
      }
      const min = Math.min(...Object.values(distance));
      for (const [key, d] of Object.entries(distance)) {
        const w = Math.exp(-(d - min) * 9);
        weights[key] = w;
        sum += w;
      }
    }
    const out = {};
    for (const key of Object.keys(weights)) {
      const w = Number(this.weights[key]);
      const gain = Number.isFinite(w) ? w : 1;
      out[key] = Math.min(1.5, (weights[key] / sum) * level * gain);
    }
    return out;
  }

  stop() {
    if (this._calibration) {
      this._calibration.resolve(null);
      this._calibration = null;
    }
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null;
    try {
      this.source?.disconnect();
      this.analyser?.disconnect();
      this.context?.close();
    } catch {
      /* ignore */
    }
    this.source = null;
    this.analyser = null;
    this.context = null;
    this.data = null;
    this.freq = null;
    this.vowels = { A: 0, I: 0, U: 0, E: 0, O: 0 };
    this.profiles = {};
    this.weights = { A: 0.6, I: 0.75, U: 1.55, E: 0.55, O: 1.55 };
    this.vowelSmoothing = 0.045;
    this._calibration = null;
    this.rawLevel = 0;
    this.level = 0;
    this._lastAt = 0;
    this._startedAt = 0;
    this._floor = 0;
    this._calibrating = false;
  }
}

export function describeMicError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { title: '麦克风权限被拒绝', text: '点击地址栏左侧的麦克风图标，允许本站使用麦克风后重试。' };
  }
  if (name === 'NotFoundError') {
    return { title: '没有找到麦克风', text: '请确认麦克风已连接，并且没有被系统禁用。' };
  }
  if (name === 'NotReadableError') {
    return { title: '麦克风被占用了', text: '另一个程序正在使用麦克风，关闭它之后重试。' };
  }
  return { title: '麦克风启动失败', text: err?.message || String(err) };
}
