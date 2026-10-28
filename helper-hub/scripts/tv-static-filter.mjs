const MODULE_ID = "helper-hub";
const Base = foundry.canvas.rendering.filters.TextureTransitionFilter;

/** One video frame at 30fps. Seeks smaller than this stay on the shared clock. */
const FRAME_SECONDS = 1 / 30;

/** Draws must pause this long before a custom file is released. */
const CUSTOM_IDLE_MS = 100;

const CUSTOM_TYPES = new Set(["tvStatic", "hhSmoke", "hhSpinner", "hhWhip", "hhCustom"]);

/** @type {(() => void) | null} */
let onApplied = null;

/** Paths already reported, so a missing file warns once instead of every frame. */
const warnedCustomPaths = new Set();

/**
 * Called on every frame the TV static filter is applied, including scene-config previews.
 * @param {() => void} callback
 */
export function bindTvStaticFrame(callback) {
  onApplied = callback;
}

/**
 * Scene transitions that share one filter instance.
 * TransitionContainer reuses the instance when the class matches and only assigns `type`,
 * so each custom id swaps in its own program. Core ids restore the core fragment program.
 */
export class TvStaticFilter extends Base {

  /**
   * Active custom id, or null while a core transition type is selected.
   * The constructed program is the TV shader, so the id starts as tvStatic.
   * @type {string | null}
   */
  #customType = "tvStatic";

  /** @type {string | null} */
  #customPath = null;

  /** @type {"image" | "video" | null} */
  #customKind = null;

  /** @type {PIXI.Texture | null} */
  #customTexture = null;

  /** @type {HTMLVideoElement | null} */
  #customVideo = null;

  #customReady = false;

  #customFailed = false;

  #failing = false;

  #customToken = 0;

  #watching = false;

  #lastCustomApply = 0;

  /** @type {Record<string, PIXI.Program> | null} */
  static #programs = null;

