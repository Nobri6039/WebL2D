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
