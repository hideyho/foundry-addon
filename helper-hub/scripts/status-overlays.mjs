const MODULE_ID = "helper-hub";

/** Above the token mesh. The hover border uses Infinity, so this stays a finite step above the mesh. */
const LAYER_LIFT = 20;

/** Pixel canvas. 1×1 fills, then an integer scale with NEAREST filtering. */
const PIXEL = 16;
const FRAMES = 4;

const MAX_DT = 50;

/** Square-token mask sits 2px inside the token box. */
const MASK_INSET = 2;
/** Dynamic-ring mask. Sits on the portrait and off the metal frame. */
const RING_MASK_RADIUS = 0.46;
/** Sprite centers stay inside that circle so the mask does not cut them in half. */
const RING_BODY_RADIUS = 0.42;
/** Orbits, including wobble, stay inside the ring portrait. */
const ORBIT_LIMIT = 0.34;
/** Dead ring and shimmer on a ring token. The stroke sits inside the mask. */
const RING_STROKE_RADIUS = 0.38;

/**
 * Pure preset. Built once at import and never touches Foundry or Pixi.
 * `color` and `accent` are hex numbers such as 0x8b1e1e.
 * @typedef {object} StatusStyle
 * @property {"drip" | "rise" | "orbit" | "vignette" | "lines" | "shimmer" | "arc" | "streak" | "mark" | "text" | "veil"} motion
 * @property {number} color
 * @property {number} [accent] Second tint. Orbits mix it; a dark wash uses it so the second layer stays readable.
 * @property {number} [alpha] Resting disc alpha for vignette and veil.
 * @property {string} [glyph] Rising letter.
 * @property {1 | 2 | 3} [weight] Arc thickness. Cover uses 1, 2, and 3.
 * @property {"sideways" | "up" | "down"} [direction]
 * @property {"drip" | "mote" | "streak" | "wisp" | "glyph" | "ring"} [accentMotion] Drawn over a wash. `motion` stays the wash.
 * @property {number} [accentCount] Drops, motes, streaks, wisps, or glyphs in that second layer.
 * @property {number} [pace] Extra drip speed multiplier. Bloodied sets this; dehydration stays on `slow`.
 * @property {boolean} [hearts]
 * @property {boolean} [bubbles]
 * @property {boolean} [flames]
 * @property {boolean} [sparks]
 * @property {boolean} [ring] Shrinking ring drawn with a rise.
 * @property {boolean} [bar] Blindfold bars instead of short strokes.
 * @property {boolean} [bent] Grapple ropes. Each rope is a short sine polyline.
 * @property {boolean} [slow]
 * @property {boolean} [shake] Vignette alpha trembles. The token itself stays still.
 * @property {boolean} [still] Disc alpha does not change.
 * @property {boolean} [feet] Disc sits on the bottom edge. The token is not rotated.
 */

/** @type {Record<string, StatusStyle>} */
const STYLES = {};

/**
 * Ids in one call share a motion and the same object.
 * Different conditions that only share a family of color get their own object.
 * @param {StatusStyle} style
 * @param {string[]} ids
 */
function share(style, ids) {
  for (const id of ids) STYLES[id] = style;
}

share({motion: "drip", color: 0x8b1e1e}, ["bleeding"]);
share({
  motion: "vignette",
  color: 0x4a1010,
  alpha: 0.22,
  accentMotion: "drip",
  accentCount: 4,
  accent: 0xb42323,
  pace: 0.5
}, ["bloodied"]);
share({motion: "rise", color: 0xe85d04, flames: true}, ["burning", "fireShield"]);
share({motion: "rise", color: 0xf4d35e, flames: true}, ["shock"]);
share({motion: "drip", color: 0xb5c94a}, ["corrode"]);
share({motion: "rise", color: 0x3d9b4a, bubbles: true}, ["poisoned", "poison"]);
share({motion: "rise", color: 0x6b8f3a, bubbles: true}, ["diseased", "disease"]);
share({motion: "orbit", color: 0x7b2cbf}, ["cursed", "curse"]);
share({motion: "drip", color: 0xc4a574, slow: true}, ["dehydration"]);
share({motion: "rise", color: 0x8a8f6a}, ["malnutrition", "degen"]);
share({
  motion: "vignette",
  color: 0x8d8d8d,
  alpha: 0.22,
  accentMotion: "mote",
  accentCount: 6,
  slow: true
}, ["exhaustion"]);
share({
  motion: "vignette",
  color: 0x5c5c5c,
  alpha: 0.22,
  accentMotion: "streak",
  accentCount: 3,
  accent: 0x9a9a9a,
  direction: "down"
}, ["encumbered"]);
share({
  motion: "vignette",
  color: 0x3a3a3a,
  alpha: 0.22,
  accentMotion: "streak",
  accentCount: 5,
  accent: 0xb5b5b5,
  direction: "down"
}, ["heavilyEncumbered"]);
share({
  motion: "vignette",
  color: 0x3a3a3a,
  alpha: 0.22,
  accentMotion: "streak",
  accentCount: 8,
  accent: 0xd0d0d0,
  direction: "down"
}, ["exceedingCarryingCapacity"]);
share({
  motion: "vignette",
  color: 0x2a1438,
  alpha: 0.22,
  shake: true,
  accentMotion: "wisp",
  accentCount: 5,
  accent: 0xd2c4f0
}, ["frightened", "fear"]);
share({motion: "orbit", color: 0xe6c15a, sparks: true}, ["stunned", "stun"]);
share({motion: "text", color: 0xf0a202, glyph: "!"}, ["surprised"]);
share({motion: "lines", color: 0x8a5a32, bent: true}, ["grappled"]);
share({motion: "lines", color: 0xa8b0b8}, ["restrained", "restrain"]);
share({motion: "lines", color: 0x9aa0a6}, ["petrified"]);
share({motion: "orbit", color: 0x4cc9f0}, ["paralyzed", "paralysis"]);
share({motion: "lines", color: 0x1c1c1c, bar: true}, ["blinded", "blind"]);
share({motion: "shimmer", color: 0x8ecae6}, ["deafened", "deaf", "silenced", "silence"]);
share({motion: "rise", color: 0x90e0ef, ring: true}, ["suffocation"]);
share({motion: "text", color: 0xa0c4ff, glyph: "Z"}, ["sleeping", "sleep"]);
share({
  motion: "vignette",
  color: 0x141820,
  alpha: 0.22,
  accentMotion: "glyph",
  accentCount: 4,
  accent: 0xd5deea,
  glyph: "Z"
}, ["unconscious"]);
share({
  motion: "vignette",
  color: 0x141820,
  alpha: 0.22,
  accentMotion: "glyph",
  accentCount: 2,
  accent: 0xd5deea,
  glyph: "Z"
}, ["incapacitated"]);
share({motion: "arc", color: 0x4d96ff, weight: 2}, ["concentrating"]);
share({motion: "rise", color: 0xff6b9a, hearts: true}, ["charmed"]);
share({motion: "rise", color: 0xe8c15a}, ["bless", "stable", "regen", "upgrade"]);
share({motion: "arc", color: 0x8ecae6, weight: 1}, ["coverHalf"]);
share({motion: "arc", color: 0x8ecae6, weight: 2}, ["coverThreeQuarters"]);
share({motion: "arc", color: 0x8ecae6, weight: 3}, ["coverTotal"]);
share({motion: "arc", color: 0xbde0fe, weight: 2}, ["coldShield"]);
share({motion: "arc", color: 0xb388ff, weight: 2}, ["magicShield"]);
share({motion: "arc", color: 0xfff3c4, weight: 2}, ["holyShield"]);
share({motion: "streak", color: 0xf8f9fa, direction: "sideways"}, ["dodging"]);
share({motion: "streak", color: 0x90e0ef, direction: "up"}, ["flying", "fly", "hovering", "hover"]);
share({motion: "streak", color: 0x6c757d, direction: "down"}, ["falling"]);
share({motion: "drip", color: 0x6b4f3a}, ["burrowing", "burrow"]);
share({motion: "shimmer", color: 0x9bf6ff}, ["invisible", "ethereal", "hiding"]);
share({motion: "orbit", color: 0xff4d6d, accent: 0xe6c15a}, ["transformed"]);
share({motion: "mark", color: 0xe63946}, ["marked", "eye", "target"]);
share({
  motion: "vignette",
  color: 0x1a0a0a,
  alpha: 0.22,
  still: true,
  accentMotion: "ring"
}, ["dead"]);
share({
  motion: "vignette",
  color: 0x3d2b1f,
  alpha: 0.45,
  feet: true,
  accentMotion: "mote",
  accentCount: 2
}, ["prone"]);
share({motion: "shimmer", color: 0xa8dadc}, ["frozen"]);
share({motion: "rise", color: 0x6c757d, slow: true}, ["downgrade"]);

/** Unknown ids. Gray, and not the bleeding red. A few slow motes keep the veil visible. */
const VEIL = {
  motion: "veil",
  color: 0x737373,
  alpha: 0.18,
  slow: true
};

/**
 * @param {string} id
 * @returns {StatusStyle}
 */
export function styleForStatus(id) {
  if (typeof id !== "string") return VEIL;
  if (STYLES[id]) return STYLES[id];
  const linked = linkedPresetId(id);
  if (linked && STYLES[linked]) return STYLES[linked];
  return VEIL;
}

/** @type {Map<object, PIXI.Container>} */
const overlays = new Map();

/** @type {Set<PIXI.Container>} */
const layers = new Set();

/**
 * Shared pixel textures, keyed by kind, frame, and status color.
 * Sprites are destroyed with the texture kept, so the cache lives on the module.
 * @type {Map<string, PIXI.Texture>}
 */
const pixelTextures = new Map();

/**
 * One text object per glyph and color. Sprites share its texture.
 * The text stays alive: Text.destroy clears the canvas even when the texture is kept.
 * @type {Map<string, PIXI.Text>}
 */
const glyphSources = new Map();

let ticking = false;
let lastSyncError = "";
let lastTickError = "";

/**
 * The first failure must not hide a later one. The same token and status are logged once
 * until the message, the token, or the status key changes.
 * @param {"sync" | "tick"} kind
 * @param {Token | null | undefined} token
 * @param {string} statusKey
 * @param {unknown} err
 */
function warnStatus(kind, token, statusKey, err) {
  const message = err instanceof Error ? err.message : String(err);
  const signature = `${token?.id ?? ""}|${statusKey}|${message}`;
  if (kind === "sync") {
    if (lastSyncError === signature) return;
    lastSyncError = signature;
  } else {
    if (lastTickError === signature) return;
    lastTickError = signature;
  }
  const id = token?.id ?? "unknown";
  const label = statusKey ? statusKey.split("\0").join(", ") : "unknown";
  const detail = kind === "sync"
    ? "Status overlays could not be updated"
    : "Status overlay animation hit an error";
  console.warn(`${MODULE_ID} | ${detail} for token ${id} (${label}).`, err);
}

/**
 * refreshToken also runs on movement, so the layer is rebuilt only when the sorted status ids change.
 */
export function registerStatusOverlays() {
  Hooks.on("refreshToken", token => syncToken(token));
  Hooks.on("destroyToken", token => removeOverlay(token));
}

/**
 * Drop every overlay and detach the single ticker.
 */
export function clearStatusOverlays() {
  for (const layer of [...layers]) untrack(layer);
  overlays.clear();
  stopTicker();
  lastSyncError = "";
  lastTickError = "";
}

/**
 * @param {Iterable<Token> | null | undefined} tokens
 */
export function refreshStatusOverlays(tokens) {
  if (!tokens) return;
  for (const token of tokens) syncToken(token);
}

/**
 * @param {Token} token
 */
function syncToken(token) {
  const attempt = {statusKey: ""};
  try {
    syncTokenNow(token, attempt);
  } catch (err) {
    warnStatus("sync", token, attempt.statusKey, err);
  }
}

/**
 * @param {Token} token
 * @param {{statusKey: string}} attempt
 */
function syncTokenNow(token, attempt) {
  if (!overlayAllowed(token)) {
    removeOverlay(token);
    return;
  }

  const ids = readStatusIds(token);
  const key = ids.join("\0");
  attempt.statusKey = key;
  if (!key) {
    removeOverlay(token);
    return;
  }

  let layer = overlays.get(token);
  if (layer?.destroyed) {
    untrack(layer);
    layer = null;
  }

  if (layer) {
    pinLayer(token);
    if (layer.parent !== token) token.addChild(layer);
    liftLayer(layer, token);
    const painted = layer.children?.some(child => (child !== layer.maskGfx) && !child.destroyed);
    if ((layer.statusKey === key) && painted) {
      syncPortraitMask(layer, token);
      ensureTicker();
      return;
    }
    clearLayer(layer);
  } else {
    layer = createLayer(token);
  }

  try {
    fillLayer(layer, token, ids, key);
  } catch (err) {
    untrack(layer);
    throw err;
  }

  overlays.set(token, layer);
  layers.add(layer);
  ensureTicker();
}

/**
 * @param {Token} token
 */
function removeOverlay(token) {
  const layer = token ? overlays.get(token) : null;
  if (layer) untrack(layer);
}

/**
 * @param {PIXI.Container} layer
 */
function untrack(layer) {
  const token = layer?.token;
  if (token && (overlays.get(token) === layer)) overlays.delete(token);
  layers.delete(layer);
  releaseMask(layer);
  destroyDisplay(layer);
  if (layers.size === 0) stopTicker();
}

/**
 * Circle and glyph textures are shared, so every sprite keeps its texture.
 * Pixi 7 Sprite.destroy reads `baseTexture`. `textureSource` is ignored.
 * A token redraw destroys children with `{children: true}` only, and this
 * returns once `destroyed` is set, so those textures have to live on the module.
 * @param {PIXI.Container | PIXI.Sprite | PIXI.Text | PIXI.Graphics | null | undefined} display
 */
function destroyDisplay(display) {
  if (!display || display.destroyed) return;
  const children = display.removeChildren?.() ?? [];
  for (const child of children) destroyDisplay(child);
  display.destroy({
    children: false,
    texture: false,
    baseTexture: false
  });
}

/**
 * @param {Token} token
 * @returns {boolean}
 */
function overlayAllowed(token) {
  if (!token?.actor) return false;
  if (token.visible === false) return false;
  // Secret means the disposition is secret and this user is not an Observer.
  // Effect icons are already hidden. The token itself can stay visible.
  if (token.document?.isSecret) return false;
  if (token.document?.hidden && !game.user?.isGM) return false;
  return animationsEnabled();
}

/**
 * @returns {boolean}
 */
function animationsEnabled() {
  try {
    return game.settings.get(MODULE_ID, "statusAnimations") !== false;
  } catch (err) {
    return false;
  }
}

/**
 * Actor statuses are the main list. Active effects contribute their status ids,
 * and an effect image that matches a configured status effect contributes that id too.
 * An id that is only a Foundry `_id` is rewritten to the preset id when one exists.
 * @param {Token} token
 * @returns {string[]}
 */
function readStatusIds(token) {
  const actor = token?.actor;
  /** @type {Set<string>} */
  const found = new Set();
  addStatusList(found, actor?.statuses);
  for (const effect of actorEffects(actor)) addEffectStatuses(found, effect);
  return [...found].sort();
}

/**
 * @param {Set<string>} found
 * @param {unknown} list
 */
function addStatusList(found, list) {
  if (!list || (typeof list === "string")) return;
  if (typeof list[Symbol.iterator] !== "function") return;
  for (const id of list) rememberStatus(found, id);
}

/**
 * @param {Set<string>} found
 * @param {unknown} id
 */
function rememberStatus(found, id) {
  if ((typeof id !== "string") || !id) return;
  if (STYLES[id]) {
    found.add(id);
    return;
  }
  const linked = linkedPresetId(id);
  found.add(linked || id);
}

/**
 * @param {Actor | null | undefined} actor
 * @returns {object[]}
 */
