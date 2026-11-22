/**
 * 应用入口：把模型、摄像头面捕、背景、界面串起来。
 */
import {
  DEFAULT_SETTINGS,
  DEFAULT_MODEL,
  STORAGE_KEY,
  GAIN_CONTROLS,
  BACKGROUNDS,
  BG_PRESETS,
} from './config.js';
import {
  $,
  $$,
  clamp,
  clamp01,
  loadSettings,
  saveSettings,
  debounce,
  formatTime,
  downloadBlob,
  canvasToBlob,
  isTypingTarget,
  loadImage,
} from './utils.js';
import { Live2DScene } from './scene.js';
import { FaceTracker, describeCameraError } from './tracker.js';
import { FaceMapper } from './mapper.js';
import { BackgroundManager } from './background.js';

const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const EYE_L = [33, 160, 158, 133, 153, 144];
const EYE_R = [362, 385, 387, 263, 373, 380];

const els = {
  app: $('#app'),
  stage: $('#stage'),
  bg: $('#bg'),
  live2d: $('#live2d'),
  brandName: $('#brandName'),
  heroName: $('#heroName'),
  status: $('#status'),
  statusText: $('#statusText'),
  cameraBtn: $('#cameraBtn'),
  cameraLabel: $('#cameraLabel'),
  openParams: $('#openParams'),
  openBackground: $('#openBackground'),
  screenshotBtn: $('#screenshotBtn'),
  fullscreenBtn: $('#fullscreenBtn'),
  welcome: $('#welcome'),
  welcomeNote: $('#welcomeNote'),
  welcomeNoteText: $('#welcomeNoteText'),
  startCameraBtn: $('#startCameraBtn'),
  browseBtn: $('#browseBtn'),
  preview: $('#preview'),
  camVideo: $('#camVideo'),
  previewCanvas: $('#previewCanvas'),
  previewHide: $('#previewHide'),
  previewHint: $('#previewHint'),
  previewLoading: $('#previewLoading'),
  previewLoadingText: $('#previewLoadingText'),
  stageHint: $('#stageHint'),
  drawer: $('#drawer'),
  drawerScrim: $('#drawerScrim'),
  drawerClose: $('#drawerClose'),
  gainSliders: $('#gainSliders'),
  resetGains: $('#resetGains'),
  smoothing: $('#smoothing'),
  smoothingVal: $('#smoothingVal'),
  angleLimit: $('#angleLimit'),
  angleLimitVal: $('#angleLimitVal'),
  mirrorToggle: $('#mirrorToggle'),
  landmarksToggle: $('#landmarksToggle'),
  mouseFollowToggle: $('#mouseFollowToggle'),
  cameraSelect: $('#cameraSelect'),
  calibrateBtn: $('#calibrateBtn'),
  stopCameraBtn: $('#stopCameraBtn'),
  telemetryState: $('#telemetryState'),
  meterYaw: $('#meterYaw'),
  meterPitch: $('#meterPitch'),
  meterRoll: $('#meterRoll'),
  meterMouth: $('#meterMouth'),
  meterBlink: $('#meterBlink'),
  valYaw: $('#valYaw'),
  valPitch: $('#valPitch'),
  valRoll: $('#valRoll'),
  valMouth: $('#valMouth'),
  valBlink: $('#valBlink'),
  bgGrid: $('#bgGrid'),
  bgCurrent: $('#bgCurrent'),
  colorBlock: $('#colorBlock'),
  imageBlock: $('#imageBlock'),
  bgColor: $('#bgColor'),
  bgColorValue: $('#bgColorValue'),
  bgFile: $('#bgFile'),
  bgUploadBtn: $('#bgUploadBtn'),
  bgClearBtn: $('#bgClearBtn'),
  bgBlur: $('#bgBlur'),
  bgBlurVal: $('#bgBlurVal'),
  bgDim: $('#bgDim'),
  bgDimVal: $('#bgDimVal'),
  zoom: $('#zoom'),
  zoomVal: $('#zoomVal'),
  offsetY: $('#offsetY'),
  offsetYVal: $('#offsetYVal'),
  offsetX: $('#offsetX'),
  offsetXVal: $('#offsetXVal'),
  resetView: $('#resetView'),
  previewToggle: $('#previewToggle'),
  shotFromPanel: $('#shotFromPanel'),
  dropOverlay: $('#dropOverlay'),
  boot: $('#boot'),
  bootText: $('#bootText'),
  bootBar: $('#bootBar'),
  fatal: $('#fatal'),
  fatalText: $('#fatalText'),
  fatalReload: $('#fatalReload'),
  toast: $('#toast'),
};

const appState = {
  ready: false,
  cameraOn: false,
  starting: false,
  startPhase: '',
  cameraErrorTitle: '',
  loopStarted: false,
  raf: 0,
  pointer: { x: 0, y: 0 },
  pointerTarget: { x: 0, y: 0 },
  detectFps: 0,
  renderFps: 0,
  lastDetection: null,
  lastParams: null,
  faceState: null,
  calibrationAnnounced: false,
  status: { kind: '', text: '', at: 0 },
  hudAt: 0,
  drawerOpen: false,
  tab: 'tracking',
  quotaWarned: false,
  imgDragDepth: 0,
};

