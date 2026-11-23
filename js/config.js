/**
 * 全局配置、默认映射与默认值。
 * 想换模型：编辑 models.json，或在本地直接放进 L2d_model / L2d_models 后刷新。
 */

export const STORAGE_KEY = 'webl2d.settings.v1';
export const SETTINGS_VERSION = 2;

/** 映射曲线预设；镜像开关负责把正负两侧做成奇函数 f(-x) = -f(x) */
export const CURVE_PRESETS = [
  { id: 'linear', name: '线性', hint: '保持原来的等比例响应' },
  { id: 'soft', name: '柔和', hint: '靠近中位更细腻，末端更缓' },
  { id: 'strong', name: '强烈', hint: '中位更灵敏，末端更快' },
  { id: 'smooth', name: 'S 曲线', hint: '两端缓、中间过渡自然' },
];

const SIGNED_SOURCES = new Set(['yaw', 'pitch', 'roll', 'gazeX', 'gazeY', 'browL', 'browR', 'mouthForm']);
export function isSignedSource(sourceId) {
  return SIGNED_SOURCES.has(sourceId);
}


export const DEFAULT_MODEL = {
  id: 'nobu',
  name: '修长小狗 · 糯布',
  subtitle: '绿色长腿小狗',
  path: 'L2d_model/修长小狗_糯布/修长小狗_糯布.model3.json',
  accent: '#7ef0c8',
};

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  smoothing: 0.35,
  mirror: true,
  showLandmarks: true,
  showPreview: true,
  mouseFollow: true,
  deviceId: '',
  modelId: '',
  modelMappings: {},
  modelProfiles: {},
  audio: {
    enabled: false,
    gain: 1,
    noiseGate: 0.05,
    blend: 'max',
    vowelProfiles: {},
    vowelWeights: { A: 0.6, I: 0.75, U: 1.55, E: 0.55, O: 1.55 },
    vowelSmoothing: 45,
  },
  background: {
    preset: 'aurora',
    color: '#0d0a16',
    image: '',
    blur: 0,
    dim: 0.24,
  },
  view: {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  },
};

/**
 * 摄像头可提供的原始参数（已校准后的值）。
 * UI 中作为“摄像头参数”下拉选项。
 */
export const CAMERA_SOURCES = [
  { id: 'yaw', name: '头部左右', hint: '左右转头', unit: '°', min: -25, max: 25, step: 1 },
  { id: 'pitch', name: '抬头 / 低头', hint: '上下点头', unit: '°', min: -25, max: 25, step: 1 },
  { id: 'roll', name: '歪头', hint: '左右歪头', unit: '°', min: -25, max: 25, step: 1 },
  { id: 'blinkL', name: '左眼眨眼', hint: '0 睁开，1 闭眼', unit: '', min: 0.1, max: 1, step: 0.05 },
  { id: 'blinkR', name: '右眼眨眼', hint: '0 睁开，1 闭眼', unit: '', min: 0.1, max: 1, step: 0.05 },
  { id: 'blink', name: '双眼眨眼（平均）', hint: '两眼一起控制', unit: '', min: 0.1, max: 1, step: 0.05 },
  { id: 'jaw', name: '嘴巴张开', hint: '说话、张嘴', unit: '', min: 0, max: 1, step: 0.05 },
  { id: 'mouthForm', name: '嘴型（笑 / 皱）', hint: '负值皱眉，正值微笑', unit: '', min: -0.5, max: 0.5, step: 0.05 },
  { id: 'smile', name: '微笑强度', hint: '只取微笑的正向强度', unit: '', min: 0, max: 0.7, step: 0.05 },
  { id: 'gazeX', name: '眼神左右', hint: '眼球水平转动', unit: '', min: -1, max: 1, step: 0.05 },
  { id: 'gazeY', name: '眼神上下', hint: '眼球垂直转动', unit: '', min: -1, max: 1, step: 0.05 },
  { id: 'browL', name: '左眉毛', hint: '挑眉 / 皱眉', unit: '', min: -0.6, max: 0.6, step: 0.05 },
  { id: 'browR', name: '右眉毛', hint: '挑眉 / 皱眉', unit: '', min: -0.6, max: 0.6, step: 0.05 },
  { id: 'browInner', name: '眉心上抬', hint: '眉毛整体上抬', unit: '', min: 0, max: 1, step: 0.05 },
  { id: 'tongue', name: '吐舌头', hint: '舌头的伸出程度', unit: '', min: 0, max: 1, step: 0.05 },
  { id: 'sneer', name: '皱鼻子', hint: '鼻翼上提', unit: '', min: 0, max: 1, step: 0.05 },
  { id: 'cheekPuff', name: '鼓腮', hint: '脸颊鼓起', unit: '', min: 0, max: 1, step: 0.05 },
  { id: 'squint', name: '眯眼', hint: '眼睛眯起', unit: '', min: 0, max: 1, step: 0.05 },
];