function actorEffects(actor) {
  if (!actor) return [];
  if (typeof actor.allApplicableEffects === "function") {
    try {
      const listed = actor.allApplicableEffects();
      if (listed && (typeof listed !== "string") && (typeof listed[Symbol.iterator] === "function")) {
        return [...listed];
      }
    } catch (err) {
      // The applied list is the other place Foundry keeps these.
    }
  }
  const applied = actor.appliedEffects;
  if (applied && (typeof applied !== "string") && (typeof applied[Symbol.iterator] === "function")) {
    try {
      return [...applied];
    } catch (err) {
      return [];
    }
  }
  return [];
}

/**
 * @param {Set<string>} found
 * @param {object | null | undefined} effect
 */
function addEffectStatuses(found, effect) {
  if (!effect || (effect.disabled === true) || (effect.isSuppressed === true)) return;
  addStatusList(found, effect.statuses);
  const img = effect.img;
  if ((typeof img !== "string") || !img) return;
  const id = statusIdForImage(img);
  if (id) rememberStatus(found, id);
}

/**
 * Foundry's CONFIG is a global. Reading it off globalThis keeps the module import safe in Node.
 * @returns {Iterable<object>}
 */
function statusEffectList() {
  const list = globalThis.CONFIG?.statusEffects;
  if (!list || (typeof list === "string")) return [];
  // Core Foundry stores an array. dnd5e replaces it with a plain object keyed by id.
  if (typeof list[Symbol.iterator] === "function") return list;
  if (typeof list === "object") return Object.values(list);
  return [];
}

/**
 * @param {string} img
 * @returns {string}
 */
function statusIdForImage(img) {
  for (const entry of statusEffectList()) {
    if (!entry || (entry.img !== img)) continue;
    if ((typeof entry.id === "string") && entry.id) return entry.id;
  }
  return "";
}

/**
 * Custom effects sometimes store `_id` on the actor while the preset key is `id`.
 * @param {string} id
 * @returns {string}
 */
function linkedPresetId(id) {
  for (const entry of statusEffectList()) {
    if (!entry) continue;
    if ((entry.id !== id) && (entry._id !== id)) continue;
    if ((typeof entry.id === "string") && entry.id && (entry.id !== id)) return entry.id;
  }
  return "";
}

/**
 * @param {Token} token
 * @returns {PIXI.Container}
 */
function createLayer(token) {
  const layer = new PIXI.Container();
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  layer.label = "helper-hub-statuses";
  pinLayer(token);
  token.addChild(layer);
  liftLayer(layer, token);
  return layer;
}

/**
 * Sorting has to be on or the zIndex never lifts the overlay above the mesh.
 * @param {Token} token
 */
function pinLayer(token) {
  if ("sortableChildren" in token) token.sortableChildren = true;
}

/**
 * @param {PIXI.Container} layer
 * @param {Token} token
 */
function liftLayer(layer, token) {
  const meshZ = token?.mesh?.zIndex;
  const base = ((typeof meshZ === "number") && Number.isFinite(meshZ)) ? meshZ : 0;
  layer.zIndex = base + LAYER_LIFT;
}

/**
 * @param {PIXI.Container} layer
 */
function clearLayer(layer) {
  releaseMask(layer);
  const removed = layer.removeChildren();
  for (const child of removed) destroyDisplay(child);
  layer.views = [];
}

/**
 * @param {PIXI.Container} layer
 * @param {Token} token
 * @param {string[]} ids
 * @param {string} key
 */
function fillLayer(layer, token, ids, key) {
  const box = tokenBox(token);
  const ring = token?.hasDynamicRing === true;
  const frozen = canvas.photosensitiveMode === true;
  layer.token = token;
  layer.statusKey = key;
  syncPortraitMask(layer, token);
  const views = [];
  for (const id of ids) {
    const before = layer.children?.length ?? 0;
    try {
      views.push(createView(layer, styleForStatus(id), box, frozen, ring, id));
    } catch (err) {
      dropChildrenFrom(layer, before);
      warnStatus("sync", token, id, err);
    }
  }
  layer.views = views;
}

/**
 * A view that throws must not leave its sprites on the layer.
 * @param {PIXI.Container} layer
 * @param {number} index
 */
function dropChildrenFrom(layer, index) {
  if (!layer?.removeChildren) return;
  const extra = layer.removeChildren(index);
  for (const child of extra) destroyDisplay(child);
}

function ensureTicker() {
  if (ticking) return;
  const ticker = canvas?.app?.ticker;
  if (!ticker) return;
  const priority = PIXI.UPDATE_PRIORITY?.NORMAL ?? 0;
  ticker.add(onStatusTick, null, priority);
  ticking = true;
}

function stopTicker() {
  if (!ticking) return;
  canvas?.app?.ticker?.remove(onStatusTick, null);
  ticking = false;
}

function onStatusTick() {
  const dt = Math.min(MAX_DT, canvas?.app?.ticker?.deltaMS ?? 16.67);
  const frozen = canvas?.photosensitiveMode === true;
  for (const layer of layers) {
    const token = layer.token;
    if (!token || token.destroyed || layer.destroyed) {
      untrack(layer);
      continue;
    }
    try {
      if (layer.parent !== token) token.addChild(layer);
      pinLayer(token);
      liftLayer(layer, token);
      stepLayer(layer, dt, frozen);
    } catch (err) {
      warnStatus("tick", token, layer.statusKey || "", err);
    }
  }
  if (layers.size === 0) stopTicker();
}

/**
 * One status throwing must not stop the others. Photosensitive mode takes the still path and does not advance time.
 * @param {Array<{failed?: boolean, time?: number}>} views
 * @param {number} seconds
 * @param {boolean} frozen
 * @param {(view: {failed?: boolean, time?: number}, action: "still" | "play") => void} run
 * @param {(view: {failed?: boolean, time?: number}, err: unknown) => void} [onError]
 */
export function stepStatusPlans(views, seconds, frozen, run, onError) {
  for (const view of views) {
    if (view?.failed) continue;
    try {
      if (frozen) {
        run(view, "still");
      } else {
        view.time = (typeof view.time === "number" ? view.time : 0) + seconds;
        run(view, "play");
      }
    } catch (err) {
      view.failed = true;
      if (onError) onError(view, err);
    }
  }
}

function stepLayer(layer, dt, frozen) {
  const box = tokenBox(layer.token);
  const ring = layer.token?.hasDynamicRing === true;
  syncPortraitMask(layer, layer.token);
  const seconds = dt / 1000;
  stepStatusPlans(layer.views || [], seconds, frozen, (view, action) => {
    if (action === "still") holdStill(view, box);
    else playView(view, box, seconds, ring);
  }, (view, err) => {
    hideView(view);
    warnStatus("tick", layer.token, view.statusId || "", err);
  });
}

/**
 * @param {Token} token
 * @returns {{w: number, h: number, cx: number, cy: number}}
 */