let settings = loadSettings(DEFAULT_SETTINGS, STORAGE_KEY);
sanitizeSettings(settings);
let model = DEFAULT_MODEL;

const scene = new Live2DScene(els.live2d, els.stage);
const background = new BackgroundManager(els.bg);
const tracker = new FaceTracker(els.camVideo);
const mapper = new FaceMapper(settings);

background.setVideo(tracker.videoEl);
background.setSettings(settings);

/* ============================================================
   基础 UI
   ============================================================ */
const persist = debounce(() => {
  const ok = saveSettings(settings, STORAGE_KEY);
  if (!ok && !appState.quotaWarned) {
    appState.quotaWarned = true;
    toast('设置保存失败：浏览器本地存储空间不足，本次设置仅当前页面有效', true, 5000);
  }
}, 260);

function persistNow() {
  const ok = saveSettings(settings, STORAGE_KEY);
  if (!ok && !appState.quotaWarned) {
    appState.quotaWarned = true;
    toast('背景图太大，无法长期保存在本机；本次打开期间仍然有效', true, 5200);
  }
  return ok;
}

function sanitizeSettings(s) {
  s.gains = s.gains || {};
  for (const c of GAIN_CONTROLS) {
    const v = Number(s.gains[c.key]);
    s.gains[c.key] = clamp(Number.isFinite(v) ? v : 1, 0, 2);
  }
  s.smoothing = clamp(Number(s.smoothing) || 0, 0, 0.9);
  s.angleLimit = clamp(Number(s.angleLimit) || 30, 10, 30);
  s.mirror = s.mirror !== false;
  s.showLandmarks = s.showLandmarks !== false;
  s.showPreview = s.showPreview !== false;
  s.idle = s.idle !== false;
  s.mouseFollow = s.mouseFollow !== false;
  s.deviceId = typeof s.deviceId === 'string' ? s.deviceId : '';
  s.background = s.background || {};
  s.background.preset = BG_PRESETS.has(s.background.preset) ? s.background.preset : 'aurora';
  s.background.color = /^#[0-9a-f]{6}$/i.test(s.background.color || '') ? s.background.color : '#0d0a16';
  s.background.image = typeof s.background.image === 'string' && s.background.image.startsWith('data:image/') ? s.background.image : '';
  s.background.blur = clamp(Number(s.background.blur) || 0, 0, 40);
  s.background.dim = clamp(Number(s.background.dim) || 0, 0, 0.7);
  s.view = s.view || {};
  s.view.zoom = clamp(Number(s.view.zoom) || 1, 0.6, 1.8);
  s.view.offsetX = clamp(Number(s.view.offsetX) || 0, -40, 40);
  s.view.offsetY = clamp(Number(s.view.offsetY) || 0, -40, 40);
}

function shortName(m) {
  if (m.shortName) return m.shortName;
  const bits = String(m.name || '糯布').replace(/[·|/]/g, ' ').trim().split(/\s+/);
  return bits[bits.length - 1] || '糯布';
}

function applyModelName() {
  const short = shortName(model);
  els.brandName.textContent = `${short}面捕`;
  els.heroName.textContent = short;
  document.title = `${short}面捕 · Live2D 摄像头面捕`;
  if (model.accent) document.documentElement.style.setProperty('--model-accent', model.accent);
}

function buildGainSliders() {
  els.gainSliders.innerHTML = '';
  for (const c of GAIN_CONTROLS) {
    const row = document.createElement('div');
    row.className = 'slider-row';
    const label = document.createElement('div');
    label.className = 'slider-label';
    label.innerHTML = `<span>${c.label}</span><b data-out="${c.key}"></b>`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(c.min);
    input.max = String(c.max);
    input.step = String(c.step);
    input.value = String(Math.round(settings.gains[c.key] * 100));
    input.dataset.gain = c.key;
    input.setAttribute('aria-label', c.label);
    input.addEventListener('input', () => {
      settings.gains[c.key] = Number(input.value) / 100;
      label.querySelector('b').textContent = `${input.value}%`;
      setRangeFill(input);
      mapper.setSettings(settings);
      persist();
    });
    const hint = document.createElement('small');
    hint.className = 'hint';
    hint.textContent = c.hint;
    row.append(label, input, hint);
    els.gainSliders.appendChild(row);
    setRangeFill(input);
    label.querySelector('b').textContent = `${input.value}%`;
  }
}

function buildBackgroundGrid() {
  els.bgGrid.innerHTML = '';
  for (const b of BACKGROUNDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bg-item';
    btn.dataset.bg = b.id;
    btn.innerHTML = `
      <span class="swatch" style="background:${b.swatch}"></span>
      <span class="bg-name">${b.name}</span>
      <span class="bg-hint">${b.hint}</span>
      <span class="bg-check"><svg><use href="#i-check"/></svg></span>`;
    btn.addEventListener('click', () => selectBackground(b.id, true));
    els.bgGrid.appendChild(btn);
  }
}

function setRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value) || 0;
  const p = max === min ? 0 : ((value - min) / (max - min)) * 100;
  input.style.setProperty('--p', `${clamp(p, 0, 100)}%`);
}

