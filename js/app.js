/**
 * 应用入口：模型切换、摄像头面捕、映射面板、背景与视图交互。
 */
import {
  DEFAULT_SETTINGS,
  DEFAULT_MODEL,
  STORAGE_KEY,
  SETTINGS_VERSION,
  CAMERA_SOURCES,
  SOURCE_BY_ID,
  BACKGROUNDS,
  BG_PRESETS,
  CURVE_PRESETS,
  buildDefaultMapping,
  normalizeMapping,
  cloneMapping,
  recommendedOutput,
  isEyeOpenParam,
  isSignedSource,
  defaultModelProfile,
  normalizeModelProfile,
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
  deepMerge,
} from './utils.js';
import { Live2DScene } from './scene.js';
import { FaceTracker, AudioTracker, describeCameraError, describeMicError } from './tracker.js';
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
  obsStyles: $('#obsStyles'),
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
  modelSelectTop: $('#modelSelectTop'),
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
  smoothing: $('#smoothing'),
  smoothingVal: $('#smoothingVal'),
  mirrorToggle: $('#mirrorToggle'),
  landmarksToggle: $('#landmarksToggle'),
  mouseFollowToggle: $('#mouseFollowToggle'),
  cameraSelect: $('#cameraSelect'),
  calibrateBtn: $('#calibrateBtn'),
  stopCameraBtn: $('#stopCameraBtn'),
  lipSyncBadge: $('#lipSyncBadge'),
  lipSyncNote: $('#lipSyncNote'),
  audioToggle: $('#audioToggle'),
  audioOptions: $('#audioOptions'),
  audioGain: $('#audioGain'),
  audioGainVal: $('#audioGainVal'),
  audioGate: $('#audioGate'),
  audioGateVal: $('#audioGateVal'),
  audioMeter: $('#audioMeter'),
  audioLevelVal: $('#audioLevelVal'),
  vowelMeters: $('#vowelMeters'),
  vowelCalibrate: $('#vowelCalibrate'),
  vowelCalibrateNote: $('#vowelCalibrateNote'),
  vowelControls: $('#vowelControls'),
  vowelWeights: $('#vowelWeights'),
  vowelWeightSum: $('#vowelWeightSum'),
  vowelSmoothing: $('#vowelSmoothing'),
  vowelSmoothingVal: $('#vowelSmoothingVal'),
  physicsControls: $('#physicsControls'),
  resetPhysics: $('#resetPhysics'),
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
  goMapping: $('#goMapping'),
  mappingList: $('#mappingList'),
  mappingCount: $('#mappingCount'),
  addGroup: $('#addGroup'),
  addEmptyGroup: $('#addEmptyGroup'),
  resetMapping: $('#resetMapping'),
  expressionRail: $('#expressionRail'),
  expressionRailList: $('#expressionRailList'),
  expressionRailToggle: $('#expressionRailToggle'),
  expressionEmpty: $('#expressionEmpty'),
  expressionSettingsBlock: $('#expressionSettingsBlock'),
  expressionVisibleToggle: $('#expressionVisibleToggle'),
  expressionShortcutList: $('#expressionShortcutList'),
  clearExpression: $('#clearExpression'),
  modelSelectPanel: $('#modelSelectPanel'),
  refreshModels: $('#refreshModels'),
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
  streamModeBtn: $('#streamModeBtn'),
  copyStreamUrl: $('#copyStreamUrl'),
  exportConfig: $('#exportConfig'),
  importConfig: $('#importConfig'),
  importFile: $('#importFile'),
  exportBgToggle: $('#exportBgToggle'),
  configStatus: $('#configStatus'),
  resetModelProfile: $('#resetModelProfile'),
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
  switching: false,
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
  dragging: null,
  models: [],
  modelParamMeta: [],
  capabilities: {
    expressions: [],
    lipSync: { available: false, parameterIds: [], primary: '' },
    physics: { available: false, groups: [] },
  },
  profile: defaultModelProfile(),
  expressionActive: '',
  shortcutCapture: '',
  audioOn: false,
  audioStarting: false,
  audioLevel: 0,
  audioCalibrating: '',
  streamMode: false,
  streamReturn: null,
  exportBg: false,
};

let settings = loadSettings(DEFAULT_SETTINGS, STORAGE_KEY);
sanitizeSettings(settings);
let model = DEFAULT_MODEL;
let mapping = { groups: [] };
let profile = defaultModelProfile();

const scene = new Live2DScene(els.live2d, els.stage);
const background = new BackgroundManager(els.bg);
const tracker = new FaceTracker(els.camVideo);
const audioTracker = new AudioTracker();
const mapper = new FaceMapper(settings);

background.setVideo(tracker.videoEl);
background.setSettings(settings);

/* ============================================================
   基础设置 / 持久化
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
  s.smoothing = clamp(Number(s.smoothing) || 0, 0, 0.9);
  s.mirror = s.mirror !== false;
  s.showLandmarks = s.showLandmarks !== false;
  s.showPreview = s.showPreview !== false;
  s.mouseFollow = s.mouseFollow !== false;
  s.deviceId = typeof s.deviceId === 'string' ? s.deviceId : '';
  s.version = SETTINGS_VERSION;
  s.modelId = typeof s.modelId === 'string' ? s.modelId : '';
  s.modelMappings = s.modelMappings && typeof s.modelMappings === 'object' && !Array.isArray(s.modelMappings) ? s.modelMappings : {};
  s.modelProfiles = s.modelProfiles && typeof s.modelProfiles === 'object' && !Array.isArray(s.modelProfiles) ? s.modelProfiles : {};
  s.audio = { ...DEFAULT_SETTINGS.audio, ...(s.audio && typeof s.audio === 'object' ? s.audio : {}) };
  s.audio.enabled = s.audio.enabled === true;
  s.audio.gain = clamp(Number(s.audio.gain) || 1, 0.3, 2.5);
  s.audio.noiseGate = clamp(Number(s.audio.noiseGate) || 0, 0, 0.3);
  s.audio.vowelProfiles = s.audio.vowelProfiles && typeof s.audio.vowelProfiles === 'object' && !Array.isArray(s.audio.vowelProfiles) ? s.audio.vowelProfiles : {};
  s.audio.vowelWeights = { ...DEFAULT_SETTINGS.audio.vowelWeights, ...(s.audio.vowelWeights && typeof s.audio.vowelWeights === 'object' ? s.audio.vowelWeights : {}) };
  // 旧版本的默认权重没有把 U/O 提上来；迁移一次，避免用户仍看到旧权重。
  const storedWeights = s.audio.vowelWeights;
  if (Math.abs(Number(storedWeights.U) - 1.3) < 1e-6 && Math.abs(Number(storedWeights.O) - 1.3) < 1e-6) {
    s.audio.vowelWeights = { ...DEFAULT_SETTINGS.audio.vowelWeights };
  } else if (Math.abs(Number(storedWeights.A) - 1) < 1e-6 && Math.abs(Number(storedWeights.U) - 2) < 1e-6 && Math.abs(Number(storedWeights.O) - 2) < 1e-6) {
    s.audio.vowelWeights = { ...DEFAULT_SETTINGS.audio.vowelWeights };
  } else if (
    Math.abs(Number(storedWeights.A) - 0.8) < 1e-6
    && Math.abs(Number(storedWeights.I) - 1) < 1e-6
    && Math.abs(Number(storedWeights.U) - 2) < 1e-6
    && Math.abs(Number(storedWeights.E) - 0.7) < 1e-6
    && Math.abs(Number(storedWeights.O) - 2) < 1e-6
  ) {
    // 旧的 650% 默认组合迁移到新的 500% 默认组合。
    s.audio.vowelWeights = { ...DEFAULT_SETTINGS.audio.vowelWeights };
  }
  for (const key of ['A', 'I', 'U', 'E', 'O']) {
    s.audio.vowelWeights[key] = clamp(Number(s.audio.vowelWeights[key]) || 1, 0.1, 3);
  }
  const smoothingMs = Number(s.audio.vowelSmoothing);
  s.audio.vowelSmoothing = Number.isFinite(smoothingMs) ? clamp(smoothingMs, 0, 150) : 45;
  s.audio.blend = 'max';
  s.background = s.background || {};
  s.background.preset = BG_PRESETS.has(s.background.preset) ? s.background.preset : 'aurora';
  s.background.color = /^#[0-9a-f]{6}$/i.test(s.background.color || '') ? s.background.color : '#0d0a16';
  s.background.image = typeof s.background.image === 'string' && s.background.image.startsWith('data:image/') ? s.background.image : '';
  s.background.blur = clamp(Number(s.background.blur) || 0, 0, 40);
  s.background.dim = clamp(Number(s.background.dim) || 0, 0, 0.7);
  s.view = s.view || {};
  s.view.zoom = clamp(Number(s.view.zoom) || 1, 0.3, 3);
  s.view.offsetX = clamp(Number(s.view.offsetX) || 0, -80, 80);
  s.view.offsetY = clamp(Number(s.view.offsetY) || 0, -80, 80);
}

function shortName(m) {
  if (m.shortName) return m.shortName;
  const bits = String(m?.name || 'Live2D').replace(/[·|/]/g, ' ').trim().split(/\s+/);
  return bits[bits.length - 1] || 'Live2D';
}

function getProfileForModel(id, seed = false) {
  let stored = settings.modelProfiles?.[id];
  if (!stored) {
    stored = normalizeModelProfile(seed ? {
      view: settings.view,
      smoothing: settings.smoothing,
      mirror: settings.mirror,
    } : {});
    settings.modelProfiles[id] = stored;
  }
  return normalizeModelProfile(stored);
}

function saveCurrentProfile() {
  if (!model?.id) return;
  profile.view = { ...settings.view };
  profile.smoothing = settings.smoothing;
  profile.mirror = settings.mirror;
  settings.modelProfiles[model.id] = normalizeModelProfile(profile);
}

function applyProfile(next) {
  profile = normalizeModelProfile(next);
  appState.profile = profile;
  settings.view = { ...profile.view };
  settings.smoothing = profile.smoothing;
  settings.mirror = profile.mirror;
  mapper.setSettings(settings);
  mapper.setBreathSettings(profile.physics);
  scene.setView(settings.view);
  scene.applyPhysicsProfile(profile.physics);
  if (appState.ready) {
    syncControls();
    renderPhysicsUI();
    renderExpressionUI();
  }
}

function applyModelName() {
  const short = shortName(model);
  els.brandName.textContent = `${short}面捕`;
  els.heroName.textContent = short;
  document.title = `${short}面捕 · Live2D 摄像头面捕`;
  if (model.accent) document.documentElement.style.setProperty('--model-accent', model.accent);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================================================
   模型列表
   ============================================================ */