function tokenBox(token) {
  const grid = canvas?.dimensions?.size || 100;
  const w = positive(token.w) || (positive(token.document?.width) * grid) || grid;
  const h = positive(token.h) || (positive(token.document?.height) * grid) || grid;
  return {w, h, cx: w / 2, cy: h / 2};
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function positive(value) {
  return ((typeof value === "number") && (value > 0)) ? value : 0;
}

/**
 * Drop the mask reference before the Graphics is destroyed with the layer.
 * @param {PIXI.Container | null | undefined} layer
 */
function releaseMask(layer) {
  if (!layer || layer.destroyed) return;
  layer.mask = null;
  layer.maskGfx = null;
  layer.maskKey = "";
}

/**
 * Circle on a dynamic ring, otherwise a rectangle 2px inside the token.
 * The Graphics stays a child at local 0,0 so it shares the token's coordinates.
 * Pixi turns `renderable` on only while it draws the stencil, then off, so the
 * white fill is not painted on the portrait. Do not set `renderable` here.
 * A single unstroked rect would scissor instead of stencil, which hides overlays on Foundry's canvas.
 * The square mask adds an outer 1px stroke so Pixi 7.4.3 does not take that path.
 * @param {PIXI.Container} layer
 * @param {Token} token
 */
function syncPortraitMask(layer, token) {
  const box = tokenBox(token);
  const ring = token?.hasDynamicRing === true;
  const key = `${box.w}\0${box.h}\0${ring ? 1 : 0}`;
  let gfx = layer.maskGfx;
  if (!gfx || gfx.destroyed) {
    gfx = new PIXI.Graphics();
    gfx.eventMode = "none";
    gfx.position.set(0, 0);
    layer.maskGfx = gfx;
    layer.maskKey = "";
  }
  if (gfx.parent !== layer) layer.addChild(gfx);
  if ((layer.mask === gfx) && (layer.maskKey === key)) return;
  gfx.clear();
  gfx.position.set(0, 0);
  for (const shape of portraitMaskShapes(box, ring)) {
    if (shape.lineWidth) {
      gfx.lineStyle({
        width: shape.lineWidth,
        color: shape.lineColor,
        alpha: shape.lineAlpha,
        alignment: shape.lineAlignment
      });
    }
    gfx.beginFill(0xffffff);
    if (shape.type === "circle") gfx.drawCircle(shape.x, shape.y, shape.radius);
    else gfx.drawRect(shape.x, shape.y, shape.w, shape.h);
    gfx.endFill();
  }
  layer.mask = gfx;
  layer.maskKey = key;
}

/**
 * Square portrait: one filled rect plus an outer 1px stroke.
 * Pixi 7.4.3 `isFastRect` is true only for a single rect with no stroke, and that scissor
 * path hides overlays on Foundry's canvas. The stroke uses alignment 1 so it sits outside
 * the fill. The stencil increments every fragment and then tests EQUAL, so a centered
 * stroke would leave a rim where it overlaps the fill. A second shape would do the same.
 * @param {{w: number, h: number, cx?: number, cy?: number}} box
 * @param {boolean} ring
 * @returns {Array<{type: string, x: number, y: number, w?: number, h?: number, radius?: number, lineWidth?: number, lineColor?: number, lineAlpha?: number, lineAlignment?: number}>}
 */
export function portraitMaskShapes(box, ring) {
  if (ring) {
    return [{
      type: "circle",
      x: box.cx,
      y: box.cy,
      radius: Math.min(box.w, box.h) * RING_MASK_RADIUS
    }];
  }
  return [{
    type: "rect",
    x: MASK_INSET,
    y: MASK_INSET,
    w: Math.max(0, box.w - (MASK_INSET * 2)),
    h: Math.max(0, box.h - (MASK_INSET * 2)),
    lineWidth: 1,
    lineColor: 0xffffff,
    lineAlpha: 1,
    lineAlignment: 1
  }];
}

/**
 * Pixi 7.4.3 `Graphics.isFastRect`: one rect, no matrix, no holes, and no visible stroke.
 * @param {Array<{type?: string, matrix?: unknown, holes?: unknown, lineWidth?: number, lineAlpha?: number}>} shapes
 * @returns {boolean}
 */
export function maskIsFastRect(shapes) {
  if (!Array.isArray(shapes) || shapes.length !== 1) return false;
  const shape = shapes[0];
  if (shape?.type !== "rect" || shape.matrix || shape.holes) return false;
  const width = shape.lineWidth || 0;
  const alpha = shape.lineAlpha ?? 1;
  const visible = width > 0 && alpha > 0;
  return !(visible && width);
}

/**
 * @param {{w: number, h: number}} box
 * @returns {number}
 */
function ringLimit(box) {
  return Math.min(box.w, box.h) * RING_BODY_RADIUS;
}

/**
 * Vertical room for a path at this x on a ring portrait.
 * @param {number} x
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @returns {{top: number, bottom: number}}
 */
function ringBand(x, box) {
  const limit = ringLimit(box);
  const dx = x - box.cx;
  const inside = (limit * limit) - (dx * dx);
  if (inside <= 0) {
    const mid = box.cy / box.h;
    return {top: mid, bottom: mid};
  }
  const dy = Math.sqrt(inside);
  return {
    top: (box.cy - dy) / box.h,
    bottom: (box.cy + dy) / box.h
  };
}

/**
 * Pull x into the ring so a vertical path still has room to travel.
 * @param {number} x
 * @param {{w: number, h: number, cx: number}} box
 * @param {boolean} ring
 * @returns {number}
 */
function clampXToRing(x, box, ring) {
  if (!ring) return x;
  const limit = ringLimit(box) * 0.9;
  return clamp(x, box.cx - limit, box.cx + limit);
}

/**
 * Progress 0 sits at 8% and progress 1 at 90%, on the axis that is not `fixed`.
 * A ring token shortens that run to the chord at `fixed`.
 * @param {number} progress
 * @param {number} fixed Cross-axis pixel.
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {boolean} ring
 * @param {boolean} horizontal Travel along x.
 * @returns {number}
 */
function streakAlong(progress, fixed, box, ring, horizontal) {
  const size = horizontal ? box.w : box.h;
  let start = size * 0.08;
  let end = size * 0.90;
  if (ring) {
    const limit = ringLimit(box);
    const center = horizontal ? box.cx : box.cy;
    const delta = fixed - (horizontal ? box.cy : box.cx);
    const inside = (limit * limit) - (delta * delta);
    const room = inside > 0 ? Math.sqrt(inside) : 0;
    start = Math.max(start, center - room);
    end = Math.min(end, center + room);
    if (end < start) {
      start = center;
      end = center;
    }
  }
  return start + (clamp(progress, 0, 1) * (end - start));
}

/**
 * @param {number} x
 * @param {number} y
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {boolean} ring
 * @returns {{x: number, y: number}}
 */
function placeOnPortrait(x, y, box, ring) {
  if (ring) {
    const limit = ringLimit(box);
    const dx = x - box.cx;
    const dy = y - box.cy;
    const dist = Math.hypot(dx, dy);
    if ((dist > limit) && (dist > 0)) {
      const scale = limit / dist;
      return {x: box.cx + (dx * scale), y: box.cy + (dy * scale)};
    }
    return {x, y};
  }
  const xPad = box.w > (MASK_INSET * 2) ? MASK_INSET : 0;
  const yPad = box.h > (MASK_INSET * 2) ? MASK_INSET : 0;
  return {
    x: clamp(x, xPad, box.w - xPad),
    y: clamp(y, yPad, box.h - yPad)
  };
}

/**
 * One rivulet segment. A center above the drip band stays hidden, including on a ring,
 * where clamping alone would pull the tail onto the circle and away from the head.
 * Visible segments are clamped onto the portrait and still hidden if that leaves them above the band.
 * @param {number} x
 * @param {number} y Unclamped segment center.
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {boolean} ring
 * @param {number} bandTop Fraction of `box.h`. The segment is above the band when `y` is smaller.
 * @returns {{x: number, y: number, visible: boolean}}
 */
export function placeDripSegment(x, y, box, ring, bandTop) {
  const limit = bandTop * box.h;
  if (y < limit) return {x, y, visible: false};
  const placed = placeOnPortrait(x, y, box, ring);
  if (placed.y < limit) return {x: placed.x, y: placed.y, visible: false};
  return {x: placed.x, y: placed.y, visible: true};
}

/**
 * @param {PIXI.Container} parent
 * @param {StatusStyle} preset
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {boolean} frozen
 * @param {boolean} ring
 * @param {string} [statusId]
 */
function createView(parent, preset, box, frozen, ring, statusId) {
  /** @type {StatusView} */
  const view = {
    preset,
    statusId: statusId || "",
    failed: false,
    particles: [],
    glyphs: [],
    embers: [],
    scene: [],
    gfx: null,
    wash: null,
    still: null,
    time: Math.random() * 5,
    gfxBox: ""
  };

  if (needsWash(preset)) {
    view.wash = addPixelSprite(parent, wantsSolidTint(preset) ? "tint" : "wash", 0, preset.color);
  }
  view.still = addPixelSprite(parent, clusterKind(preset), 0, clusterColor(preset));
  view.still.visible = false;
  if (usesGraphics(preset)) view.gfx = addGraphics(parent);

  const count = particleCount(preset);
  for (let index = 0; index < count; index += 1) {
    view.particles.push(addParticle(parent, preset, index, count));
  }
  if (preset.flames) view.embers = addEmbers(parent, preset);
  if ((preset.motion === "text") || (preset.accentMotion === "glyph")) {
    view.glyphs = addPixelGlyphs(parent, preset);
  }
  view.scene = addSceneSprites(parent, preset);

  if (frozen) holdStill(view, box);
  else playView(view, box, 0, ring === true);
  return view;
}

/**
 * @param {StatusView | null | undefined} view
 */
function hideView(view) {
  if (!view) return;
  if (view.wash) view.wash.visible = false;
  if (view.still) view.still.visible = false;
  if (view.gfx) view.gfx.visible = false;
  for (const particle of view.particles || []) showParticle(particle, false);
  for (const glyph of view.glyphs || []) {
    if (glyph?.sprite) glyph.sprite.visible = false;
  }
  for (const ember of view.embers || []) {
    if (ember?.sprite) ember.sprite.visible = false;
  }
  hideScene(view);
}

/**
 * @param {StatusStyle} preset
 * @returns {boolean}
 */
function needsWash(preset) {
  if (preset.feet) return false;
  if (wantsSolidTint(preset)) return true;
  return (preset.motion === "vignette") || (preset.motion === "veil");
}

/**
 * Solid portrait tint for the effects that were only specks.
 * Checkerboard washes stay on the other vignettes.
 * @param {StatusStyle} preset
 * @returns {boolean}
 */
function wantsSolidTint(preset) {
  if (preset.hearts === true) return true;
  if (preset === STYLES.petrified) return true;
  if ((preset.bubbles === true) && (preset.color === 0x3d9b4a)) return true;
  if (preset === STYLES.exhaustion) return true;
  if (preset === STYLES.frightened) return true;
  return false;
}

/**
 * Extra integer scale on the moving sprites, on top of `pixelScale`.
 * @param {StatusStyle} preset
 * @returns {number}
 */
function particleScaleBoost(preset) {
  if (preset.hearts === true) return 2;
  if ((preset.bubbles === true) && (preset.color === 0x3d9b4a)) return 2;
  if (preset === STYLES.exhaustion) return 1;
  if (preset.accentMotion === "wisp") return 2;
  if ((preset.motion === "orbit") && (preset.color === 0x4cc9f0) && (preset.sparks !== true)) return 2;
  if ((preset.motion === "shimmer") && (preset.color === 0x8ecae6)) return 2;
  return 0;
}

/**
 * Whether a status asks for a readable picture: a solid tint, or a sprite scale boost.
 * @param {StatusStyle} preset
 * @returns {{scaleBoost: number, tint: boolean}}
 */
export function overlayPresence(preset) {
  let scaleBoost = particleScaleBoost(preset);
  for (const sprite of sceneSpriteSpecs(preset)) {
    scaleBoost = Math.max(scaleBoost, sprite.scaleBoost || 0);
  }
  return {scaleBoost, tint: wantsSolidTint(preset)};
}

/**
 * @param {StatusStyle} preset
 * @returns {boolean}
 */
function usesGraphics(preset) {
  return (preset.motion === "lines")
    || (preset.motion === "shimmer")
    || (preset.motion === "arc")
    || (preset.motion === "mark")
    || (preset.ring === true)
    || (preset.accentMotion === "ring")
    || (preset.feet === true);
}

/**
 * Glyphs and the dead ring are not particles. A wash's second layer uses `accentCount`.
 * Lines, arcs, marks, and the dead ring are scene sprites from `overlaySpritePlan`.
 * @param {StatusStyle} preset
 * @returns {number}
 */
function particleCount(preset) {
  if ((preset.accentMotion === "glyph") || (preset.accentMotion === "ring")) return 0;
  if (typeof preset.accentCount === "number") return preset.accentCount;
  if (preset.motion === "drip") return preset.color === 0x6b4f3a ? 6 : 7;
  if (preset.motion === "rise") {
    if (preset.hearts) return 3;
    if (preset.flames) return 5;
    return 6;
  }
  if (preset.motion === "orbit") {
    if (preset.sparks) return 8;
    if (preset.color === 0x4cc9f0) return 8;
    return 7;
  }
  if (preset.motion === "streak") return 6;
  if (preset.motion === "shimmer") return 4;
  if (preset.motion === "veil") return 5;
  return 0;
}

/**
 * Drips, motes, wisps, and heavy streaks replace the wash's motion for the sprites only.
 * @param {StatusStyle} preset
 * @returns {string}
 */
function particleMotion(preset) {
  const accent = preset.accentMotion;
  if (accent && (accent !== "glyph") && (accent !== "ring")) return accent;
  if ((preset.motion === "drip") || (preset.motion === "rise") || (preset.motion === "orbit")
    || (preset.motion === "streak") || (preset.motion === "shimmer") || (preset.motion === "veil")) {
    return preset.motion;
  }
  return "";
}

/**
 * @param {StatusStyle} preset
 * @returns {string}
 */
function particleKind(preset) {
  const motion = particleMotion(preset);
  if (preset === STYLES.exhaustion) return "dripHead";
  if (motion === "drip") return preset.color === 0x6b4f3a ? "clod" : "rivulet";
  if (preset.flames) return preset.color === 0xf4d35e ? "bolt" : "flame";
  if (preset.hearts) return "heart";
  if (preset.bubbles) return "bubble";
  if (preset.sparks) return "plus";
  if ((motion === "rise") && (preset.color === 0xe8c15a)) return "star";
  if (motion === "rise") return "spark";
  if ((motion === "orbit") && (preset.color === 0x4cc9f0)) return "shard";
  if (motion === "orbit") return "mote";
  if (motion === "wisp") return "puff";
  if (motion === "streak") return preset.accentMotion === "streak" ? "dash" : "speedX";
  if (motion === "shimmer") {
    if (preset.color === 0xa8dadc) return "crystal";
    if (preset.color === 0x8ecae6) return "wave";
    return "mote";
  }
  if ((motion === "mote") || (preset.feet === true)) return "dust";
  return "mote";
}

/**
 * @param {StatusStyle} preset
 * @returns {string}
 */
function clusterKind(preset) {
  if (preset.glyph === "!") return "bang";
  if ((preset.motion === "text") || (preset.accentMotion === "glyph")) return "glyphZ";
  if (preset.bar) return "cloth";
  if (preset.bent) return "rope";
  if (preset === STYLES.petrified) return "crack";
  if (preset.motion === "lines") return "chain";
  if (preset.motion === "mark") return "cross";
  if (preset.motion === "arc") return "arc";
  if (preset.accentMotion === "ring") return "ring";
  if ((preset.motion === "shimmer") && (preset.color === 0xa8dadc)) return "crystal";
  return particleKind(preset);
}

/**
 * @param {StatusStyle} preset
 * @returns {number}
 */
function clusterColor(preset) {
  const color = (typeof preset.accent === "number") && preset.accentMotion && (preset.accentMotion !== "ring")
    ? preset.accent
    : preset.color;
  return lightenDrawnColor(color);
}

/**
 * Near-black status colors stay on the preset. Sprites draw this lighter mix.
 * A channel sum under 90 is the same cutoff `clusterColor` uses.
 * @param {number} color
 * @returns {number}
 */
function lightenDrawnColor(color) {
  const sum = ((color >> 16) & 255) + ((color >> 8) & 255) + (color & 255);
  if (sum < 90) return mix(color, 0xffffff, 0.65);
  return color;
}

/**
 * @param {string} kind
 * @param {string} role
 * @param {number} [scaleBoost]
 * @param {boolean} [wide]
 * @returns {OverlaySpriteSpec}
 */
function spriteSpec(kind, role, scaleBoost = 0, wide = false) {
  return {kind, role, scaleBoost, wide};
}

/**
 * @param {string} kind
 * @param {string} role
 * @param {number} count
 * @param {number} [scaleBoost]
 * @returns {OverlaySpriteSpec[]}
 */
function repeatSpecs(kind, role, count, scaleBoost = 0) {
  const sprites = [];
  for (let index = 0; index < count; index += 1) sprites.push(spriteSpec(kind, role, scaleBoost, false));
  return sprites;
}

/**
 * Scene sprites that replace Graphics the canvas does not show.
 * Particle and glyph sprites are counted separately so a short list is padded with motes.
 * @param {StatusStyle} preset
 * @returns {OverlaySpriteSpec[]}
 */
function sceneSpriteSpecs(preset) {
  if (preset.bar) {
    const stitches = repeatSpecs("spark", "stitch", 4);
    const eyes = [spriteSpec("shut", "eye", 2), spriteSpec("shut", "eye", 2)];
    return [spriteSpec("cloth", "cloth", 0, true), ...stitches, ...eyes];
  }
  if (preset.bent) return repeatSpecs("rope", "rope", 10);
  if (preset === STYLES.petrified) return repeatSpecs("crack", "crack", 6, 2);
  if ((preset.motion === "orbit") && (preset.color === 0x4cc9f0) && (preset.sparks !== true)) {
    return repeatSpecs("block", "halo", 10);
  }
  if ((preset.bubbles === true) && (preset.color === 0x3d9b4a)) {
    return [spriteSpec("dripHead", "drop", 1)];
  }
  if (preset.motion === "lines") return repeatSpecs("chain", "chain", 12);
  if (preset.motion === "arc") {
    const scaleBoost = Math.max(0, (preset.weight ?? 2) - 1);
    return repeatSpecs("block", "block", 8, scaleBoost);
  }
  if (preset.motion === "mark") return repeatSpecs("cross", "cross", 5, 1);
  if (preset.accentMotion === "ring") return repeatSpecs("ring", "ring", 10);
  return [];
}

/**
 * Sprites `createView` already builds outside the scene list.
 * Heart mates count. Drip tails are part of a rivulet that is already one sprite.
 * @param {StatusStyle} preset
 * @returns {number}
 */
function companionSpriteCount(preset) {
  let count = particleCount(preset);
  if (preset.hearts) count *= 2;
  if ((preset.motion === "text") || (preset.accentMotion === "glyph")) {
    count += preset.accentMotion === "glyph" ? (preset.accentCount || 3) : 4;
  }
  return count;
}

/**
 * Pure sprite request for one status. `color` is what the sprites draw.
 * `preset.color` is not changed, including near-black blinded and dead.
 * @param {StatusStyle} preset
 * @returns {{color: number, sprites: OverlaySpriteSpec[]}}
 */
export function overlaySpritePlan(preset) {
  const color = clusterColor(preset);
  const sprites = sceneSpriteSpecs(preset);
  const companion = companionSpriteCount(preset);
  while ((sprites.length + companion) < 4) sprites.push(spriteSpec("mote", "mote"));
  for (const sprite of sprites) sprite.color = color;
  return {color, sprites};
}

/**
 * @param {StatusStyle} preset
 * @param {number} index
 * @returns {number}
 */
function particleColor(preset, index) {
  let color = preset.color;
  if (typeof preset.accent === "number") {
    if (preset.accentMotion && (preset.accentMotion !== "glyph") && (preset.accentMotion !== "ring")) {
      color = preset.accent;
    } else if ((index % 2) === 1) color = preset.accent;
  }
  if (preset.slow && (preset.motion === "rise")) color = mix(color, 0x000000, 0.4);
  return color;
}

/**
 * @param {PIXI.Container} parent
 * @returns {PIXI.Graphics}
 */
function addGraphics(parent) {
  const gfx = new PIXI.Graphics();
  gfx.eventMode = "none";
  parent.addChild(gfx);
  return gfx;
}

/**
 * @param {PIXI.Container} parent
 * @param {string} kind
 * @param {number} frame
 * @param {number} color
 * @returns {PIXI.Sprite}
 */
function addPixelSprite(parent, kind, frame, color) {
  const sprite = new PIXI.Sprite(pixelTexture(kind, frame, color));
  sprite.anchor.set(0.5);
  sprite.eventMode = "none";
  parent.addChild(sprite);
  return sprite;
}

/**
 * @param {number} index
 * @param {number} salt
 * @returns {number}
 */
function hashUnit(index, salt) {
  const raw = Math.sin(((index + 1) * 127.1) + (salt * 311.7)) * 43758.5453;
  return raw - Math.floor(raw);
}

/**
 * Golden spacing plus a hash jitter, so a handful of drops never land on equal lanes.
 * @param {number} index
 * @param {number} salt
 * @returns {number}
 */
function spreadUnit(index, salt) {
  const golden = (((index + 1) * 0.61803398875) + (salt * 0.137)) % 1;
  const jitter = (hashUnit(index, salt) - 0.5) * 0.2;
  let value = (golden + jitter) % 1;
  if (value < 0) value += 1;
  return value;
}

/**
 * @param {PIXI.Container} parent
 * @param {StatusStyle} preset
 * @param {number} index
 * @param {number} count
 * @returns {StatusParticle}
 */
function addParticle(parent, preset, index, count) {
  const color = particleColor(preset, index);
  const kind = particleKind(preset);
  const motion = particleMotion(preset);
  const headKind = kind === "rivulet" ? "dripHead" : kind;
  const sprite = addPixelSprite(parent, headKind, index % FRAMES, color);
  /** @type {PIXI.Sprite[]} */
  const parts = [];
  /** @type {PIXI.Sprite | null} */
  let pool = null;
  if (motion === "drip") {
    const clod = kind === "clod";
    const bodyKind = clod ? "clod" : "droplet";
    const segments = clod ? 3 : 2;
    for (let part = 0; part < segments; part += 1) {
      parts.push(addPixelSprite(parent, bodyKind, part % FRAMES, color));
    }
    pool = addPixelSprite(parent, clod ? "clod" : "pool", 0, color);
  }
  const mate = preset.hearts ? addPixelSprite(parent, "heart", 0, color) : null;
  const origin = motion === "drip"
    ? 0.24 + (spreadUnit(index, 1.3) * 0.52)
    : 0.22 + (spreadUnit(index, 2.7 + (count * 0.01)) * 0.56);
  return {
    sprite,
    mate,
    pool,
    parts,
    kind,
    color,
    origin,
    progress: hashUnit(index, 5.5),
    phase: hashUnit(index, 3.3) * Math.PI * 2,
    radius: preset.sparks ? 0.1 + (hashUnit(index, 10) * 0.14) : 0.16 + (hashUnit(index, 10) * 0.12),
    spin: (0.7 + (hashUnit(index, 7.7) * 1.15)) * ((hashUnit(index, 8.8) > 0.5) ? 1 : -1),
    speed: 0.32 + (hashUnit(index, 4.2) * 0.4),
    swayAmp: 0.025 + (hashUnit(index, 6.1) * 0.03),
    f1: 0.85 + (hashUnit(index, 8.4) * 1.55),
    f2: 2.35 + (hashUnit(index, 9.7) * 2.15),
    index
  };
}

/**
 * @param {PIXI.Container} parent
 * @param {StatusStyle} preset
 * @returns {StatusEmber[]}
 */
function addEmbers(parent, preset) {
  const embers = [];
  const color = mix(preset.color, 0xffffff, 0.35);
  for (let index = 0; index < 3; index += 1) {
    embers.push({
      sprite: addPixelSprite(parent, "ember", 0, color),
      color,
      origin: 0.2 + (spreadUnit(index, 4.4) * 0.6),
      progress: hashUnit(index, 2.2),
      phase: hashUnit(index, 1.1) * Math.PI * 2,
      speed: 0.55 + (hashUnit(index, 3.3) * 0.45)
    });
  }
  return embers;
}

/**
 * Pixi 7 constructor is Text(text, style). An options object becomes "[object Object]".
 * @param {{Text: new (text: string, style?: object) => PIXI.Text}} pixi
 * @param {string} text
 * @param {object} [style]
 * @returns {PIXI.Text}
 */
export function createGlyph(pixi, text, style) {
  return new pixi.Text(text, style);
}

/**
 * One texture per glyph and color. The overlay sprites point at it and are
 * destroyed with `texture: false`, so a rebuild does not leak the canvas.
 * @param {{Text: new (text: string, style?: object) => PIXI.Text}} pixi
 * @param {string} glyph
 * @param {number} color
 * @returns {PIXI.Texture}
 */
export function glyphTextureFor(pixi, glyph, color) {
  const key = `${glyph}\0${color}`;
  const cached = glyphSources.get(key);
  if (cached) return cached.texture;
  const source = createGlyph(pixi, glyph, {
    fill: color,
    fontFamily: "serif",
    fontWeight: "bold",
    fontSize: 32
  });
  if (typeof source.updateText === "function") source.updateText(true);
  glyphSources.set(key, source);
  return source.texture;
}

/**
 * @param {StatusStyle} preset
 * @returns {number}
 */
function glyphFill(preset) {
  if ((preset.accentMotion === "glyph") && (typeof preset.accent === "number")) return preset.accent;
  return preset.color;
}

/**
 * On-token letters are pixel bitmaps. `createGlyph` stays for the text-texture contract.
 * @param {PIXI.Container} parent
 * @param {StatusStyle} preset
 * @returns {StatusGlyph[]}
 */
function addPixelGlyphs(parent, preset) {
  const glyphs = [];
  const count = preset.accentMotion === "glyph" ? (preset.accentCount || 3) : 4;
  const kind = preset.glyph === "!" ? "bang" : "glyphZ";
  const color = glyphFill(preset);
  for (let index = 0; index < count; index += 1) {
    glyphs.push({
      sprite: addPixelSprite(parent, kind, 0, color),
      kind,
      color,
      lane: 0.22 + (((index + 0.5) / count) * 0.56),
      progress: index / count
    });
  }
  return glyphs;
}

/**
 * Photosensitive mode draws one still pixel cluster. No frame cycling, no moving particles, no pulsing alpha.
 * @param {StatusView} view
 * @param {{w: number, h: number, cx: number, cy: number}} box
 */
function holdStill(view, box) {
  for (const particle of view.particles) showParticle(particle, false);
  for (const glyph of view.glyphs) glyph.sprite.visible = false;
  for (const ember of view.embers) ember.sprite.visible = false;
  hideScene(view);
  if (view.gfx) view.gfx.visible = false;
  if (view.wash) view.wash.visible = false;
  if (!view.still) return;
  const y = view.preset.feet ? box.h * 0.8 : box.cy;
  const wide = view.preset.bar === true;
  let boost = view.preset.motion === "shimmer" ? 2 : 0;
  if (!wide) boost = Math.max(boost, overlayPresence(view.preset).scaleBoost);
  placePixel(
    view.still,
    box.cx,
    y,
    Math.min(box.w, box.h),
    clusterColor(view.preset),
    clusterKind(view.preset),
    0,
    0.85,
    boost,
    wide ? clothScale(box) : 0
  );
}

/**
 * @param {StatusView} view
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {boolean} [ring]
 */
function playView(view, box, seconds, ring) {
  if (view.still) view.still.visible = false;
  if (view.wash) placeWash(view.wash, box, view.preset, view.time || 0);
  // Graphics stay a secondary layer. A failed or invisible draw must not hide the sprites.
  if (view.gfx && !view.gfxFailed) {
    try {
      view.gfx.visible = true;
      drawGraphics(view, box, ring === true);
    } catch {
      view.gfxFailed = true;
      view.gfx.visible = false;
    }
  }
  for (const particle of view.particles) {
    showParticle(particle, true);
    stepParticle(particle, view.preset, box, seconds, view.time || 0, ring === true);
  }
  for (const glyph of view.glyphs) {
    glyph.sprite.visible = true;
    stepGlyph(glyph, view.preset, box, seconds, ring === true);
  }
  for (const ember of view.embers) {
    ember.sprite.visible = true;
    stepEmber(ember, box, seconds, view.time || 0, ring === true);
  }
  stepScene(view, box, seconds, ring === true);
}

/**
 * @param {StatusView | null | undefined} view
 */
function hideScene(view) {
  for (const item of view?.scene || []) {
    if (item?.sprite) item.sprite.visible = false;
  }
}

/**
 * Scene sprites are added after the Graphics child so they paint above it.
 * @param {PIXI.Container} parent
 * @param {StatusStyle} preset
 * @returns {StatusSceneSprite[]}
 */
function addSceneSprites(parent, preset) {
  const plan = overlaySpritePlan(preset);
  /** @type {Record<string, number>} */
  const roleCounts = {};
  for (const spec of plan.sprites) roleCounts[spec.role] = (roleCounts[spec.role] || 0) + 1;
  /** @type {Record<string, number>} */
  const seen = {};
  return plan.sprites.map((spec) => {
    const slot = seen[spec.role] || 0;
    seen[spec.role] = slot + 1;
    return {
      sprite: addPixelSprite(parent, spec.kind, 0, spec.color),
      kind: spec.kind,
      role: spec.role,
      slot,
      roleCount: roleCounts[spec.role],
      color: spec.color,
      scaleBoost: spec.scaleBoost || 0,
      wide: spec.wide === true,
      phase: hashUnit(slot, 2.2) * Math.PI * 2,
      progress: hashUnit(slot, 4.4)
    };
  });
}

/**
 * @param {StatusView} view
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {boolean} ring
 */
function stepScene(view, box, seconds, ring) {
  const time = view.time || 0;
  const span = Math.min(box.w, box.h);
  for (const item of view.scene || []) {
    const placed = scenePlacement(item, box, seconds, time, ring);
    const scaleOverride = item.wide ? clothScale(box) : 0;
    placePixel(
      item.sprite,
      placed.x,
      placed.y,
      span,
      item.color,
      item.kind,
      frameAt(time + item.phase, 4),
      placed.alpha,
      item.scaleBoost || 0,
      scaleOverride
    );
  }
}

/**
 * Cloth sprite width is `scale * 16`, aimed at about 70% of the token.
 * @param {{w: number}} box
 * @returns {number}
 */
function clothScale(box) {
  return Math.max(2, Math.round((box.w * 0.7) / PIXEL));
}

/**
 * @param {{w: number, h: number}} box
 * @param {boolean} ring
 * @returns {number}
 */
function eyeBandCenter(box, ring) {
  const barH = Math.max(8, box.h * 0.2);
  const top = box.h * (ring ? 0.36 : 0.32);
  return top + (barH / 2);
}

/**
 * @param {number} x
 * @param {number} y
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {boolean} ring
 * @returns {{x: number, y: number}}
 */
function settleOnPortrait(x, y, box, ring) {
  const clampedX = clamp(x, box.w * 0.12, box.w * 0.88);
  const clampedY = clamp(y, box.h * 0.12, box.h * 0.88);
  return placeOnPortrait(clampedX, clampedY, box, ring);
}

/**
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function scenePlacement(item, box, seconds, time, ring) {
  if (item.role === "rope") return placeRopeSprite(item, box, time, ring);
  if (item.role === "chain") return placeChainSprite(item, box, time, ring);
  if (item.role === "crack") return placeCrackSprite(item, box, time, ring);
  if (item.role === "cloth") return placeClothSprite(box, ring);
  if (item.role === "stitch") return placeStitchSprite(item, box, time, ring);
  if (item.role === "eye") return placeEyeSprite(item, box, ring);
  if (item.role === "halo") return placeHaloSprite(item, box, time, ring);
  if (item.role === "drop") return placeDropSprite(item, box, seconds, time, ring);
  if (item.role === "block") return placeArcBlock(item, box, time, ring);
  if (item.role === "cross") return placeCrossSprite(item, box, time, ring);
  if (item.role === "ring") return placeDeadRingSprite(item, box, seconds, time, ring);
  return placePadMote(item, box, seconds, time, ring);
}

/**
 * Same bent paths as the rope Graphics. `u` crawls so the links travel the rope.
 * @param {number} rope
 * @param {number} u
 * @param {{w: number, h: number}} box
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number}}
 */
function ropeAnchor(rope, u, box, time, ring) {
  const y0 = ring ? 0.30 : 0.18;
  const yStep = ring ? 0.10 : 0.15;
  const tiltMag = ring ? 0.02 : 0.05;
  const x0 = ring ? 0.26 : 0.08;
  const x1 = ring ? 0.74 : 0.92;
  const yBase = box.h * (y0 + (rope * yStep));
  const tilt = box.h * tiltMag * ((rope % 2 === 0) ? 1 : -1);
  const x = (box.w * x0) + ((box.w * (x1 - x0)) * u);
  const y = yBase + (tilt * u) + bendOffset(u, rope, time, Math.min(box.w, box.h), ring);
  return {x, y};
}

/**
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placeRopeSprite(item, box, time, ring) {
  const ropes = 5;
  const rope = item.slot % ropes;
  const u = wrap01((item.slot * 0.17) + (time * 0.12));
  const point = ropeAnchor(rope, u, box, time, ring);
  const placed = settleOnPortrait(point.x, point.y, box, ring);
  return {x: placed.x, y: placed.y, alpha: 0.92};
}

/**
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placeChainSprite(item, box, time, ring) {
  const rows = 4;
  const row = item.slot % rows;
  const col = Math.floor(item.slot / rows);
  const cols = Math.max(1, Math.ceil(item.roleCount / rows));
  const shift = wrap01(time * 0.2);
  const xFrac = 0.12 + (wrap01(((col + 0.5) / cols) + shift) * 0.76);
  const y0 = ring ? 0.30 : 0.22;
  const yStep = ring ? 0.12 : 0.16;
  const yFrac = clamp(y0 + (row * yStep), 0.12, 0.88);
  const placed = settleOnPortrait(box.w * xFrac, box.h * yFrac, box, ring);
  return {x: placed.x, y: placed.y, alpha: 0.9};
}

/** Scattered crack centers, kept inside the 12%–88% portrait band. */
const CRACK_SPOTS = [
  [0.28, 0.30],
  [0.50, 0.34],
  [0.66, 0.46],
  [0.36, 0.58],
  [0.58, 0.66],
  [0.34, 0.76]
];

/**
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placeCrackSprite(item, box, time, ring) {
  const spot = CRACK_SPOTS[item.slot % CRACK_SPOTS.length];
  const placed = settleOnPortrait(box.w * spot[0], box.h * spot[1], box, ring);
  const beat = Math.floor(Math.abs(time * 2)) % Math.max(1, item.roleCount);
  const pulse = 0.62 + (0.28 * (0.5 + (0.5 * Math.sin(time * 1.4))));
  const alpha = item.slot === beat ? Math.min(1, pulse + 0.28) : pulse;
  return {x: placed.x, y: placed.y, alpha};
}

/**
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placeClothSprite(box, ring) {
  const placed = settleOnPortrait(box.cx, eyeBandCenter(box, ring), box, ring);
  return {x: placed.x, y: placed.y, alpha: 0.92};
}

/**
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placeStitchSprite(item, box, time, ring) {
  const count = Math.max(1, item.roleCount);
  const shift = wrap01(time * 0.25);
  const xFrac = 0.16 + (wrap01((item.slot / count) + shift) * 0.68);
  const placed = settleOnPortrait(box.w * xFrac, eyeBandCenter(box, ring), box, ring);
  return {x: placed.x, y: placed.y, alpha: 0.95};
}

/**
 * One shut eye on each side of the blindfold. The centers stay on the eye line.
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placeEyeSprite(item, box, ring) {
  const side = (item.slot % 2) === 0 ? -1 : 1;
  const x = box.cx + (side * box.w * (ring ? 0.16 : 0.22));
  const placed = settleOnPortrait(x, eyeBandCenter(box, ring), box, ring);
  return {x: placed.x, y: placed.y, alpha: 0.96};
}

/**
 * Cyan blocks around the portrait, outside the orbiting shards.
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placeHaloSprite(item, box, time, ring) {
  const count = Math.max(3, item.roleCount);
  const angle = ((item.slot / count) * Math.PI * 2) + (time * 0.12);
  const span = Math.min(box.w, box.h);
  const radius = ring ? span * 0.30 : span * 0.38;
  const placed = settleOnPortrait(
    box.cx + (Math.cos(angle) * radius),
    box.cy + (Math.sin(angle) * radius),
    box,
    ring
  );
  const alpha = 0.78 + (0.16 * (0.5 + (0.5 * Math.sin((time * 1.6) + item.slot))));
  return {x: placed.x, y: placed.y, alpha};
}

/**
 * One falling teardrop. The bubbles keep rising on their own.
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placeDropSprite(item, box, seconds, time, ring) {
  item.progress = wrap01(item.progress + (seconds * 0.28));
  let x = box.w * (0.58 + (Math.sin(time * 0.8) * 0.04));
  x = clamp(x, box.w * 0.2, box.w * 0.8);
  x = clampXToRing(x, box, ring);
  const band = dripBand(box, x, ring);
  const y = (band.top + (item.progress * (band.bottom - band.top))) * box.h;
  const placed = placeOnPortrait(x, y, box, ring);
  const alpha = 0.72 + (0.22 * Math.sin(item.progress * Math.PI));
  return {x: placed.x, y: placed.y, alpha};
}

/**
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placeArcBlock(item, box, time, ring) {
  const start = Math.PI * 0.62;
  const end = Math.PI * 1.38;
  const count = Math.max(2, item.roleCount);
  const angle = start + ((end - start) * (item.slot / (count - 1)));
  const span = Math.min(box.w, box.h);
  const wanted = ring
    ? Math.min(span * 0.36, Math.max(1, (span * RING_MASK_RADIUS) - 6))
    : span * 0.44;
  const radius = Math.min(wanted, (box.h * 0.38) / 0.93, (box.w * 0.38) / 0.37);
  const placed = settleOnPortrait(
    box.cx + (Math.cos(angle) * radius),
    box.cy + (Math.sin(angle) * radius),
    box,
    ring
  );
  const alpha = clamp(0.58 + (0.36 * arcPulse(time)), 0.22, 1);
  return {x: placed.x, y: placed.y, alpha};
}

/**
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placeCrossSprite(item, box, time, ring) {
  const span = Math.min(box.w, box.h);
  const arm = span * 0.22;
  const offsets = [
    [0, 0],
    [-arm, 0],
    [arm, 0],
    [0, -arm],
    [0, arm]
  ];
  const offset = offsets[item.slot % offsets.length];
  const placed = settleOnPortrait(box.cx + offset[0], box.cy + offset[1], box, ring);
  const alpha = 0.72 + (0.23 * (0.5 + (0.5 * Math.sin((time * 2.4) + (item.slot * 0.4)))));
  return {x: placed.x, y: placed.y, alpha};
}

/**
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placeDeadRingSprite(item, box, seconds, time, ring) {
  const span = Math.min(box.w, box.h);
  const speed = 0.45 + ((item.slot % 5) * 0.08);
  const direction = (item.slot % 2 === 0) ? 1 : -1;
  item.phase += seconds * speed * direction;
  const radial = Math.min(ORBIT_LIMIT, 0.16 + ((item.slot % 4) * 0.045));
  const rx = span * radial;
  const ry = rx * (ring ? 0.9 : 0.82);
  const placed = settleOnPortrait(
    box.cx + (Math.cos(item.phase) * rx),
    box.cy + (Math.sin(item.phase) * ry),
    box,
    ring
  );
  const alpha = 0.7 + (0.25 * (0.5 + (0.5 * Math.sin((time * 1.3) + item.phase))));
  return {x: placed.x, y: placed.y, alpha};
}

/**
 * @param {StatusSceneSprite} item
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {number} time
 * @param {boolean} ring
 * @returns {{x: number, y: number, alpha: number}}
 */
function placePadMote(item, box, seconds, time, ring) {
  item.progress = wrap01(item.progress + (seconds * 0.22 * (0.65 + ((item.slot % 5) * 0.07))));
  const sway = Math.sin((time * 1.3) + item.phase) * 0.04;
  let x = (0.2 + ((item.slot * 0.17) % 0.6) + sway) * box.w;
  x = clamp(x, box.w * 0.12, box.w * 0.88);
  x = clampXToRing(x, box, ring);
  let top = 0.18;
  let bottom = 0.82;
  if (ring) {
    const band = ringBand(x, box);
    top = Math.max(top, band.top);
    bottom = Math.min(bottom, band.bottom);
    if (bottom < top) {
      top = band.top;
      bottom = band.bottom;
    }
  }
  const y = (top + (item.progress * (bottom - top))) * box.h;
  const placed = settleOnPortrait(x, y, box, ring);
  const alpha = 0.75 + (0.2 * (0.5 + (0.5 * Math.sin((time * 1.6) + item.phase))));
  return {x: placed.x, y: placed.y, alpha};
}

/**
 * @param {StatusStyle} preset
 * @param {number} time
 * @returns {number}
 */
function washAlpha(preset, time) {
  if (wantsSolidTint(preset)) {
    const wobble = Math.sin(time * (preset.shake ? 9 : 0.8)) * 0.03;
    return clamp(0.5 + wobble, 0.45, 0.55);
  }
  const base = Math.max(preset.alpha ?? 0.4, 0.4);
  if (preset.still) return base;
  if (preset.shake) return clamp(base + (Math.sin(time * 9) * 0.06), 0.34, 0.6);
  const speed = (preset.slow || (preset.motion === "veil")) ? 0.7 : 1.2;
  return clamp(base + (Math.sin(time * speed) * 0.06), 0.34, 0.62);
}

/**
 * @param {PIXI.Sprite} sprite
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {StatusStyle} preset
 * @param {number} time
 */
function placeWash(sprite, box, preset, time) {
  const scale = Math.max(2, Math.ceil(Math.max(box.w, box.h) / PIXEL));
  const kind = wantsSolidTint(preset) ? "tint" : "wash";
  sprite.texture = pixelTexture(kind, frameAt(time, 2), preset.color);
  sprite.scale.set(scale);
  sprite.position.set(Math.round(box.cx), Math.round(box.cy));
  sprite.rotation = 0;
  sprite.alpha = washAlpha(preset, time);
  sprite.visible = true;
}

/**
 * Sine shared by the shield alpha and the redraw key. A new value redraws inside the old third-of-a-second bucket.
 * @param {number} time
 * @returns {number}
 */
export function arcPulse(time) {
  return Math.sin((time || 0) * 1.8);
}

/**
 * Arcs breathe with `arcPulse`. The same box and the same sine skip the redraw.
 * @param {StatusView} view
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {boolean} [ring] Dynamic-ring portrait. Omitted keeps the square-token geometry.
 */
export function drawGraphics(view, box, ring) {
  const gfx = view.gfx;
  if (!gfx) return;
  const dynamicRing = ring === true;
  if (view.preset.motion === "arc") {
    const key = `${box.w}\0${box.h}\0${arcPulse(view.time)}\0${dynamicRing ? 1 : 0}`;
    if (view.gfxBox === key) return;
    drawStatusGraphics(gfx, view.preset, box, view.time || 0, dynamicRing);
    view.gfxBox = key;
    return;
  }
  drawStatusGraphics(gfx, view.preset, box, view.time || 0, dynamicRing);
}

/**
 * Pixi 7 Graphics. Foundry 14 has no `rect`, `circle`, or `stroke`.
 * @param {PIXI.Graphics} gfx
 * @param {StatusStyle} preset
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} time
 * @param {boolean} [ring] Dynamic-ring portrait. Omitted keeps the square-token geometry.
 */
export function drawStatusGraphics(gfx, preset, box, time, ring) {
  gfx.clear();
  const color = preset.color;
  const span = Math.min(box.w, box.h);
  const dynamicRing = ring === true;
  const light = mix(color, 0xffffff, 0.55);
  const dark = mix(color, 0x000000, 0.45);

  if (preset.motion === "lines") {
    if (preset.bar) {
      drawBlindfold(gfx, box, color, dark, light, time, dynamicRing);
      return;
    }
    if (preset.bent) {
      drawBentRopes(gfx, box, time, span, color, light, dynamicRing);
      return;
    }
    if (preset === STYLES.petrified) {
      drawCracks(gfx, box, time, color, light);
      return;
    }
    drawStraightChains(gfx, box, time, color, light, dynamicRing);
    return;
  }

  if (preset.motion === "shimmer") {
    drawBlockRing(gfx, preset, box, time, span, dynamicRing);
    return;
  }

  if (preset.motion === "arc") {
    drawPixelArc(gfx, preset, box, time, span, dynamicRing);
    return;
  }

  if (preset.motion === "mark") {
    drawCrosshair(gfx, box, color, time, span);
    return;
  }

  if (preset.ring) drawShrinkRing(gfx, box, color, time, span, dynamicRing);
  if (preset.accentMotion === "ring") drawDeadRing(gfx, box, color, time, span, dynamicRing);
  if (preset.feet) drawFeetBand(gfx, box, color);
}

/**
 * @param {PIXI.Graphics} gfx
 */
function cutStroke(gfx) {
  gfx.lineStyle({width: 0, alpha: 0});
}

/**
 * A wide filled cloth band, with a darker fold and marching stitches.
 * @param {PIXI.Graphics} gfx
 * @param {{w: number, h: number}} box
 * @param {number} color
 * @param {number} dark
 * @param {number} light
 * @param {number} time
 * @param {boolean} ring
 */
function drawBlindfold(gfx, box, color, dark, light, time, ring) {
  const barH = Math.max(8, Math.round(box.h * 0.2));
  const y = Math.round(box.h * (ring ? 0.36 : 0.32));
  const x = Math.round(box.w * (ring ? 0.16 : 0.06));
  const w = Math.round(box.w * (ring ? 0.68 : 0.88));
  gfx.beginFill(color, 0.9);
  gfx.drawRect(x, y, w, barH);
  gfx.endFill();
  gfx.beginFill(dark, 0.5);
  gfx.drawRect(x, y + barH - 3, w, 3);
  gfx.endFill();
  gfx.beginFill(light, 0.85);
  const offset = Math.floor(time * 8) % 6;
  for (let stitch = x + offset; stitch < (x + w - 2); stitch += 6) {
    gfx.drawRect(stitch, y + 2, 2, 2);
  }
  gfx.endFill();
}

/**
 * Five ropes. Each rope is a chain of pixel links along the bent path. Link size grows with the token.
 * @param {PIXI.Graphics} gfx
 * @param {{w: number, h: number}} box
 * @param {number} time
 * @param {number} span
 * @param {number} color
 * @param {number} light
 * @param {boolean} ring
 */
function drawBentRopes(gfx, box, time, span, color, light, ring) {
  const ropes = 5;
  const linksPerRope = 8;
  const y0 = ring ? 0.30 : 0.18;
  const yStep = ring ? 0.10 : 0.15;
  const tiltMag = ring ? 0.02 : 0.05;
  const x0 = ring ? 0.26 : 0.08;
  const x1 = ring ? 0.74 : 0.92;
  const linkSize = 2 * pixelScale(span);
  const half = linkSize / 2;
  /** @type {{x: number, y: number, shine: boolean}[]} */
  const links = [];
  for (let index = 0; index < ropes; index += 1) {
    const yBase = box.h * (y0 + (index * yStep));
    const tilt = box.h * tiltMag * ((index % 2 === 0) ? 1 : -1);
    const xStart = box.w * x0;
    const xEnd = box.w * x1;
    for (let step = 0; step < linksPerRope; step += 1) {
      const u = step / (linksPerRope - 1);
      const x = xStart + ((xEnd - xStart) * u);
      const y = yBase + (tilt * u) + bendOffset(u, index, time, span, ring);
      links.push({
        x: Math.round(x - half),
        y: Math.round(y - half),
        shine: (step % 2) === 0
      });
    }
  }
  gfx.beginFill(color, 0.92);
  for (const link of links) {
    if (!link.shine) gfx.drawRect(link.x, link.y, linkSize, linkSize);
  }
  gfx.endFill();
  gfx.beginFill(light, 0.9);
  for (const link of links) {
    if (link.shine) gfx.drawRect(link.x, link.y, linkSize, linkSize);
  }
  gfx.endFill();
}

/**
 * @param {number} u
 * @param {number} index
 * @param {number} time
 * @param {number} span
 * @param {boolean} ring
 * @returns {number}
 */
function bendOffset(u, index, time, span, ring) {
  const primary = ring ? 0.03 : 0.07;
  const secondary = ring ? 0.012 : 0.03;
  return (Math.sin((u * Math.PI * 2) + (time * 1.2) + (index * 0.85)) * span * primary)
    + (Math.sin((u * Math.PI * 3.5) + (index * 1.4)) * span * secondary);
}

/**
 * Straighter chains than the grapple ropes. Links march along the line.
 * @param {PIXI.Graphics} gfx
 * @param {{w: number, h: number}} box
 * @param {number} time
 * @param {number} color
 * @param {number} light
 * @param {boolean} ring
 */
function drawStraightChains(gfx, box, time, color, light, ring) {
  const chains = 4;
  const y0 = ring ? 0.30 : 0.22;
  const yStep = ring ? 0.12 : 0.16;
  const x0 = ring ? 0.22 : 0.1;
  const x1 = ring ? 0.78 : 0.9;
  const shift = Math.floor(time * 5) % 5;
  const scale = pixelScale(Math.min(box.w, box.h));
  const linkW = 3 * scale;
  const linkH = 2 * scale;
  gfx.beginFill(color, 0.9);
  for (let index = 0; index < chains; index += 1) {
    const y = Math.round(box.h * (y0 + (index * yStep)));
    const left = box.w * x0;
    const right = box.w * x1;
    for (let x = left + shift; x <= right; x += 6) gfx.drawRect(Math.round(x), y, linkW, linkH);
  }
  gfx.endFill();
  gfx.beginFill(light, 0.85);
  for (let index = 0; index < chains; index += 1) {
    const y = Math.round(box.h * (y0 + (index * yStep)));
    gfx.drawRect(Math.round(box.w * x0) + shift, y, linkW, linkH);
  }
  gfx.endFill();
}

/**
 * Short gray crack ticks. One tick is picked out in the highlight each beat.
 * @param {PIXI.Graphics} gfx
 * @param {{w: number, h: number}} box
 * @param {number} time
 * @param {number} color
 * @param {number} light
 */
function drawCracks(gfx, box, time, color, light) {
  const scale = pixelScale(Math.min(box.w, box.h));
  const ticks = [
    [0.28, 0.26, 12, 2],
    [0.46, 0.30, 2, 14],
    [0.50, 0.46, 16, 2],
    [0.36, 0.58, 2, 12],
    [0.58, 0.62, 10, 2],
    [0.32, 0.74, 14, 2],
    [0.62, 0.40, 2, 8]
  ];
  const alpha = 0.78 + (Math.sin(time * 1.4) * 0.12);
  gfx.beginFill(color, alpha);
  for (const [fx, fy, w, h] of ticks) {
    gfx.drawRect(Math.round(box.w * fx), Math.round(box.h * fy), w * scale, h * scale);
  }
  gfx.endFill();
  const lit = ticks[Math.floor(Math.abs(time * 2)) % ticks.length];
  gfx.beginFill(light, 0.9);
  gfx.drawRect(Math.round(box.w * lit[0]), Math.round(box.h * lit[1]), lit[2] * scale, lit[3] * scale);
  gfx.endFill();
}

/**
 * Separated pixel blocks on a ring. Alpha and which blocks are lit change with time.
 * @param {PIXI.Graphics} gfx
 * @param {StatusStyle} preset
 * @param {{cx: number, cy: number}} box
 * @param {number} time
 * @param {number} span
 * @param {boolean} ring
 */
function drawBlockRing(gfx, preset, box, time, span, ring) {
  const radius = ring ? span * 0.34 : span * 0.42;
  const count = 14;
  const size = 4;
  const alpha = 0.62 + (0.28 * Math.sin(time * 1.5));
  const spin = Math.floor(time * 2);
  const light = mix(preset.color, 0xffffff, 0.55);
  for (let index = 0; index < count; index += 1) {
    if (((index + spin) % 5) === 0) continue;
    const angle = ((index + (spin * 0.15)) / count) * Math.PI * 2;
    const x = Math.round(box.cx + (Math.cos(angle) * radius) - (size / 2));
    const y = Math.round(box.cy + (Math.sin(angle) * radius) - (size / 2));
    const color = ((index % 4) === (spin % 4)) ? light : preset.color;
    gfx.beginFill(color, alpha);
    gfx.drawRect(x, y, size, size);
    gfx.endFill();
  }
  if (preset.color !== 0xa8dadc) return;
  gfx.beginFill(light, Math.max(0.7, alpha));
  const crystals = [[-0.1, -0.06, 3, 5], [0.08, 0.1, 5, 3], [0.0, 0.16, 3, 4]];
  for (const [fx, fy, w, h] of crystals) {
    gfx.drawRect(Math.round(box.cx + (span * fx)), Math.round(box.cy + (span * fy)), w, h);
  }
  gfx.endFill();
}

/**
 * Pixel blocks along the shield arc. Weight makes the blocks thicker. Alpha breathes.
 * @param {PIXI.Graphics} gfx
 * @param {StatusStyle} preset
 * @param {{cx: number, cy: number}} box
 * @param {number} time
 * @param {number} span
 * @param {boolean} ring
 */
function drawPixelArc(gfx, preset, box, time, span, ring) {
  const weight = preset.weight ?? 2;
  const start = Math.PI * 0.62;
  const end = Math.PI * 1.38;
  const radius = ring
    ? Math.min(span * 0.36, Math.max(1, (span * RING_MASK_RADIUS) - 6))
    : span * 0.44;
  const size = (2 + ((weight - 1) * 2)) * pixelScale(span);
  const count = 9;
  const breathe = 0.58 + (0.36 * arcPulse(time));
  for (let index = 0; index < count; index += 1) {
    const angle = start + ((end - start) * (index / (count - 1)));
    const x = Math.round(box.cx + (Math.cos(angle) * radius) - (size / 2));
    const y = Math.round(box.cy + (Math.sin(angle) * radius) - (size / 2));
    gfx.beginFill(preset.color, breathe);
    gfx.drawRect(x, y, size, size);
    gfx.endFill();
  }
}

/**
 * A thick pixel crosshair. The stroke is wide enough to read, and the nodes are blocks.
 * @param {PIXI.Graphics} gfx
 * @param {{cx: number, cy: number}} box
 * @param {number} color
 * @param {number} time
 * @param {number} span
 */
function drawCrosshair(gfx, box, color, time, span) {
  const alpha = 0.82 + (0.12 * Math.sin(time * 2.4));
  const arm = Math.max(10, Math.round(span * 0.22));
  const thick = Math.max(4, Math.round(span * 0.06));
  const light = mix(color, 0xffffff, 0.45);
  gfx.lineStyle({width: thick, color, alpha});
  gfx.moveTo(box.cx - arm, box.cy);
  gfx.lineTo(box.cx + arm, box.cy);
  gfx.moveTo(box.cx, box.cy - arm);
  gfx.lineTo(box.cx, box.cy + arm);
  cutStroke(gfx);
  gfx.beginFill(color, alpha);
  gfx.drawRect(Math.round(box.cx - arm), Math.round(box.cy - (thick / 2)), arm * 2, thick);
  gfx.drawRect(Math.round(box.cx - (thick / 2)), Math.round(box.cy - arm), thick, arm * 2);
  gfx.endFill();
  gfx.beginFill(light, 0.95);
  gfx.drawRect(Math.round(box.cx - (thick / 2)), Math.round(box.cy - (thick / 2)), thick, thick);
  gfx.endFill();
}

/**
 * Shrinking ring. The circle radius and the pixel blocks on it both change with time.
 * @param {PIXI.Graphics} gfx
 * @param {{cx: number, cy: number}} box
 * @param {number} color
 * @param {number} time
 * @param {number} span
 * @param {boolean} ring
 */
function drawShrinkRing(gfx, box, color, time, span, ring) {
  const cycle = (time % 1.8) / 1.8;
  const radius = ring
    ? Math.max(2, span * (RING_STROKE_RADIUS - (cycle * 0.24)))
    : Math.max(2, span * (0.46 - (cycle * 0.32)));
  const alpha = Math.min(0.9, (0.72 * (1 - cycle)) + 0.18);
  const width = Math.max(4, Math.round(span * 0.045));
  gfx.lineStyle({width, color, alpha});
  gfx.drawCircle(box.cx, box.cy, radius);
  cutStroke(gfx);
  const size = 4;
  const count = 12;
  gfx.beginFill(mix(color, 0xffffff, 0.4), Math.max(0.7, alpha));
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    gfx.drawRect(
      Math.round(box.cx + (Math.cos(angle) * radius) - (size / 2)),
      Math.round(box.cy + (Math.sin(angle) * radius) - (size / 2)),
      size,
      size
    );
  }
  gfx.endFill();
}

