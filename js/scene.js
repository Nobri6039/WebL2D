/**
 * Live2D 舞台：加载/切换模型、适配尺寸、把面捕参数写进模型。
 *
 * 关键点：pixi-live2d-display 的 internalModel.update() 在 render 时执行，
 * 每帧末尾会 loadParameters()。参数在动作更新后、物理计算前写入。
 */
import { DEFAULT_PARAM_VALUES, PARAM_RANGES } from './config.js';

export class Live2DScene {
  constructor(canvas, stageEl) {
    this.canvas = canvas;
    this.stageEl = stageEl;
    this.app = null;
    this.model = null;
    this.coreModel = null;
    this.paramIndex = new Map();
    this.paramMeta = [];
    this.paramById = new Map();
    this.paramDefaults = { ...DEFAULT_PARAM_VALUES };
    this.view = { zoom: 1, offsetX: 0, offsetY: 0 };
    this.basePosition = { x: 0, y: 0 };
    this.baseScale = 1;
    this.ready = false;
    this.modelInfo = null;
    this.modelPath = '';
    this.pendingParams = {};
    this._paramHook = null;
    this._silenceHook = null;
    this.silenceParamId = '';
    this.vowelStrength = 0;
    this.silenceValue = 1;
    this.capabilities = {
      expressions: [],
      lipSync: { available: false, parameterIds: [], primary: '' },
      physics: { available: false, groups: [] },
    };
    this._physicsBase = null;
  }

  async init(modelPath) {
    if (!this.app) {
      const width = Math.max(1, this.stageEl.clientWidth);
      const height = Math.max(1, this.stageEl.clientHeight);
      this.app = new PIXI.Application({
        view: this.canvas,
        width,
        height,
        backgroundAlpha: 0,
        transparent: true,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoStart: false,
        powerPreference: 'high-performance',
      });
      this.app.stop();
    }
    return this.loadModel(modelPath);
  }

  async loadModel(modelPath) {
    const url = new URL(modelPath, document.baseURI).href;
    const [model, meta] = await Promise.all([
      PIXI.live2d.Live2DModel.from(url, { autoInteract: false, autoUpdate: false }),
      this._fetchParamMeta(url).catch((err) => {
        console.warn('[webl2d] 参数描述加载失败，使用参数 ID', err);
        return null;
      }),
    ]);

    // 眼睛和呼吸由自己的逻辑接管，避免库内动画覆盖参数。
    model.internalModel.eyeBlink = undefined;
    model.internalModel.breath = undefined;
    model.autoUpdate = false;

    const old = this.model;
    if (old) {
      this._detach(old);
      this.app.stage.removeChild(old);
      try {
        old.destroy({ texture: true });
      } catch (err) {
        console.warn('[webl2d] 旧模型销毁失败', err);
      }
    }

    this.model = model;
    this.coreModel = model.internalModel.coreModel;
    this.modelPath = modelPath;
    this.pendingParams = {};
    this.paramIndex.clear();
    this.paramMeta = [];
    this.paramById.clear();
    this.silenceParamId = '';
    this._buildParamMeta(meta);
    this._buildCapabilities(meta);
    this._physicsBase = null;
    this._capturePhysicsBase();

    this._paramHook = () => this._applyNow(this.pendingParams);
    // 只写 afterMotionUpdate：此时动作已结束、物理还没开始。
    // 如果同时在 beforeModelUpdate（物理之后）再写，会把 physics 输出覆盖掉，
    // 头发、耳朵、尾巴等就不会自然摆动了。
    model.internalModel.on('afterMotionUpdate', this._paramHook);
    this._silenceHook = () => {
      const idx = this.paramIndex.get(this.silenceParamId);
      if (idx !== undefined) this.coreModel.setParameterValueByIndex(idx, this.silenceValue, 1);
    };
    model.internalModel.on('beforeModelUpdate', this._silenceHook);
    this.app.stage.addChild(model);

    this.modelInfo = {
      name: model.internalModel.settings?.name || '',
      width: model.internalModel.width,
      height: model.internalModel.height,
      params: this.paramMeta.length,
      path: modelPath,
    };

    this.resize();
    this.ready = true;
    return this.modelInfo;
  }

  _detach(model) {
    if (!this._paramHook || !model) return;
    model.internalModel?.off?.('afterMotionUpdate', this._paramHook);
    model.internalModel?.off?.('beforeModelUpdate', this._silenceHook);
    this._paramHook = null;
    this._silenceHook = null;
  }