function setSwitch(el, on) {
  el.setAttribute('aria-checked', String(!!on));
}

function syncControls() {
  els.smoothing.value = String(Math.round(settings.smoothing * 100));
  els.smoothingVal.textContent = `${els.smoothing.value}%`;
  els.angleLimit.value = String(settings.angleLimit);
  els.angleLimitVal.textContent = `${settings.angleLimit}°`;
  setSwitch(els.mirrorToggle, settings.mirror);
  setSwitch(els.landmarksToggle, settings.showLandmarks);
  setSwitch(els.mouseFollowToggle, settings.mouseFollow);
  setSwitch(els.previewToggle, settings.showPreview);

  els.bgColor.value = settings.background.color;
  els.bgColorValue.textContent = settings.background.color.toUpperCase();
  els.bgBlur.value = String(settings.background.blur);
  els.bgBlurVal.textContent = `${settings.background.blur}px`;
  els.bgDim.value = String(Math.round(settings.background.dim * 100));
  els.bgDimVal.textContent = `${els.bgDim.value}%`;

  els.zoom.value = String(Math.round(settings.view.zoom * 100));
  els.zoomVal.textContent = `${els.zoom.value}%`;
  els.offsetY.value = String(settings.view.offsetY);
  els.offsetYVal.textContent = `${settings.view.offsetY}%`;
  els.offsetX.value = String(settings.view.offsetX);
  els.offsetXVal.textContent = `${settings.view.offsetX}%`;

  for (const input of $$('input[type="range"]')) setRangeFill(input);
  background.setSettings(settings);
  updateBackgroundUI();
  updateCameraButtons();
}

/* ============================================================
   Toast / 状态 / 弹层
   ============================================================ */
let toastTimer = 0;
function toast(message, isError = false, ms = 3200) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle('is-error', isError);
  els.toast.classList.add('is-show');
  toastTimer = setTimeout(() => els.toast.classList.remove('is-show'), ms);
}

function setStatus(kind, text) {
  if (els.status.dataset.state !== kind) els.status.dataset.state = kind;
  if (els.statusText.textContent !== text) els.statusText.textContent = text;
  appState.status = { kind, text, at: performance.now() };
}

function dismissWelcome() {
  els.welcome.classList.add('is-hidden');
  els.welcome.setAttribute('aria-hidden', 'true');
}

function showWelcomeError(title, text) {
  els.welcome.classList.remove('is-hidden');
  els.welcome.removeAttribute('aria-hidden');
  els.welcomeNote.classList.add('is-error');
  els.welcomeNoteText.textContent = `${title}：${text}`;
  els.welcome.querySelector('.welcome-card')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetWelcomeNote() {
  els.welcomeNote.classList.remove('is-error');
  els.welcomeNoteText.textContent = '首次使用浏览器会请求摄像头权限 · 仅本机处理';
}

function showPreviewLoading(text) {
  els.previewLoadingText.textContent = text;
  els.previewLoading.classList.remove('is-done');
}

function hidePreviewLoading() {
  els.previewLoading.classList.add('is-done');
}

function syncPreviewVisibility() {
  const visible = settings.showPreview && (appState.cameraOn || appState.starting);
  els.preview.classList.toggle('is-hidden', !visible);
}

function updateCameraButtons() {
  const busy = appState.starting;
  const on = appState.cameraOn;
  els.cameraBtn.disabled = busy;
  els.cameraBtn.classList.toggle('is-on', on);
  els.cameraLabel.textContent = busy ? '启动中…' : on ? '关闭面捕' : '开启面捕';
  els.cameraBtn.setAttribute('aria-label', busy ? '正在启动摄像头' : on ? '关闭面捕' : '开启面捕');
  els.cameraBtn.title = busy ? '正在启动摄像头' : on ? '关闭面捕' : '开启摄像头面捕';
  const icon = els.cameraBtn.querySelector('use');
  icon?.setAttribute('href', on ? '#i-stop' : '#i-camera');
  els.stopCameraBtn.disabled = !on || busy;
  els.cameraSelect.disabled = busy;
}

/* ============================================================
   抽屉 / 标签页
   ============================================================ */
function switchTab(tab) {
  appState.tab = tab;
  for (const btn of $$('.tab')) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  }
  for (const panel of $$('.tab-panel')) {
    panel.hidden = panel.dataset.panel !== tab;
  }
  $('.drawer-body')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function openDrawer(tab = 'tracking') {
  appState.drawerOpen = true;
  els.app.classList.add('drawer-open');
  els.drawer.classList.add('is-open');
  els.drawer.setAttribute('aria-hidden', 'false');
  els.drawerScrim.classList.add('is-open');
  switchTab(tab);
}

function closeDrawer() {
  appState.drawerOpen = false;
  els.app.classList.remove('drawer-open');
  els.drawer.classList.remove('is-open');
  els.drawer.setAttribute('aria-hidden', 'true');
  els.drawerScrim.classList.remove('is-open');
}

/* ============================================================
   背景
   ============================================================ */
function updateBackgroundUI() {
  const preset = settings.background.preset;
  for (const btn of $$('.bg-item')) {
    btn.classList.toggle('is-active', btn.dataset.bg === preset);
  }
  els.colorBlock.hidden = preset !== 'solid';
  els.imageBlock.hidden = preset !== 'image';
  const meta = BACKGROUNDS.find((b) => b.id === preset);
  els.bgCurrent.textContent = meta?.name || '极光';
}

function selectBackground(id, user = true) {
  if (!BG_PRESETS.has(id)) return;
  settings.background.preset = id;
  if (id === 'camera' && settings.background.blur < 4) {
    settings.background.blur = 16;
    els.bgBlur.value = '16';
    els.bgBlurVal.textContent = '16px';
    setRangeFill(els.bgBlur);
  }
  background.setSettings(settings);
  background.apply();
  updateBackgroundUI();
  persist();
  if (!user) return;
  if (id === 'image' && !settings.background.image) {
    toast('选择一张图片，或把图片直接拖进页面');
    els.bgFile.click();
  } else if (id === 'camera' && !appState.cameraOn) {
    toast('开启摄像头后，这里会显示实时虚化的画面');
  }
}

async function compressImage(file) {
  const objectUrl = URL.createObjectURL(file);
  let img;
  try {
    img = await loadImage(objectUrl);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  const max = 1920;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let data = canvas.toDataURL('image/webp', 0.86);
  if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.86);
  if (data.length > 3_800_000) {
    const small = document.createElement('canvas');
    const s2 = Math.min(1, 1280 / Math.max(canvas.width, canvas.height));
    small.width = Math.round(canvas.width * s2);
    small.height = Math.round(canvas.height * s2);
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
    data = small.toDataURL('image/jpeg', 0.78);
  }
  return data;
}

async function handleImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('请选择图片文件（JPG / PNG / WebP）', true);
    return;
  }
  try {
    toast('正在处理图片…');
    const data = await compressImage(file);
    settings.background.image = data;
    settings.background.preset = 'image';
    await background.setImageDataUrl(data);
    updateBackgroundUI();
    const ok = persistNow();
    toast(ok ? '背景图片已更新' : '图片已应用，但太大无法长期保存；本次打开期间有效', !ok, ok ? 2600 : 5000);
  } catch (err) {
    console.error(err);
    toast('图片处理失败，换一张试试', true);
  }
}