/**
 * A thick dark ring plus pixel ticks. The pulse stays slow and the stroke stays visible.
 * @param {PIXI.Graphics} gfx
 * @param {{cx: number, cy: number}} box
 * @param {number} color
 * @param {number} time
 * @param {number} span
 * @param {boolean} ring
 */
function drawDeadRing(gfx, box, color, time, span, ring) {
  const radius = span * (ring ? 0.34 : 0.4);
  const width = Math.max(4, span * 0.062);
  const alpha = 0.78 + (Math.sin(time * 0.65) * 0.12);
  gfx.lineStyle({width, color, alpha});
  gfx.drawCircle(box.cx, box.cy, radius);
  cutStroke(gfx);
  const tick = Math.max(3, Math.round(width * 0.5));
  const light = rimColor(color);
  gfx.beginFill(light, 0.9);
  const ticks = 12;
  for (let index = 0; index < ticks; index += 1) {
    const angle = (index / ticks) * Math.PI * 2;
    gfx.drawRect(
      Math.round(box.cx + (Math.cos(angle) * radius) - (tick / 2)),
      Math.round(box.cy + (Math.sin(angle) * radius) - (tick / 2)),
      tick,
      tick
    );
  }
  gfx.endFill();
  const rim = ring
    ? Math.min(span * RING_STROKE_RADIUS, radius + (width * 0.35))
    : radius + (width * 0.35);
  gfx.lineStyle({
    width: Math.max(2, span * 0.02),
    color: light,
    alpha: 0.82
  });
  gfx.arc(box.cx, box.cy, rim, 0, Math.PI * 2);
}

