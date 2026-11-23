/**
 * FaceMapper —— 把 MediaPipe 的 478 个关键点 + 52 个表情系数，
 * 经过“可配置映射组”转换成 Live2D 参数。
 *
 * 每个映射组：一个摄像头来源 + 输入范围 + 多个模型目标及其输出范围。
 * 来源为 null 的空组：目标保持默认值；如果是眼睛开合且打开 autoBlink，会走自动眨眼。
 */
import { clamp, clamp01 } from './utils.js';
import { DEFAULT_PARAM_VALUES, PARAM_RANGES, isEyeOpenParam, isFaceParam } from './config.js';

const EYE_L = [33, 133, 159, 145];
const EYE_R = [362, 263, 386, 374];
const NOSE = 1;
const CHIN = 152;
const CHEEK_L = 234;
const CHEEK_R = 454;

const CALIB_SAMPLES = 40;
const FAST_KEYS = new Set(['ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamEyeROpen']);
const VOWEL_KEYS = new Set(['ParamA', 'ParamI', 'ParamU', 'ParamE', 'ParamO']);
const SLOW_KEYS = new Set(['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX']);

function avgPoint(landmarks, indices) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of indices) {
    const p = landmarks[i];
    x += p.x;
    y += p.y;
    z += p.z || 0;
  }
  const n = indices.length;
  return { x: x / n, y: y / n, z: z / n };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function softDeadzone(v, d) {
  if (Math.abs(v) <= d) return 0;
  return (v - Math.sign(v) * d) / (1 - d);
}

function applyCurve(t, curve) {
  const x = clamp01(t);
  if (curve === 'soft') return 1 - (1 - x) * (1 - x);
  if (curve === 'strong') return x * x;
  if (curve === 'smooth') return x * x * (3 - 2 * x);
  return x;
}

/**
 * 输入范围 → 输出范围。
 * mirror=true 时按 0 的左右两侧分别做奇函数曲线，保证 f(-x) = -f(x)；
 * 例如头部左右、歪头、眼神、眉毛、嘴型在正负方向上手感一致。
 */
function mapRange(value, inMin, inMax, outMin, outMax, curve = 'linear', mirror = false) {
  const a = Number(inMin);
  const b = Number(inMax);
  const lo = Number(outMin);
  const hi = Number(outMax);
  const v = Number(value);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < 1e-9) return Number.isFinite(lo) ? lo : 0;
  if (!Number.isFinite(v)) return lo;
  if (mirror && a < 0 && b > 0) {
    const center = (lo + hi) / 2;
    if (v >= 0) {
      const c = applyCurve(clamp01(v / b), curve);
      return center + c * (hi - center);
    }
    const c = applyCurve(clamp01(-v / -a), curve);
    return center - c * (center - lo);
  }
  const t = applyCurve(clamp((v - a) / (b - a), 0, 1), curve);
  return lo + t * (hi - lo);
}

export class FaceMapper {
  constructor(settings) {
    this.settings = settings;
    this.mapping = { groups: [] };
    this.paramMeta = [];
    this.paramDefaults = { ...DEFAULT_PARAM_VALUES };
    this.paramRangeMap = new Map();
    this.smoothed = { ...DEFAULT_PARAM_VALUES };
    this.targets = { ...DEFAULT_PARAM_VALUES };
    this.previousMapped = new Set();
    this.facePresent = false;
    this.lastFaceAt = -1e9;
    this.raw = null;
    this.bs = {};
    this.calib = this._emptyCalibration();
    this.calibrating = false;
    this.calibProgress = 0;
    this.autoBlink = { nextAt: 0, start: -1, amount: 0 };
    this.breathAmplitude = 1;
    this.breathSpeed = 1;
    this.vowelMode = false;
    this.vowelParams = [];
    this.vowels = {};
    this._state = {
      facePresent: false,
      calibrating: false,
      calibProgress: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      mouth: 0,
      blink: 0,
      eyeOpen: 1,
      brow: 0,
      gazeX: 0,
      gazeY: 0,
      expression: 0,
      fps: 0,
      delegate: '',
    };
  }

  _emptyCalibration() {
    return {
      samples: 0,
      sumYaw: 0,
      sumPitch: 0,
      sumRoll: 0,
      sumJaw: 0,
      sumGazeX: 0,
      sumGazeY: 0,
      sumBrowL: 0,
      sumBrowR: 0,
      sumSmile: 0,
      sumFrown: 0,
      sumSquint: 0,
      sumMouthForm: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      jaw: 0.04,
      gazeX: 0,
      gazeY: 0,
      browL: 0,
      browR: 0,
      smile: 0,
      frown: 0,
      squint: 0,
      mouthForm: 0,
      done: false,
      startedAt: 0,
    };
  }