export const SOURCE_BY_ID = Object.fromEntries(CAMERA_SOURCES.map((s) => [s.id, s]));

/** 模型参数显示范围（舞台写入时也会被模型真实 range 夹住） */
export const PARAM_RANGES = {
  ParamAngleX: [-30, 30],
  ParamAngleY: [-30, 30],
  ParamAngleZ: [-30, 30],
  ParamEyeLOpen: [0, 1],
  ParamEyeROpen: [0, 1],
  ParamEyeLSmile: [0, 1],
  ParamEyeRSmile: [0, 1],
  ParamEyeBallX: [-1, 1],
  ParamEyeBallY: [-1, 1],
  ParamBrowLY: [-1, 1],
  ParamBrowRY: [-1, 1],
  ParamBrowLAngle: [-1, 1],
  ParamBrowRAngle: [-1, 1],
  ParamBrowLForm: [-1, 1],
  ParamBrowRForm: [-1, 1],
  ParamMouthOpenY: [0, 1],
  ParamMouthForm: [-1, 1],
  ParamCheek: [0, 1],
  ParamTongue: [0, 1],
  ParamNose: [0, 1],
  ParamBodyAngleX: [-10, 10],
  ParamBreath: [0, 1],
};

/** 参数默认值（没有摄像头输入、也没有映射时回到这些值） */
export const DEFAULT_PARAM_VALUES = {
  ParamAngleX: 0,
  ParamAngleY: 0,
  ParamAngleZ: 0,
  ParamEyeLOpen: 1,
  ParamEyeROpen: 1,
  ParamEyeLSmile: 0,
  ParamEyeRSmile: 0,
  ParamEyeBallX: 0,
  ParamEyeBallY: 0,
  ParamBrowLY: 0,
  ParamBrowRY: 0,
  ParamBrowLAngle: 0,
  ParamBrowRAngle: 0,
  ParamBrowLForm: 0,
  ParamBrowRForm: 0,
  ParamMouthOpenY: 0,
  ParamMouthForm: 0,
  ParamCheek: 0,
  ParamTongue: 0,
  ParamNose: 0,
  ParamBodyAngleX: 0,
  ParamBreath: 0.42,
};

export const EYE_OPEN_PARAMS = ['ParamEyeLOpen', 'ParamEyeROpen'];

export function isEyeOpenParam(id) {
  return id === 'ParamEyeLOpen' || id === 'ParamEyeROpen';
}

/** 哪些参数属于“面捕参数”；未映射时会被复位到默认值，而不是被摄像头残留值驱动。
 *  模型 physics 输出的参数不在这里复位，避免破坏物理。 */
export function isFaceParam(id) {
  return /^Param(Angle|Eye|Brow|Mouth|Cheek|Tongue|Nose)/.test(id);
}

/** 单个模型的本地缓存：视图、手感、表情快捷键、物理手感。只进 localStorage。 */
export function defaultModelProfile() {
  return {
    view: { zoom: 1, offsetX: 0, offsetY: 0 },
    smoothing: 0.35,
    mirror: true,
    expressions: { visible: true, collapsed: false, shortcuts: {} },
    physics: { groups: {}, breath: 1, breathSpeed: 1, smoothing: 1 },
  };
}