/**
 * @param {number} color
 * @returns {number}
 */
function rimColor(color) {
  const r = Math.min(255, ((color >> 16) & 255) + 96);
  const g = Math.min(255, ((color >> 8) & 255) + 40);
  const b = Math.min(255, (color & 255) + 40);
  return (r << 16) | (g << 8) | b;
}

/**
 * @param {PIXI.Graphics} gfx
 * @param {{w: number, h: number}} box
 * @param {number} color
 */
function drawFeetBand(gfx, box, color) {
  const bandH = Math.max(6, Math.round(box.h * 0.14));
  const y = Math.round(box.h * 0.78);
  const x = Math.round(box.w * 0.08);
  const w = Math.round(box.w * 0.84);
  gfx.beginFill(color, 0.82);
  gfx.drawRect(x, y, w, bandH);
  gfx.endFill();
  gfx.beginFill(mix(color, 0xffffff, 0.35), 0.7);
  gfx.drawRect(x, y, w, 2);
  gfx.endFill();
}

/**
 * @param {StatusParticle} particle
 * @param {StatusStyle} preset
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {number} time
 * @param {boolean} ring
 */
function stepParticle(particle, preset, box, seconds, time, ring) {
  const motion = particleMotion(preset);
  if (motion === "drip") {
    stepDrip(particle, preset, box, seconds, time, ring);
    return;
  }
  if (motion === "rise") {
    stepRise(particle, preset, box, seconds, time, ring);
    return;
  }
  if (motion === "orbit") {
    stepOrbit(particle, preset, box, seconds, time, ring);
    return;
  }
  if (motion === "streak") {
    stepStreak(particle, preset, box, seconds, time, ring);
    return;
  }
  if (motion === "wisp") {
    stepWisp(particle, preset, box, time, ring);
    return;
  }
  if (motion === "shimmer") {
    stepShimmerMote(particle, preset, box, seconds, time, ring);
    return;
  }
  if ((motion === "mote") || (motion === "veil")) stepMote(particle, preset, box, seconds, time, ring);
}