  setSettings(settings) {
    this.settings = settings;
  }

  setMapping(mapping) {
    this.mapping = mapping && Array.isArray(mapping.groups) ? mapping : { groups: [] };
  }

  setBreathSettings(profile = {}) {
    const amp = Number(profile.breath);
    const speed = Number(profile.breathSpeed);
    this.breathAmplitude = Number.isFinite(amp) ? Math.max(0.2, Math.min(2, amp)) : 1;
    this.breathSpeed = Number.isFinite(speed) ? Math.max(0.3, Math.min(2.5, speed)) : 1;
  }

  setVowelParams(ids) {
    this.vowelParams = Array.isArray(ids) ? ids.filter(Boolean) : [];
  }

  setVowelMode(on) {
    this.vowelMode = !!on;
  }

  setModelInfo(paramMeta, defaults) {    this.paramMeta = Array.isArray(paramMeta) ? paramMeta : [];
    this.paramDefaults = { ...DEFAULT_PARAM_VALUES, ...(defaults || {}) };
    this.paramRangeMap.clear();
    for (const p of this.paramMeta) this.paramRangeMap.set(p.id, [p.min, p.max]);
    this.smoothed = { ...this.paramDefaults };
    this.targets = {};
    this.previousMapped.clear();
    this.facePresent = false;
    this.lastFaceAt = -1e9;
    this.raw = null;
    this.resetCalibration();
  }

  resetCalibration() {
    this.calib = this._emptyCalibration();
    this.calibrating = false;
    this.calibProgress = 0;
  }

  resetTracking() {
    this.facePresent = false;
    this.lastFaceAt = -1e9;
    this.raw = null;
    this.smoothed = { ...this.paramDefaults };
    this.targets = {};
    this.previousMapped.clear();
    this.autoBlink.start = -1;
    this.autoBlink.amount = 0;
    this.autoBlink.nextAt = 0;
    this.resetCalibration();
  }

  update({ detection, newFrame = false, now, dt, cameraOn, pointer = { x: 0, y: 0 }, fps = 0, audioLevel = 0, audioVowels = null }) {
    this.now = now;
    this.vowels = audioVowels && typeof audioVowels === 'object' ? audioVowels : {};
    const s = this.settings;

    if (newFrame) {
      const lm = detection?.faceLandmarks?.[0];
      if (lm && lm.length >= 400) {
        this._ingest(lm, detection?.faceBlendshapes?.[0]?.categories || []);
        this.facePresent = true;
        this.lastFaceAt = now;
      } else if (now - this.lastFaceAt > 450) {
        this.facePresent = false;
      }
    } else if (this.facePresent && now - this.lastFaceAt > 900) {
      this.facePresent = false;
    }
    if (!cameraOn) this.facePresent = false;

    const present = this.facePresent && !!this.raw;
    this.calibrating = present && !this.calib.done;
    this.calibProgress = present && !this.calib.done ? clamp01(this.calib.samples / CALIB_SAMPLES) : 1;
    if (present && !this.calib.done) this._sampleCalibration(now);

    const auto = this._autoBlinkAmount(now, dt, true);
    const faceSources = present ? this._faceSources(this.calib.done) : null;
    const idleSources = this._idleSources(now, cameraOn, pointer, auto);
    const audio = Number(audioLevel) > 0.015 ? clamp01(Number(audioLevel)) : 0;
    if (!this.vowelMode && audio > 0) {
      if (faceSources) faceSources.jaw = Math.max(faceSources.jaw, audio);
      idleSources.jaw = Math.max(idleSources.jaw, audio);
    }
    this._computeTargets({ present, faceSources, idleSources, auto });
    this._smooth(dt, s.smoothing);

    const params = {};
    for (const key of Object.keys(this.targets)) {
      if (key in this.smoothed) params[key] = this.smoothed[key];
    }

    const eyeL = params.ParamEyeLOpen;
    const eyeR = params.ParamEyeROpen;
    const hasEyes = Number.isFinite(eyeL) || Number.isFinite(eyeR);
    const eyeOpen = hasEyes ? ((eyeL ?? 1) + (eyeR ?? 1)) / 2 : clamp01(1 - auto);
    const vowelMouth = this.vowelMode
      ? Math.max(0, ...this.vowelParams.map((id) => Number(params[id]) || 0))
      : 0;
    this._state = {
      facePresent: present,
      calibrating: this.calibrating,
      calibProgress: this.calibProgress,
      yaw: params.ParamAngleX ?? 0,
      pitch: params.ParamAngleY ?? 0,
      roll: params.ParamAngleZ ?? 0,
      mouth: Math.max(params.ParamMouthOpenY ?? 0, vowelMouth),
      blink: 1 - eyeOpen,
      eyeOpen,
      brow: ((params.ParamBrowLY ?? 0) + (params.ParamBrowRY ?? 0)) / 2,
      gazeX: params.ParamEyeBallX ?? 0,
      gazeY: params.ParamEyeBallY ?? 0,
      expression: params.ParamMouthForm ?? 0,
      fps,
      delegate: '',
    };
    return { params, state: this._state };
  }