function normalizeCatalog(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item.path !== 'string') continue;
    const id = String(item.id || item.path);
    if (seen.has(id)) continue;
    seen.add(id);
    const name = String(item.name || item.path.split('/').pop() || '未命名模型');
    out.push({
      id,
      name,
      shortName: item.shortName || shortName({ name }),
      subtitle: item.subtitle || '',
      path: item.path,
      accent: item.accent || '#7ef0c8',
    });
  }
  return out;
}

async function fetchModelList() {
  let list = null;
  // 本地 server.py 提供 /api/models 动态扫描；静态托管（GitHub Pages）直接读 models.json
  const canScan = !!location.port;
  if (canScan) {
    try {
      const res = await fetch(new URL('api/models', document.baseURI), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        list = Array.isArray(data) ? data : data?.models;
      }
    } catch {
      /* 静态服务器没有此接口时回退 models.json */
    }
  }
  if (!Array.isArray(list) || !list.length) {
    try {
      const res = await fetch(new URL('models.json', document.baseURI), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      list = Array.isArray(data) ? data : data?.models;
    } catch (err) {
      console.warn('[webl2d] 读取 models.json 失败，使用默认模型', err);
    }
  }
  const catalog = normalizeCatalog(list);
  return catalog.length ? catalog : normalizeCatalog([DEFAULT_MODEL]);
}

async function loadModelCatalog() {
  const catalog = await fetchModelList();
  appState.models = catalog;
  const wanted = settings.modelId;
  model = catalog.find((m) => m.id === wanted) || catalog[0] || DEFAULT_MODEL;
  settings.modelId = model.id;
}

function populateModelSelects() {
  for (const select of [els.modelSelectTop, els.modelSelectPanel]) {
    if (!select) continue;
    select.innerHTML = '';
    for (const m of appState.models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      select.appendChild(opt);
    }
    select.value = model.id;
    select.disabled = appState.switching;
  }
}

async function refreshModelList() {
  const catalog = await fetchModelList();
  appState.models = catalog;
  if (!catalog.some((m) => m.id === model.id)) {
    const first = catalog[0];
    if (first) {
      await switchModel(first.id);
      toast(`已刷新模型列表 · ${catalog.length} 个模型`);
      return;
    }
  }
  populateModelSelects();
  toast(`模型列表已刷新 · ${catalog.length} 个模型`, false, 2200);
}

function getMappingForModel(modelId, paramMeta) {
  const paramIds = (paramMeta || []).map((p) => p.id);
  const blocked = (paramMeta || []).filter((p) => p.physicsDriven || p.systemDriven).map((p) => p.id);
  const stored = settings.modelMappings?.[modelId];
  if (stored) {
    const normalized = normalizeMapping(stored, paramIds, blocked);
    // 旧版本可能把 ParamBodyAngleX 这类物理输出存进了映射；全部被过滤时回到默认。
    if (normalized.groups.length || !stored.groups?.length) return normalized;
  }
  return buildDefaultMapping(paramIds);
}

function commitMapping() {
  mapper.setMapping(mapping);
  settings.modelMappings[model.id] = cloneMapping(mapping);
  persist();
}

async function switchModel(id) {
  if (!id || id === model.id || appState.switching || appState.starting) {
    populateModelSelects();
    return;
  }
  const next = appState.models.find((m) => m.id === id);
  if (!next) {
    populateModelSelects();
    return;
  }

  settings.modelMappings[model.id] = cloneMapping(mapping);
  saveCurrentProfile();
  persist();

  appState.switching = true;
  appState.ready = false;
  appState.calibrationAnnounced = false;
  els.bootBar.style.display = '';
  els.bootText.textContent = `正在切换模型 · ${next.name}…`;
  els.boot.classList.remove('is-done');
  updateCameraButtons();
  populateModelSelects();

  try {
    await scene.loadModel(next.path);
    model = next;
    settings.modelId = model.id;
    appState.modelParamMeta = scene.getParamMeta();
    appState.capabilities = scene.getCapabilities();
    appState.expressionActive = '';
    profile = getProfileForModel(model.id, false);
    applyProfile(profile);
    mapping = getMappingForModel(model.id, appState.modelParamMeta);
    mapper.setModelInfo(appState.modelParamMeta, scene.getParamDefaults());
    mapper.setMapping(mapping);
    mapper.setSettings(settings);
    applyModelName();
    appState.ready = true;
    syncControls();
    renderMappingUI();
    renderPhysicsUI();
    renderExpressionUI();
    updateAudioCapability();
    populateModelSelects();
    els.bootText.textContent = '模型已切换';
    els.bootBar.style.display = 'none';
    setTimeout(() => els.boot.classList.add('is-done'), 180);
    persist();
    toast(`已切换到 ${next.name}`, false, 2400);
  } catch (err) {
    console.error('[webl2d] 模型切换失败', err);
    appState.ready = true;
    els.boot.classList.add('is-done');
    els.bootBar.style.display = 'none';
    populateModelSelects();
    toast(`模型切换失败：${err?.message || err}`, true, 5200);
  } finally {
    appState.switching = false;
    updateCameraButtons();
    populateModelSelects();
  }
}

/* ============================================================
   映射面板
   ============================================================ */
function paramMetaById(id) {
  return appState.modelParamMeta.find((p) => p.id === id);
}

function allTargets() {
  return (mapping.groups || []).flatMap((g) => g.targets || []);
}

function usedByOtherParam(paramId) {
  return allTargets().some((t) => t.param === paramId);
}

function findUnusedParam() {
  const used = new Set(allTargets().map((t) => t.param));
  return appState.modelParamMeta.find((p) => !p.physicsDriven && !p.systemDriven && !used.has(p.id));
}

function sourceDefaults(sourceId) {
  const def = SOURCE_BY_ID[sourceId];
  return { inMin: def?.min ?? 0, inMax: def?.max ?? 1 };
}

function makeGroup(sourceId) {
  const param = findUnusedParam();
  if (!param) return null;
  const [outMin, outMax] = recommendedOutput(param.id);
  const source = sourceId && SOURCE_BY_ID[sourceId] ? sourceId : null;
  const range = sourceDefaults(source);
  const group = {
    id: `g_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    source,
    autoBlink: !source && isEyeOpenParam(param.id),
    inMin: range.inMin,
    inMax: range.inMax,
    targets: [{ param: param.id, outMin, outMax, curve: 'linear', mirror: isSignedSource(source) }],
  };
  return group;
}

function addMappingGroup(empty) {
  const source = empty ? null : (CAMERA_SOURCES.find((s) => s.id === 'yaw')?.id || CAMERA_SOURCES[0]?.id);
  const group = makeGroup(source);
  if (!group) {
    toast('所有模型参数都已经在映射里了', true);
    return;
  }
  mapping.groups.push(group);
  commitMapping();
  renderMappingUI();
}

function addTarget(gi) {
  const group = mapping.groups[gi];
  if (!group) return;
  const param = findUnusedParam();
  if (!param) {
    toast('没有未使用的模型参数了', true);
    return;
  }
  const [outMin, outMax] = recommendedOutput(param.id);
  group.targets.push({ param: param.id, outMin, outMax, curve: 'linear', mirror: isSignedSource(group.source) });
  commitMapping();
  renderMappingUI();
}

function renderMappingUI() {
  if (!els.mappingList) return;
  const groups = mapping.groups || [];
  const targetCount = groups.reduce((n, g) => n + g.targets.length, 0);
  if (els.mappingCount) els.mappingCount.textContent = `${groups.length} 组 · ${targetCount} 项`;

  if (!appState.modelParamMeta.length) {
    els.mappingList.innerHTML = '<div class="mapping-empty">模型参数还没有加载完成。</div>';
    return;
  }
  if (!groups.length) {
    els.mappingList.innerHTML = '<div class="mapping-empty">还没有映射组。<br>点上面的「+ 对照组」从摄像头控制模型，或「+ 空对照组」把参数排除在面捕之外。</div>';
    return;
  }

  const used = new Set(allTargets().map((t) => t.param));
  const cards = [];

  groups.forEach((group, gi) => {
    const sourceDef = group.source ? SOURCE_BY_ID[group.source] : null;
    const sourceOptions = [
      '<option value="">无（空对照组）</option>',
      ...CAMERA_SOURCES.map((s) => `<option value="${s.id}"${group.source === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`),
    ].join('');

    const targetRows = group.targets.map((target, ti) => {
      const allowed = appState.modelParamMeta.filter((p) => (p.id === target.param || (!used.has(p.id) && !p.physicsDriven && !p.systemDriven)));
      const byGroup = new Map();
      for (const p of allowed) {
        if (!byGroup.has(p.group)) byGroup.set(p.group, []);
        byGroup.get(p.group).push(p);
      }
      const options = [...byGroup.entries()].map(([groupName, items]) => {
        const opts = items.map((p) => `<option value="${p.id}"${p.id === target.param ? ' selected' : ''}>${escapeHtml(p.name)}${p.name === p.id ? '' : ` · ${escapeHtml(p.id)}`}</option>`).join('');
        return `<optgroup label="${escapeHtml(groupName)}">${opts}</optgroup>`;
      }).join('');
      const signed = isSignedSource(group.source);
      const curve = CURVE_PRESETS.some((c) => c.id === target.curve) ? target.curve : 'linear';
      const curveOptions = CURVE_PRESETS.map((c) => `<option value="${c.id}"${c.id === curve ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
      return `
        <div class="map-target" data-ti="${ti}">
          <div class="map-target-row">
            <select data-role="target-param" aria-label="模型参数">${options}</select>
            <label class="map-field">输出最小<input class="num-input" data-role="num" data-field="outMin" type="number" step="0.05" value="${target.outMin}"></label>
            <label class="map-field">输出最大<input class="num-input" data-role="num" data-field="outMax" type="number" step="0.05" value="${target.outMax}"></label>
            <button type="button" class="map-target-del" data-act="del-target" data-gi="${gi}" data-ti="${ti}" title="删除这个模型参数" aria-label="删除这个模型参数">×</button>
          </div>
          <div class="map-curve-row">
            <select data-role="curve" aria-label="响应曲线">${curveOptions}</select>
            <label class="mini-check"><input type="checkbox" data-role="mirror" ${target.mirror && signed ? 'checked' : ''} ${signed ? '' : 'disabled'}><span>正负镜像</span></label>
          </div>
        </div>`;
    }).join('');

    const hasEye = group.targets.some((t) => isEyeOpenParam(t.param));
    let emptyUi = '';
    if (!group.source) {
      emptyUi = hasEye
        ? `<div class="map-auto-row">
             <div><b>自动眨眼</b><small>没有摄像头来源时，让眼睛自动眨</small></div>
             <button type="button" class="switch" role="switch" aria-checked="${group.autoBlink ? 'true' : 'false'}" data-role="autoBlink" aria-label="自动眨眼"><i></i></button>
           </div>`
        : '<div class="map-empty-note">空对照组：这些模型参数不参与摄像头面捕，保持模型默认值。</div>';
    }

    cards.push(`
      <div class="map-card" data-gi="${gi}">
        <div class="map-card-head">
          <span class="map-index">${gi + 1}</span>
          <select class="map-source" data-role="source" aria-label="摄像头参数">${sourceOptions}</select>
          <button type="button" class="map-icon-btn" data-act="del-group" data-gi="${gi}" title="删除对照组" aria-label="删除对照组">×</button>
        </div>
        ${sourceDef ? `
          <div class="map-range">
            <label class="map-field">输入最小<input class="num-input" data-role="num" data-field="inMin" type="number" step="${sourceDef.step}" value="${group.inMin}"></label>
            <label class="map-field">输入最大<input class="num-input" data-role="num" data-field="inMax" type="number" step="${sourceDef.step}" value="${group.inMax}"></label>
            <span class="map-range-unit">摄像头「${escapeHtml(sourceDef.name)}」范围${sourceDef.unit ? `（${sourceDef.unit}）` : ''}</span>
          </div>` : ''}
        <div class="map-targets">${targetRows}</div>
        <button type="button" class="map-add-target" data-act="add-target" data-gi="${gi}">+ 模型参数</button>
        ${emptyUi}
      </div>`);
  });

  els.mappingList.innerHTML = cards.join('');
}

