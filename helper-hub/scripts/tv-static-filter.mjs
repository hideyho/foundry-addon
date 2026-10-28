const MODULE_ID = "helper-hub";
const Base = foundry.canvas.rendering.filters.TextureTransitionFilter;

/** @type {(() => void) | null} */
let onApplied = null;

/**
 * Called on every frame the transition filter is applied, including scene-config previews.
 * @param {() => void} callback
 */
export function bindTvStaticFrame(callback) {
  onApplied = callback;
}

/**
 * Analog television interference between two scene captures.
 * The cut is a hard step at progress 0.5, buried in the static burst.
 */
export class TvStaticFilter extends Base {

  /**
   * True after create(), which compiles the TV fragment.
   * TransitionContainer reuses this instance for later built-in types.
   * @type {boolean}
   */
  #tvStatic = true;

  /** @type {PIXI.Program | null} */
  static #tvProgram = null;

  /** @type {PIXI.Program | null} */
  static #coreProgram = null;

  /**
   * Compile each program once. PIXI.Program.from caches by source, and
   * Foundry replaces PIXI.Filter#program the same way for post-process swaps.
   */
  static #ensurePrograms() {
    if (this.#coreProgram) return;
    const vertexSrc = Base._createVertexShader();
    this.#tvProgram = PIXI.Program.from(vertexSrc, this._createFragmentShader());
    this.#coreProgram = PIXI.Program.from(vertexSrc, Base._createFragmentShader());
  }

  /** @override */
  static get defaultUniforms() {
    return {...super.defaultUniforms, time: 0, intensity: 1};
  }

  /**
   * @returns {string}
   */
  get type() {
    return this.#tvStatic ? "tvStatic" : super.type;
  }

  /**
   * @param {string} type  Transition id from TransitionContainer.
   */
  set type(type) {
    TvStaticFilter.#ensurePrograms();
    if (type === "tvStatic") {
      // FADE clears the private padding flag. "tvStatic" is not a core type and would throw.
      super.type = Base.TYPES.FADE;
      this.program = TvStaticFilter.#tvProgram;
      this.#tvStatic = true;
      return;
    }
    this.#tvStatic = false;
    this.program = TvStaticFilter.#coreProgram;
    super.type = type;
  }

  /** @override */
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

  /** @override */
  apply(filterManager, input, output, clear) {
    if (this.#tvStatic) {
      // Stay in seconds, wrapped every 64s so sin/floor stay precise for the whole session.
      const seconds = canvas.app.ticker.lastTime * 0.001;
      this.uniforms.time = seconds % 64;
      this.uniforms.intensity = game.settings.get(MODULE_ID, "intensity");
      onApplied?.();
    }
    return super.apply(filterManager, input, output, clear);
  }
}