/**
 * @param {StatusStyle} preset
 * @returns {number}
 */
function dripRate(preset) {
  const slow = preset.slow ? 0.45 : 1;
  const pace = (typeof preset.pace === "number") ? preset.pace : 1;
  return slow * pace;
}

/**
 * Drip run as fractions of the token height. A square portrait stays in the 8%–86% band.
 * A ring shortens that run to the chord at `x`.
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} x
 * @param {boolean} ring
 * @returns {{top: number, bottom: number}}
 */
export function dripBand(box, x, ring) {
  let top = 0.08;
  let bottom = 0.86;
  if (!ring) return {top, bottom};
  const band = ringBand(x, box);
  top = Math.max(top, band.top);
  bottom = Math.min(bottom, band.bottom);
  if (bottom < top) return {top: band.top, bottom: band.bottom};
  return {top, bottom};
}

/**
 * Several drops. Each has its own origin, speed, and sway, a teardrop head, and a pool at the portrait's bottom.
 * Liquid trails are at most two small droplets just above the head. Burrow keeps clods.
 * @param {StatusParticle} particle
 * @param {StatusStyle} preset
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {number} time
 * @param {boolean} ring
 */
function stepDrip(particle, preset, box, seconds, time, ring) {
  const rate = dripRate(preset);
  particle.progress = wrap01(particle.progress + (seconds * particle.speed * rate));
  const t = particle.progress;
  const fall = 1 - ((1 - t) * (1 - t));
  let x = (particle.origin
    + (Math.sin((time * particle.f1) + particle.phase) * particle.swayAmp)
    + (Math.sin((time * particle.f2) + (particle.phase * 1.7)) * particle.swayAmp * 0.35)) * box.w;
  x = clamp(x, box.w * 0.12, box.w * 0.88);
  x = clampXToRing(x, box, ring);
  const band = dripBand(box, x, ring);
  const headY = (band.top + (fall * (band.bottom - band.top))) * box.h;
  const span = Math.min(box.w, box.h);
  const scale = pixelScale(span);
  const frame = frameAt(time + particle.phase, 5);
  let alpha = 0.92;
  if (t < 0.08) alpha *= t / 0.08;
  let poolAlpha = 0;
  if (t > 0.74) {
    const splat = (t - 0.74) / 0.26;
    alpha *= 1 - splat;
    poolAlpha = Math.sin(Math.min(1, splat) * Math.PI) * 0.88;
  }
  const clod = particle.kind === "clod";
  const headKind = clod ? "clod" : "dripHead";
  const bodyKind = clod ? "clod" : "droplet";
  const placed = placeOnPortrait(x, headY, box, ring);
  placePixel(particle.sprite, placed.x, placed.y, span, particle.color, headKind, frame, Math.max(0, alpha));
  const step = clod ? (3 * scale) : (5 * scale);
  const lead = clod ? step : (8 * scale);
  for (let index = 0; index < particle.parts.length; index += 1) {
    const segment = placeDripSegment(x, headY - lead - (index * step), box, ring, band.top);
    const bodyAlpha = segment.visible ? Math.max(0, alpha * (0.85 - (index * 0.12))) : 0;
    placePixel(
      particle.parts[index],
      segment.x,
      segment.y,
      span,
      particle.color,
      bodyKind,
      (frame + index) % FRAMES,
      bodyAlpha
    );
  }
  if (!particle.pool) return;
  const poolPlaced = placeOnPortrait(x, band.bottom * box.h, box, ring);
  const poolKind = particle.kind === "clod" ? "clod" : "pool";
  const poolFrame = Math.min(FRAMES - 1, Math.floor((poolAlpha / 0.88) * FRAMES));
  placePixel(
    particle.pool,
    poolPlaced.x,
    poolPlaced.y,
    span,
    particle.color,
    poolKind,
    poolFrame,
    poolAlpha,
    poolAlpha > 0.55 ? 1 : 0
  );
}

/**
 * @param {StatusParticle} particle
 * @param {StatusStyle} preset
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {number} time
 * @param {boolean} ring
 */
function stepRise(particle, preset, box, seconds, time, ring) {
  const slow = preset.slow ? 0.45 : 1;
  let pace = 0.42;
  if (preset.flames) pace = 0.5;
  else if (preset.bubbles) pace = 0.38;
  else if (preset.hearts) pace = 0.36;
  particle.progress = wrap01(particle.progress + (seconds * pace * slow));
  const sway = preset.bubbles ? 0.045 : 0.04;
  let x = (particle.origin
    + (Math.sin((time * particle.f1) + particle.phase) * sway)
    + (Math.sin((time * particle.f2) + particle.phase) * sway * 0.3)) * box.w;
  x = clamp(x, box.w * 0.12, box.w * 0.88);
  x = clampXToRing(x, box, ring);
  const band = dripBand(box, x, ring);
  let y = (band.bottom - (particle.progress * (band.bottom - band.top))) * box.h;
  const life = Math.sin(particle.progress * Math.PI);
  const span = Math.min(box.w, box.h);
  const frame = frameAt(time + particle.phase, preset.flames ? 8 : 4);
  let alpha = 0.78 + (0.17 * life);
  if (preset.flames) {
    const flicker = 0.5 + (0.5 * Math.sin((time * 10) + particle.phase));
    alpha = 0.72 + (0.23 * flicker);
  } else if (preset.slow) {
    alpha = 0.7 + (0.08 * life);
  } else if (preset.hearts) {
    alpha = 0.8 + (0.15 * Math.abs(Math.sin((time * 4) + particle.phase)));
    y += Math.sin((time * 4.4) + particle.phase) * box.h * 0.02;
  }
  const placed = placeOnPortrait(x, y, box, ring);
  const boost = particleScaleBoost(preset);
  placePixel(particle.sprite, placed.x, placed.y, span, particle.color, particle.kind, frame, alpha, boost);
  if (particle.mate) placeMate(particle, box, ring, span, frame, boost);
}

/**
 * Two pixel hearts, separated by a gap so they do not stack into one blob.
 * @param {StatusParticle} particle
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {boolean} ring
 * @param {number} span
 * @param {number} frame
 * @param {number} boost
 */
function placeMate(particle, box, ring, span, frame, boost) {
  const mate = particle.mate;
  if (!mate) return;
  const gap = 13 * (pixelScale(span) + boost);
  const placed = placeOnPortrait(particle.sprite.x + gap, particle.sprite.y, box, ring);
  placePixel(mate, placed.x, placed.y, span, particle.color, "heart", frame, particle.sprite.alpha, boost);
}

/**
 * @param {StatusParticle} particle
 * @param {StatusStyle} preset
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {number} time
 * @param {boolean} ring
 */
function stepOrbit(particle, preset, box, seconds, time, ring) {
  const spark = preset.sparks === true;
  const paralyzed = (preset.color === 0x4cc9f0) && !spark;
  const pace = paralyzed ? 0.35 : spark ? 1.2 : 0.8;
  particle.phase += seconds * particle.spin * pace;
  const span = Math.min(box.w, box.h);
  const wobble = 1 + (Math.sin((time * (spark ? 3 : 1.6)) + particle.phase) * (spark ? 0.2 : 0.1));
  const radial = Math.min(ORBIT_LIMIT, particle.radius * wobble);
  const rx = span * radial;
  const ry = rx * 0.62;
  const placed = placeOnPortrait(
    box.cx + (Math.cos(particle.phase) * rx),
    box.cy + (Math.sin(particle.phase) * ry),
    box,
    ring
  );
  const frame = frameAt(time + particle.phase, spark ? 8 : 4);
  let alpha = 0.55 + (0.4 * (0.5 + (0.5 * Math.sin((time * 3) + particle.phase))));
  if (spark) alpha = (frame % 2) === 0 ? 0.95 : 0.2;
  else if (paralyzed) alpha = 0.72 + (0.18 * (0.5 + (0.5 * Math.sin((time * 1.5) + particle.phase))));
  placePixel(particle.sprite, placed.x, placed.y, span, particle.color, particle.kind, frame, alpha, particleScaleBoost(preset));
}

/**
 * @param {StatusParticle} particle
 * @param {StatusStyle} preset
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {number} time
 * @param {boolean} ring
 */
function stepStreak(particle, preset, box, seconds, time, ring) {
  const heavy = preset.accentMotion === "streak";
  const direction = preset.direction || "down";
  let base = 0.65;
  if (heavy) base = 0.28;
  else if (direction === "sideways") base = 0.85;
  else if (direction === "up") base = 0.4;
  const slow = preset.slow ? 0.55 : 1;
  particle.progress = wrap01(particle.progress + (seconds * base * slow * (0.7 + (particle.speed * 0.5))));
  const span = Math.min(box.w, box.h);
  const wave = Math.sin((time * 2.2) + particle.phase) * (heavy ? 0.02 : 0.04);
  const lane = clamp(particle.origin + wave, 0.08, 0.9);
  let x = lane * box.w;
  let y = box.cy;
  let kind = "speedX";
  if (direction === "up") {
    x = clampXToRing(lane * box.w, box, ring);
    y = streakAlong(1 - particle.progress, x, box, ring, false);
    kind = "speedUp";
  } else if (direction === "down") {
    x = clampXToRing(lane * box.w, box, ring);
    y = streakAlong(particle.progress, x, box, ring, false);
    kind = heavy ? "dash" : "speedDown";
  } else {
    y = clamp(lane * box.h, box.h * 0.08, box.h * 0.9);
    if (ring) y = clamp(y, box.cy - (ringLimit(box) * 0.85), box.cy + (ringLimit(box) * 0.85));
    x = streakAlong(particle.progress, y, box, ring, true);
  }
  const placed = placeOnPortrait(x, y, box, ring);
  const life = Math.sin(particle.progress * Math.PI);
  const alpha = (heavy ? 0.74 : 0.7) + (0.22 * life);
  placePixel(particle.sprite, placed.x, placed.y, span, particle.color, kind, frameAt(time + particle.phase, heavy ? 6 : 8), alpha);
}

/**
 * Smoke curls inside the portrait. The token itself is not moved.
 * @param {StatusParticle} particle
 * @param {StatusStyle} preset
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} time
 * @param {boolean} ring
 */
function stepWisp(particle, preset, box, time, ring) {
  const curl = (time * (0.35 + (particle.speed * 0.25))) + particle.phase;
  const limit = ring ? ringLimit(box) : Math.min(box.w, box.h) * 0.5;
  const rx = Math.min(box.w * 0.26, limit * 0.7);
  const ry = Math.min(box.h * 0.22, limit * 0.62);
  const rad = 0.35 + (0.65 * (0.5 + (0.5 * Math.sin(curl * 0.8))));
  const x = box.cx + (Math.cos(curl) * rx * rad) + (Math.sin(curl * 1.7) * rx * 0.15);
  const y = box.cy + (Math.sin(curl * 0.85) * ry * rad);
  const placed = placeOnPortrait(x, y, box, ring);
  const span = Math.min(box.w, box.h);
  const alpha = 0.72 + (0.23 * (0.5 + (0.5 * Math.sin((time * 1.4) + particle.phase))));
  placePixel(
    particle.sprite,
    placed.x,
    placed.y,
    span,
    particle.color,
    "puff",
    frameAt(time + particle.phase, 4),
    alpha,
    particleScaleBoost(preset)
  );
}

/**
 * Sound waves on the left and right of the portrait. The frame opens the arcs; the reach grows with it.
 * @param {StatusParticle} particle
 * @param {StatusStyle} preset
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} time
 * @param {boolean} ring
 */
function stepSoundWave(particle, preset, box, time, ring) {
  const span = Math.min(box.w, box.h);
  const frame = frameAt(time + particle.phase, 5);
  const side = (particle.index % 2) === 0 ? -1 : 1;
  const lane = Math.floor(particle.index / 2) % 2 === 0 ? -1 : 1;
  const reach = 0.16 + (frame * 0.045);
  const x = box.cx + (side * span * reach);
  const y = box.cy + (lane * span * 0.12);
  const placed = placeOnPortrait(x, y, box, ring);
  const alpha = Math.min(0.98, 0.55 + (frame * 0.12));
  placePixel(
    particle.sprite,
    placed.x,
    placed.y,
    span,
    particle.color,
    "wave",
    frame,
    alpha,
    particleScaleBoost(preset)
  );
}

function stepShimmerMote(particle, preset, box, seconds, time, ring) {
  if (preset.color === 0x8ecae6) {
    stepSoundWave(particle, preset, box, time, ring);
    return;
  }
  particle.phase += seconds * 0.4 * particle.spin;
  const span = Math.min(box.w, box.h);
  const rad = Math.min(span * 0.3, span * (0.18 + (particle.radius * 0.4)));
  const placed = placeOnPortrait(
    box.cx + (Math.cos(particle.phase) * rad),
    box.cy + (Math.sin(particle.phase) * rad * 0.7),
    box,
    ring
  );
  const kind = preset.color === 0xa8dadc ? "crystal" : "mote";
  const alpha = 0.7 + (0.25 * (0.5 + (0.5 * Math.sin((time * 1.3) + particle.phase))));
  placePixel(particle.sprite, placed.x, placed.y, span, particle.color, kind, frameAt(time + particle.phase, 4), alpha, 2);
}