function mappingEventTarget(e) {
  const card = e.target.closest?.('.map-card');
  if (!card) return null;
  const gi = Number(card.dataset.gi);
  const group = mapping.groups[gi];
  if (!group) return null;
  const targetRow = e.target.closest?.('.map-target');
  const ti = targetRow ? Number(targetRow.dataset.ti) : -1;
  return { card, gi, group, ti };
}

function handleMappingChange(e) {
  const info = mappingEventTarget(e);
  if (!info) return;
  const { gi, group, ti } = info;
  const role = e.target.dataset.role;
  if (role === 'source') {
    const value = e.target.value || null;
    group.source = value && SOURCE_BY_ID[value] ? value : null;
    if (group.source) {
      group.autoBlink = false;
      const range = sourceDefaults(group.source);
      group.inMin = range.inMin;
      group.inMax = range.inMax;
    } else {
      group.autoBlink = group.targets.some((t) => isEyeOpenParam(t.param));
    }
    for (const t of group.targets) t.mirror = isSignedSource(group.source);
    commitMapping();
    renderMappingUI();
  } else if (role === 'target-param') {
    const param = e.target.value;
    if (!param) return;
    if (paramMetaById(param)?.physicsDriven || paramMetaById(param)?.systemDriven) {
      toast('这个参数由模型系统控制，不能手动映射', true);
      renderMappingUI();
      return;
    }
    const usedElsewhere = mapping.groups.some((g, gidx) => gidx !== gi && g.targets.some((t) => t.param === param));
    const usedInGroup = group.targets.some((t, tidx) => tidx !== ti && t.param === param);
    if (usedElsewhere || usedInGroup) {
      toast(`「${paramMetaById(param)?.name || param}」已经在别的映射组里了`, true);
      renderMappingUI();
      return;
    }
    const target = group.targets[ti];
    if (!target) return;
    target.param = param;
    const [outMin, outMax] = recommendedOutput(param);
    target.outMin = outMin;
    target.outMax = outMax;
    target.curve = target.curve || 'linear';
    target.mirror = isSignedSource(group.source);
    if (!group.source && isEyeOpenParam(param)) group.autoBlink = true;
    commitMapping();
    renderMappingUI();
  } else if (role === 'curve' || role === 'mirror') {
    const target = group.targets[ti];
    if (!target) return;
    if (role === 'curve') {
      target.curve = CURVE_PRESETS.some((c) => c.id === e.target.value) ? e.target.value : 'linear';
    } else {
      target.mirror = isSignedSource(group.source) ? !!e.target.checked : false;
    }
    commitMapping();
  }
}