  _ingest(landmarks, categories) {
    const bs = {};
    for (const c of categories) bs[c.categoryName] = c.score;

    const eyeL = avgPoint(landmarks, EYE_L);
    const eyeR = avgPoint(landmarks, EYE_R);
    const eyeMid = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 };
    const nose = landmarks[NOSE];
    const chin = landmarks[CHIN];
    const cheekL = landmarks[CHEEK_L];
    const cheekR = landmarks[CHEEK_R];

    const faceW = Math.max(0.03, dist(cheekL, cheekR));
    const eyeLine = Math.hypot(eyeR.x - eyeL.x, eyeR.y - eyeL.y) || 0.1;
    const chinSpan = Math.max(0.06, chin.y - eyeMid.y);

    const yaw = ((nose.x - eyeMid.x) / faceW) * 88;
    const pitchRatio = (nose.y - eyeMid.y) / chinSpan;
    const pitch = (pitchRatio - 0.43) * 112;
    const roll = (Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x) * 180) / Math.PI;

    this.raw = {
      yaw,
      pitch,
      roll,
      jaw: bs.jawOpen || 0,
      smile: ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2,
      frown: ((bs.mouthFrownLeft || 0) + (bs.mouthFrownRight || 0)) / 2,
      mouthForm:
        (((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2) -
        (((bs.mouthFrownLeft || 0) + (bs.mouthFrownRight || 0)) / 2) * 0.85,
      blinkL: bs.eyeBlinkLeft || 0,
      blinkR: bs.eyeBlinkRight || 0,
      squint: ((bs.eyeSquintLeft || 0) + (bs.eyeSquintRight || 0)) / 2,
      browInner: bs.browInnerUp || 0,
      browDownL: bs.browDownLeft || 0,
      browDownR: bs.browDownRight || 0,
      browOuterL: bs.browOuterUpLeft || 0,
      browOuterR: bs.browOuterUpRight || 0,
      gazeX:
        (bs.eyeLookOutLeft || 0) +
        (bs.eyeLookInRight || 0) -
        (bs.eyeLookInLeft || 0) -
        (bs.eyeLookOutRight || 0),
      gazeY:
        (bs.eyeLookUpLeft || 0) +
        (bs.eyeLookUpRight || 0) -
        (bs.eyeLookDownLeft || 0) -
        (bs.eyeLookDownRight || 0),
      tongue: bs.tongueOut || 0,
      sneer: ((bs.noseSneerLeft || 0) + (bs.noseSneerRight || 0)) / 2,
      cheekPuff: bs.cheekPuff || 0,
      eyeLine,
      faceW,
      landmarks,
      bs,
    };
    this.bs = bs;
  }

  _sampleCalibration(now) {
    if (!this.raw) return;
    const c = this.calib;
    if (!c.startedAt) c.startedAt = now;
    if (Math.abs(this.raw.yaw) > 34 || Math.abs(this.raw.pitch) > 32 || Math.abs(this.raw.roll) > 36) return;
    c.samples += 1;
    c.sumYaw += this.raw.yaw;
    c.sumPitch += this.raw.pitch;
    c.sumRoll += this.raw.roll;
    c.sumJaw += this.raw.jaw;
    c.sumGazeX += this.raw.gazeX;
    c.sumGazeY += this.raw.gazeY;
    c.sumBrowL += this.raw.browInner * 0.9 + this.raw.browOuterL * 0.55 - this.raw.browDownL * 0.85;
    c.sumBrowR += this.raw.browInner * 0.9 + this.raw.browOuterR * 0.55 - this.raw.browDownR * 0.85;
    c.sumSmile += this.raw.smile;
    c.sumFrown += this.raw.frown;
    c.sumSquint += this.raw.squint;
    c.sumMouthForm += this.raw.mouthForm;
    const timedOut = c.samples >= 8 && now - c.startedAt > 2600;
    const forced = c.samples >= 1 && now - c.startedAt > 6500;
    if (c.samples >= CALIB_SAMPLES || timedOut || forced) {
      const n = Math.max(1, c.samples);
      c.yaw = c.sumYaw / n;
      c.pitch = c.sumPitch / n;
      c.roll = c.sumRoll / n;
      c.jaw = c.sumJaw / n;
      c.gazeX = c.sumGazeX / n;
      c.gazeY = c.sumGazeY / n;
      c.browL = c.sumBrowL / n;
      c.browR = c.sumBrowR / n;
      c.smile = c.sumSmile / n;
      c.frown = c.sumFrown / n;
      c.squint = c.sumSquint / n;
      c.mouthForm = c.sumMouthForm / n;
      c.done = true;
      this.calibrating = false;
      this.calibProgress = 1;
    }
  }

  _autoBlinkAmount(now, dt, active) {
    const b = this.autoBlink;
    if (!active) {
      b.amount = Math.max(0, b.amount - dt * 10);
      return b.amount;
    }
    if (b.nextAt === 0) b.nextAt = now + 1200 + Math.random() * 2200;
    if (b.start < 0 && now >= b.nextAt) {
      b.start = now;
      b.nextAt = now + 2600 + Math.random() * 4200;
    }
    if (b.start >= 0) {
      const t = now - b.start;
      if (t < 90) b.amount = t / 90;
      else if (t < 150) b.amount = 1;
      else if (t < 360) b.amount = 1 - (t - 150) / 210;
      else {
        b.amount = 0;
        b.start = -1;
      }
    }
    return b.amount;
  }

  _mirrorSources(v) {
    if (this.settings.mirror) return v;
    v.yaw = -v.yaw;
    v.roll = -v.roll;
    v.gazeX = -v.gazeX;
    [v.blinkL, v.blinkR] = [v.blinkR, v.blinkL];
    [v.browL, v.browR] = [v.browR, v.browL];
    v.blink = (v.blinkL + v.blinkR) / 2;
    return v;
  }

  _faceSources(ready) {
    const r = this.raw;
    const c = this.calib;
    const yaw = ready ? r.yaw - c.yaw : 0;
    const pitch = ready ? r.pitch - c.pitch : 0;
    const roll = ready ? r.roll - c.roll : 0;
    const smile = r.smile - c.smile;
    const frown = r.frown - c.frown;
    const squint = r.squint - c.squint;
    const browRawL = r.browInner * 0.9 + r.browOuterL * 0.55 - r.browDownL * 0.85;
    const browRawR = r.browInner * 0.9 + r.browOuterR * 0.55 - r.browDownR * 0.85;
    const blinkL = r.blinkL;
    const blinkR = r.blinkR;
    const sources = {
      yaw,
      pitch,
      roll,
      blinkL,
      blinkR,
      blink: (blinkL + blinkR) / 2,
      jaw: r.jaw - c.jaw,
      mouthForm: softDeadzone(r.mouthForm - c.mouthForm, 0.03),
      smile: Math.max(0, smile),
      frown,
      gazeX: softDeadzone(r.gazeX - c.gazeX, 0.06),
      gazeY: softDeadzone(r.gazeY - c.gazeY, 0.06),
      browL: softDeadzone(browRawL - c.browL, 0.1),
      browR: softDeadzone(browRawR - c.browR, 0.1),
      browInner: r.browInner,
      tongue: r.tongue,
      sneer: r.sneer,
      cheekPuff: r.cheekPuff,
      squint,
    };
    return this._mirrorSources(sources);
  }

  _idleSources(now, cameraOn, pointer, auto) {
    const time = now / 1000;
    const swayX = Math.sin(time * 0.55) * 2.1 + Math.sin(time * 1.31) * 0.55;
    const swayY = Math.sin(time * 0.72 + 1.2) * 1.5;
    const swayZ = Math.sin(time * 0.43 + 0.5) * 1.8;
    const follow = this.settings.mouseFollow && !cameraOn ? pointer : { x: 0, y: 0 };
    const drift = Math.sin(time * 0.7) * 0.1 + Math.sin(time * 2.1) * 0.03;
    const sources = {
      yaw: -(swayX + follow.x * 16),
      pitch: -swayY + follow.y * 10,
      roll: -swayZ + follow.x * 3.5,
      blinkL: auto,
      blinkR: auto,
      blink: auto,
      jaw: 0,
      mouthForm: 0,
      smile: 0,
      frown: 0,
      gazeX: -(drift + follow.x * 0.35),
      gazeY: Math.sin(time * 0.9 + 0.4) * 0.08 - follow.y * 0.25,
      browL: 0,
      browR: 0,
      browInner: 0,
      tongue: 0,
      sneer: 0,
      cheekPuff: 0,
      squint: 0,
    };
    return this._mirrorSources(sources);
  }

  _defaultFor(id) {
    return Object.prototype.hasOwnProperty.call(this.paramDefaults, id) ? this.paramDefaults[id] : DEFAULT_PARAM_VALUES[id] ?? 0;
  }

  _computeTargets({ present, faceSources, idleSources, auto }) {
    const targets = {};
    const mapped = new Set();
    const groups = this.mapping.groups || [];

    for (const group of groups) {
      if (!group || !Array.isArray(group.targets)) continue;
      const sourceId = group.source || null;
      let sourceValue = null;
      if (sourceId) {
        const values = present && faceSources ? faceSources : idleSources;
        sourceValue = values?.[sourceId];
        if (sourceValue == null) sourceValue = idleSources?.[sourceId] ?? 0;
      }
      for (const target of group.targets) {
        if (!target || !target.param) continue;
        let value;
        if (sourceId) {
          value = mapRange(sourceValue, group.inMin, group.inMax, target.outMin, target.outMax, target.curve, target.mirror);
        } else if (group.autoBlink && isEyeOpenParam(target.param)) {
          value = mapRange(auto, 0, 1, target.outMin, target.outMax);
        } else {
          value = this._defaultFor(target.param);
        }
        targets[target.param] = value;
        mapped.add(target.param);
      }
    }

    // 未参与映射的面捕参数复位到模型默认值，避免残留上一次面捕的值。
    for (const p of this.paramMeta) {
      if (!mapped.has(p.id) && isFaceParam(p.id)) targets[p.id] = this._defaultFor(p.id);
    }
    for (const id of Object.keys(DEFAULT_PARAM_VALUES)) {
      if (!mapped.has(id) && isFaceParam(id) && !(id in targets)) targets[id] = this._defaultFor(id);
    }
    for (const id of this.previousMapped) {
      if (!mapped.has(id) && !(id in targets)) targets[id] = this._defaultFor(id);
    }
    this.previousMapped = mapped;

    if (this.vowelMode && this.vowelParams.length) {
      // 元音模式：A/I/U/E/O 由音频分类驱动；Open/Smile 仍保留摄像头值，
      // 由 ParamSilence = 1 - 元音强度 在模型内部做连续混合。
      for (const id of this.vowelParams) {
        const key = id.replace(/^Param/, '');
        targets[id] = clamp01(Number(this.vowels[key] ?? this.vowels[id]) || 0);
      }
    } else {
      for (const id of this.vowelParams) targets[id] = 0;
    }

    if (!mapped.has('ParamBreath')) {
      targets.ParamBreath = 0.42 + 0.24 * this.breathAmplitude * Math.sin((this.now / 1000) * 1.6 * this.breathSpeed);
    }
    this.targets = targets;
  }

  _smooth(dt, smoothing) {
    const s = clamp01(smoothing);
    const baseTau = 0.008 + s * s * 0.5;
    const alphaFor = (key) => {
      let tau = baseTau;
      if (FAST_KEYS.has(key)) tau *= 0.55;
      else if (SLOW_KEYS.has(key)) tau *= 1.25;
      if (tau <= 0.004) return 1;
      return 1 - Math.exp(-Math.max(0.0001, dt) / tau);
    };
    for (const key of Object.keys(this.targets)) {
      if (!(key in this.smoothed)) this.smoothed[key] = this._defaultFor(key);
      const target = Number(this.targets[key]);
      // 元音口型不做平滑：说话时 A/I/U/E/O 是突变切换的。
      if (VOWEL_KEYS.has(key)) {
        this.smoothed[key] = target;
        continue;
      }
      const alpha = alphaFor(key);
      this.smoothed[key] += (target - this.smoothed[key]) * alpha;
      const range = this.paramRangeMap.get(key) || PARAM_RANGES[key];
      if (range) this.smoothed[key] = clamp(this.smoothed[key], range[0], range[1]);
    }
  }

  getState() {
    return this._state;
  }
}
