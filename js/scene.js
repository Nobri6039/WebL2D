/**
 * Live2D 舞台：加载模型、适配尺寸、把面捕参数写进模型。
 *
 * 关键点：pixi-live2d-display 的 internalModel.update() 在 render 时执行，
 * 每帧末尾会 loadParameters()。因此参数必须在 render 之前写入。
 */
import { PARAM_RANGES } from './config.js';

export class Live2DScene {
  constructor(canvas, stageEl) {
    this.canvas = canvas;
    this.stageEl = stageEl;
    this.app = null;
    this.model = null;
    this.coreModel = null;
    this.paramIndex = new Map();
    this.view = { zoom: 1, offsetX: 0, offsetY: 0 };
    this.basePosition = { x: 0, y: 0 };
    this.baseScale = 1;
    this.ready = false;
    this.modelInfo = null;
  }

  async init(modelPath) {
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

    const url = new URL(modelPath, document.baseURI).href;
    const model = await PIXI.live2d.Live2DModel.from(url, {
      autoInteract: false,
      autoUpdate: false,
    });

    // 眼睛和呼吸由面捕 / 待机逻辑接管，避免库内动画覆盖我们的参数。
    model.internalModel.eyeBlink = undefined;
    model.internalModel.breath = undefined;
    model.autoUpdate = false;

    this.model = model;
    this.coreModel = model.internalModel.coreModel;
    this.pendingParams = {};
    this._paramHook = () => this._applyNow(this.pendingParams);
    // 在动作更新之后、物理计算之前写入面捕参数：
    // 1) 不会被模型自带的 idle motion 覆盖；2) 头发/尾巴物理会跟随面捕角度。
    model.internalModel.on('afterMotionUpdate', this._paramHook);
    // 表情更新之后再写一次，保证最终渲染的是面捕值。
    model.internalModel.on('beforeModelUpdate', this._paramHook);
    this.app.stage.addChild(model);

    for (const id of Object.keys(PARAM_RANGES)) {
      const idx = this.coreModel.getParameterIndex(id);
      if (idx >= 0) this.paramIndex.set(id, idx);
    }

    this.modelInfo = {
      name: model.internalModel.settings?.name || '',
      width: model.internalModel.width,
      height: model.internalModel.height,
      params: this.paramIndex.size,
    };

    this.resize();
    this.ready = true;
    return this.modelInfo;
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
    if (!this.model) return;
    const width = this.app.screen.width;
    const height = this.app.screen.height;
    const iw = this.model.internalModel.width || 2000;
    const ih = this.model.internalModel.height || 3000;

    // 给顶栏和底部留一点呼吸空间；矮屏 / 横屏手机适当缩小，避免顶栏压住头
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
      const v = range ? Math.min(range[1], Math.max(range[0], value)) : value;
      this.coreModel.setParameterValueByIndex(idx, v, 1);
    }
  }

  /** 累加时间，真正的模型更新在 render 里 */
  update(dt) {
    if (this.model) this.model.update(dt);
  }

  render() {
    if (this.app) this.app.renderer.render(this.app.stage);
  }

  /** 返回画布供截图合成 */
  getCanvas() {
    return this.app?.view || this.canvas;
  }

  destroy() {
    try {
      if (this._paramHook) {
        this.model?.internalModel?.off?.('afterMotionUpdate', this._paramHook);
        this.model?.internalModel?.off?.('beforeModelUpdate', this._paramHook);
      }
      this.model?.destroy({ texture: true });
      this.app?.destroy(false, { children: true });
    } catch (err) {
      console.warn('[webl2d] 销毁舞台失败', err);
    }
    this.ready = false;
  }
}