  async _fetchParamMeta(modelUrl) {
    const res = await fetch(modelUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`model3 HTTP ${res.status}`);
    const json = await res.json();
    const cdiPath = json?.FileReferences?.DisplayInfo;
    const physicsPath = json?.FileReferences?.Physics;
    let cdi = null;
    let physics = null;
    if (cdiPath) {
      try {
        const cdiUrl = new URL(cdiPath, modelUrl).href;
        const cdiRes = await fetch(cdiUrl, { cache: 'no-cache' });
        if (cdiRes.ok) cdi = await cdiRes.json();
      } catch {
        cdi = null;
      }
    }
    if (physicsPath) {
      try {
        const physicsUrl = new URL(physicsPath, modelUrl).href;
        const physicsRes = await fetch(physicsUrl, { cache: 'no-cache' });
        if (physicsRes.ok) physics = await physicsRes.json();
      } catch {
        physics = null;
      }
    }
    const physicsInputs = new Set();
    const physicsOutputs = new Set();
    const physicsSettings = [];
    const physicsGroups = new Map((physics?.Meta?.PhysicsDictionary || []).map((g) => [g.Id, g.Name]));
    let baseInputIndex = 0;
    let baseOutputIndex = 0;
    for (const setting of physics?.PhysicsSettings || []) {
      const inputs = [];
      const outputs = [];
      for (const input of setting.Input || []) {
        const id = input?.Source?.Id;
        if (input?.Source?.Target === 'Parameter' && id) {
          physicsInputs.add(id);
          inputs.push({ id, weight: input.Weight, type: input.Type });
        }
      }
      for (const output of setting.Output || []) {
        const id = output?.Destination?.Id;
        if (output?.Destination?.Target === 'Parameter' && id) {
          physicsOutputs.add(id);
          outputs.push({ id, angleScale: output.Scale, weight: output.Weight, type: output.Type });
        }
      }
      physicsSettings.push({
        id: setting.Id || `PhysicsSetting${physicsSettings.length + 1}`,
        name: physicsGroups.get(setting.Id) || '',
        settingIndex: physicsSettings.length,
        baseInputIndex,
        inputCount: inputs.length,
        baseOutputIndex,
        outputCount: outputs.length,
        inputs,
        outputs,
      });
      baseInputIndex += inputs.length;
      baseOutputIndex += outputs.length;
    }
    const expressions = (json?.FileReferences?.Expressions || []).map((e) => ({
      id: String(e.Name || e.Id || e.File || ''),
      name: String(e.Name || e.Id || e.File || ''),
    })).filter((e) => e.id);
    const lipSyncIds = [];
    for (const group of json?.Groups || []) {
      if (group?.Name === 'LipSync' && Array.isArray(group.Ids)) lipSyncIds.push(...group.Ids);
    }
    return {
      cdi,
      physicsInputs: [...physicsInputs],
      physicsOutputs: [...physicsOutputs],
      physicsSettings,
      expressions,
      lipSyncIds: [...new Set(lipSyncIds)],
    };
  }

  _buildParamMeta(info) {
    const cdi = info?.cdi || null;
    const physicsInputs = new Set(info?.physicsInputs || []);
    const physicsOutputs = new Set(info?.physicsOutputs || []);
    const names = new Map();
    const groupNames = new Map();
    if (cdi) {
      for (const g of cdi.ParameterGroups || []) groupNames.set(g.Id, g.Name);
      for (const p of cdi.Parameters || []) names.set(p.Id, { name: p.Name, groupId: p.GroupId });
    }

    const count = this.coreModel.getParameterCount?.() || 0;
    const ids = this.coreModel._parameterIds
      || this.coreModel.getModel?.()?.parameters?.ids
      || [];
    for (let i = 0; i < count; i++) {
      const id = ids[i] || `Param${i}`;
      const paramInfo = names.get(id);
      const vowelParam = id === 'ParamA' || id === 'ParamI' || id === 'ParamU' || id === 'ParamE' || id === 'ParamO'
        || /^(A|I|U|E|O)$/i.test(paramInfo?.name || '');
      const silenceParam = id === 'ParamSilence' || /^silence$/i.test(paramInfo?.name || '');
      const meta = {
        id,
        index: i,
        name: paramInfo?.name || id,
        group: groupNames.get(paramInfo?.groupId) || '其他',
        min: this.coreModel.getParameterMinimumValue(i),
        max: this.coreModel.getParameterMaximumValue(i),
        def: this.coreModel.getParameterDefaultValue(i),
        physicsInput: physicsInputs.has(id),
        physicsOutput: physicsOutputs.has(id),
        // 这些参数由模型 physics 自己输出；呼吸也由系统呼吸节奏驱动。
        // 让用户手动映射它们会覆盖物理状态，物理输出就会抽搐或卡住。
        physicsDriven: physicsOutputs.has(id) || id === 'ParamBreath',
        // Silence 是普通口型 / 元音口型的混合权重：1 = 普通 Open/Smile，0 = 元音。
        // 由元音强度自动驱动，不属于可映射参数。
        systemDriven: silenceParam || vowelParam,
        vowel: vowelParam,
      };
      this.paramIndex.set(id, i);
      this.paramMeta.push(meta);
      this.paramById.set(id, meta);
      this.paramDefaults[id] = meta.def;
    }
    // 保证标准参数即使在 cdi3 缺失时也有 UI 名称
    for (const [id, range] of Object.entries(PARAM_RANGES)) {
      if (!this.paramById.has(id)) continue;
      const meta = this.paramById.get(id);
      if (meta.name === id) meta.name = id;
      this.paramDefaults[id] = meta.def;
      if (!Number.isFinite(meta.min)) meta.min = range[0];
      if (!Number.isFinite(meta.max)) meta.max = range[1];
    }
    this.silenceParamId = this.paramMeta.find((p) => p.systemDriven)?.id || '';
  }