export function normalizeModelProfile(profile) {
  const base = defaultModelProfile();
  const p = profile && typeof profile === 'object' ? profile : {};
  const view = p.view && typeof p.view === 'object' ? p.view : {};
  base.view.zoom = Math.max(0.3, Math.min(3, Number(view.zoom) || 1));
  base.view.offsetX = Math.max(-80, Math.min(80, Number(view.offsetX) || 0));
  base.view.offsetY = Math.max(-80, Math.min(80, Number(view.offsetY) || 0));
  base.smoothing = Math.max(0, Math.min(0.9, Number.isFinite(Number(p.smoothing)) ? Number(p.smoothing) : base.smoothing));
  base.mirror = p.mirror !== false;
  const ex = p.expressions && typeof p.expressions === 'object' ? p.expressions : {};
  base.expressions.visible = ex.visible !== false;
  base.expressions.collapsed = ex.collapsed === true;
  base.expressions.shortcuts = ex.shortcuts && typeof ex.shortcuts === 'object' && !Array.isArray(ex.shortcuts) ? { ...ex.shortcuts } : {};
  const ph = p.physics && typeof p.physics === 'object' ? p.physics : {};
  base.physics.groups = {};
  const rawGroups = ph.groups && typeof ph.groups === 'object' && !Array.isArray(ph.groups) ? ph.groups : {};
  for (const [id, value] of Object.entries(rawGroups)) {
    const n = Number(value);
    if (Number.isFinite(n)) base.physics.groups[id] = Math.max(0.2, Math.min(2, n));
  }
  for (const key of ['breath', 'breathSpeed', 'smoothing']) {
    const v = Number(ph[key]);
    if (Number.isFinite(v)) base.physics[key] = Math.max(0, Math.min(2, v));
  }
  return base;
}


/** 新建目标参数时的推荐输出范围（直接点“新增”就能得到合理方向） */
export const RECOMMENDED_OUTPUT = {
  ParamAngleX: [30, -30],
  ParamAngleY: [30, -30],
  ParamAngleZ: [30, -30],
  ParamEyeLOpen: [1, 0],
  ParamEyeROpen: [1, 0],
  ParamEyeLSmile: [0, 1],
  ParamEyeRSmile: [0, 1],
  ParamEyeBallX: [1, -1],
  ParamEyeBallY: [-1, 1],
  ParamBrowLY: [-1, 1],
  ParamBrowRY: [-1, 1],
  ParamBrowLAngle: [-1, 1],
  ParamBrowRAngle: [-1, 1],
  ParamBrowLForm: [-1, 1],
  ParamBrowRForm: [-1, 1],
  ParamMouthOpenY: [0, 1],
  ParamMouthForm: [-1, 1],
  ParamCheek: [0, 1],
  ParamTongue: [0, 1],
  ParamNose: [0, 1],
  ParamBodyAngleX: [10, -10],
  ParamBreath: [0, 1],
};

export function recommendedOutput(param) {
  const r = RECOMMENDED_OUTPUT[param];
  return r ? [...r] : [0, 1];
}

/**
 * 默认映射：尽量复刻之前硬编码的面捕手感，同时让所有参数都可以在 UI 里改。
 * @param {Iterable<string>} paramIds 当前模型实际拥有的参数 ID
 */
export function buildDefaultMapping(paramIds) {
  const have = new Set(paramIds || []);
  const specs = [
    { id: 'head-x', source: 'yaw', inMin: -25, inMax: 25, targets: [['ParamAngleX', 30, -30]] },
    { id: 'head-y', source: 'pitch', inMin: -25, inMax: 25, targets: [['ParamAngleY', 30, -30]] },
    { id: 'head-z', source: 'roll', inMin: -25, inMax: 25, targets: [['ParamAngleZ', 30, -30]] },
    { id: 'eye-l', source: 'blinkL', inMin: 0.18, inMax: 1, targets: [['ParamEyeLOpen', 1, 0]] },
    { id: 'eye-r', source: 'blinkR', inMin: 0.18, inMax: 1, targets: [['ParamEyeROpen', 1, 0]] },
    { id: 'gaze-x', source: 'gazeX', inMin: -1, inMax: 1, targets: [['ParamEyeBallX', 1, -1]] },
    { id: 'gaze-y', source: 'gazeY', inMin: -1, inMax: 1, targets: [['ParamEyeBallY', -1, 1]] },
    { id: 'mouth-open', source: 'jaw', inMin: 0, inMax: 1, targets: [['ParamMouthOpenY', 0, 1]] },
    { id: 'mouth-form', source: 'mouthForm', inMin: -0.5, inMax: 0.5, targets: [['ParamMouthForm', -1, 1]] },
    { id: 'smile', source: 'smile', inMin: 0, inMax: 0.7, targets: [['ParamEyeLSmile', 0, 1], ['ParamEyeRSmile', 0, 1], ['ParamCheek', 0, 1]] },
    { id: 'brow-l', source: 'browL', inMin: -0.6, inMax: 0.6, targets: [['ParamBrowLY', -1, 1]] },
    { id: 'brow-r', source: 'browR', inMin: -0.6, inMax: 0.6, targets: [['ParamBrowRY', -1, 1]] },
    { id: 'tongue', source: 'tongue', inMin: 0, inMax: 1, targets: [['ParamTongue', 0, 1]] },
    { id: 'nose', source: 'sneer', inMin: 0, inMax: 1, targets: [['ParamNose', 0, 1]] },
  ];
  const groups = [];
  const used = new Set();
  for (const spec of specs) {
    const targets = [];
    for (const [param, outMin, outMax] of spec.targets) {
      if (!have.has(param) || used.has(param)) continue;
      targets.push({
        param,
        outMin,
        outMax,
        curve: 'linear',
        mirror: isSignedSource(spec.source),
      });
      used.add(param);
    }
    if (targets.length) {
      groups.push({
        id: spec.id,
        source: spec.source,
        autoBlink: false,
        inMin: spec.inMin,
        inMax: spec.inMax,
        targets,
      });
    }
  }
  return { groups };
}