/* ============================================================
   摄像头流程
   ============================================================ */
async function populateCameras() {
  try {
    const cams = await tracker.listCameras();
    const current = settings.deviceId;
    els.cameraSelect.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = '默认摄像头';
    els.cameraSelect.appendChild(def);
    cams.forEach((cam, i) => {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `摄像头 ${i + 1}`;
      els.cameraSelect.appendChild(opt);
    });
    if (current && cams.some((c) => c.deviceId === current)) {
      els.cameraSelect.value = current;
    } else if (current && !cams.some((c) => c.deviceId === current)) {
      els.cameraSelect.value = '';
    }
  } catch {
    /* 没有权限时读不到 label，保持默认即可 */
  }
}

function engineErrorInfo() {
  return {
    title: '面捕引擎加载失败',
    text: '请检查 vendor/mediapipe 和 assets/models/face_landmarker.task 是否完整，然后刷新重试。',
  };
}

async function startCamera() {
  if (appState.starting || appState.cameraOn) return;
  appState.starting = true;
  appState.startPhase = 'requesting';
  appState.cameraErrorTitle = '';
  appState.calibrationAnnounced = false;
  tracker.engineError = null;
  resetWelcomeNote();
  dismissWelcome();
  syncPreviewVisibility();
  showPreviewLoading('正在请求摄像头权限…');
  setStatus('requesting', '等待摄像头授权…');
  updateCameraButtons();

  try {
    let deviceId = settings.deviceId || '';
    try {
      await tracker.openCamera(deviceId);
    } catch (err) {
      if (deviceId && (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError')) {
        settings.deviceId = '';
        deviceId = '';
        els.cameraSelect.value = '';
        persist();
        await tracker.openCamera('');
      } else {
        throw err;
      }
    }

    appState.startPhase = 'loading';
    showPreviewLoading('正在加载面捕引擎…');
    setStatus('loading', '正在加载面捕引擎…');
    await tracker.ensureEngine((stage) => {
      if (stage === 'wasm') showPreviewLoading('正在加载面捕引擎…');
      else if (stage === 'model') showPreviewLoading('正在加载人脸模型…');
      else if (stage === 'cpu') showPreviewLoading('GPU 不可用，切换到 CPU…');
    });

    mapper.resetTracking();
    appState.cameraOn = true;
    appState.starting = false;
    appState.startPhase = '';
    hidePreviewLoading();
    syncPreviewVisibility();
    updateCameraButtons();
    setStatus('calibrating', '正在校准 · 保持正脸');
    await populateCameras();
    toast('摄像头已开启 · 保持正脸约 1 秒完成校准', false, 3600);
  } catch (err) {
    console.error('[webl2d] 启动摄像头失败', err);
    appState.starting = false;
    appState.startPhase = '';
    appState.cameraOn = false;
    tracker.stopStream();
    hidePreviewLoading();
    syncPreviewVisibility();
    clearPreviewCanvas();
    background.clearCamera();
    const info = tracker.engineError ? engineErrorInfo() : describeCameraError(err);
    appState.cameraErrorTitle = info.title;
    setStatus('error', info.title);
    showWelcomeError(info.title, info.text);
    updateCameraButtons();
    toast(`${info.title}：${info.text}`, true, 6200);
  }
}

function stopCamera() {
  if (appState.starting) return;
  tracker.stopStream();
  appState.cameraOn = false;
  appState.cameraErrorTitle = '';
  mapper.resetTracking();
  hidePreviewLoading();
  clearPreviewCanvas();
  background.clearCamera();
  syncPreviewVisibility();
  setStatus('off', '摄像头未开启');
  updateCameraButtons();
  updateTelemetryUI(null);
  toast('摄像头已关闭', false, 2200);
}

async function changeCamera(deviceId) {
  settings.deviceId = deviceId;
  persist();
  if (!appState.cameraOn) return;
  appState.cameraOn = false;
  tracker.stopStream();
  clearPreviewCanvas();
  background.clearCamera();
  await startCamera();
}

/* ============================================================
   面捕循环
   ============================================================ */
function startLoop() {
  if (appState.loopStarted) return;
  appState.loopStarted = true;
  let last = performance.now();
  let frameCount = 0;
  let detectCount = 0;
  let fpsAt = last;

  const frame = (now) => {
    appState.raf = requestAnimationFrame(frame);
    const dt = clamp((now - last) / 1000, 0.001, 0.05);
    last = now;
    if (!scene.ready) return;

    appState.pointer.x += (appState.pointerTarget.x - appState.pointer.x) * 0.1;
    appState.pointer.y += (appState.pointerTarget.y - appState.pointer.y) * 0.1;

    try {
      const poll = appState.cameraOn && !document.hidden ? tracker.poll() : null;
      if (poll) {
        appState.lastDetection = poll.result;
        detectCount += 1;
        drawPreview(poll.result);
      }

      const result = mapper.update({
        detection: poll?.result || null,
        newFrame: !!poll,
        now,
        dt,
        cameraOn: appState.cameraOn,
        pointer: appState.pointer,
        fps: appState.detectFps,
      });
      appState.lastParams = result.params;
      appState.faceState = result.state;

      scene.apply(result.params);
      scene.update(dt);
      scene.render();
      background.update(now);

      if (appState.drawerOpen) updateTelemetryUI(result.state, now);
      updateStatus(now, result.state);
      announceCalibration(result.state);

      frameCount += 1;
      if (now - fpsAt >= 700) {
        appState.renderFps = Math.round((frameCount * 1000) / (now - fpsAt));
        appState.detectFps = Math.round((detectCount * 1000) / (now - fpsAt));
        frameCount = 0;
        detectCount = 0;
        fpsAt = now;
      }
    } catch (err) {
      console.error('[webl2d] 渲染循环异常', err);
      if (!appState.loopErrorShown) {
        appState.loopErrorShown = true;
        toast('渲染出现异常，刷新页面试试', true, 5000);
      }
    }
  };
  appState.raf = requestAnimationFrame(frame);
}

function updateStatus(now, state) {
  if (!appState.ready) return;
  if (appState.starting) {
    if (els.previewHint.textContent !== '正在启动…') els.previewHint.textContent = '正在启动…';
    els.previewHint.classList.add('is-warn');
    els.previewHint.classList.remove('is-ok');
    return;
  }
  let kind = 'off';
  let text = '摄像头未开启';
  if (appState.cameraErrorTitle && !appState.cameraOn) {
    kind = 'error';
    text = appState.cameraErrorTitle;
  } else if (!appState.cameraOn) {
    kind = 'off';
    text = '摄像头未开启';
  } else if (state.calibrating) {
    kind = 'calibrating';
    text = `正在校准 · ${Math.round(state.calibProgress * 100)}%`;
  } else if (!state.facePresent) {
    kind = 'lost';
    text = '未检测到人脸';
  } else {
    kind = 'tracking';
    const fps = appState.detectFps > 0 ? ` · ${appState.detectFps} FPS` : '';
    text = `面捕中${fps}`;
  }

  const status = appState.status;
  if (kind !== status.kind || (text !== status.text && now - status.at > 240)) {
    setStatus(kind, text);
  }

  let hint = '保持正脸';
  let hintClass = '';
  if (kind === 'calibrating') {
    hint = '保持正脸 · 校准中';
    hintClass = 'is-warn';
  } else if (kind === 'lost') {
    hint = '未检测到人脸';
    hintClass = 'is-warn';
  } else if (kind === 'tracking') {
    hint = '已锁定';
    hintClass = 'is-ok';
  } else if (appState.starting) {
    hint = '正在启动…';
    hintClass = 'is-warn';
  }
  if (els.previewHint.textContent !== hint) els.previewHint.textContent = hint;
  els.previewHint.classList.toggle('is-warn', hintClass === 'is-warn');
  els.previewHint.classList.toggle('is-ok', hintClass === 'is-ok');
}

function announceCalibration(state) {
  if (!appState.calibrationAnnounced && appState.cameraOn && state.facePresent && !state.calibrating) {
    appState.calibrationAnnounced = true;
    toast('校准完成，动动头、眨眨眼试试', false, 2600);
  }
}

function updateTelemetryUI(state, now = performance.now()) {
  if (state && now - appState.hudAt < 110) return;
  appState.hudAt = now;
  if (!state) {
    els.telemetryState.textContent = '待机';
    els.telemetryState.classList.remove('is-live');
    for (const el of [els.meterYaw, els.meterPitch, els.meterRoll, els.meterMouth, els.meterBlink]) {
      el.style.width = '0%';
      el.classList.remove('neg');
    }
    for (const el of [els.valYaw, els.valPitch, els.valRoll, els.valMouth, els.valBlink]) el.textContent = '0';
    return;
  }

  const limit = settings.angleLimit || 30;
  const signed = (value, el, out, suffix = '°') => {
    const pct = clamp(((value + limit) / (limit * 2)) * 100, 0, 100);
    el.style.width = `${pct}%`;
    el.classList.toggle('neg', value < -0.5);
    out.textContent = `${Math.round(value)}${suffix}`;
  };
  signed(state.yaw, els.meterYaw, els.valYaw);
  signed(state.pitch, els.meterPitch, els.valPitch);
  signed(state.roll, els.meterRoll, els.valRoll);

  els.meterMouth.style.width = `${clamp01(state.mouth) * 100}%`;
  els.meterMouth.classList.remove('neg');
  els.valMouth.textContent = `${Math.round(clamp01(state.mouth) * 100)}%`;

  els.meterBlink.style.width = `${clamp01(state.blink) * 100}%`;
  els.meterBlink.classList.remove('neg');
  els.valBlink.textContent = `${Math.round(clamp01(state.blink) * 100)}%`;

  let label = '待机';
  let live = false;
  if (appState.cameraOn) {
    if (state.calibrating) label = `校准中 ${Math.round(state.calibProgress * 100)}%`;
    else if (!state.facePresent) label = '未检测到人脸';
    else {
      label = '已锁定';
      live = true;
    }
  }
  if (els.telemetryState.textContent !== label) els.telemetryState.textContent = label;
  els.telemetryState.classList.toggle('is-live', live);
}

/* ============================================================
   摄像头预览绘制
   ============================================================ */
function previewPointMapper(video, w, h) {
  const vw = video.videoWidth || 4;
  const vh = video.videoHeight || 3;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const ox = (w - dw) / 2;
  const oy = (h - dh) / 2;
  return (p) => [ox + (1 - p.x) * dw, oy + p.y * dh];
}

function drawPreview(result) {
  const canvas = els.previewCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!settings.showLandmarks) return;
  const lm = result?.faceLandmarks?.[0];
  if (!lm || !tracker.videoEl.videoWidth) return;

  const pt = previewPointMapper(tracker.videoEl, w, h);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(126, 240, 200, 0.86)';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(126, 240, 200, 0.55)';
  ctx.shadowBlur = 7;

  ctx.beginPath();
  FACE_OVAL.forEach((idx, i) => {
    const p = lm[idx];
    if (!p) return;
    const [x, y] = pt(p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 178, 211, 0.9)';
  ctx.lineWidth = 1.8;
  for (const idxs of [EYE_L, EYE_R]) {
    ctx.beginPath();
    idxs.forEach((idx, i) => {
      const p = lm[idx];
      if (!p) return;
      const [x, y] = pt(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 214, 122, 0.95)';
  for (const idx of [1, 10, 152]) {
    const p = lm[idx];
    if (!p) continue;
    const [x, y] = pt(p);
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function clearPreviewCanvas() {
  const ctx = els.previewCanvas.getContext('2d');
  ctx.clearRect(0, 0, els.previewCanvas.width, els.previewCanvas.height);
}

/* ============================================================
   截图 / 全屏
   ============================================================ */
async function takeScreenshot() {
  if (!scene.ready) return;
  try {
    scene.render();
    const w = els.stage.clientWidth;
    const h = els.stage.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w * dpr));
    out.height = Math.max(1, Math.round(h * dpr));
    const ctx = out.getContext('2d');
    ctx.scale(dpr, dpr);
    background.render(ctx, w, h, performance.now());
    ctx.drawImage(scene.getCanvas(), 0, 0, w, h);
    const blob = await canvasToBlob(out, 'image/png');
    if (!blob) throw new Error('canvas toBlob failed');
    const name = `糯布面捕-${formatTime()}.png`;
    downloadBlob(blob, name);
    toast('截图已保存到下载文件夹', false, 2600);
  } catch (err) {
    console.error(err);
    toast('截图失败，稍后再试', true);
  }
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await els.app.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {
    toast('当前浏览器不支持全屏，或全屏请求被拒绝', true, 3000);
  }
}

/* ============================================================
   交互绑定
   ============================================================ */
function bindUI() {
  els.startCameraBtn.addEventListener('click', startCamera);
  els.cameraBtn.addEventListener('click', () => {
    if (appState.cameraOn) stopCamera();
    else startCamera();
  });
  els.stopCameraBtn.addEventListener('click', stopCamera);
  els.browseBtn.addEventListener('click', () => {
    dismissWelcome();
    toast('已进入浏览模式 · 点右上角的相机按钮随时开始', false, 3000);
  });
  els.previewHide.addEventListener('click', () => {
    settings.showPreview = false;
    setSwitch(els.previewToggle, false);
    persist();
    syncPreviewVisibility();
  });
  els.previewToggle.addEventListener('click', () => {
    settings.showPreview = !settings.showPreview;
    setSwitch(els.previewToggle, settings.showPreview);
    syncPreviewVisibility();
    persist();
  });

  els.openParams.addEventListener('click', () => openDrawer('tracking'));
  els.openBackground.addEventListener('click', () => openDrawer('background'));
  els.drawerClose.addEventListener('click', closeDrawer);
  els.drawerScrim.addEventListener('click', closeDrawer);
  for (const tab of $$('.tab')) tab.addEventListener('click', () => switchTab(tab.dataset.tab));

  els.smoothing.addEventListener('input', () => {
    settings.smoothing = Number(els.smoothing.value) / 100;
    els.smoothingVal.textContent = `${els.smoothing.value}%`;
    setRangeFill(els.smoothing);
    mapper.setSettings(settings);
    persist();
  });
  els.angleLimit.addEventListener('input', () => {
    settings.angleLimit = Number(els.angleLimit.value);
    els.angleLimitVal.textContent = `${settings.angleLimit}°`;
    setRangeFill(els.angleLimit);
    mapper.setSettings(settings);
    persist();
  });
  els.mirrorToggle.addEventListener('click', () => {
    settings.mirror = !settings.mirror;
    setSwitch(els.mirrorToggle, settings.mirror);
    mapper.setSettings(settings);
    persist();
  });
  els.landmarksToggle.addEventListener('click', () => {
    settings.showLandmarks = !settings.showLandmarks;
    setSwitch(els.landmarksToggle, settings.showLandmarks);
    if (!settings.showLandmarks) clearPreviewCanvas();
    persist();
  });
  els.mouseFollowToggle.addEventListener('click', () => {
    settings.mouseFollow = !settings.mouseFollow;
    setSwitch(els.mouseFollowToggle, settings.mouseFollow);
    persist();
  });
  els.resetGains.addEventListener('click', () => {
    for (const c of GAIN_CONTROLS) settings.gains[c.key] = 1;
    for (const input of $$('#gainSliders input[type="range"]')) {
      input.value = '100';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    toast('面捕强度已恢复默认');
  });

  els.calibrateBtn.addEventListener('click', () => {
    if (!appState.cameraOn) {
      toast('请先开启摄像头面捕');
      return;
    }
    mapper.resetCalibration();
    appState.calibrationAnnounced = false;
    toast('重新校准：请保持正脸约 1 秒', false, 2600);
  });

  els.cameraSelect.addEventListener('change', () => {
    changeCamera(els.cameraSelect.value).catch((err) => console.error(err));
  });

  els.screenshotBtn.addEventListener('click', takeScreenshot);
  els.shotFromPanel.addEventListener('click', takeScreenshot);
  els.fullscreenBtn.addEventListener('click', toggleFullscreen);

  els.bgColor.addEventListener('input', () => {
    settings.background.color = els.bgColor.value;
    els.bgColorValue.textContent = els.bgColor.value.toUpperCase();
    background.setSettings(settings);
    background.apply();
    persist();
  });
  els.bgBlur.addEventListener('input', () => {
    settings.background.blur = Number(els.bgBlur.value);
    els.bgBlurVal.textContent = `${settings.background.blur}px`;
    setRangeFill(els.bgBlur);
    background.setSettings(settings);
    background.apply();
    persist();
  });
  els.bgDim.addEventListener('input', () => {
    settings.background.dim = Number(els.bgDim.value) / 100;
    els.bgDimVal.textContent = `${els.bgDim.value}%`;
    setRangeFill(els.bgDim);
    background.setSettings(settings);
    background.apply();
    persist();
  });

  els.bgUploadBtn.addEventListener('click', () => els.bgFile.click());
  els.bgFile.addEventListener('change', () => {
    handleImageFile(els.bgFile.files?.[0]);
    els.bgFile.value = '';
  });
  els.bgClearBtn.addEventListener('click', async () => {
    settings.background.image = '';
    await background.setImageDataUrl('');
    settings.background.preset = 'aurora';
    background.setSettings(settings);
    updateBackgroundUI();
    persistNow();
    toast('背景图片已清除');
  });

  els.zoom.addEventListener('input', () => {
    settings.view.zoom = Number(els.zoom.value) / 100;
    els.zoomVal.textContent = `${els.zoom.value}%`;
    setRangeFill(els.zoom);
    scene.setView(settings.view);
    persist();
  });
  els.offsetY.addEventListener('input', () => {
    settings.view.offsetY = Number(els.offsetY.value);
    els.offsetYVal.textContent = `${els.offsetY.value}%`;
    setRangeFill(els.offsetY);
    scene.setView(settings.view);
    persist();
  });
  els.offsetX.addEventListener('input', () => {
    settings.view.offsetX = Number(els.offsetX.value);
    els.offsetXVal.textContent = `${els.offsetX.value}%`;
    setRangeFill(els.offsetX);
    scene.setView(settings.view);
    persist();
  });
  els.resetView.addEventListener('click', () => {
    settings.view = { zoom: 1, offsetX: 0, offsetY: 0 };
    syncControls();
    scene.setView(settings.view);
    persist();
    toast('视图已重置');
  });

  window.addEventListener('pointermove', (e) => {
    appState.pointerTarget.x = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
    appState.pointerTarget.y = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
  }, { passive: true });
  window.addEventListener('pointerleave', () => {
    appState.pointerTarget.x = 0;
    appState.pointerTarget.y = 0;
  });

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      closeDrawer();
      return;
    }
    if (key === 'c') {
      e.preventDefault();
      if (appState.cameraOn) stopCamera();
      else startCamera();
    } else if (key === 'b') {
      e.preventDefault();
      openDrawer('background');
    } else if (key === 'p') {
      e.preventDefault();
      openDrawer('tracking');
    } else if (key === 's') {
      e.preventDefault();
      takeScreenshot();
    } else if (key === 'f') {
      e.preventDefault();
      toggleFullscreen();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    const use = els.fullscreenBtn.querySelector('use');
    use?.setAttribute('href', document.fullscreenElement ? '#i-fullscreen-exit' : '#i-expand');
    setTimeout(() => scene.resize(), 80);
  });

  window.addEventListener('resize', () => {
    clearTimeout(bindUI._resizeTimer);
    bindUI._resizeTimer = setTimeout(() => scene.resize(), 90);
  });
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => scene.resize()).observe(els.stage);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tracker.lastVideoTime = -1;
  });
  window.addEventListener('beforeunload', () => tracker.stopStream());

  // 拖入图片
  const hasImage = (e) => Array.from(e.dataTransfer?.items || []).some((i) => i.kind === 'file' && i.type.startsWith('image/'));
  window.addEventListener('dragenter', (e) => {
    if (!hasImage(e)) return;
    e.preventDefault();
    appState.imgDragDepth += 1;
    els.dropOverlay.classList.add('is-active');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasImage(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!appState.imgDragDepth) return;
    appState.imgDragDepth = Math.max(0, appState.imgDragDepth - 1);
    if (appState.imgDragDepth === 0) els.dropOverlay.classList.remove('is-active');
  });
  window.addEventListener('dragend', () => {
    appState.imgDragDepth = 0;
    els.dropOverlay.classList.remove('is-active');
  });
  window.addEventListener('drop', (e) => {
    if (!hasImage(e)) return;
    e.preventDefault();
    appState.imgDragDepth = 0;
    els.dropOverlay.classList.remove('is-active');
    const file = Array.from(e.dataTransfer.files || []).find((f) => f.type.startsWith('image/'));
    if (file) handleImageFile(file);
  });

  els.fatalReload.addEventListener('click', () => location.reload());
}

/* ============================================================
   启动
   ============================================================ */
async function loadModelCatalog() {
  try {
    const res = await fetch(new URL('models.json', document.baseURI), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    if (Array.isArray(list) && list.length) {
      const good = list.filter((m) => m && typeof m.path === 'string' && typeof m.name === 'string');
      if (good.length) model = good[0];
    }
  } catch (err) {
    console.warn('[webl2d] 读取 models.json 失败，使用默认模型', err);
  }
}

async function bootScene() {
  els.bootText.textContent = '正在加载 Live2D 模型…';
  try {
    const info = await scene.init(model.path);
    console.info('[webl2d] 模型已加载', info);
    if (!info.params) console.warn('[webl2d] 没有找到可映射的标准参数，面捕效果可能受限');
    appState.ready = true;
    els.bootText.textContent = '模型已就绪';
    els.bootBar.style.display = 'none';
    setTimeout(() => els.boot.classList.add('is-done'), 220);
    startLoop();
  } catch (err) {
    console.error('[webl2d] 模型加载失败', err);
    els.boot.classList.add('is-done');
    els.fatal.hidden = false;
    els.fatalText.textContent = `无法加载模型：${model.path}\n${err?.message || err}\n\n请确认通过 start.cmd 启动，并且模型文件完整。`;
  }
}

async function main() {
  await loadModelCatalog();
  applyModelName();
  buildGainSliders();
  buildBackgroundGrid();
  bindUI();
  syncControls();
  background.setSettings(settings);
  background.apply();
  scene.setView(settings.view);

  // 测试 / 调试入口
  window.__webl2d = {
    scene,
    tracker,
    mapper,
    background,
    get settings() { return settings; },
    get state() { return appState; },
    startCamera,
    stopCamera,
    takeScreenshot,
    openDrawer,
    closeDrawer,
    selectBackground,
    handleImageFile,
    setStatus,
    toast,
    async waitReady() {
      while (!appState.ready) await new Promise((r) => setTimeout(r, 50));
      return true;
    },
  };

  await bootScene();
}

main().catch((err) => {
  console.error('[webl2d] 初始化失败', err);
  els.boot.classList.add('is-done');
  els.fatal.hidden = false;
  els.fatalText.textContent = `初始化失败：${err?.message || err}`;
});