  _buildCapabilities(info) {
    const expressions = Array.isArray(info?.expressions) ? info.expressions : [];
    const lipIds = (info?.lipSyncIds || []).filter((id) => this.paramIndex.has(id));
    if (!lipIds.length && this.paramIndex.has('ParamMouthOpenY')) lipIds.push('ParamMouthOpenY');
    const primary = lipIds.includes('ParamMouthOpenY') ? 'ParamMouthOpenY' : lipIds[0] || '';
    const vowels = this.paramMeta
      .filter((p) => p.vowel)
      .map((p) => ({ id: p.id, name: p.name }));
    const groups = (info?.physicsSettings || []).map((g) => ({ ...g }));
    this.capabilities = {
      expressions,
      lipSync: { available: lipIds.length > 0, parameterIds: lipIds, primary, vowels },
      physics: { available: groups.length > 0, groups },
    };
  }

  _capturePhysicsBase() {
    const rig = this.model?.internalModel?.physics?._physicsRig;
    if (!rig) {
      this._physicsBase = null;
      return;
    }
    this._physicsBase = {
      outputs: (rig.outputs || []).map((o) => ({
        angleScale: Number(o.angleScale),
        translationScale: o.translationScale ? { x: Number(o.translationScale.x), y: Number(o.translationScale.y) } : null,
      })),
      particles: (rig.particles || []).map((p) => ({
        mobility: Number(p.mobility),
        delay: Number(p.delay),
        acceleration: Number(p.acceleration),
      })),
    };
  }

  getCapabilities() {
    return JSON.parse(JSON.stringify(this.capabilities));
  }

  /** 元音总强度 0..1；Silence = 1 - sum(A,I,U,E,O)，实现普通口型与元音的连续混合。 */
  setVowelStrength(strength) {
    this.vowelStrength = Math.max(0, Math.min(1, Number(strength) || 0));
    this.silenceValue = 1 - this.vowelStrength;
  }

  async setExpression(id) {
    const manager = this.model?.internalModel?.motionManager?.expressionManager;
    if (!manager) return false;
    try {
      return !!(await this.model.expression(id));
    } catch (err) {
      console.warn('[webl2d] 表情触发失败', id, err);
      return false;
    }
  }

  clearExpression() {
    const manager = this.model?.internalModel?.motionManager?.expressionManager;
    if (!manager) return false;
    manager.resetExpression();
    return true;
  }

  getActiveExpression() {
    const expr = this.model?.internalModel?.motionManager?.expressionManager?.currentExpression;
    return expr?.name || expr?.id || '';
  }