function handleMappingInput(e) {
  const info = mappingEventTarget(e);
  if (!info) return;
  const { group, ti } = info;
  const role = e.target.dataset.role;
  if (role !== 'num') return;
  const field = e.target.dataset.field;
  const value = Number(e.target.value);
  if (!Number.isFinite(value)) return;
  if (ti >= 0) {
    const target = group.targets[ti];
    if (!target || !['outMin', 'outMax'].includes(field)) return;
    target[field] = value;
  } else if (['inMin', 'inMax'].includes(field)) {
    group[field] = value;
  } else {
    return;
  }
  commitMapping();
}

function handleMappingClick(e) {
  const action = e.target.closest?.('[data-act]')?.dataset.act;
  if (action) {
    const card = e.target.closest('.map-card');
    const gi = Number(card?.dataset.gi);
    const ti = Number(e.target.closest('.map-target')?.dataset.ti);
    if (action === 'del-group') {
      mapping.groups.splice(gi, 1);
      commitMapping();
      renderMappingUI();
    } else if (action === 'del-target') {
      const group = mapping.groups[gi];
      if (!group) return;
      group.targets.splice(ti, 1);
      if (!group.targets.length) mapping.groups.splice(gi, 1);
      commitMapping();
      renderMappingUI();
    } else if (action === 'add-target') {
      addTarget(gi);
    }
    return;
  }
  const auto = e.target.closest?.('[data-role="autoBlink"]');
  if (auto) {
    const info = mappingEventTarget(e);
    if (!info) return;
    info.group.autoBlink = !info.group.autoBlink;
    auto.setAttribute('aria-checked', String(info.group.autoBlink));
    commitMapping();
  }
}

/* ============================================================
   表情触发
   ============================================================ */
const RESERVED_SHORTCUTS = new Set(['C', 'B', 'P', 'S', 'F', 'Escape']);

function expressionLabel(expr) {
  return expr?.name || expr?.id || '未命名表情';
}

