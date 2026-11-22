/**
 * FaceMapper —— 把 MediaPipe 的 478 个关键点 + 52 个表情系数，
 * 映射成 Live2D 参数（角度、眼睛、嘴、眉毛、表情、身体）。
 *
 * 完全不依赖具体模型；缺失的参数会被舞台忽略。
 */
import { clamp, clamp01 } from './utils.js';
import { PARAM_RANGES } from './config.js';

const EYE_L = [33, 133, 159, 145];
const EYE_R = [362, 263, 386, 374];
const NOSE = 1;
const CHIN = 152;
const CHEEK_L = 234;
const CHEEK_R = 454;

const CALIB_SAMPLES = 40;

const BASE_PARAMS = {
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
  ParamMouthOpenY: 0,
  ParamMouthForm: 0,
  ParamCheek: 0,
  ParamTongue: 0,
  ParamNose: 0,
  ParamBodyAngleX: 0,
  ParamBreath: 0.42,
};

const FAST_KEYS = new Set(['ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamEyeROpen']);
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

/** 去掉静息噪声，避免模型一直斜眼 / 皱眉 */
function softDeadzone(v, d) {
  if (Math.abs(v) <= d) return 0;
  return (v - Math.sign(v) * d) / (1 - d);
}

export class FaceMapper {
  constructor(settings) {
    this.settings = settings;
    this.smoothed = { ...BASE_PARAMS };
    this.targets = { ...BASE_PARAMS };
    this.facePresent = false;
    this.lastFaceAt = -1e9;
    this.raw = null;
    this.bs = {};
    this.now = 0;
    this.cameraOn = false;
    this.calib = this._emptyCalibration();
    this.calibrating = false;
    this.calibProgress = 0;
    this.autoBlink = { nextAt: 0, start: -1, amount: 0 };
    this._prevCalibrating = false;
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
      done: false,
      startedAt: 0,
    };
  }

  setSettings(settings) {
    this.settings = settings;
  }

  resetCalibration() {
    this.calib = this._emptyCalibration();
    this.calibrating = false;
    this.calibProgress = 0;
    this._prevCalibrating = false;
  }

  resetTracking() {
    this.facePresent = false;
    this.lastFaceAt = -1e9;
    this.raw = null;
    this.smoothed = { ...BASE_PARAMS };
    this.targets = { ...BASE_PARAMS };
    this.autoBlink.start = -1;
    this.autoBlink.amount = 0;
    this.autoBlink.nextAt = 0;
    this.resetCalibration();
  }

  /**
   * @param {object} opts
   * @param {object|null|undefined} opts.detection  MediaPipe 结果
   * @param {boolean} opts.newFrame 是否是新视频帧
   * @param {number} opts.now performance.now()
   * @param {number} opts.dt 秒
   * @param {boolean} opts.cameraOn
   * @param {{x:number,y:number}} opts.pointer -1..1
   * @param {number} opts.fps
   */
  update({ detection, newFrame = false, now, dt, cameraOn, pointer = { x: 0, y: 0 }, fps = 0 }) {
    this.now = now;
    this.cameraOn = cameraOn;
    const s = this.settings;
    const gains = s.gains;
    const mirror = s.mirror;
    const mirrorSign = mirror ? 1 : -1;

    if (newFrame) {
      const lm = detection?.faceLandmarks?.[0];
      if (lm && lm.length >= 400) {
        this._ingest(lm, detection?.faceBlendshapes?.[0]?.categories || []);
        this.facePresent = true;
        this.lastFaceAt = now;
      } else if (now - this.lastFaceAt > 450) {
        // 单帧漏检不立刻报“未检测到人脸”，给 0.45 秒缓冲
        this.facePresent = false;
      }
    } else if (this.facePresent && now - this.lastFaceAt > 900) {
      this.facePresent = false;
    }
    if (!cameraOn) this.facePresent = false;

    const present = this.facePresent && !!this.raw;
    this.calibrating = present && !this.calib.done;
    this.calibProgress = present && !this.calib.done ? clamp01(this.calib.samples / CALIB_SAMPLES) : 1;

    if (present && !this.calib.done) {
      this._sampleCalibration(now);
    }

    this._computeTargets({ present, now, dt, cameraOn, pointer, mirrorSign, gains, s });
    this._smooth(dt, s.smoothing);

    const params = { ...BASE_PARAMS, ...this.smoothed };
    this._state = {
      facePresent: present,
      calibrating: this.calibrating,
      calibProgress: this.calibProgress,
      yaw: params.ParamAngleX,
      pitch: params.ParamAngleY,
      roll: params.ParamAngleZ,
      mouth: params.ParamMouthOpenY,
      blink: 1 - (params.ParamEyeLOpen + params.ParamEyeROpen) / 2,
      eyeOpen: (params.ParamEyeLOpen + params.ParamEyeROpen) / 2,
      brow: (params.ParamBrowLY + params.ParamBrowRY) / 2,
      gazeX: params.ParamEyeBallX,
      gazeY: params.ParamEyeBallY,
      expression: params.ParamMouthForm,
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
    // 丢弃特别夸张的帧，避免校准被一个大动作带偏
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

  _computeTargets({ present, now, dt, cameraOn, pointer, mirrorSign, gains, s }) {
    const t = { ...BASE_PARAMS };
    const time = now / 1000;
    const breath = 0.42 + 0.24 * Math.sin(time * 1.6);
    t.ParamBreath = breath;

    if (present && this.raw) {
      const r = this.raw;
      const c = this.calib;
      const ready = c.done;
      const limit = s.angleLimit || 30;
      const headGain = gains.head * 1.35;

      const yaw = ready ? r.yaw - c.yaw : 0;
      const pitch = ready ? r.pitch - c.pitch : 0;
      const roll = ready ? r.roll - c.roll : 0;

      t.ParamAngleX = clamp(-yaw * headGain, -limit, limit) * mirrorSign;
      t.ParamAngleY = clamp(-pitch * headGain, -limit, limit);
      t.ParamAngleZ = clamp(-roll * headGain * 0.9, -limit, limit) * mirrorSign;
      t.ParamBodyAngleX = clamp(t.ParamAngleX * 0.38 * gains.body, -10, 10);

      // 眨眼：MediaPipe 的值在睁眼时也有 0.1~0.2，用曲线压掉底噪
      const openFromBlink = (v) => {
        const x = clamp01((v - 0.16) / 0.84);
        return clamp01(1 - Math.pow(x, 0.85) * 1.1);
      };
      const blinkL = openFromBlink(r.blinkL);
      const blinkR = openFromBlink(r.blinkR);
      const eyeGain = gains.eyes;
      const eyeOpenL = clamp01(1 - (1 - blinkL) * eyeGain);
      const eyeOpenR = clamp01(1 - (1 - blinkR) * eyeGain);

      if (s.mirror) {
        t.ParamEyeLOpen = eyeOpenL;
        t.ParamEyeROpen = eyeOpenR;
      } else {
        t.ParamEyeLOpen = eyeOpenR;
        t.ParamEyeROpen = eyeOpenL;
      }

      const smile = r.smile - c.smile;
      const frown = r.frown - c.frown;
      const squint = r.squint - c.squint;
      const exprGain = gains.expression;
      t.ParamEyeLSmile = clamp01((smile * 0.8 + squint * 0.6) * exprGain);
      t.ParamEyeRSmile = t.ParamEyeLSmile;

      t.ParamMouthOpenY = clamp01((r.jaw - c.jaw) * 2.75 * gains.mouth);
      t.ParamMouthForm = clamp((smile - frown * 0.85) * 2.1 * exprGain, -1, 1);
      t.ParamCheek = clamp01((smile * 0.7 + r.cheekPuff * 0.5) * exprGain);
      t.ParamTongue = clamp01(r.tongue * 1.2 * exprGain);
      t.ParamNose = clamp01(r.sneer * 1.2 * exprGain);

      const browGain = gains.brows * 1.5;
      const browRawL = r.browInner * 0.9 + r.browOuterL * 0.55 - r.browDownL * 0.85;
      const browRawR = r.browInner * 0.9 + r.browOuterR * 0.55 - r.browDownR * 0.85;
      const browL = clamp(softDeadzone(browRawL - c.browL, 0.1) * browGain, -1, 1);
      const browR = clamp(softDeadzone(browRawR - c.browR, 0.1) * browGain, -1, 1);
      if (s.mirror) {
        t.ParamBrowLY = browL;
        t.ParamBrowRY = browR;
      } else {
        t.ParamBrowLY = browR;
        t.ParamBrowRY = browL;
      }

      const gazeX = clamp(softDeadzone(r.gazeX - c.gazeX, 0.06) * 1.5 * gains.eyes, -1, 1);
      const gazeY = clamp(softDeadzone(r.gazeY - c.gazeY, 0.06) * 1.4 * gains.eyes, -1, 1);
      t.ParamEyeBallX = clamp(-gazeX * mirrorSign + t.ParamAngleX * 0.006, -1, 1);
      t.ParamEyeBallY = clamp(gazeY + t.ParamAngleY * 0.006, -1, 1);
    } else {
      // 待机：呼吸、微摆、眨眼、鼠标跟随
      const swayX = Math.sin(time * 0.55) * 2.1 + Math.sin(time * 1.31) * 0.55;
      const swayY = Math.sin(time * 0.72 + 1.2) * 1.5;
      const swayZ = Math.sin(time * 0.43 + 0.5) * 1.8;
      const follow = s.mouseFollow && !cameraOn ? pointer : { x: 0, y: 0 };
      t.ParamAngleX = clamp(swayX + follow.x * 16, -22, 22);
      t.ParamAngleY = clamp(swayY - follow.y * 10, -18, 18);
      t.ParamAngleZ = clamp(swayZ - follow.x * 3.5, -12, 12);
      t.ParamBodyAngleX = clamp(t.ParamAngleX * 0.28, -10, 10);

      const auto = this._autoBlinkAmount(now, dt, true);
      const eye = clamp01(1 - auto);
      t.ParamEyeLOpen = eye;
      t.ParamEyeROpen = eye;
      t.ParamMouthOpenY = 0;
      t.ParamMouthForm = 0;

      const drift = Math.sin(time * 0.7) * 0.1 + Math.sin(time * 2.1) * 0.03;
      t.ParamEyeBallX = clamp(drift + follow.x * 0.35, -1, 1);
      t.ParamEyeBallY = clamp(Math.sin(time * 0.9 + 0.4) * 0.08 - follow.y * 0.25, -1, 1);
    }

    this.targets = t;
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
    for (const key of Object.keys(BASE_PARAMS)) {
      if (!(key in this.smoothed)) this.smoothed[key] = BASE_PARAMS[key];
      const target = this.targets[key] ?? BASE_PARAMS[key];
      const alpha = alphaFor(key);
      this.smoothed[key] += (target - this.smoothed[key]) * alpha;
      const range = PARAM_RANGES[key];
      if (range) this.smoothed[key] = clamp(this.smoothed[key], range[0], range[1]);
    }
  }

  getState() {
    return this._state;
  }
}