/**
 * @param {StatusParticle} particle
 * @param {StatusStyle} preset
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {number} time
 * @param {boolean} ring
 */
function stepMote(particle, preset, box, seconds, time, ring) {
  const dust = preset.feet === true;
  const sweat = preset === STYLES.exhaustion;
  const pace = dust ? 0.16 : 0.22;
  const slow = preset.slow ? 0.5 : 1;
  particle.progress = wrap01(particle.progress + (seconds * pace * slow * (0.65 + particle.speed)));
  const sway = 0.04;
  let x = (particle.origin
    + (Math.sin((time * particle.f1) + particle.phase) * sway)
    + (Math.sin((time * particle.f2) + particle.phase) * sway * 0.35)) * box.w;
  x = clamp(x, box.w * 0.12, box.w * 0.88);
  x = clampXToRing(x, box, ring);
  let top = dust ? 0.62 : 0.12;
  let bottom = 0.86;
  if (sweat) {
    const band = dripBand(box, x, ring);
    top = band.top;
    bottom = band.bottom;
  }
  if (ring) {
    const band = ringBand(x, box);
    top = Math.max(top, band.top);
    bottom = Math.min(bottom, band.bottom);
    if (bottom < top) {
      top = band.top;
      bottom = band.bottom;
    }
  }
  const y = (top + (particle.progress * (bottom - top))) * box.h;
  const placed = placeOnPortrait(x, y, box, ring);
  const span = Math.min(box.w, box.h);
  const alpha = 0.75 + (0.2 * (0.5 + (0.5 * Math.sin((time * 1.6) + particle.phase))));
  const kind = sweat ? "dripHead" : (preset.motion === "veil" ? "mote" : "dust");
  placePixel(
    particle.sprite,
    placed.x,
    placed.y,
    span,
    particle.color,
    kind,
    frameAt(time + particle.phase, 4),
    alpha,
    sweat ? particleScaleBoost(preset) : 0
  );
}

/**
 * @param {StatusGlyph} glyph
 * @param {StatusStyle} preset
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {boolean} ring
 */
function stepGlyph(glyph, preset, box, seconds, ring) {
  const dream = preset.accentMotion === "glyph";
  glyph.progress = wrap01(glyph.progress + (seconds * (dream ? 0.16 : 0.32)));
  const span = Math.min(box.w, box.h);
  const sway = dream ? Math.sin((glyph.progress * Math.PI * 2) + (glyph.lane * 12)) * box.w * 0.035 : 0;
  let x = clamp((box.w * glyph.lane) + sway, box.w * 0.12, box.w * 0.88);
  x = clampXToRing(x, box, ring);
  const band = dripBand(box, x, ring);
  const y = (band.bottom - (glyph.progress * (band.bottom - band.top))) * box.h;
  const placed = placeOnPortrait(x, y, box, ring);
  const alpha = Math.max(0, (dream ? 0.94 : 0.9) * (1 - (glyph.progress * 0.85)));
  placePixel(glyph.sprite, placed.x, placed.y, span, glyph.color, glyph.kind, frameAt(glyph.progress * 4, 1), alpha);
}

/**
 * @param {StatusEmber} ember
 * @param {{w: number, h: number, cx: number, cy: number}} box
 * @param {number} seconds
 * @param {number} time
 * @param {boolean} ring
 */
function stepEmber(ember, box, seconds, time, ring) {
  ember.progress = wrap01(ember.progress + (seconds * ember.speed));
  let x = (ember.origin + (Math.sin((time * 3) + ember.phase) * 0.04)) * box.w;
  x = clamp(x, box.w * 0.12, box.w * 0.88);
  x = clampXToRing(x, box, ring);
  const band = dripBand(box, x, ring);
  const y = (band.bottom - (ember.progress * (band.bottom - band.top))) * box.h;
  const placed = placeOnPortrait(x, y, box, ring);
  const span = Math.min(box.w, box.h);
  const alpha = 0.55 + (0.4 * Math.sin(ember.progress * Math.PI));
  placePixel(ember.sprite, placed.x, placed.y, span, ember.color, "ember", frameAt(time + ember.phase, 8), alpha, 0, 2);
}

/**
 * @param {StatusParticle} particle
 * @param {boolean} visible
 */
function showParticle(particle, visible) {
  particle.sprite.visible = visible;
  if (particle.mate) particle.mate.visible = visible;
  if (particle.pool) particle.pool.visible = visible;
  for (const part of particle.parts) part.visible = visible;
}

/**
 * @param {number} span
 * @returns {number}
 */
export function pixelScale(span) {
  return Math.max(2, Math.ceil((span * 0.08) / PIXEL));
}

/**
 * @returns {number}
 */
export function pixelCanvasSize() {
  return PIXEL;
}

/**
 * Whole-pixel position and an integer scale of at least 2.
 * @param {number} x
 * @param {number} y
 * @param {number} span
 * @param {number} [scaleBoost]
 * @param {number} [scaleOverride]
 * @returns {{x: number, y: number, scale: number}}
 */
export function pixelPlacement(x, y, span, scaleBoost = 0, scaleOverride = 0) {
  const scale = scaleOverride > 0 ? scaleOverride : pixelScale(span) + scaleBoost;
  return {x: Math.round(x), y: Math.round(y), scale};
}

/**
 * Nearest sampling, mipmaps off. A 16×16 power-of-two canvas would otherwise mip and soften.
 * @returns {{scaleMode: "NEAREST", mipmap: "OFF"}}
 */
export function pixelSamplingModes() {
  return {scaleMode: "NEAREST", mipmap: "OFF"};
}

/**
 * @param {number} time
 * @param {number} [speed]
 * @returns {number}
 */
function frameAt(time, speed) {
  const index = Math.floor(time * (speed || 4));
  return ((index % FRAMES) + FRAMES) % FRAMES;
}

/**
 * Whole-pixel position, integer scale of at least 2, so a cluster stays readable.
 * @param {PIXI.Sprite} sprite
 * @param {number} x
 * @param {number} y
 * @param {number} span
 * @param {number} color
 * @param {string} kind
 * @param {number} frame
 * @param {number} alpha
 * @param {number} [scaleBoost]
 * @param {number} [scaleOverride]
 */
function placePixel(sprite, x, y, span, color, kind, frame, alpha, scaleBoost = 0, scaleOverride = 0) {
  const drawn = lightenDrawnColor(color);
  const placed = pixelPlacement(x, y, span, scaleBoost, scaleOverride);
  sprite.texture = pixelTexture(kind, frame, drawn);
  sprite.scale.set(placed.scale);
  sprite.position.set(placed.x, placed.y);
  sprite.alpha = alpha;
  sprite.rotation = 0;
  sprite.visible = alpha > 0.03;
}

/**
 * @param {number} value
 * @returns {number}
 */