function shortcutFromEvent(e) {
  const key = e.key === ' ' ? 'Space' : e.key;
  if (!key || key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta' || key === 'CapsLock') return '';
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}

function renderExpressionUI() {
  const list = appState.capabilities.expressions || [];
  const available = list.length > 0;
  els.clearExpression.disabled = !available || !appState.expressionActive;
  els.expressionEmpty.hidden = available;
  els.expressionSettingsBlock.hidden = !available;
  els.expressionRail.hidden = !available || !profile.expressions.visible || appState.streamMode;
  els.expressionRail.classList.toggle('is-collapsed', !!profile.expressions.collapsed);
  els.expressionRailToggle.textContent = profile.expressions.collapsed ? '+' : '−';
  els.expressionRailToggle.title = profile.expressions.collapsed ? '展开表情栏' : '收起表情栏';
  els.expressionVisibleToggle && setSwitch(els.expressionVisibleToggle, profile.expressions.visible);

  if (!available) {
    els.expressionRailList.innerHTML = '';
    els.expressionShortcutList.innerHTML = '';
    return;
  }

  els.expressionRailList.innerHTML = list.map((expr) => `
    <button type="button" class="expression-btn${appState.expressionActive === expr.id ? ' is-active' : ''}" data-expr="${escapeHtml(expr.id)}" title="${escapeHtml(expressionLabel(expr))}">
      ${escapeHtml(expressionLabel(expr))}
    </button>`).join('');

  els.expressionShortcutList.innerHTML = list.map((expr) => {
    const combo = profile.expressions.shortcuts?.[expr.id] || '';
    const capturing = appState.shortcutCapture === expr.id;
    return `
      <div class="shortcut-row">
        <span title="${escapeHtml(expressionLabel(expr))}">${escapeHtml(expressionLabel(expr))}</span>
        <button type="button" class="shortcut-key${capturing ? ' is-capturing' : ''}" data-shortcut-for="${escapeHtml(expr.id)}">${capturing ? '按下按键…' : (combo || '未设置')}</button>
      </div>`;
  }).join('');
}

async function triggerExpression(id) {
  if (!id) return;
  if (appState.expressionActive === id) {
    clearExpression();
    return;
  }
  const ok = await scene.setExpression(id);
  if (!ok) {
    toast('这个表情没有加载成功，换一个试试', true);
    return;
  }
  appState.expressionActive = id;
  renderExpressionUI();
}

function clearExpression() {
  scene.clearExpression();
  appState.expressionActive = '';
  renderExpressionUI();
}

function beginShortcutCapture(id) {
  appState.shortcutCapture = id;
  renderExpressionUI();
}

function setExpressionShortcut(id, combo) {
  if (!profile.expressions.shortcuts) profile.expressions.shortcuts = {};
  for (const [key, value] of Object.entries(profile.expressions.shortcuts)) {
    if (value === combo && key !== id) delete profile.expressions.shortcuts[key];
  }
  if (combo) profile.expressions.shortcuts[id] = combo;
  else delete profile.expressions.shortcuts[id];
  saveCurrentProfile();
  persist();
  appState.shortcutCapture = '';
  renderExpressionUI();
}

function matchExpressionShortcut(combo) {
  const shortcuts = profile.expressions?.shortcuts || {};
  return Object.entries(shortcuts).find(([, value]) => value === combo)?.[0] || '';
}

/* ============================================================
   音频口型
   ============================================================ */
function syncAudioUI() {
  const cap = appState.capabilities.lipSync;
  const available = !!cap?.available;
  const vowels = cap?.vowels || [];
  els.audioToggle.disabled = !available || appState.audioStarting;
  setSwitch(els.audioToggle, appState.audioOn);
  els.audioOptions.hidden = !appState.audioOn;
  els.lipSyncBadge.textContent = !available ? '不支持' : appState.audioOn ? (vowels.length ? '元音模式' : '口型模式') : '可用';
  els.lipSyncBadge.classList.toggle('is-live', appState.audioOn);
  if (!available) {
    els.lipSyncNote.textContent = '当前模型没有 LipSync 口型参数，不能使用麦克风口型';
  } else if (appState.audioOn) {
    els.lipSyncNote.textContent = vowels.length
      ? `正在驱动元音 ${vowels.map((v) => v.name || v.id).join(' / ')}（Silence = 1 - 加权总和）`
      : `正在驱动 ${cap.primary || '口型参数'}；与摄像头嘴部取较大值`;
  } else {
    els.lipSyncNote.textContent = vowels.length
      ? '检测到元音 A/I/U/E/O；打开后使用元音口型，默认关闭'
      : '只在打开时申请麦克风权限；默认关闭';
  }
  if (els.vowelMeters) {
    if (vowels.length) {
      els.vowelMeters.hidden = false;
      els.vowelMeters.innerHTML = vowels.map((v) => {
        const label = v.name || v.id;
        return `<div class="vowel-meter"><span>${escapeHtml(label)}</span><div class="meter"><i data-vowel="${escapeHtml(v.id)}"></i></div></div>`;
      }).join('');
    } else {
      els.vowelMeters.hidden = true;
      els.vowelMeters.innerHTML = '';
    }
  }
  if (els.vowelCalibrate) {
    if (vowels.length) {
      els.vowelCalibrate.hidden = false;
      if (els.vowelCalibrateNote) els.vowelCalibrateNote.hidden = false;
      els.vowelCalibrate.innerHTML = vowels.map((v) => {
        const key = v.id.replace(/^Param/, '');
        const busy = appState.audioCalibrating === key;
        return `<button type="button" class="vowel-cal-btn" data-calibrate-vowel="${escapeHtml(key)}" ${busy ? 'disabled' : ''}>${busy ? '…' : `${escapeHtml(key)} 校准`}</button>`;
      }).join('');
    } else {
      els.vowelCalibrate.hidden = true;
      els.vowelCalibrate.innerHTML = '';
      if (els.vowelCalibrateNote) els.vowelCalibrateNote.hidden = true;
    }
  }
  els.audioGain.value = String(Math.round(settings.audio.gain * 100));
  els.audioGainVal.textContent = `${els.audioGain.value}%`;
  els.audioGate.value = String(Math.round(settings.audio.noiseGate * 100));
  els.audioGateVal.textContent = `${els.audioGate.value}%`;
  setRangeFill(els.audioGain);
  setRangeFill(els.audioGate);
  syncVowelControls();
}

function updateVowelMeters(vowels = {}) {
  if (!els.vowelMeters) return;
  for (const bar of els.vowelMeters.querySelectorAll('[data-vowel]')) {
    const id = bar.dataset.vowel;
    const key = id.replace(/^Param/, '');
    const v = vowels[key] ?? vowels[id] ?? 0;
    bar.style.width = `${Math.round(clamp01(v) * 100)}%`;
  }
}

function updateVowelWeightSum() {
  if (!els.vowelWeightSum) return;
  const sum = ['A', 'I', 'U', 'E', 'O'].reduce((total, key) => {
    const v = Number(settings.audio.vowelWeights?.[key]);
    return total + (Number.isFinite(v) ? v : 1);
  }, 0);
  const percent = Math.round(sum * 100);
  const warn = Math.abs(percent - 500) > 0.5;
  const label = els.vowelWeightSum.querySelector('span');
  const value = els.vowelWeightSum.querySelector('b');
  if (label) label.textContent = warn ? '权重总和（应为 500%）' : '权重总和';
  if (value) value.textContent = warn ? `${percent}% ⚠` : `${percent}%`;
  els.vowelWeightSum.classList.toggle('is-warn', warn);
  els.vowelWeightSum.title = warn ? '五个元音权重合计不是 500%，可能导致口型异常' : '五个元音权重合计 500%';
}

function syncVowelControls() {
  if (!els.vowelControls) return;
  const vowels = appState.capabilities.lipSync?.vowels || [];
  if (!vowels.length) {
    els.vowelControls.hidden = true;
    return;
  }
  els.vowelControls.hidden = false;
  const signature = vowels.map((v) => v.id).join(',');
  if (els.vowelWeights.dataset.signature !== signature) {
    els.vowelWeights.dataset.signature = signature;
    els.vowelWeights.innerHTML = vowels.map((v) => {
      const key = v.id.replace(/^Param/, '');
      const value = Math.round((settings.audio.vowelWeights?.[key] ?? 1) * 100);
      const label = v.name || key;
      return `<div class="vowel-weight-row"><span>${escapeHtml(label)}</span><input type="range" min="10" max="300" step="5" value="${value}" data-vowel-weight="${escapeHtml(key)}" aria-label="${escapeHtml(label)} 权重"><b data-vowel-weight-val="${escapeHtml(key)}">${value}%</b></div>`;
    }).join('');
  }
  for (const input of els.vowelWeights.querySelectorAll('[data-vowel-weight]')) {
    const key = input.dataset.vowelWeight;
    const value = Math.round((settings.audio.vowelWeights?.[key] ?? 1) * 100);
    input.value = String(value);
    const label = els.vowelWeights.querySelector(`[data-vowel-weight-val="${key}"]`);
    if (label) label.textContent = `${value}%`;
    setRangeFill(input);
  }
  els.vowelSmoothing.value = String(settings.audio.vowelSmoothing);
  els.vowelSmoothingVal.textContent = `${settings.audio.vowelSmoothing}ms`;
  setRangeFill(els.vowelSmoothing);
  updateVowelWeightSum();
}

function setAudioMouthMode(on) {
  const vowels = (appState.capabilities.lipSync?.vowels || []).map((v) => v.id);
  const useVowels = !!on && vowels.length > 0;
  mapper.setVowelParams(vowels);
  mapper.setVowelMode(useVowels);
  // 实际 Silence 由每一帧的元音总强度驱动；这里只重置混合权重。
  const initialSum = Object.values(audioTracker.vowels).reduce((sum, v) => sum + (Number(v) || 0), 0);
  scene.setVowelStrength(useVowels ? initialSum : 0);
}

async function calibrateVowel(key) {
  if (!key || appState.audioCalibrating) return;
  if (!appState.audioOn) {
    await startAudio();
    if (!appState.audioOn) return;
  }
  appState.audioCalibrating = key;
  syncAudioUI();
  toast(`请持续发 ${key} 音约 1 秒…`, false, 1600);
  try {
    const profile = await audioTracker.calibrate(key, 1200);
    if (profile) {
      settings.audio.vowelProfiles = { ...(settings.audio.vowelProfiles || {}), [key]: profile };
      audioTracker.setProfiles(settings.audio.vowelProfiles);
      persist();
      toast(`${key} 元音校准完成`, false, 1800);
    } else {
      toast('没有采到足够声音，靠近麦克风再试', true, 3200);
    }
  } finally {
    appState.audioCalibrating = '';
    syncAudioUI();
  }
}

async function startAudio() {
  if (appState.audioStarting || appState.audioOn) return;
  if (!appState.capabilities.lipSync?.available) {
    toast('当前模型没有 LipSync 口型参数', true);
    return;
  }
  appState.audioStarting = true;
  syncAudioUI();
  try {
    audioTracker.setOptions(settings.audio);
    audioTracker.setProfiles(settings.audio.vowelProfiles || {});
    audioTracker.setWeights(settings.audio.vowelWeights || {});
    audioTracker.setVowelSmoothing(settings.audio.vowelSmoothing);
    await audioTracker.start();
    appState.audioOn = true;
    settings.audio.enabled = true;
    setAudioMouthMode(true);
    syncAudioUI();
    persist();
    toast(appState.capabilities.lipSync?.vowels?.length ? '麦克风元音口型已开启' : '麦克风口型已开启', false, 2200);
  } catch (err) {
    console.error('[webl2d] 麦克风启动失败', err);
    const info = describeMicError(err);
    toast(`${info.title}：${info.text}`, true, 5200);
  } finally {
    appState.audioStarting = false;
    syncAudioUI();
  }
}

function stopAudio(silent = false) {
  audioTracker.stop();
  appState.audioOn = false;
  appState.audioLevel = 0;
  settings.audio.enabled = false;
  setAudioMouthMode(false);
  syncAudioUI();
  updateAudioMeter(0);
  updateVowelMeters({});
  persist();
  if (!silent) toast('麦克风口型已关闭', false, 2000);
}

function updateAudioCapability() {
  const available = !!appState.capabilities.lipSync?.available;
  if (!available && appState.audioOn) stopAudio(true);
  settings.audio.enabled = appState.audioOn;
  if (appState.audioOn) setAudioMouthMode(true);
  else setAudioMouthMode(false);
  syncAudioUI();
}

function updateAudioMeter(level) {
  if (!els.audioMeter) return;
  const pct = Math.round(clamp01(level) * 100);
  els.audioMeter.style.width = `${pct}%`;
  els.audioLevelVal.textContent = `${pct}%`;
}

/* ============================================================
   物理手感
   ============================================================ */
function physicsRows() {
  const groups = appState.capabilities.physics?.groups || [];
  const rows = groups.map((g) => ({
    key: `g:${g.id}`,
    label: g.name || g.id,
    value: profile.physics.groups?.[g.id] ?? 1,
  }));
  rows.push({ key: 'breath', label: '呼吸幅度', value: profile.physics.breath ?? 1 });
  rows.push({ key: 'breathSpeed', label: '呼吸速度', value: profile.physics.breathSpeed ?? 1 });
  rows.push({ key: 'smoothing', label: '物理平滑', value: profile.physics.smoothing ?? 1 });
  return rows;
}

function renderPhysicsUI() {
  if (!els.physicsControls) return;
  const available = !!appState.capabilities.physics?.available;
  if (!available) {
    els.physicsControls.innerHTML = '<p class="fineprint">当前模型没有可调的 physics 分组。</p>';
    els.resetPhysics.disabled = true;
    return;
  }
  els.resetPhysics.disabled = false;
  els.physicsControls.innerHTML = physicsRows().map((row) => {
    return `
      <div class="slider-row">
        <div class="slider-label"><span>${escapeHtml(row.label)}</span><b data-physics-val="${escapeHtml(row.key)}">${Math.round(row.value * 100)}%</b></div>
        <input type="range" min="20" max="200" step="5" value="${Math.round(row.value * 100)}" data-physics-key="${escapeHtml(row.key)}" aria-label="${escapeHtml(row.label)}">
      </div>`;
  }).join('');
  for (const input of els.physicsControls.querySelectorAll('input[type="range"]')) setRangeFill(input);
}

function applyPhysicsValue(key, percent) {
  const value = clamp(Number(percent) / 100, 0.2, 2);
  if (key.startsWith('g:')) {
    if (!profile.physics.groups) profile.physics.groups = {};
    profile.physics.groups[key.slice(2)] = value;
  } else {
    profile.physics[key] = value;
  }
  mapper.setBreathSettings(profile.physics);
  scene.applyPhysicsProfile(profile.physics);
  const label = [...els.physicsControls.querySelectorAll('[data-physics-val]')].find((el) => el.dataset.physicsVal === key);
  if (label) label.textContent = `${Math.round(value * 100)}%`;
  settings.modelProfiles[model.id] = normalizeModelProfile(profile);
  persist();
}


/* ============================================================
   UI 同步
   ============================================================ */
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

function syncViewControls() {
  els.zoom.value = String(Math.round(settings.view.zoom * 100));
  els.zoomVal.textContent = `${els.zoom.value}%`;
  els.offsetY.value = String(Math.round(settings.view.offsetY));
  els.offsetYVal.textContent = `${els.offsetY.value}%`;
  els.offsetX.value = String(Math.round(settings.view.offsetX));
  els.offsetXVal.textContent = `${els.offsetX.value}%`;
  for (const input of [els.zoom, els.offsetX, els.offsetY]) setRangeFill(input);
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
      <span class="bg-name">${escapeHtml(b.name)}</span>
      <span class="bg-hint">${escapeHtml(b.hint)}</span>
      <span class="bg-check"><svg><use href="#i-check"/></svg></span>`;
    btn.addEventListener('click', () => selectBackground(b.id, true));
    els.bgGrid.appendChild(btn);
  }
}

function syncControls() {
  els.smoothing.value = String(Math.round(settings.smoothing * 100));
  els.smoothingVal.textContent = `${els.smoothing.value}%`;
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

  syncViewControls();
  for (const input of $$('input[type="range"]')) setRangeFill(input);
  background.setSettings(settings);
  updateBackgroundUI();
  updateCameraButtons();
  syncAudioUI();
}

function updateCameraButtons() {
  const busy = appState.starting || appState.switching;
  const on = appState.cameraOn;
  els.cameraBtn.disabled = busy;
  els.cameraBtn.classList.toggle('is-on', on);
  els.cameraLabel.textContent = busy ? (appState.switching ? '切换中…' : '启动中…') : on ? '关闭面捕' : '开启面捕';
  els.cameraBtn.setAttribute('aria-label', busy ? '正在处理' : on ? '关闭面捕' : '开启面捕');
  els.cameraBtn.title = busy ? '正在处理' : on ? '关闭面捕' : '开启摄像头面捕';
  const icon = els.cameraBtn.querySelector('use');
  icon?.setAttribute('href', on ? '#i-stop' : '#i-camera');
  els.stopCameraBtn.disabled = !on || busy;
  els.cameraSelect.disabled = busy;
  for (const select of [els.modelSelectTop, els.modelSelectPanel]) {
    if (select) select.disabled = appState.switching;
  }
  els.refreshModels.disabled = appState.switching;
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
  for (const panel of $$('.tab-panel')) panel.hidden = panel.dataset.panel !== tab;
  $('.drawer-body')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function openDrawer(tab = 'mapping') {
  dismissWelcome();
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
  for (const btn of $$('.bg-item')) btn.classList.toggle('is-active', btn.dataset.bg === preset);
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
    els.cameraSelect.value = current && cams.some((c) => c.deviceId === current) ? current : '';
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
  if (appState.starting || appState.cameraOn || appState.switching) return;
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
  if (appState.starting || appState.switching) return;
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
    if (!scene.ready || !appState.ready) return;

    appState.pointer.x += (appState.pointerTarget.x - appState.pointer.x) * 0.1;
    appState.pointer.y += (appState.pointerTarget.y - appState.pointer.y) * 0.1;

    try {
      const poll = appState.cameraOn && !document.hidden ? tracker.poll() : null;
      if (poll) {
        appState.lastDetection = poll.result;
        detectCount += 1;
        drawPreview(poll.result);
      }

      const audioLevel = appState.audioOn ? audioTracker.update(now) : 0;
      const audioVowels = appState.audioOn ? audioTracker.vowels : null;
      appState.audioLevel = audioLevel;
      const vowelStrength = audioVowels && (appState.capabilities.lipSync?.vowels?.length || 0) > 0
        ? Object.values(audioVowels).reduce((sum, v) => sum + (Number(v) || 0), 0)
        : 0;
      scene.setVowelStrength(vowelStrength);

      const result = mapper.update({
        detection: poll?.result || null,
        newFrame: !!poll,
        now,
        dt,
        cameraOn: appState.cameraOn,
        pointer: appState.pointer,
        fps: appState.detectFps,
        audioLevel,
        audioVowels,
      });
      appState.lastParams = result.params;
      appState.faceState = result.state;

      scene.apply(result.params);
      scene.update(dt);
      scene.render();
      background.update(now);

      if (appState.drawerOpen) {
        updateTelemetryUI(result.state, now);
        updateAudioMeter(audioLevel);
        updateVowelMeters(audioVowels || {});
      }
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
  if (!appState.ready || appState.switching) return;
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
    if (appState.audioOn) {
      kind = 'tracking';
      text = '麦克风口型';
    } else {
      kind = 'off';
      text = '摄像头未开启';
    }
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
  if (kind !== status.kind || (text !== status.text && now - status.at > 240)) setStatus(kind, text);

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

  const limit = 30;
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
   摄像头预览
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
  if (!scene.ready || !appState.ready) return;
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
    downloadBlob(blob, `${shortName(model)}-${formatTime()}.png`);
    toast('截图已保存到下载文件夹', false, 2600);
  } catch (err) {
    console.error(err);
    toast('截图失败，稍后再试', true);
  }
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await els.app.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    toast('当前浏览器不支持全屏，或全屏请求被拒绝', true, 3000);
  }
}

/* ============================================================
   OBS 透明直播模式 / 配置
   ============================================================ */
function streamUrl() {
  const url = new URL(location.href);
  url.searchParams.set('stream', '1');
  url.hash = '';
  return url.href;
}

async function copyStreamUrl() {
  const url = streamUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast('OBS 地址已复制到剪贴板', false, 2600);
  } catch {
    window.prompt('复制这个 OBS 地址：', url);
  }
}

function enterStreamMode() {
  if (appState.streamMode) return;
  appState.streamReturn = {
    preset: settings.background.preset,
    blur: settings.background.blur,
    dim: settings.background.dim,
  };
  closeDrawer();
  dismissWelcome();
  appState.streamMode = true;
  document.documentElement.classList.add('stream-mode');
  document.body.classList.add('stream-mode');
  if (els.obsStyles) els.obsStyles.media = 'all';
  settings.background.preset = 'transparent';
  settings.background.blur = 0;
  settings.background.dim = 0;
  background.setSettings(settings);
  background.apply();
  updateBackgroundUI();
  els.streamModeBtn.textContent = '退出透明直播模式';
  renderExpressionUI();
}

function exitStreamMode() {
  if (!appState.streamMode) return;
  appState.streamMode = false;
  document.documentElement.classList.remove('stream-mode');
  document.body.classList.remove('stream-mode');
  if (els.obsStyles) els.obsStyles.media = 'none';
  if (appState.streamReturn) {
    settings.background.preset = appState.streamReturn.preset;
    settings.background.blur = appState.streamReturn.blur;
    settings.background.dim = appState.streamReturn.dim;
  }
  background.setSettings(settings);
  background.apply();
  updateBackgroundUI();
  els.streamModeBtn.textContent = '进入透明直播模式';
  renderExpressionUI();
}

function exportConfig() {
  const data = JSON.parse(JSON.stringify(settings));
  delete data.deviceId;
  if (!appState.exportBg) delete data.background.image;
  const payload = {
    app: 'WebL2D',
    version: SETTINGS_VERSION,
    exportedAt: new Date().toISOString(),
    settings: data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `webl2d-config-${formatTime().replace(/[: ]/g, '-')}.json`);
  els.configStatus.textContent = '配置已导出（不含摄像头设备 ID）。';
  toast('配置已导出', false, 2200);
}

async function importConfig(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const incoming = payload?.settings && typeof payload.settings === 'object' ? payload.settings : payload;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('格式不是设置对象');
    try {
      localStorage.setItem(`${STORAGE_KEY}.backup`, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
    const merged = deepMerge(DEFAULT_SETTINGS, incoming);
    sanitizeSettings(merged);
    merged.modelId = model.id;
    settings = merged;
    profile = getProfileForModel(model.id, false);
    mapping = getMappingForModel(model.id, appState.modelParamMeta);
    mapper.setMapping(mapping);
    mapper.setModelInfo(appState.modelParamMeta, scene.getParamDefaults());
    mapper.setMapping(mapping);
    applyProfile(profile);
    background.setSettings(settings);
    background.apply();
    updateBackgroundUI();
    appState.audioOn = false;
    audioTracker.stop();
    settings.audio.enabled = false;
    syncControls();
    renderMappingUI();
    renderPhysicsUI();
    renderExpressionUI();
    syncAudioUI();
    persistNow();
    els.configStatus.textContent = `已导入配置 · ${new Date().toLocaleString()}`;
    toast('配置已导入；原配置已备份到本机缓存', false, 3200);
  } catch (err) {
    console.error('[webl2d] 配置导入失败', err);
    toast(`配置导入失败：${err?.message || err}`, true, 5200);
  }
}

/* ============================================================
   拖拽 / 滚轮
   ============================================================ */
function resetModelPosition() {
  settings.view.offsetX = 0;
  settings.view.offsetY = 0;
  scene.setView(settings.view);
  syncViewControls();
  saveCurrentProfile();
  persist();
  toast('模型位置已复原', false, 1800);
}

function setupStageInteractions() {
  const pointers = new Map();
  let gesture = null;
  let lastTapAt = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  const resetGesture = () => {
    gesture = null;
    els.stage.classList.remove('is-dragging');
  };

  const resetViewAll = () => {
    settings.view = { zoom: 1, offsetX: 0, offsetY: 0 };
    scene.setView(settings.view);
    syncViewControls();
    saveCurrentProfile();
    persist();
    toast('视图已复位', false, 1800);
  };

  els.stage.addEventListener('pointerdown', (e) => {
    if (appState.switching) return;
    if (e.button === 1) {
      e.preventDefault();
      resetModelPosition();
      return;
    }
    if (e.button !== 0 || !scene.ready) return;

    if (e.pointerType === 'touch') {
      const now = performance.now();
      if (now - lastTapAt < 320 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 28) {
        lastTapAt = 0;
        resetViewAll();
        e.preventDefault();
        return;
      }
      lastTapAt = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
    }

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      els.stage.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (pointers.size === 1) {
      gesture = {
        mode: 'drag',
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        offsetX: settings.view.offsetX,
        offsetY: settings.view.offsetY,
      };
      els.stage.classList.add('is-dragging');
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = {
        mode: 'pinch',
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        zoom: settings.view.zoom,
        offsetX: settings.view.offsetX,
        offsetY: settings.view.offsetY,
      };
    }
    e.preventDefault();
  });

  els.stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const width = Math.max(1, els.stage.clientWidth);
    const height = Math.max(1, els.stage.clientHeight);

    if (gesture?.mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      settings.view.zoom = clamp(gesture.zoom * (distance / gesture.distance), 0.3, 3);
      settings.view.offsetX = clamp(gesture.offsetX + ((cx - gesture.cx) / width) * 100, -80, 80);
      settings.view.offsetY = clamp(gesture.offsetY + ((cy - gesture.cy) / height) * 100, -80, 80);
      scene.setView(settings.view);
      syncViewControls();
      persist();
      return;
    }

    if (gesture?.mode !== 'drag' || gesture.id !== e.pointerId) return;
    settings.view.offsetX = clamp(gesture.offsetX + ((e.clientX - gesture.x) / width) * 100, -80, 80);
    settings.view.offsetY = clamp(gesture.offsetY + ((e.clientY - gesture.y) / height) * 100, -80, 80);
    scene.setView(settings.view);
    syncViewControls();
    saveCurrentProfile();
    persist();
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    try {
      els.stage.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (pointers.size === 1) {
      const [id, p] = [...pointers.entries()][0];
      gesture = {
        mode: 'drag',
        id,
        x: p.x,
        y: p.y,
        offsetX: settings.view.offsetX,
        offsetY: settings.view.offsetY,
      };
    } else if (pointers.size === 0) {
      resetGesture();
      saveCurrentProfile();
      persist();
    } else {
      resetGesture();
    }
  };
  els.stage.addEventListener('pointerup', endPointer);
  els.stage.addEventListener('pointercancel', endPointer);

  els.stage.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  els.stage.addEventListener(
    'wheel',
    (e) => {
      if (appState.switching) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0012);
      settings.view.zoom = clamp(settings.view.zoom * factor, 0.3, 3);
      scene.setView(settings.view);
      syncViewControls();
      saveCurrentProfile();
      persist();
    },
    { passive: false }
  );
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

  els.openParams.addEventListener('click', () => openDrawer('mapping'));
  els.goMapping.addEventListener('click', () => switchTab('mapping'));
  els.openBackground.addEventListener('click', () => openDrawer('background'));
  els.drawerClose.addEventListener('click', closeDrawer);
  els.drawerScrim.addEventListener('click', closeDrawer);
  for (const tab of $$('.tab')) tab.addEventListener('click', () => switchTab(tab.dataset.tab));

  for (const select of [els.modelSelectTop, els.modelSelectPanel]) {
    select?.addEventListener('change', () => {
      switchModel(select.value).catch((err) => console.error(err));
    });
  }
  els.refreshModels.addEventListener('click', () => refreshModelList().catch((err) => console.error(err)));

  els.smoothing.addEventListener('input', () => {
    settings.smoothing = Number(els.smoothing.value) / 100;
    els.smoothingVal.textContent = `${els.smoothing.value}%`;
    setRangeFill(els.smoothing);
    mapper.setSettings(settings);
    saveCurrentProfile();
    persist();
  });
  els.mirrorToggle.addEventListener('click', () => {
    settings.mirror = !settings.mirror;
    setSwitch(els.mirrorToggle, settings.mirror);
    mapper.setSettings(settings);
    saveCurrentProfile();
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

  els.addGroup.addEventListener('click', () => addMappingGroup(false));
  els.addEmptyGroup.addEventListener('click', () => addMappingGroup(true));
  els.resetMapping.addEventListener('click', () => {
    mapping = buildDefaultMapping(appState.modelParamMeta.map((p) => p.id));
    commitMapping();
    renderMappingUI();
    toast('参数映射已恢复默认');
  });
  els.mappingList.addEventListener('change', handleMappingChange);
  els.mappingList.addEventListener('input', handleMappingInput);
  els.mappingList.addEventListener('click', handleMappingClick);

  els.audioToggle.addEventListener('click', () => {
    if (appState.audioOn) stopAudio();
    else startAudio();
  });
  els.audioGain.addEventListener('input', () => {
    settings.audio.gain = Number(els.audioGain.value) / 100;
    els.audioGainVal.textContent = `${els.audioGain.value}%`;
    setRangeFill(els.audioGain);
    audioTracker.setOptions(settings.audio);
    syncAudioUI();
    persist();
  });
  els.audioGate.addEventListener('input', () => {
    settings.audio.noiseGate = Number(els.audioGate.value) / 100;
    els.audioGateVal.textContent = `${els.audioGate.value}%`;
    setRangeFill(els.audioGate);
    audioTracker.setOptions(settings.audio);
    syncAudioUI();
    persist();
  });
  els.vowelCalibrate.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-calibrate-vowel]');
    if (btn) calibrateVowel(btn.dataset.calibrateVowel).catch((err) => console.error(err));
  });
  els.vowelWeights.addEventListener('input', (e) => {
    const key = e.target.dataset.vowelWeight;
    if (!key) return;
    const value = clamp(Number(e.target.value) / 100, 0.1, 3);
    settings.audio.vowelWeights[key] = value;
    audioTracker.setWeights(settings.audio.vowelWeights);
    const label = [...els.vowelWeights.querySelectorAll('[data-vowel-weight-val]')].find((el) => el.dataset.vowelWeightVal === key);
    if (label) label.textContent = `${Math.round(value * 100)}%`;
    setRangeFill(e.target);
    updateVowelWeightSum();
    persist();
  });
  els.vowelSmoothing.addEventListener('input', () => {
    settings.audio.vowelSmoothing = Number(els.vowelSmoothing.value);
    els.vowelSmoothingVal.textContent = `${els.vowelSmoothing.value}ms`;
    setRangeFill(els.vowelSmoothing);
    audioTracker.setVowelSmoothing(settings.audio.vowelSmoothing);
    persist();
  });
  els.physicsControls.addEventListener('input', (e) => {
    const key = e.target.dataset.physicsKey;
    if (!key) return;
    setRangeFill(e.target);
    applyPhysicsValue(key, e.target.value);
  });
  els.resetPhysics.addEventListener('click', () => {
    profile.physics = defaultModelProfile().physics;
    mapper.setBreathSettings(profile.physics);
    scene.applyPhysicsProfile(profile.physics);
    settings.modelProfiles[model.id] = normalizeModelProfile(profile);
    renderPhysicsUI();
    persist();
    toast('物理手感已复位');
  });

  els.expressionRailList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-expr]');
    if (btn) triggerExpression(btn.dataset.expr);
  });
  els.expressionShortcutList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shortcut-for]');
    if (btn) beginShortcutCapture(btn.dataset.shortcutFor);
  });
  els.expressionVisibleToggle.addEventListener('click', () => {
    profile.expressions.visible = !profile.expressions.visible;
    saveCurrentProfile();
    renderExpressionUI();
    persist();
  });
  els.expressionRailToggle.addEventListener('click', () => {
    profile.expressions.collapsed = !profile.expressions.collapsed;
    saveCurrentProfile();
    renderExpressionUI();
    persist();
  });
  els.clearExpression.addEventListener('click', clearExpression);

  els.streamModeBtn.addEventListener('click', () => {
    if (appState.streamMode) exitStreamMode();
    else enterStreamMode();
  });
  els.copyStreamUrl.addEventListener('click', copyStreamUrl);
  els.exportConfig.addEventListener('click', exportConfig);
  els.importConfig.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => {
    const file = els.importFile.files?.[0];
    els.importFile.value = '';
    if (file) importConfig(file);
  });
  els.exportBgToggle.addEventListener('click', () => {
    appState.exportBg = !appState.exportBg;
    setSwitch(els.exportBgToggle, appState.exportBg);
  });
  els.resetModelProfile.addEventListener('click', () => {
    profile = defaultModelProfile();
    settings.view = { ...profile.view };
    settings.smoothing = profile.smoothing;
    settings.mirror = profile.mirror;
    settings.modelProfiles[model.id] = normalizeModelProfile(profile);
    applyProfile(profile);
    persist();
    toast('当前模型的视图、手感与物理已重置');
  });

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
    saveCurrentProfile();
    persist();
  });
  els.offsetY.addEventListener('input', () => {
    settings.view.offsetY = Number(els.offsetY.value);
    els.offsetYVal.textContent = `${els.offsetY.value}%`;
    setRangeFill(els.offsetY);
    scene.setView(settings.view);
    saveCurrentProfile();
    persist();
  });
  els.offsetX.addEventListener('input', () => {
    settings.view.offsetX = Number(els.offsetX.value);
    els.offsetXVal.textContent = `${els.offsetX.value}%`;
    setRangeFill(els.offsetX);
    scene.setView(settings.view);
    saveCurrentProfile();
    persist();
  });
  els.resetView.addEventListener('click', () => {
    settings.view = { zoom: 1, offsetX: 0, offsetY: 0 };
    syncControls();
    scene.setView(settings.view);
    saveCurrentProfile();
    persist();
    toast('视图已重置');
  });

  setupStageInteractions();

  window.addEventListener('pointermove', (e) => {
    appState.pointerTarget.x = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
    appState.pointerTarget.y = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
  }, { passive: true });
  window.addEventListener('pointerleave', () => {
    appState.pointerTarget.x = 0;
    appState.pointerTarget.y = 0;
  });

  window.addEventListener('keydown', (e) => {
    if (appState.shortcutCapture) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        appState.shortcutCapture = '';
        renderExpressionUI();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        setExpressionShortcut(appState.shortcutCapture, '');
        return;
      }
      const combo = shortcutFromEvent(e);
      if (!combo) return;
      if (RESERVED_SHORTCUTS.has(combo)) {
        toast(`「${combo}」是系统快捷键，换一个`, true);
        return;
      }
      setExpressionShortcut(appState.shortcutCapture, combo);
      return;
    }
    if (isTypingTarget(e.target)) return;

    const combo = shortcutFromEvent(e);
    const expressionId = combo ? matchExpressionShortcut(combo) : '';
    if (expressionId) {
      e.preventDefault();
      triggerExpression(expressionId);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      if (appState.streamMode) exitStreamMode();
      else closeDrawer();
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
      openDrawer('mapping');
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
  if ('ResizeObserver' in window) new ResizeObserver(() => scene.resize()).observe(els.stage);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tracker.lastVideoTime = -1;
  });
  window.addEventListener('beforeunload', () => {
    tracker.stopStream();
    audioTracker.stop();
  });

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
  window.addEventListener('dragleave', () => {
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
async function bootScene() {
  els.bootText.textContent = '正在加载 Live2D 模型…';
  els.bootBar.style.display = '';
  els.boot.classList.remove('is-done');
  try {
    const info = await scene.init(model.path);
    console.info('[webl2d] 模型已加载', info);
    appState.modelParamMeta = scene.getParamMeta();
    appState.capabilities = scene.getCapabilities();
    profile = getProfileForModel(model.id, true);
    applyProfile(profile);
    mapping = getMappingForModel(model.id, appState.modelParamMeta);
    mapper.setModelInfo(appState.modelParamMeta, scene.getParamDefaults());
    mapper.setMapping(mapping);
    mapper.setSettings(settings);
    appState.ready = true;
    settings.audio.enabled = false;
    appState.audioOn = false;
    syncControls();
    renderMappingUI();
    renderPhysicsUI();
    renderExpressionUI();
    updateAudioCapability();
    populateModelSelects();
    els.bootText.textContent = '模型已就绪';
    els.bootBar.style.display = 'none';
    setTimeout(() => els.boot.classList.add('is-done'), 220);
    if (new URLSearchParams(location.search).get('stream') === '1') enterStreamMode();
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
  buildBackgroundGrid();
  bindUI();
  syncControls();
  mapper.setSettings(settings);
  background.setSettings(settings);
  background.apply();
  scene.setView(settings.view);

  window.__webl2d = {
    scene,
    tracker,
    mapper,
    background,
    get settings() { return settings; },
    get state() { return appState; },
    get profile() { return profile; },
    get capabilities() { return appState.capabilities; },
    get mapping() { return mapping; },
    get catalog() { return appState.models; },
    get currentModel() { return model; },
    switchModel,
    refreshModelList,
    addMappingGroup,
    renderMappingUI,
    renderExpressionUI,
    renderPhysicsUI,
    applyPhysicsValue,
    startAudio,
    stopAudio,
    enterStreamMode,
    exitStreamMode,
    startCamera,
    stopCamera,
    takeScreenshot,
    openDrawer,
    closeDrawer,
    selectBackground,
    handleImageFile,
    setStatus,
    toast,
    audioTracker,
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