/** 校验并修复从 localStorage 读出的映射，保证一个模型参数只出现一次 */
export function normalizeMapping(mapping, paramIds, blockedIds) {
  const have = new Set(paramIds || []);
  const blocked = blockedIds instanceof Set ? blockedIds : new Set(blockedIds || []);
  const source = mapping && Array.isArray(mapping.groups) ? mapping.groups : [];
  const used = new Set();
  const groups = [];
  for (const g of source) {
    if (!g || typeof g !== 'object') continue;
    const isSource = g.source && SOURCE_BY_ID[g.source];
    const def = isSource ? SOURCE_BY_ID[g.source] : null;
    const inMin = Number.isFinite(Number(g.inMin)) ? Number(g.inMin) : def?.min ?? 0;
    const inMax = Number.isFinite(Number(g.inMax)) ? Number(g.inMax) : def?.max ?? 1;
    const targets = [];
    for (const t of Array.isArray(g.targets) ? g.targets : []) {
      if (!t || !have.has(t.param) || used.has(t.param) || blocked.has(t.param)) continue;
      const [roMin, roMax] = recommendedOutput(t.param);
      const outMin = Number.isFinite(Number(t.outMin)) ? Number(t.outMin) : roMin;
      const outMax = Number.isFinite(Number(t.outMax)) ? Number(t.outMax) : roMax;
      const curve = CURVE_PRESETS.some((c) => c.id === t.curve) ? t.curve : 'linear';
      const mirror = t.mirror !== undefined ? !!t.mirror : isSignedSource(isSource ? g.source : null);
      targets.push({ param: t.param, outMin, outMax, curve, mirror });
      used.add(t.param);
    }
    if (!targets.length) continue;
    groups.push({
      id: String(g.id || `group-${groups.length + 1}`),
      source: isSource ? g.source : null,
      autoBlink: isSource ? false : g.autoBlink !== false,
      inMin,
      inMax,
      targets,
    });
  }
  return { groups };
}

export function cloneMapping(mapping) {
  return JSON.parse(JSON.stringify(mapping && Array.isArray(mapping.groups) ? mapping : { groups: [] }));
}

/** 背景预设 */
export const BACKGROUNDS = [
  {
    id: 'aurora',
    name: '极光',
    hint: '深空 + 流动光晕',
    swatch: 'linear-gradient(135deg,#0b1026 0%,#183d4a 45%,#6f2d63 100%)',
  },
  {
    id: 'dusk',
    name: '暮色',
    hint: '暖橘 + 薰衣草',
    swatch: 'linear-gradient(135deg,#2a1633 0%,#7a3f52 55%,#f0a879 100%)',
  },
  {
    id: 'solid',
    name: '纯色',
    hint: '自选一个颜色',
    swatch: 'linear-gradient(135deg,#1b1830,#2b2647)',
  },
  {
    id: 'image',
    name: '图片',
    hint: '上传 / 拖入一张图',
    swatch: 'linear-gradient(135deg,#27303f,#4f6175)',
  },
  {
    id: 'camera',
    name: '摄像头',
    hint: '实时虚化人像背景',
    swatch: 'linear-gradient(135deg,#1a2c28,#3c6158)',
  },
  {
    id: 'transparent',
    name: '透明',
    hint: '棋盘格，便于抠像',
    swatch: 'repeating-conic-gradient(#2a2a36 0% 25%, #1c1c26 0% 50%) 0 0 / 16px 16px',
  },
];

export const BG_PRESETS = new Set(BACKGROUNDS.map((b) => b.id));
