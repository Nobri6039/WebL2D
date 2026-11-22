/**
 * 全局配置与默认值。
 * 想换模型：编辑 models.json 即可，无需改代码。
 */

export const STORAGE_KEY = 'webl2d.settings.v1';

export const DEFAULT_MODEL = {
  id: 'nobu',
  name: '修长小狗 · 糯布',
  subtitle: '绿色长腿小狗',
  path: 'L2d_model/修长小狗_糯布/修长小狗_糯布.model3.json',
  accent: '#7ef0c8',
};

export const DEFAULT_SETTINGS = {
  gains: {
    head: 1,
    eyes: 1,
    mouth: 1,
    brows: 1,
    expression: 1,
    body: 1,
  },
  smoothing: 0.35,
  mirror: true,
  showLandmarks: true,
  showPreview: true,
  angleLimit: 30,
  idle: true,
  mouseFollow: true,
  deviceId: '',
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

/** 面捕强度滑杆 */
export const GAIN_CONTROLS = [
  {
    key: 'head',
    label: '头部转动',
    hint: '左右转头、抬头低头的幅度',
    min: 0,
    max: 200,
    step: 5,
    unit: '%',
  },
  {
    key: 'eyes',
    label: '眼神与眨眼',
    hint: '眼球跟随与眼睛开合',
    min: 0,
    max: 200,
    step: 5,
    unit: '%',
  },
  {
    key: 'mouth',
    label: '嘴部开合',
    hint: '说话、张嘴的幅度',
    min: 0,
    max: 200,
    step: 5,
    unit: '%',
  },
  {
    key: 'brows',
    label: '眉毛',
    hint: '挑眉、皱眉的幅度',
    min: 0,
    max: 200,
    step: 5,
    unit: '%',
  },
  {
    key: 'expression',
    label: '表情',
    hint: '微笑、脸红、吐舌等',
    min: 0,
    max: 200,
    step: 5,
    unit: '%',
  },
  {
    key: 'body',
    label: '身体摆动',
    hint: '身体跟随头部摆动的幅度',
    min: 0,
    max: 200,
    step: 5,
    unit: '%',
  },
];

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
  ParamMouthOpenY: [0, 1],
  ParamMouthForm: [-1, 1],
  ParamCheek: [0, 1],
  ParamTongue: [0, 1],
  ParamNose: [0, 1],
  ParamBodyAngleX: [-10, 10],
  ParamBreath: [0, 1],
};