function wrap01(value) {
  const next = value % 1;
  return next < 0 ? next + 1 : next;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function mix(a, b, t) {
  const channel = (shift) => {
    const from = (a >> shift) & 255;
    const to = (b >> shift) & 255;
    return Math.round(from + ((to - from) * t));
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * @param {number} color
 * @returns {{dark: number, mid: number, light: number}}
 */
function palette(color) {
  return {
    dark: mix(color, 0x000000, 0.48),
    mid: color,
    light: mix(color, 0xffffff, 0.58)
  };
}

/**
 * Cached by kind, frame, and color. Nearest filtering with mipmaps off keeps the 1×1 pixels square.
 * @param {string} kind
 * @param {number} frame
 * @param {number} color
 * @returns {PIXI.Texture}
 */
function pixelTexture(kind, frame, color) {
  const frameIndex = ((frame % FRAMES) + FRAMES) % FRAMES;
  const key = `${kind}\0${frameIndex}\0${color}`;
  const cached = pixelTextures.get(key);
  if (cached) return cached;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = PIXEL;
  canvasEl.height = PIXEL;
  const context = canvasEl.getContext("2d");
  if (!context) throw new Error("Could not create the status pixel texture.");
  context.imageSmoothingEnabled = false;
  paintPixelFrame(context, kind, frameIndex, palette(color));
  const texture = PIXI.Texture.from(canvasEl);
  const sampling = pixelSamplingModes();
  texture.baseTexture.scaleMode = PIXI.SCALE_MODES[sampling.scaleMode];
  texture.baseTexture.mipmap = PIXI.MIPMAP_MODES[sampling.mipmap];
  pixelTextures.set(key, texture);
  return texture;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} color
 */
function plot(ctx, x, y, color) {
  const px = x | 0;
  const py = y | 0;
  if ((px < 0) || (py < 0) || (px >= PIXEL) || (py >= PIXEL)) return;
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(px, py, 1, 1);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string[]} rows
 * @param {number} ox
 * @param {number} oy
 * @param {{dark: number, mid: number, light: number}} pal
 */
function stamp(ctx, rows, ox, oy, pal) {
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      const cell = rows[y][x];
      if (cell === ".") continue;
      const color = cell === "D" ? pal.dark : cell === "L" ? pal.light : pal.mid;
      plot(ctx, ox + x, oy + y, color);
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
export function paintPixelFrame(ctx, kind, frame, pal) {
  const paint = PAINTERS[kind] || paintMote;
  paint(ctx, frame, pal);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintDripBody(ctx, frame, pal) {
  const x = 8 + [0, 1, 0, -1][frame];
  for (let y = 1; y <= 14; y += 1) {
    plot(ctx, x - 1, y, pal.dark);
    plot(ctx, x, y, ((y + frame) % 4 === 0) ? pal.light : pal.mid);
    plot(ctx, x + 1, y, pal.dark);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintDripHead(ctx, frame, pal) {
  const lean = [0, 1, 0, -1][frame] || 0;
  const halves = [0, 0, 1, 1, 2, 3, 3, 3, 2, 1];
  const top = 3;
  const cx = 8 + lean;
  for (let row = 0; row < halves.length; row += 1) {
    const y = top + row;
    const half = halves[row];
    const above = row > 0 ? halves[row - 1] : -1;
    const below = row < halves.length - 1 ? halves[row + 1] : -1;
    for (let dx = -half; dx <= half; dx += 1) {
      const side = Math.abs(dx) === half;
      const cap = (Math.abs(dx) > above) || (Math.abs(dx) > below);
      let color = pal.mid;
      if (side || cap) color = pal.dark;
      if ((row === 6) && (dx === -1)) color = pal.light;
      plot(ctx, cx + dx, y, color);
    }
  }
}

/**
 * A filled circle about 3px across. Trails a teardrop without becoming another column.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintDroplet(ctx, frame, pal) {
  const ox = [0, 1, 0, -1][frame] || 0;
  for (let y = -1; y <= 1; y += 1) {
    for (let x = -1; x <= 1; x += 1) {
      let color = pal.mid;
      if ((x === 0) && (y === 0)) color = pal.light;
      else if ((Math.abs(x) === 1) && (Math.abs(y) === 1)) color = pal.dark;
      plot(ctx, 8 + ox + x, 8 + y, color);
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintPool(ctx, frame, pal) {
  const radius = 2 + frame;
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if ((x * x) + (y * y) > (radius * radius)) continue;
      const edge = (x * x) + (y * y) >= ((radius - 1) * (radius - 1));
      let color = pal.mid;
      if ((x === 0) && (y === 0)) color = pal.light;
      else if (edge) color = pal.dark;
      plot(ctx, 8 + x, 10 + y, color);
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintClod(ctx, frame, pal) {
  const shift = [0, 1, 0, -1][frame];
  const blobs = [[5, 6], [6, 5], [7, 6], [6, 7], [8, 6], [7, 8], [5, 8], [9, 7], [4, 7]];
  for (let index = 0; index < blobs.length; index += 1) {
    const x = blobs[index][0] + shift;
    const y = blobs[index][1] + (frame % 2);
    const color = index < 2 ? pal.light : index > 6 ? pal.dark : pal.mid;
    plot(ctx, x, y, color);
    plot(ctx, x + 1, y, color);
    plot(ctx, x, y + 1, (index % 2) ? pal.dark : pal.mid);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintFlame(ctx, frame, pal) {
  const tip = [2, 1, 3, 2][frame];
  const lean = [0, 1, 0, -1][frame];
  for (let y = tip; y <= 14; y += 1) {
    const depth = y - tip;
    const half = Math.min(3, Math.floor(depth / 2));
    for (let dx = -half; dx <= half; dx += 1) {
      let color = pal.dark;
      if (depth < 3) color = pal.light;
      else if ((Math.abs(dx) < half) || (half === 0)) color = pal.mid;
      plot(ctx, 8 + lean + dx, y, color);
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintBolt(ctx, frame, pal) {
  const jag = [0, 1, -1, 0][frame];
  const nodes = [[8, 4], [6, 5], [9, 6], [5, 7], [8, 8], [6, 9]];
  for (let index = 0; index < nodes.length; index += 1) {
    const x = nodes[index][0] + jag;
    const y = nodes[index][1];
    const color = index < 2 ? pal.light : index > 3 ? pal.dark : pal.mid;
    plot(ctx, x, y, color);
    plot(ctx, x + 1, y, (index % 2) ? pal.mid : pal.light);
    if (index > 0) plot(ctx, x, y - 1, pal.dark);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintEmber(ctx, frame, pal) {
  const y = 6 + frame;
  plot(ctx, 8, y, pal.light);
  plot(ctx, 7, y + 1, pal.dark);
  plot(ctx, 9, y, pal.mid);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintBubble(ctx, frame, pal) {
  const radius = 5;
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const dist = Math.hypot(x, y);
      if (dist > radius) continue;
      const edge = dist > (radius - 1.25);
      let color = pal.mid;
      if (edge) color = pal.dark;
      plot(ctx, 8 + x, 8 + y, color);
    }
  }
  const hx = 6 + (frame % 2);
  const hy = 5 + (frame > 1 ? 1 : 0);
  plot(ctx, hx, hy, pal.light);
  plot(ctx, hx + 1, hy, pal.light);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintStar(ctx, frame, pal) {
  plot(ctx, 8, 2, pal.light);
  plot(ctx, 8, 3, pal.light);
  plot(ctx, 8, 4, pal.mid);
  plot(ctx, 8, 5, pal.mid);
  plot(ctx, 7, 6, pal.mid);
  plot(ctx, 9, 6, pal.mid);
  for (let x = 2; x <= 14; x += 1) plot(ctx, x, 7, (x < 4 || x > 12) ? pal.dark : pal.mid);
  plot(ctx, 7, 8, pal.mid);
  plot(ctx, 9, 8, pal.mid);
  plot(ctx, 8, 9, pal.mid);
  plot(ctx, 8, 10, pal.mid);
  plot(ctx, 8, 11, pal.dark);
  plot(ctx, 8, 12, pal.dark);
  plot(ctx, 8, 7, pal.light);
  const glint = [[6, 5], [10, 5], [6, 9], [10, 9]][frame];
  plot(ctx, glint[0], glint[1], pal.light);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintSpark(ctx, frame, pal) {
  const y = 6 + (frame % 2);
  plot(ctx, 8, y - 2, pal.light);
  plot(ctx, 8, y - 1, pal.mid);
  plot(ctx, 8, y, pal.mid);
  plot(ctx, 8, y + 1, pal.dark);
  plot(ctx, 6, y, pal.dark);
  plot(ctx, 7, y, pal.mid);
  plot(ctx, 9, y, pal.mid);
  plot(ctx, 10, y, pal.light);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintHeart(ctx, frame, pal) {
  stamp(ctx, [
    "..DDD..DDD..",
    ".DMMMDDMMMD.",
    "DMMMMMMMMMMD",
    "DMMMMMMMMMMD",
    "DMMMMMMMMMMD",
    "DMMMMMMMMMMD",
    ".DMMMMMMMMD.",
    "..DMMMMMMD..",
    "...DMMMMD...",
    "....DMMD....",
    ".....DD.....",
    "......D....."
  ], 2, 2, pal);
  const glint = [[4, 4], [5, 4], [9, 4], [4, 5]][frame];
  plot(ctx, glint[0], glint[1], pal.light);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintPlus(ctx, frame, pal) {
  if ((frame % 2) !== 0) {
    plot(ctx, 8, 8, pal.dark);
    plot(ctx, 8, 7, pal.mid);
    plot(ctx, 7, 8, pal.light);
    return;
  }
  for (let index = 4; index <= 12; index += 1) {
    const color = (index === 4 || index === 12) ? pal.dark : index === 8 ? pal.light : pal.mid;
    plot(ctx, 8, index, color);
    plot(ctx, index, 8, color);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintShard(ctx, frame, pal) {
  const lean = [0, 1, 0, -1][frame] || 0;
  const halves = [0, 1, 2, 3, 4, 3, 2, 1];
  const top = 4;
  for (let row = 0; row < halves.length; row += 1) {
    const half = halves[row];
    const y = top + row;
    for (let dx = -half; dx <= half; dx += 1) {
      const edge = (Math.abs(dx) === half) || (row === 0) || (row === halves.length - 1);
      let color = pal.mid;
      if (edge) color = pal.dark;
      if ((row === 2) && (dx === 0)) color = pal.light;
      plot(ctx, 8 + lean + dx, y, color);
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintMote(ctx, frame, pal) {
  const ox = [0, 1, 0, -1][frame];
  const cells = [[7, 6], [8, 6], [6, 7], [7, 7], [8, 7], [9, 7], [7, 8], [8, 8], [8, 9]];
  for (let index = 0; index < cells.length; index += 1) {
    const color = index === 0 ? pal.light : index > 6 ? pal.dark : pal.mid;
    plot(ctx, cells[index][0] + ox, cells[index][1], color);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintDust(ctx, frame, pal) {
  const ox = [0, 1, -1, 0][frame];
  for (let y = 4; y <= 12; y += 1) {
    for (let x = 3; x <= 12; x += 1) {
      const nx = x - 8;
      const ny = y - 8;
      if ((nx * nx) + (ny * ny) > 18) continue;
      if (((x + y + frame) % 5) === 0) continue;
      const edge = (nx * nx) + (ny * ny) > 10;
      const color = (x === 6 && y === 6) ? pal.light : edge ? pal.dark : pal.mid;
      plot(ctx, x + ox, y, color);
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintPuff(ctx, frame, pal) {
  const ox = [0, 1, 0, -1][frame] || 0;
  const oy = [0, 0, 1, 0][frame] || 0;
  const blobs = [[8, 9, 5], [5, 8, 3.4], [11, 8, 3.4], [8, 5, 3.2], [6, 12, 2.6], [10, 12, 2.6]];
  for (let y = 0; y < PIXEL; y += 1) {
    for (let x = 0; x < PIXEL; x += 1) {
      let inside = false;
      let edge = true;
      for (let index = 0; index < blobs.length; index += 1) {
        const blob = blobs[index];
        const dx = (x - ox) - blob[0];
        const dy = (y - oy) - blob[1];
        const dist = Math.hypot(dx, dy);
        if (dist <= blob[2]) {
          inside = true;
          if (dist <= (blob[2] - 1.15)) edge = false;
        }
      }
      if (!inside) continue;
      let color = edge ? pal.dark : pal.mid;
      if ((x === 8) && (y === 8)) color = pal.light;
      plot(ctx, x, y, color);
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintDash(ctx, frame, pal) {
  const shift = frame * 2;
  for (let x = 0; x < PIXEL; x += 1) {
    const local = (x + shift) % 6;
    if (local > 3) continue;
    const color = local === 0 ? pal.light : local === 3 ? pal.dark : pal.mid;
    plot(ctx, x, 7, color);
    plot(ctx, x, 8, pal.dark);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintSpeedX(ctx, frame, pal) {
  const shift = frame * 2;
  const rows = [4, 8, 12];
  for (let row = 0; row < rows.length; row += 1) {
    for (let x = 0; x < 12 - (row * 2); x += 1) {
      const color = x > 9 ? pal.light : x < 2 ? pal.dark : pal.mid;
      plot(ctx, (x + shift + row) % PIXEL, rows[row], color);
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 * @param {boolean} down
 */
function paintSpeedY(ctx, frame, pal, down) {
  const shift = frame * 2;
  const cols = [4, 8, 12];
  for (let col = 0; col < cols.length; col += 1) {
    for (let y = 0; y < 12 - (col * 2); y += 1) {
      let color = pal.mid;
      if (down) color = y > 9 ? pal.light : y < 2 ? pal.dark : pal.mid;
      else color = y < 2 ? pal.light : y > 9 ? pal.dark : pal.mid;
      plot(ctx, cols[col], (y + shift + col) % PIXEL, color);
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintCrystal(ctx, frame, pal) {
  const rows = [1, 2, 3, 4, 3, 2, 1];
  for (let index = 0; index < rows.length; index += 1) {
    const half = rows[index];
    for (let dx = -half; dx <= half; dx += 1) {
      let color = Math.abs(dx) === half ? pal.dark : pal.mid;
      if ((index === frame) && (dx === 0)) color = pal.light;
      plot(ctx, 8 + dx, 4 + index, color);
    }
  }
  plot(ctx, 8, 5, pal.light);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintGlyphZ(ctx, frame, pal) {
  stamp(ctx, [
    "LLLLLLLL",
    "MMMMMMMM",
    ".....MM.",
    "....MM..",
    "...MM...",
    "..MM....",
    ".MM.....",
    "DDDDDDDD",
    "MMMMMMMM"
  ], 4, 3, pal);
  plot(ctx, 5 + frame, 8, pal.light);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintBang(ctx, frame, pal) {
  stamp(ctx, [
    "..LL..",
    "..MM..",
    "..MM..",
    "..MM..",
    "..DD..",
    "......",
    "..MM..",
    "..DD.."
  ], 5, 3, pal);
  if ((frame % 2) === 0) plot(ctx, 6, 3, pal.light);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintWash(ctx, frame, pal) {
  for (let y = 0; y < PIXEL; y += 1) {
    for (let x = 0; x < PIXEL; x += 1) {
      if (((x + y) % 2) !== 0) continue;
      const speckle = (((x * 3) + y + frame) % 7) === 0;
      plot(ctx, x, y, speckle ? pal.light : (((x + frame) % 4) === 0 ? pal.mid : pal.dark));
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintCloth(ctx, frame, pal) {
  for (let y = 3; y <= 13; y += 1) {
    for (let x = 0; x < PIXEL; x += 1) {
      const edge = (y === 3) || (y === 13) || (x === 0) || (x === PIXEL - 1);
      const fold = y >= 11;
      let color = pal.mid;
      if (edge || fold) color = pal.dark;
      else if ((((x + frame) % 5) === 0) && ((y === 6) || (y === 8))) color = pal.light;
      plot(ctx, x, y, color);
    }
  }
  plot(ctx, 3 + (frame % 4), 7, pal.light);
  plot(ctx, 10, 8, pal.light);
}

/**
 * A shut eye: a thick X so it reads as closed from across the table.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintShut(ctx, frame, pal) {
  const ox = 3 + (frame % 2);
  const oy = 3;
  for (let i = 0; i < 10; i += 1) {
    plot(ctx, ox + i, oy + i, pal.dark);
    plot(ctx, ox + i, oy + 9 - i, pal.dark);
    if ((i > 0) && (i < 9)) {
      plot(ctx, ox + i, oy + i - 1, pal.mid);
      plot(ctx, ox + i, oy + 10 - i, pal.mid);
    }
  }
  plot(ctx, ox + 4, oy + 3, pal.light);
}

/**
 * Two or three concentric arcs. The lit ring steps outward with the frame.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintWave(ctx, frame, pal) {
  const arcs = [
    {radius: 4, reach: 2, ox: 4},
    {radius: 6, reach: 2, ox: 7},
    {radius: 7, reach: 2, ox: 10}
  ];
  for (let ring = 0; ring < arcs.length; ring += 1) {
    const arc = arcs[ring];
    const lit = (frame % 3) === ring;
    const nudge = lit ? 1 : 0;
    const steps = arc.radius * 2;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const angle = -1.2 + (2.4 * t);
      const x = Math.round(arc.ox + nudge + (Math.cos(angle) * arc.reach));
      const y = Math.round(8 + (Math.sin(angle) * arc.radius));
      let color = pal.mid;
      if ((step === 0) || (step === steps)) color = pal.dark;
      else if (lit) color = pal.light;
      plot(ctx, x, y, color);
      plot(ctx, x + 1, y, color);
    }
  }
}

/**
 * Every pixel, darker at the rim, with a few light speckles. Not a checkerboard.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintTint(ctx, frame, pal) {
  for (let y = 0; y < PIXEL; y += 1) {
    for (let x = 0; x < PIXEL; x += 1) {
      const edge = (x < 2) || (y < 2) || (x >= PIXEL - 2) || (y >= PIXEL - 2);
      const speckle = (((x * 5) + (y * 3) + frame) % 29) === 0;
      let color = pal.mid;
      if (edge) color = pal.dark;
      else if (speckle) color = pal.light;
      plot(ctx, x, y, color);
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintRope(ctx, frame, pal) {
  for (let index = 0; index < 6; index += 1) {
    const x = 3 + (index * 2);
    const y = 4 + ((index + frame) % 2);
    plot(ctx, x, y, pal.mid);
    plot(ctx, x + 1, y, pal.dark);
    plot(ctx, x, y + 1, pal.light);
    plot(ctx, x + 1, y + 1, pal.mid);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintChain(ctx, frame, pal) {
  for (let index = 0; index < 4; index += 1) {
    const x = 2 + (index * 4);
    plot(ctx, x, 7, pal.dark);
    plot(ctx, x + 1, 6, pal.mid);
    plot(ctx, x + 1, 7, pal.light);
    plot(ctx, x + 1, 8, pal.mid);
    plot(ctx, x + 2, 7, pal.dark);
  }
  plot(ctx, 2 + (frame * 4), 7, pal.light);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintCrack(ctx, frame, pal) {
  const shift = frame % 2;
  const paths = [
    [[1, 2], [4, 5], [7, 4], [10, 8], [13, 6], [15, 9]],
    [[2, 14], [5, 11], [8, 12], [12, 8], [15, 13]],
    [[0, 8], [3, 6], [6, 9], [9, 7], [12, 11], [15, 10]]
  ];
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
    const path = paths[pathIndex];
    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1];
      const to = path[index];
      const y0 = from[1] + ((index === 1) ? shift : 0);
      const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - y0), 1);
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = Math.round(from[0] + ((to[0] - from[0]) * t));
        const y = Math.round(y0 + ((to[1] - y0) * t));
        plot(ctx, x, y, pal.mid);
        plot(ctx, x + 1, y, pal.dark);
      }
    }
  }
  plot(ctx, 4 + frame, 5, pal.light);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintRingIcon(ctx, frame, pal) {
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const x = Math.round(8 + (Math.cos(angle) * 5));
    const y = Math.round(8 + (Math.sin(angle) * 5));
    const color = (index % 4) === frame ? pal.light : (index % 3) === 0 ? pal.dark : pal.mid;
    plot(ctx, x, y, color);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintArcIcon(ctx, frame, pal) {
  for (let index = 0; index < 7; index += 1) {
    const angle = Math.PI * (0.62 + (0.76 * (index / 6)));
    const x = Math.round(8 + (Math.cos(angle) * 6));
    const y = Math.round(8 + (Math.sin(angle) * 6));
    const color = (index === frame) || (index === frame + 3) ? pal.light : pal.mid;
    plot(ctx, x, y, color);
    plot(ctx, x + 1, y, pal.dark);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintBlock(ctx, frame, pal) {
  const inset = 4;
  for (let y = inset; y < PIXEL - inset; y += 1) {
    for (let x = inset; x < PIXEL - inset; x += 1) {
      const edge = (x === inset) || (y === inset) || (x === PIXEL - inset - 1) || (y === PIXEL - inset - 1);
      let color = pal.mid;
      if (edge) color = pal.dark;
      else if (((x + y + frame) % 8) === 0) color = pal.light;
      plot(ctx, x, y, color);
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frame
 * @param {{dark: number, mid: number, light: number}} pal
 */
function paintCross(ctx, frame, pal) {
  for (let index = 3; index <= 12; index += 1) {
    const color = (index === 3 || index === 12) ? pal.dark : pal.mid;
    plot(ctx, 8, index, color);
    plot(ctx, index, 8, color);
  }
  plot(ctx, 6 + frame, 8, pal.light);
  plot(ctx, 8, 6 + frame, pal.light);
  plot(ctx, 8, 8, pal.light);
}

/** @type {Record<string, (ctx: CanvasRenderingContext2D, frame: number, pal: {dark: number, mid: number, light: number}) => void>} */
const PAINTERS = {
  dripHead: paintDripHead,
  rivulet: paintDripHead,
  droplet: paintDroplet,
  dripBody: paintDripBody,
  pool: paintPool,
  clod: paintClod,
  flame: paintFlame,
  bolt: paintBolt,
  ember: paintEmber,
  bubble: paintBubble,
  star: paintStar,
  spark: paintSpark,
  heart: paintHeart,
  plus: paintPlus,
  shard: paintShard,
  mote: paintMote,
  dust: paintDust,
  puff: paintPuff,
  dash: paintDash,
  speedX: paintSpeedX,
  speedUp: (ctx, frame, pal) => paintSpeedY(ctx, frame, pal, false),
  speedDown: (ctx, frame, pal) => paintSpeedY(ctx, frame, pal, true),
  crystal: paintCrystal,
  glyphZ: paintGlyphZ,
  bang: paintBang,
  wash: paintWash,
  tint: paintTint,
  cloth: paintCloth,
  shut: paintShut,
  wave: paintWave,
  rope: paintRope,
  chain: paintChain,
  crack: paintCrack,
  ring: paintRingIcon,
  arc: paintArcIcon,
  block: paintBlock,
  cross: paintCross
};

/**
 * @returns {string[]}
 */
export function painterKinds() {
  return Object.keys(PAINTERS);
}

/**
 * @typedef {object} StatusParticle
 * @property {PIXI.Sprite} sprite
 * @property {PIXI.Sprite | null} mate
 * @property {PIXI.Sprite | null} pool
 * @property {PIXI.Sprite[]} parts
 * @property {string} kind
 * @property {number} color
 * @property {number} origin
 * @property {number} progress
 * @property {number} phase
 * @property {number} radius
 * @property {number} spin
 * @property {number} speed
 * @property {number} swayAmp
 * @property {number} f1
 * @property {number} f2
 * @property {number} index
 */

/**
 * @typedef {object} StatusEmber
 * @property {PIXI.Sprite} sprite
 * @property {number} color
 * @property {number} origin
 * @property {number} progress
 * @property {number} phase
 * @property {number} speed
 */

/**
 * @typedef {object} StatusGlyph
 * @property {PIXI.Sprite} sprite
 * @property {string} kind
 * @property {number} color
 * @property {number} lane
 * @property {number} progress
 */

/**
 * @typedef {object} OverlaySpriteSpec
 * @property {string} kind
 * @property {string} role
 * @property {number} scaleBoost
 * @property {boolean} wide
 * @property {number} [color]
 */

/**
 * @typedef {object} StatusSceneSprite
 * @property {PIXI.Sprite} sprite
 * @property {string} kind
 * @property {string} role
 * @property {number} slot
 * @property {number} roleCount
 * @property {number} color
 * @property {number} scaleBoost
 * @property {boolean} wide
 * @property {number} phase
 * @property {number} progress
 */

/**
 * @typedef {object} StatusView
 * @property {StatusStyle} preset
 * @property {string} statusId
 * @property {boolean} failed
 * @property {StatusParticle[]} particles
 * @property {StatusGlyph[]} glyphs
 * @property {StatusEmber[]} embers
 * @property {StatusSceneSprite[]} scene
 * @property {boolean} [gfxFailed]
 * @property {PIXI.Graphics | null} gfx
 * @property {PIXI.Sprite | null} wash
 * @property {PIXI.Sprite | null} still
 * @property {number} time
 * @property {string} gfxBox
 */