  /**
   * 物理手感：只缩放 physics 内部的分组输出和粒子阻尼，
   * 不写回 ParamEarsBling / ParamTail，避免破坏物理状态。
   */
  applyPhysicsProfile(profile) {
    const rig = this.model?.internalModel?.physics?._physicsRig;
    if (!rig || !this._physicsBase) return false;
    const p = profile || {};
    const mult = (id) => {
      const v = Number(p.groups?.[id]);
      return Number.isFinite(v) ? Math.max(0.2, Math.min(2, v)) : 1;
    };
    for (const group of this.capabilities.physics.groups) {
      const m = mult(group.id);
      for (let k = 0; k < group.outputCount; k++) {
        const i = group.baseOutputIndex + k;
        const out = rig.outputs?.[i];
        const base = this._physicsBase.outputs[i];
        if (!out || !base) continue;
        out.angleScale = base.angleScale * m;
        if (out.translationScale && base.translationScale) {
          out.translationScale.x = base.translationScale.x * m;
          out.translationScale.y = base.translationScale.y * m;
        }
      }
    }
    const smooth = Number.isFinite(Number(p.smoothing)) ? Math.max(0, Math.min(2, Number(p.smoothing))) : 1;
    const slow = 0.5 + 0.5 * smooth;
    const fast = 1 / slow;
    for (let i = 0; i < (rig.particles?.length || 0); i++) {
      const particle = rig.particles[i];
      const base = this._physicsBase.particles[i];
      if (!particle || !base) continue;
      particle.mobility = Math.max(0, Math.min(1, base.mobility * fast));
      particle.delay = Math.max(0, Math.min(1, base.delay * slow));
      particle.acceleration = Math.max(0, Math.min(1, base.acceleration * fast));
    }
    return true;
  }


  getParamMeta() {
    return this.paramMeta.slice();
  }

  getParamDefaults() {
    return { ...this.paramDefaults };
  }

  setView(view) {
    this.view = { ...this.view, ...view };
    this.layout();
  }

  resize() {
    if (!this.app) return;
    const width = Math.max(1, this.stageEl.clientWidth);
    const height = Math.max(1, this.stageEl.clientHeight);
    this.app.renderer.resize(width, height);
    this.layout();
  }

  layout() {
    if (!this.model || !this.app) return;
    const width = this.app.screen.width;
    const height = this.app.screen.height;
    const iw = this.model.internalModel.width || 2000;
    const ih = this.model.internalModel.height || 3000;

    const heightFactor = height < 560 ? 0.8 : 1.0;
    const fit = Math.min((width * 0.94) / iw, (height * heightFactor) / ih);
    this.baseScale = fit;
    const scale = fit * (this.view.zoom || 1);
    this.model.scale.set(scale);
    this.model.anchor.set(0.5, 0.5);
    this.basePosition.x = width / 2 + ((this.view.offsetX || 0) / 100) * width;
    this.basePosition.y = height / 2 + ((this.view.offsetY || 0) / 100) * height;
    this.model.position.set(this.basePosition.x, this.basePosition.y);
  }

  /** 写入面捕参数（缓存并在模型更新循环的正确时机生效） */
  apply(params) {
    this.pendingParams = params;
    this._applyNow(params);
  }

  _applyNow(params) {
    if (!this.coreModel || !params) return;
    for (const [id, value] of Object.entries(params)) {
      const idx = this.paramIndex.get(id);
      if (idx === undefined) continue;
      const range = PARAM_RANGES[id];
      const meta = this.paramById.get(id);
      const lo = Number.isFinite(meta?.min) ? meta.min : range?.[0];
      const hi = Number.isFinite(meta?.max) ? meta.max : range?.[1];
      let v = Number(value);
      if (!Number.isFinite(v)) continue;
      if (Number.isFinite(lo)) v = Math.max(lo, v);
      if (Number.isFinite(hi)) v = Math.min(hi, v);
      this.coreModel.setParameterValueByIndex(idx, v, 1);
    }
    // Silence 是普通口型与元音口型的混合权重：1 = 普通 Open/Smile，0 = 元音。
    const silenceIndex = this.paramIndex.get(this.silenceParamId);
    if (silenceIndex !== undefined) this.coreModel.setParameterValueByIndex(silenceIndex, this.silenceValue, 1);
  }

  update(dt) {
    // Live2DModel.update() 接收毫秒（内部再 /1000）；应用主循环的 dt 是秒。
    if (this.model) this.model.update(dt * 1000);
  }

  render() {
    if (this.app) this.app.renderer.render(this.app.stage);
  }

  getCanvas() {
    return this.app?.view || this.canvas;
  }

  /** 拖动/滚轮用：返回当前模型画布中心（屏幕 CSS 像素） */
  getViewCenter() {
    return { ...this.basePosition };
  }

  destroy() {
    try {
      this._detach(this.model);
      this.model?.destroy({ texture: true });
      this.app?.destroy(false, { children: true });
    } catch (err) {
      console.warn('[webl2d] 销毁舞台失败', err);
    }
    this.ready = false;
  }
}