  /**
   * Compile each program once. PIXI.Program.from caches by source, and
   * Foundry replaces PIXI.Filter#program the same way for post-process swaps.
   */
  static #ensurePrograms() {
    if (this.#programs) return;
    const vertexSrc = Base._createVertexShader();
    this.#programs = {
      core: PIXI.Program.from(vertexSrc, Base._createFragmentShader()),
      tvStatic: PIXI.Program.from(vertexSrc, this._createFragmentShader()),
      hhSmoke: PIXI.Program.from(vertexSrc, this.#smokeFragment()),
      hhSpinner: PIXI.Program.from(vertexSrc, this.#spinnerFragment()),
      hhWhip: PIXI.Program.from(vertexSrc, this.#whipFragment()),
      hhCustom: PIXI.Program.from(vertexSrc, this.#customFragment())
    };
  }

  /** @override */
  static get defaultUniforms() {
    return {
      ...super.defaultUniforms,
      time: 0,
      intensity: 1,
      aspect: [1, 1],
      customMode: 0,
      customReady: 0,
      customIsVideo: 0,
      customTexture: PIXI.Texture.EMPTY
    };
  }

  /**
   * @returns {string}
   */
  get type() {
    return this.#customType ?? super.type;
  }

  /**
   * @param {string} type  Transition id from TransitionContainer.
   */
  set type(type) {
    TvStaticFilter.#ensurePrograms();
    if ((this.#customType === "hhCustom") && (type !== "hhCustom")) this.#releaseCustom();

    if (CUSTOM_TYPES.has(type)) {
      // FADE clears the private padding flag. These ids are not core types and would throw.
      super.type = Base.TYPES.FADE;
      this.program = TvStaticFilter.#programs[type];
      this.#customType = type;
      if (type === "hhCustom") this.#ensureCustomMedia();
      return;
    }

    this.#customType = null;
    this.program = TvStaticFilter.#programs.core;
    super.type = type;
  }

  /** @override */
  destroy() {
    this.#releaseCustom();
    super.destroy();
  }

  /**
   * Analog television interference. The cut is a hard step at progress 0.5, buried in the static burst.
   * @override
   * @returns {string}
   */
  static _createFragmentShader() {
    return `
    precision ${PIXI.settings.PRECISION_FRAGMENT} float;

    uniform float progress;
    uniform float opaque;
    uniform vec4 backgroundColor;
    uniform vec4 tintAlpha;
    uniform sampler2D uSampler;
    uniform sampler2D targetTexture;
    uniform mat3 filterMatrixInverse;
    uniform mat3 targetUVMatrix;
    uniform float time;
    uniform float intensity;

    varying vec2 vTextureCoord;
    varying vec2 vFilterCoord;

    vec2 mapFuv2Suv(in vec2 uv) {
      return (filterMatrixInverse * vec3(uv, 1.0)).xy;
    }

    vec2 mapFuv2Tuv(in vec2 uv) {
      return (targetUVMatrix * vec3(uv, 1.0)).xy;
    }

    float getClip(in vec2 uv) {
      return step(3.5, step(0.0, uv.x) + step(0.0, uv.y) + step(uv.x, 1.0) + step(uv.y, 1.0));
    }

    vec4 colorFromSource(in vec2 uv) {
      return texture2D(uSampler, uv);
    }

    vec4 colorFromTarget(in vec2 uv) {
      return texture2D(targetTexture, mapFuv2Tuv(uv)) * getClip(uv);
    }

    float hash(vec2 p) {
      vec2 uv = mod(p, 1000.0);
      return fract(dot(uv, vec2(5.23, 2.89) * fract((2.41 * uv.x + 2.27 * uv.y) * 251.19)) * 551.83);
    }

    /* Hard cut. Source and target are never mixed. */
    vec4 sampleCut(vec2 filterUv, vec2 sourceUv) {
      if (progress < 0.5) return colorFromSource(sourceUv);
      return colorFromTarget(filterUv);
    }

    void main() {
      const float PI = 3.141592653589793;
      float t = clamp(progress, 0.0, 1.0);
      float edges = smoothstep(0.0, 0.02, t) * (1.0 - smoothstep(0.98, 1.0, t));
      float burst = clamp(sin(t * PI) * edges * intensity, 0.0, 1.0);
      vec4 result;

      if (burst <= 0.0001) {
        result = sampleCut(vFilterCoord, vTextureCoord);
      } else {
        float band = floor(vFilterCoord.y * 26.0);
        float frame = floor(time * 18.0);
        float yOff = (hash(vec2(band, frame)) - 0.5) * 0.055 * burst;
        float xOff = (hash(vec2(band + 19.0, frame + 2.0)) - 0.5) * 0.04 * burst;
        float roll = sin(time * 6.5) * 0.02 * burst;
        vec2 torn = vFilterCoord + vec2(xOff, yOff + roll);
        float ca = 0.0045 * burst;

        vec4 channelR = sampleCut(torn + vec2(ca, 0.0), mapFuv2Suv(torn + vec2(ca, 0.0)));
        vec4 channelG = sampleCut(torn, mapFuv2Suv(torn));
        vec4 channelB = sampleCut(torn - vec2(ca, 0.0), mapFuv2Suv(torn - vec2(ca, 0.0)));
        result = vec4(channelR.r, channelG.g, channelB.b, channelG.a);

        float luma = dot(result.rgb, vec3(0.299, 0.587, 0.114));
        result.rgb = mix(result.rgb, vec3(luma), burst * 0.9);

        float tickA = floor(time * 53.0);
        float tickB = floor(time * 31.0);
        vec2 fine = floor(vFilterCoord * vec2(380.0, 210.0));
        vec2 coarse = floor(vFilterCoord * vec2(70.0, 40.0));
        float snow = hash(fine + vec2(tickA, tickB)) * 0.7 + hash(coarse + vec2(tickB, tickA)) * 0.3;
        float cover = 1.0 - smoothstep(0.0, 0.12, abs(t - 0.5));
        float snowMix = clamp(mix(burst * 0.8, 1.0, cover), 0.0, 1.0);
        result.rgb = mix(result.rgb, vec3(snow), snowMix);

        float bandShade = mix(0.72, 1.0, hash(vec2(band, frame + 5.0)));
        result.rgb *= mix(1.0, bandShade, burst);

        float scanPhase = abs(fract(vFilterCoord.y * 320.0) - 0.5);
        float scan = mix(0.78, 1.0, smoothstep(0.0, 0.5, scanPhase));
        result.rgb *= mix(1.0, scan, burst * 0.85);

        float barY = fract(time * 0.75);
        float bar = 1.0 - smoothstep(0.002, 0.012, abs(vFilterCoord.y - barY));
        result.rgb += vec3(bar * burst * 0.95);

        result.a = mix(result.a, 1.0, burst);
        result.rgb = clamp(result.rgb, 0.0, 1.0);
      }

      result *= tintAlpha;
      if (opaque > 0.5) {
        vec4 bg = backgroundColor;
        result.rgb = result.rgb + (bg.rgb * bg.a) * (1.0 - result.a);
        result.a = 1.0;
      }
      gl_FragColor = result;
    }
    `;
  }

  /**
   * @param {string} extraUniforms
   * @param {string} helpers  Function declarations used by main.
   * @param {string} body  Statements inside main(), leaving a vec4 named result.
   * @returns {string}
   */
  static #fragment(extraUniforms, helpers, body) {
    return `
    precision ${PIXI.settings.PRECISION_FRAGMENT} float;

    uniform float progress;
    uniform float opaque;
    uniform vec4 backgroundColor;
    uniform vec4 tintAlpha;
    uniform sampler2D uSampler;
    uniform sampler2D targetTexture;
    uniform mat3 filterMatrixInverse;
    uniform mat3 targetUVMatrix;
    uniform float time;
    uniform float intensity;
    ${extraUniforms}

    varying vec2 vTextureCoord;
    varying vec2 vFilterCoord;

    vec2 mapFuv2Suv(in vec2 uv) {
      return (filterMatrixInverse * vec3(uv, 1.0)).xy;
    }

    vec2 mapFuv2Tuv(in vec2 uv) {
      return (targetUVMatrix * vec3(uv, 1.0)).xy;
    }

    float getClip(in vec2 uv) {
      return step(3.5, step(0.0, uv.x) + step(0.0, uv.y) + step(uv.x, 1.0) + step(uv.y, 1.0));
    }

    vec4 colorFromSource(in vec2 uv) {
      return texture2D(uSampler, uv);
    }

    vec4 colorFromTarget(in vec2 uv) {
      return texture2D(targetTexture, mapFuv2Tuv(uv)) * getClip(uv);
    }

    ${helpers}

    void main() {
      ${body}
      result *= tintAlpha;
      if (opaque > 0.5) {
        vec4 bg = backgroundColor;
        result.rgb = result.rgb + (bg.rgb * bg.a) * (1.0 - result.a);
        result.a = 1.0;
      }
      gl_FragColor = result;
    }
    `;
  }

  /**
   * The scene leaves through drifting smoke. Progress 0 is the source and progress 1 is the target.
   * @returns {string}
   */
  static #smokeFragment() {
    return this.#fragment("", `
    float smokeHash(vec2 p) {
      vec2 uv = mod(p, 1000.0);
      return fract(dot(uv, vec2(5.23, 2.89) * fract((2.41 * uv.x + 2.27 * uv.y) * 251.19)) * 551.83);
    }

    float smokeValue(vec2 p) {
      vec2 cell = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = smokeHash(cell);
      float b = smokeHash(cell + vec2(1.0, 0.0));
      float c = smokeHash(cell + vec2(0.0, 1.0));
      float d = smokeHash(cell + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    /* Four octaves. Filter Y grows downward, so a positive Y drift travels up the screen. */
    float smokeFbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
      for (int i = 0; i < 4; i++) {
        value += amplitude * smokeValue(p);
        p = rot * p * 2.05 + vec2(1.7, 9.2);
        amplitude *= 0.5;
      }
      return value / 0.9375;
    }
    `, `
      float strength = clamp(intensity, 0.0, 1.0);
      float t = clamp(progress, 0.0, 1.0);
      float speed = mix(0.03, 0.42, strength);
      vec2 drift = vec2(time * speed * 0.85, time * speed);
      float n = smokeFbm(vFilterCoord * vec2(3.4, 4.2) + drift);
      float density = clamp(n * mix(0.55, 1.15, strength), 0.0, 1.0);
      float edge = mix(-0.08, 1.08, t);
      float reveal = smoothstep(density - 0.05, density + 0.05, edge);
      vec4 result = mix(colorFromSource(vTextureCoord), colorFromTarget(vFilterCoord), reveal);

      float ends = smoothstep(0.0, 0.16, t) * (1.0 - smoothstep(0.84, 1.0, t));
      float smoke = n * ends * mix(0.25, 0.95, strength);
      vec3 ash = mix(vec3(0.50, 0.52, 0.55), vec3(0.95, 0.96, 0.97), n);
      result.rgb = mix(result.rgb, ash, clamp(smoke, 0.0, 0.92));
    `);
  }

  /**
   * A sector opens from the top. The loading arc is that sector's leading edge, and it fades out at both ends.
   * @returns {string}
   */
  static #spinnerFragment() {
    return this.#fragment("uniform vec2 aspect;", "", `
      const float PI = 3.141592653589793;
      const float TAU = 6.283185307179586;
      float strength = clamp(intensity, 0.0, 1.0);
      float t = clamp(progress, 0.0, 1.0);
      vec2 fromCenter = vFilterCoord - 0.5;
      vec2 circular = fromCenter * aspect;
      float radius = length(circular);

      float ang = atan(fromCenter.x, -fromCenter.y);
      if (ang < 0.0) ang += TAU;
      float headAngle = t * TAU;
      float revealed = 1.0 - smoothstep(headAngle - 0.02, headAngle + 0.02, ang);
      if (t <= 0.0) revealed = 0.0;
      if (t >= 1.0) revealed = 1.0;
      vec4 result = mix(colorFromSource(vTextureCoord), colorFromTarget(vFilterCoord), revealed);

      float behind = mod(headAngle - ang + TAU, TAU);
      float head = exp(-pow(behind / 0.16, 2.0));
      float trail = exp(-behind * mix(3.4, 1.5, strength));
      float width = mix(0.005, 0.024, strength);
      float dist = abs(radius - 0.16);
      float ring = 1.0 - smoothstep(width * 0.35, width, dist);
      float glow = exp(-pow(dist / max(mix(0.02, 0.085, strength), 0.001), 2.0));
      float arc = clamp(ring * max(head, trail * 0.8) + glow * trail * 0.75, 0.0, 1.0);
      float presence = sin(t * PI) * strength;
      float light = arc * presence;
      result.rgb = mix(result.rgb, vec3(0.78, 0.92, 1.0), clamp(light, 0.0, 1.0));
      result.rgb += vec3(0.35, 0.58, 0.9) * glow * head * presence;
      result.rgb = clamp(result.rgb, 0.0, 1.0);
    `);
  }

  /**
   * Horizontal whip pan. Motion, blur, streak, and letterbox all peak in the middle.
   * @returns {string}
   */
  static #whipFragment() {
    return this.#fragment("", "", `
      const float PI = 3.141592653589793;
      float strength = clamp(intensity, 0.0, 1.0);
      float t = clamp(progress, 0.0, 1.0);
      float motion = sin(t * PI);
      float shift = motion * mix(0.03, 0.16, strength);
      float spread = motion * 0.055 * strength;

      vec4 accSource = vec4(0.0);
      vec4 accTarget = vec4(0.0);
      vec3 streak = vec3(0.0);
      float weightSum = 0.0;
      for (int i = 0; i < 5; i++) {
        float o = (float(i) - 2.0) / 2.0;
        float w = 1.0 - abs(o) * 0.45;
        vec2 srcUv = clamp(vFilterCoord + vec2(-shift + o * spread, 0.0), 0.0, 1.0);
        vec2 dstUv = clamp(vFilterCoord + vec2(shift + o * spread, 0.0), 0.0, 1.0);
        vec4 src = colorFromSource(mapFuv2Suv(srcUv));
        vec4 dst = colorFromTarget(dstUv);
        accSource += src * w;
        accTarget += dst * w;
        weightSum += w;

        vec4 pair = mix(src, dst, t);
        float lum = dot(pair.rgb, vec3(0.299, 0.587, 0.114));
        streak += pair.rgb * max(lum - 0.45, 0.0) * w;
      }

      vec4 result = mix(accSource / weightSum, accTarget / weightSum, t);
      float mid = exp(-(t - 0.5) * (t - 0.5) * 90.0);
      result.rgb += streak * mid * strength * 0.45;
      result.rgb = clamp(result.rgb, 0.0, 1.0);

      float bar = motion * 0.11 * strength;
      float showBar = step(0.0005, bar);
      float topBar = (1.0 - smoothstep(bar, bar + 0.004, vFilterCoord.y)) * showBar;
      float bottomBar = smoothstep(1.0 - bar - 0.004, 1.0 - bar, vFilterCoord.y) * showBar;
      result.rgb = mix(result.rgb, vec3(0.0), clamp(topBar + bottomBar, 0.0, 1.0));
    `);
  }

  /**
   * User file. Play composites the frame. Mask reveals by luminance.
   * An unready sampler is never drawn: apply() falls back to the core fade program.
   * @returns {string}
   */
  static #customFragment() {
    return this.#fragment(`
    uniform sampler2D customTexture;
    uniform float customMode;
    uniform float customReady;
    uniform float customIsVideo;
    `, "", `
      float strength = clamp(intensity, 0.0, 1.0);
      float t = clamp(progress, 0.0, 1.0);
      vec4 source = colorFromSource(vTextureCoord);
      vec4 target = colorFromTarget(vFilterCoord);
      vec4 scenes = mix(source, target, t);
      vec4 result = scenes;

      if (customReady > 0.5) {
        vec4 frame = texture2D(customTexture, vTextureCoord);
        if (customMode > 0.5) {
          float luma = dot(frame.rgb, vec3(0.299, 0.587, 0.114));
          float soft = mix(0.001, 0.22, strength);
          float threshold = mix(1.0 + soft, -soft, t);
          float reveal = smoothstep(threshold - soft, threshold + soft, luma);
          result = mix(source, target, reveal);
        } else if (customIsVideo > 0.5) {
          result.rgb = frame.rgb * frame.a + scenes.rgb * (1.0 - frame.a);
          result.a = frame.a + scenes.a * (1.0 - frame.a);
        } else {
          float cover = (1.0 - smoothstep(0.30, 0.70, t)) * frame.a;
          result.rgb = mix(scenes.rgb, frame.rgb, cover);
          result.a = mix(scenes.a, 1.0, cover);
        }
      }
    `);
  }

  /** @override */
  apply(filterManager, input, output, clear) {
    if (this.#customType) {
      const lastTime = canvas.app?.ticker?.lastTime ?? 0;
      this.uniforms.time = (lastTime * 0.001) % 64;
      this.uniforms.intensity = readIntensity();
      if (this.#customType === "hhSpinner") this.#updateAspect();
      if (this.#customType === "hhCustom") {
        this.#lastCustomApply = lastTime;
        this.#syncCustomDraw();
      }
      if (this.#customType === "tvStatic") onApplied?.();
    }
    return super.apply(filterManager, input, output, clear);
  }

  #updateAspect() {
    const app = canvas.app;
    const screen = (app?.screen?.width && app?.screen?.height) ? app.screen : app?.renderer?.screen;
    const width = screen?.width || 1;
    const height = screen?.height || 1;
    this.uniforms.aspect = [width / height, 1];
  }

  /**
   * Keep the custom file on the transition clock, then draw it or the core fade.
   */
  #syncCustomDraw() {
    this.#ensureCustomMedia();
    this.#seekCustomVideo();

    const mode = game.settings.get(MODULE_ID, "customMode") === "mask" ? 1 : 0;
    const ready = this.#customReady && !this.#customFailed && this.#customTexture && !this.#customTexture.destroyed;
    this.uniforms.customMode = mode;
    this.uniforms.customIsVideo = this.#customKind === "video" ? 1 : 0;
    this.uniforms.customReady = ready ? 1 : 0;
    this.uniforms.customTexture = ready ? this.#customTexture : PIXI.Texture.EMPTY;
    const programs = TvStaticFilter.#programs;
    this.program = ready ? programs.hhCustom : programs.core;
  }

  #seekCustomVideo() {
    const video = this.#customVideo;
    // A new currentTime aborts the seek in flight, and a paused video only uploads on seeked.
    if (!video || video.seeking || (video.readyState < 1)) return;
    const duration = video.duration;
    if (!Number.isFinite(duration) || (duration <= 0)) return;

    const progress = Number(this.uniforms.progress);
    const t = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
    const target = t * duration;
    if (Math.abs(video.currentTime - target) <= FRAME_SECONDS) return;
    try {
      video.currentTime = target;
    }
    catch {
      // Metadata can report a duration before seeking is allowed.
    }
  }

  #ensureCustomMedia() {
    const raw = game.settings.get(MODULE_ID, "customAnimation");
    const path = (typeof raw === "string") ? raw.trim() : "";
    if (path === this.#customPath) return;
    this.#loadCustom(path);
  }

  /**
   * @param {string} path
   */
  #loadCustom(path) {
    this.#releaseCustom();
    this.#customPath = path;

    const kind = mediaKind(path);
    if (!kind) {
      this.#customFailed = true;
      warnMissingCustom(path);
      return;
    }

    const token = this.#customToken;
    if (kind === "video") this.#loadCustomVideo(path, token);
    else this.#loadCustomImage(path, token);
    this.#armCustomWatch();
  }

  /**
   * @param {string} path
   * @param {number} token
   */
  #loadCustomVideo(path, token) {
    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.autoplay = false;
    video.crossOrigin = "anonymous";
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    this.#customVideo = video;
    this.#customKind = "video";

    const fail = () => this.#failCustom(path, token);
    video.addEventListener("error", fail, {once: true});
    video.addEventListener("loadeddata", () => {
      if ((token !== this.#customToken) || this.#customFailed) return;
      try {
        const texture = PIXI.Texture.from(video, {resourceOptions: {autoPlay: false}});
        if (!video.paused) video.pause();
        if ((token !== this.#customToken) || this.#customFailed) {
          texture.destroy(true);
          return;
        }
        this.#customTexture = texture;
        this.#customReady = true;
        texture.baseTexture.once("error", fail);
      }
      catch {
        fail();
      }
    }, {once: true});
    video.src = path;
  }

  /**
   * @param {string} path
   * @param {number} token
   */
  #loadCustomImage(path, token) {
    const image = new Image();
    image.crossOrigin = "anonymous";
    this.#customKind = "image";

    const fail = () => this.#failCustom(path, token);
    image.addEventListener("error", fail, {once: true});
    image.addEventListener("load", () => {
      if ((token !== this.#customToken) || this.#customFailed) return;
      try {
        const texture = PIXI.Texture.from(image);
        if ((token !== this.#customToken) || this.#customFailed) {
          texture.destroy(true);
          return;
        }
        this.#customTexture = texture;
        this.#customReady = !!texture.baseTexture?.valid;
        if (!this.#customReady) {
          texture.baseTexture.once("loaded", () => {
            if (token !== this.#customToken) return;
            this.#customReady = true;
          });
        }
        texture.baseTexture.once("error", fail);
      }
      catch {
        fail();
      }
    }, {once: true});
    image.src = path;
  }

  /**
   * @param {string} path
   * @param {number} token
   */
  #failCustom(path, token) {
    if ((token !== this.#customToken) || this.#failing) return;
    if (this.#customFailed && !this.#customTexture && !this.#customVideo) return;
    this.#failing = true;
    this.#customFailed = true;
    this.#customReady = false;
    warnMissingCustom(path);

    const video = this.#customVideo;
    this.#customVideo = null;
    if (video) {
      try { video.pause(); }
      catch { /* not playing */ }
      try { video.currentTime = 0; }
      catch { /* metadata is not ready */ }
    }

    const texture = this.#customTexture;
    this.#customTexture = null;
    if (this.uniforms) this.uniforms.customTexture = PIXI.Texture.EMPTY;
    if (texture && (texture !== PIXI.Texture.EMPTY)) {
      try { texture.destroy(true); }
      catch { /* already destroyed */ }
    }
    else if (video) {
      try {
        video.removeAttribute("src");
        video.load();
      }
      catch { /* the element is already detached */ }
    }
    this.#failing = false;
  }

  /**
   * Pause, rewind, and drop the file. Safe to call when nothing is loaded.
   */
  #releaseCustom() {
    this.#customToken += 1;
    this.#stopCustomWatch();

    const video = this.#customVideo;
    this.#customVideo = null;
    if (video) {
      try { video.pause(); }
      catch { /* not playing */ }
      try { video.currentTime = 0; }
      catch { /* metadata is not ready */ }
    }

    const texture = this.#customTexture;
    this.#customTexture = null;
    this.#customReady = false;
    this.#customFailed = false;
    this.#customKind = null;
    this.#customPath = null;
    if (this.uniforms) this.uniforms.customTexture = PIXI.Texture.EMPTY;

    if (texture && (texture !== PIXI.Texture.EMPTY)) {
      try { texture.destroy(true); }
      catch { /* already destroyed */ }
    }
    else if (video) {
      try {
        video.removeAttribute("src");
        video.load();
      }
      catch { /* the element is already detached */ }
    }
  }

  #armCustomWatch() {
    this.#lastCustomApply = canvas.app?.ticker?.lastTime ?? this.#lastCustomApply;
    if (this.#watching || !canvas.app?.ticker) return;
    this.#watching = true;
    canvas.app.ticker.add(this.#onCustomWatch, null, PIXI.UPDATE_PRIORITY.UTILITY);
  }

  #stopCustomWatch() {
    if (!this.#watching) return;
    this.#watching = false;
    canvas.app?.ticker?.remove(this.#onCustomWatch, null);
  }

  #onCustomWatch = () => {
    const ticker = canvas.app?.ticker;
    if (!ticker) return;
    if ((ticker.lastTime - this.#lastCustomApply) < CUSTOM_IDLE_MS) return;
    this.#releaseCustom();
  };
}

/**
 * @returns {number}
 */
function readIntensity() {
  const intensity = game.settings.get(MODULE_ID, "intensity");
  if ((typeof intensity !== "number") || !Number.isFinite(intensity)) return 1;
  return Math.min(Math.max(intensity, 0), 1);
}

/**
 * Extension with any query or hash stripped. GIF and APNG stay images.
 * @param {string} path
 * @returns {string}
 */
function fileExtension(path) {
  const clean = String(path).split("?")[0].split("#")[0];
  const slash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  const base = clean.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if ((dot <= 0) || (dot === base.length - 1)) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * @param {string} path
 * @returns {"image" | "video" | null}
 */
function mediaKind(path) {
  const ext = fileExtension(path);
  if (!ext) return null;
  if (Object.prototype.hasOwnProperty.call(CONST.VIDEO_FILE_EXTENSIONS, ext)) return "video";
  if (Object.prototype.hasOwnProperty.call(CONST.IMAGE_FILE_EXTENSIONS, ext)) return "image";
  return null;
}

/**
 * @param {string} path
 */
function warnMissingCustom(path) {
  if (warnedCustomPaths.has(path)) return;
  warnedCustomPaths.add(path);
  const message = game.i18n.localize("HELPERHUB.CustomMissing");
  console.warn(`${MODULE_ID} | ${message}`, path);
  ui.notifications?.warn(message);
}
