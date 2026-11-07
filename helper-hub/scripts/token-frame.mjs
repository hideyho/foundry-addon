import {ensureStorageDirectory, isSafeUploadPath} from "./chat-images.mjs";

const MODULE_ID = "helper-hub";

/** @typedef {"player" | "enemy" | "ally" | "neutral"} TokenFrameRole */

/**
 * Placement shared by the preview and the baked PNG.
 * zoom 1 covers the inner circle. panX and panY are fractions of the canvas side; 0 is centered.
 * @typedef {{zoom: number, panX: number, panY: number}} TokenFrameCrop
 */

/** @typedef {{path: string, crop: TokenFrameCrop}} TokenFrameFit */

/** 5etools alignment codes. NX and NY are the two neutral axes. */
const ALIGNMENT_CODES = new Set(["G", "E", "N", "U", "A", "L", "C", "NX", "NY"]);

const NEUTRAL_CODES = new Set(["N", "NX", "NY"]);

/** @type {Record<TokenFrameRole, {ring: string, background: string}>} */
const FRAME_COLORS = {
  player: {ring: "#e8c15a", background: "#4a3410"},
  enemy: {ring: "#d6453d", background: "#4a1414"},
  ally: {ring: "#4c8dff", background: "#102848"},
  neutral: {ring: "#b7bcc2", background: "#3a3e44"}
};

/** @type {TokenFrameRole[]} */
const FRAME_ROLES = ["player", "enemy", "ally", "neutral"];

/** @type {Record<TokenFrameRole, string>} */
const ROLE_LABELS = {
  player: "HELPERHUB.TokenFramePlayer",
  enemy: "HELPERHUB.TokenFrameEnemy",
  ally: "HELPERHUB.TokenFrameAlly",
  neutral: "HELPERHUB.TokenFrameNeutral"
};

/** Square bake. The preview uses the same placement on a smaller canvas. */
const BAKE_SIZE = 512;

const PREVIEW_SIZE = 360;

/** Steel's default colorBand.startRadius when getRingDataBySize fails. */
const FALLBACK_SUBJECT_FRACTION = 0.666;

/** Pulls the portrait off the first colored ring pixels. */
const SUBJECT_RADIUS_INSET = 0.98;

/** Above this long-side / short-side ratio the portrait is not cropped automatically. */
const SQUARE_RATIO = 1.15;

const ZOOM_MIN = 0.35;

const ZOOM_MAX = 3;

/** uploadPersistent path under modules/helper-hub/storage. Foundry does not create this folder. */
const TOKEN_STORAGE = "tokens";

/** Baked frames live here. A later recolor must not treat one of these as the original portrait. */
const BAKED_TOKEN_DIR = "modules/helper-hub/storage/tokens/";

/**
 * Character sheets are always the player frame. Otherwise alignment wins,
 * and a non-default disposition is only used when alignment does not decide.
 * Hostile is the core token default, so it does not mean enemy.
 * @param {Actor | null | undefined} actor
 * @param {object | null | undefined} [creature] Plutonium creature. Only its alignment is read.
 * @returns {TokenFrameRole | null}
 */
export function detectTokenFrameRole(actor, creature) {
  if (actor?.type === "character") return "player";

  const raw = (creature != null) ? creature.alignment : actor?.system?.details?.alignment;
  const fromAlignment = roleFromAlignment(raw);
  if (fromAlignment) return fromAlignment;

  if (actor) {
    const disposition = actor.isToken ? actor.token?.disposition : actor.prototypeToken?.disposition;
    if (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return "ally";
    if (disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL) return "neutral";
  }
  return null;
}

/**
 * A center crop is automatic when the portrait is nearly square.
 * Above 1.15 the cut would hide an unknown part of the character, so the user places it.
 * @param {number} width
 * @param {number} height
 * @returns {boolean}
 */
export function needsTokenFramePlacement(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || (width <= 0) || (height <= 0)) return false;
  return (Math.max(width, height) / Math.min(width, height)) > SQUARE_RATIO;
}

/**
 * Ring fields only. effects 1 is TokenRing.effects.ENABLED.
 * Subject scale, width, and height are left untouched.
 * A baked file passed as the subject texture is not scaled down a second time.
 * @param {TokenFrameRole} role
 * @param {string} [subjectTexture]
 * @returns {{ring: {enabled: true, colors: {ring: string, background: string}, effects: number, subject?: {texture: string}}}}
 */
export function ringUpdate(role, subjectTexture) {
  const colors = FRAME_COLORS[role];
  /** @type {{enabled: true, colors: {ring: string, background: string}, effects: number, subject?: {texture: string}}} */
  const ring = {
    enabled: true,
    colors: {ring: colors.ring, background: colors.background},
    effects: 1
  };
  if (subjectTexture) ring.subject = {texture: subjectTexture};
  return {ring};
}

/**
 * Save the role and paint the ring on the prototype and on placed tokens.
 * The portrait is fitted first. One actor update then writes the flags, the ring,
 * and, when a bake exists, the token image. Permitted tokens update together.
 * A synthetic token actor already lists its own token from getDependentTokens,
 * so that token is updated once.
 * Failures are warned and swallowed so a caller cannot treat them as a failed create.
 * The fit warning waits until the ring write succeeds, and a skipped bake is not announced as applied.
 * @param {Actor} actor
 * @param {TokenFrameRole} role
 * @returns {Promise<void>}
 */
export async function applyTokenFrame(actor, role) {
  if (!actor || !isRole(role)) return;
  const source = tokenFrameSource(actor);
  const savedCrop = readSavedCrop(actor);
  /** @type {TokenFrameFit | null} */
  let fitted = null;
  if (source) {
    fitted = await fitTokenFramePortrait(source, role, {
      token: actor.prototypeToken,
      crop: savedCrop
    });
  } else {
    console.warn(
      `${MODULE_ID} | Could not fit the portrait inside the token ring.`,
      new Error("The actor has no portrait to fit.")
    );
  }
  const baked = fitted?.path ?? "";
  const previousBakes = baked ? previousBakeFiles(actor, baked) : [];

  /** @type {Record<string, unknown>} */
  const frameFlags = {tokenFrame: role};
  const savedSource = readFlag(actor, "tokenFrameSource");
  if (((typeof savedSource !== "string") || !savedSource) && source && !source.includes("*")) {
    frameFlags.tokenFrameSource = source;
  }
  if (fitted?.crop) frameFlags.tokenFrameCrop = fitted.crop;

  /** @type {Record<string, unknown>} */
  const prototypeToken = {ring: ringUpdate(role, baked || undefined).ring};
  if (baked) prototypeToken.texture = {src: baked};

  try {
    await actor.update({
      flags: {[MODULE_ID]: frameFlags},
      prototypeToken
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not apply the token frame.`, err);
    ui.notifications.warn(game.i18n.localize("HELPERHUB.TokenFrameFailed"));
    return;
  }

  let failed = false;
  const updates = [];
  for (const token of actor.getDependentTokens({concreteOnly: true})) {
    if (token.canUserModify(game.user, "update") === false) continue;
    updates.push((async () => {
      try {
        /** @type {Record<string, unknown>} */
        const fields = {ring: ringUpdate(role, baked || undefined).ring};
        if (baked) fields.texture = {src: baked};
        await token.update(fields);
      } catch (err) {
        failed = true;
        console.warn(`${MODULE_ID} | Could not apply the token frame.`, err);
      }
    })());
  }
  await Promise.all(updates);
  if (failed) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.TokenFrameFailed"));
    return;
  }
  if (!baked) {
    notifyTokenFrameFitFailed();
    return;
  }
  await removeUnusedBakes(actor, previousBakes);
  notifyTokenFrame(role);
}

/**
 * Clip a portrait to the inner circle and upload that PNG.
 * Nearly square art is cover-cropped. Anything wider opens the placement dialog.
 * Cancel and dismiss keep a saved crop. The first fit, and a cancel with nothing saved, stay cover-centered.
 * Null means the image could not be used. The caller shows that warning after the ring write succeeds.
 * The circle is sized from the prototype grid, once. Placed tokens share that file.
 * @param {string} src
 * @param {TokenFrameRole} role
 * @param {{token?: object, crop?: Partial<TokenFrameCrop> | null}} [fit]
 * @returns {Promise<TokenFrameFit | null>}
 */
export async function fitTokenFramePortrait(src, role, fit) {
  if (!isRole(role)) return null;
  if ((typeof src !== "string") || !src || src.includes("*")) {
    console.warn(
      `${MODULE_ID} | Could not fit the portrait inside the token ring.`,
      new Error("The portrait path cannot be loaded.")
    );
    return null;
  }

  /** @type {LoadedPortrait | undefined} */
  let loaded;
  try {
    loaded = await loadPortrait(src);
    const fraction = subjectDiameterFraction(fit?.token);
    const saved = isCropRecord(fit?.crop) ? fit.crop : null;
    const crop = needsTokenFramePlacement(loaded.width, loaded.height)
      ? await askTokenFrameCrop(loaded.image, role, fraction, saved)
      : coverCrop();
    const path = await uploadTokenPortrait(loaded.image, crop, fraction);
    return {path, crop};
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not fit the portrait inside the token ring.`, err);
    return null;
  } finally {
    loaded?.release();
  }
}

/**
 * @param {TokenFrameRole} role
 */
export function notifyTokenFrame(role) {
  const name = game.i18n.localize(ROLE_LABELS[role]);
  ui.notifications.info(game.i18n.format("HELPERHUB.TokenFrameApplied", {role: name}));
}

/**
 * The portrait was skipped. The ring itself was already written.
 */
export function notifyTokenFrameFitFailed() {
  ui.notifications.warn(game.i18n.localize("HELPERHUB.TokenFrameFitFailed"));
}

/**
 * @typedef {object} LoadedPortrait
 * @property {HTMLImageElement} image
 * @property {number} width
 * @property {number} height
 * @property {() => void} release
 */

/**
 * The first fitted portrait is remembered so a recolor does not crop the bake.
 * Without that flag, a real token image is used unless it is already a bake.
 * Otherwise the sheet portrait is the source.
 * @param {Actor} actor
 * @returns {string}
 */
function tokenFrameSource(actor) {
  const saved = readFlag(actor, "tokenFrameSource");
  if ((typeof saved === "string") && saved && !saved.includes("*")) return saved;
  const texture = actor?.prototypeToken?.texture?.src;
  if (isRealImagePath(texture) && !isBakedTokenPath(texture)) return texture;
  const img = actor?.img;
  return (typeof img === "string") ? img : "";
}

/**
 * @param {Actor} actor
 * @param {string} key
 * @returns {unknown}
 */
function readFlag(actor, key) {
  if (typeof actor?.getFlag !== "function") return undefined;
  return actor.getFlag(MODULE_ID, key);
}

/**
 * The saved placement, or null the first time the flag is missing.
 * @param {Actor} actor
 * @returns {Partial<TokenFrameCrop> | null}
 */
function readSavedCrop(actor) {
  const saved = readFlag(actor, "tokenFrameCrop");
  return isCropRecord(saved) ? saved : null;
}

/**
 * @param {unknown} crop
 * @returns {crop is Partial<TokenFrameCrop>}
 */
function isCropRecord(crop) {
  return !!crop && (typeof crop === "object") && !Array.isArray(crop);
}

/**
 * @param {unknown} src
 * @returns {src is string}
 */
function isRealImagePath(src) {
  if ((typeof src !== "string") || !src || src.includes("*")) return false;
  const path = src.split(/[?#]/, 1)[0];
  const slash = path.lastIndexOf("/");
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf(".");
  if ((dot <= 0) || (dot === base.length - 1)) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  let images;
  try {
    images = CONST.IMAGE_FILE_EXTENSIONS;
  } catch {
    return false;
  }
  return !!images && Object.prototype.hasOwnProperty.call(images, ext);
}

/**
 * @param {unknown} src
 * @returns {boolean}
 */
function isBakedTokenPath(src) {
  return (typeof src === "string") && src.includes(BAKED_TOKEN_DIR);
}

/**
 * @returns {TokenFrameCrop}
 */
function coverCrop() {
  return {zoom: 1, panX: 0, panY: 0};
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
 * @param {Partial<TokenFrameCrop> | null | undefined} crop
 * @returns {TokenFrameCrop}
 */
function normalizeCrop(crop) {
  const zoom = Number(crop?.zoom);
  const panX = Number(crop?.panX);
  const panY = Number(crop?.panY);
  return {
    zoom: clamp(Number.isFinite(zoom) ? zoom : 1, ZOOM_MIN, ZOOM_MAX),
    panX: Number.isFinite(panX) ? panX : 0,
    panY: Number.isFinite(panY) ? panY : 0
  };
}

/**
 * Inner-circle diameter as a fraction of the canvas side.
 * getRingDataBySize uses the prototype's smaller grid side, the same choice as configureSize.
 * colorBand.startRadius is the inner edge of the colored ring. The circle uses that radius,
 * inset so the portrait stays off the first colored pixels.
 * ring.subject.scale is read and divided in. It is not written back.
 * 0.666, steel's default startRadius, is used only when that ring lookup fails.
 * @param {object | null | undefined} token Prototype token, or the creature token being fitted.
 * @returns {number}
 */
function subjectDiameterFraction(token) {
  /** @type {number | null} */
  let startRadius = null;
  try {
    startRadius = CONFIG.Token.ring.ringClass.getRingDataBySize(prototypeGridSize(token)).colorBand.startRadius;
  } catch {
    startRadius = null;
  }
  return subjectCircleFraction(startRadius, prototypeSubjectScale(token));
}

/**
 * @param {object | null | undefined} token
 * @returns {number}
 */
function prototypeGridSize(token) {
  const width = Number(token?.width);
  const height = Number(token?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || (width <= 0) || (height <= 0)) return 1;
  return Math.min(width, height);
}

/**
 * @param {object | null | undefined} token
 * @returns {number}
 */
function prototypeSubjectScale(token) {
  const scale = Number(token?.ring?.subject?.scale);
  if (!Number.isFinite(scale) || !(scale > 0)) return 1;
  return scale;
}

/**
 * Portrait diameter as a fraction of the canvas side.
 * A valid startRadius is the inner edge of the color band. Dividing by ring.subject.scale
 * and applying the inset keeps opaque portrait pixels inside that edge.
 * A missing, non-finite, or non-positive radius uses steel's default startRadius the same way.
 * @param {number | null | undefined} startRadius colorBand.startRadius for the prototype grid size.
 * @param {number} [subjectScale] ring.subject.scale. Read only.
 * @returns {number}
 */
export function subjectCircleFraction(startRadius, subjectScale = 1) {
  const scale = (typeof subjectScale === "number") && Number.isFinite(subjectScale) && (subjectScale > 0)
    ? subjectScale
    : 1;
  const radius = (typeof startRadius === "number") && Number.isFinite(startRadius) && (startRadius > 0)
    ? startRadius
    : FALLBACK_SUBJECT_FRACTION;
  const fraction = (radius / scale) * SUBJECT_RADIUS_INSET;
  if (!Number.isFinite(fraction) || (fraction <= 0)) return 1;
  return Math.min(1, fraction);
}

/**
 * A Foundry path loads through Image. http and https are fetched first so the canvas stays clean.
 * @param {string} src
 * @returns {Promise<LoadedPortrait>}
 */
async function loadPortrait(src) {
  const remote = /^https?:\/\//i.test(src);
  let objectUrl = "";
  try {
    const url = remote ? await remoteObjectUrl(src) : src;
    if (remote) objectUrl = url;
    const image = await loadHtmlImage(url);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!(width > 0) || !(height > 0)) throw new Error("The portrait has no pixels.");
    return {
      image,
      width,
      height,
      release() {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    };
  } catch (err) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

/**
 * @param {string} src
 * @returns {Promise<string>}
 */
async function remoteObjectUrl(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Portrait request failed (${response.status}).`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The portrait image failed to load."));
    image.src = src;
  });
}

/**
 * A saved crop opens where the user left it. The first fit starts cover-centered.
 * Cancel and dismiss return that saved crop, or cover-center when nothing was saved.
 * Confirm and Cancel are core i18n keys. DialogV2 localizes them.
 * @param {HTMLImageElement} image
 * @param {TokenFrameRole} role
 * @param {number} fraction
 * @param {Partial<TokenFrameCrop> | null} [saved]
 * @returns {Promise<TokenFrameCrop>}
 */
async function askTokenFrameCrop(image, role, fraction, saved) {
  const seeded = isCropRecord(saved) ? normalizeCrop(saved) : null;
  /** @type {TokenFrameCrop} */
  const placement = seeded ? {...seeded} : coverCrop();
  const dismissed = () => (seeded ? {...seeded} : coverCrop());
  let result;
  try {
    result = await foundry.applications.api.DialogV2.wait({
      window: {title: "HELPERHUB.TokenFramePlaceTitle"},
      content: tokenFrameCropContent(placement.zoom),
      modal: true,
      rejectClose: false,
      position: {width: 480},
      render: (_event, dialog) => bindTokenFrameCrop(dialog.element, image, role, placement, fraction),
      buttons: [
        {
          action: "ok",
          label: "Confirm",
          icon: "fa-solid fa-check",
          default: true,
          callback: () => normalizeCrop(placement)
        },
        {
          action: "cancel",
          label: "Cancel",
          icon: "fa-solid fa-xmark",
          callback: () => false
        }
      ]
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not open the portrait placement dialog.`, err);
    return dismissed();
  }
  if (!result || (typeof result !== "object")) return dismissed();
  return normalizeCrop(result);
}

/**
 * DialogV2 copies this element's innerHTML and drops attributes on the root,
 * so the root div has none and the canvas lives inside it.
 * @param {number} zoom
 * @returns {HTMLDivElement}
 */
function tokenFrameCropContent(zoom) {
  const content = document.createElement("div");
  const body = document.createElement("div");
  body.className = "helper-hub-token-crop";

  const hint = document.createElement("p");
  hint.className = "hint helper-hub-token-crop-hint";
  hint.textContent = game.i18n.localize("HELPERHUB.TokenFramePlaceHint");

  const canvas = document.createElement("canvas");
  canvas.className = "helper-hub-token-crop-canvas";
  canvas.width = PREVIEW_SIZE;
  canvas.height = PREVIEW_SIZE;

  const label = document.createElement("label");
  label.className = "helper-hub-token-crop-zoom";
  const name = document.createElement("span");
  name.textContent = game.i18n.localize("HELPERHUB.TokenFramePlaceZoom");
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "helper-hub-token-crop-zoom-input";
  // defaultValue is the attribute innerHTML keeps. The value property alone is dropped.
  slider.min = String(ZOOM_MIN);
  slider.max = String(ZOOM_MAX);
  slider.step = "0.01";
  slider.defaultValue = String(clamp(zoom, ZOOM_MIN, ZOOM_MAX));
  label.append(name, slider);

  body.append(hint, canvas, label);
  content.append(body);
  return content;
}

/**
 * The copied canvas is empty until this runs. Listeners bind to dialog.element.
 * @param {HTMLElement | undefined} root
 * @param {HTMLImageElement} image
 * @param {TokenFrameRole} role
 * @param {TokenFrameCrop} placement
 * @param {number} fraction
 */
function bindTokenFrameCrop(root, image, role, placement, fraction) {
  if (!(root instanceof HTMLElement)) return;
  const canvas = root.querySelector("canvas.helper-hub-token-crop-canvas");
  const slider = root.querySelector("input.helper-hub-token-crop-zoom-input");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  if (canvas.dataset.helperHubCrop === "1") return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.dataset.helperHubCrop = "1";

  const draw = (smoothing = "high") => {
    paintTokenPortrait(ctx, image, placement, canvas.width, fraction, FRAME_COLORS[role].ring, smoothing);
  };

  if (slider instanceof HTMLInputElement) {
    slider.value = String(placement.zoom);
    slider.addEventListener("input", () => {
      placement.zoom = clamp(Number(slider.value), ZOOM_MIN, ZOOM_MAX);
      draw();
    });
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener("pointermove", event => {
    if (!dragging) return;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : canvas.width;
    const height = rect.height > 0 ? rect.height : canvas.height;
    placement.panX += (event.clientX - lastX) / width;
    placement.panY += (event.clientY - lastY) / height;
    lastX = event.clientX;
    lastY = event.clientY;
    draw("low");
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    draw();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  draw();
}

/**
 * Cover the inner circle, then clip to it. The stroke is preview-only.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} image
 * @param {TokenFrameCrop} crop
 * @param {number} size
 * @param {number} fraction Inner-circle diameter as a fraction of the canvas side.
 * @param {string} [stroke]
 * @param {"low" | "high"} [smoothing] Low while the preview is dragged. The 512 bake stays high.
 */
function paintTokenPortrait(ctx, image, crop, size, fraction, stroke, smoothing = "high") {
  const placement = normalizeCrop(crop);
  const diameter = fraction * size;
  const radius = diameter / 2;
  const center = size / 2;
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!(iw > 0) || !(ih > 0)) return;
  const cover = diameter / Math.min(iw, ih);
  const scale = cover * placement.zoom;
  const drawW = iw * scale;
  const drawH = ih * scale;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = smoothing === "low" ? "low" : "high";
  ctx.drawImage(
    image,
    center + (placement.panX * size) - (drawW / 2),
    center + (placement.panY * size) - (drawH / 2),
    drawW,
    drawH
  );
  ctx.restore();

  if (!stroke) return;
  const lineWidth = Math.max(4, size * 0.028);
  const strokeRadius = Math.min((size / 2) - (lineWidth / 2), radius + (lineWidth / 2));
  ctx.beginPath();
  ctx.arc(center, center, strokeRadius, 0, Math.PI * 2);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/**
 * @param {HTMLImageElement} image
 * @param {TokenFrameCrop} crop
 * @param {number} fraction
 * @returns {Promise<string>}
 */
async function uploadTokenPortrait(image, crop, fraction) {
  const blob = await bakeTokenPortrait(image, crop, fraction);
  const file = new File([blob], `${foundry.utils.randomID()}.png`, {type: "image/png"});
  await ensureStorageDirectory(TOKEN_STORAGE);
  const response = await foundry.applications.apps.FilePicker.uploadPersistent(
    MODULE_ID,
    TOKEN_STORAGE,
    file,
    {},
    {notify: false}
  );
  const path = response?.path;
  if (!isSafeUploadPath(path)) throw new Error("The fitted portrait was not stored at a safe path.");
  return path;
}

/**
 * The PNG is transparent outside the circle. Foundry paints the real ring in that band.
 * @param {HTMLImageElement} image
 * @param {TokenFrameCrop} crop
 * @param {number} fraction
 * @returns {Promise<Blob>}
 */
async function bakeTokenPortrait(image, crop, fraction) {
  const canvas = document.createElement("canvas");
  canvas.width = BAKE_SIZE;
  canvas.height = BAKE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The portrait canvas is unavailable.");
  paintTokenPortrait(ctx, image, crop, BAKE_SIZE, fraction);
  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob(result => {
        if (result) resolve(result);
        else reject(new Error("The portrait could not be encoded."));
      }, "image/png");
    } catch (err) {
      reject(err);
    }
  });
  return blob;
}

/**
 * Bake paths this fit is about to replace. Captured before the actor update.
 * @param {Actor} actor
 * @param {string} next
 * @returns {string[]}
 */
function previousBakeFiles(actor, next) {
  const replacement = storedTokenPath(next);
  /** @type {string[]} */
  const files = [];
  const remember = (src) => {
    const file = storedTokenPath(src);
    if (!file || (file === replacement) || files.includes(file)) return;
    if (!isBakedTokenPath(file) || !isSafeUploadPath(file)) return;
    files.push(file);
  };
  remember(actor?.prototypeToken?.texture?.src);
  let tokens = [];
  try {
    tokens = actor?.getDependentTokens?.({concreteOnly: true}) ?? [];
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not list tokens for the previous bake.`, err);
  }
  for (const token of tokens) remember(token?.texture?.src);
  return files;
}

/**
 * @param {unknown} src
 * @returns {string}
 */
function storedTokenPath(src) {
  if (typeof src !== "string") return "";
  return src.split(/[?#]/, 1)[0];
}

/**
 * After the ring write, drop bakes nothing still displays.
 * @param {Actor} actor
 * @param {string[]} files
 * @returns {Promise<void>}
 */
async function removeUnusedBakes(actor, files) {
  for (const file of files) {
    if (bakeStillUsed(actor, file)) continue;
    await deleteStoredToken(file);
  }
}

/**
 * @param {Actor} actor
 * @param {string} file
 * @returns {boolean}
 */
function bakeStillUsed(actor, file) {
  if (storedTokenPath(actor?.prototypeToken?.texture?.src) === file) return true;
  let tokens = [];
  try {
    tokens = actor?.getDependentTokens?.({concreteOnly: true}) ?? [];
  } catch {
    return true;
  }
  for (const token of tokens) {
    if (storedTokenPath(token?.texture?.src) === file) return true;
  }
  return false;
}

/**
 * A previous bake under storage/tokens, and not the file just written.
 * Callers use this after the document update has succeeded.
 * @param {unknown} path
 * @param {string} next
 * @returns {Promise<void>}
 */
export async function removeStoredTokenBake(path, next) {
  const file = storedTokenPath(path);
  if (!file || (file === storedTokenPath(next))) return;
  if (!isBakedTokenPath(file) || !isSafeUploadPath(file)) return;
  await deleteStoredToken(file);
}

/**
 * Foundry 14's FilePicker can upload and browse. It has no delete method unless a
 * later build or a subclass adds one. The path is still only removed when that exists.
 * @param {string} path
 * @returns {Promise<void>}
 */
async function deleteStoredToken(path) {
  const picker = foundry.applications?.apps?.FilePicker;
  const impl = picker?.implementation ?? picker;
  const remove = impl?.delete ?? impl?.remove;
  if (typeof remove !== "function") {
    console.warn(`${MODULE_ID} | Could not delete the previous token bake.`, path);
    return;
  }
  try {
    await remove.call(impl, "data", path);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not delete the previous token bake.`, err);
  }
}

/**
 * Confirm returns the role. Cancel and dismiss return null.
 * DialogV2 copies the content element's innerHTML and drops attributes on that root,
 * so the radios live in a wrapper inside an attribute-free div.
 * @param {string | null | undefined} selected
 * @returns {Promise<TokenFrameRole | null>}
 */
export async function chooseTokenFrameRole(selected) {
  const initial = isRole(selected) ? selected : null;
  let result;
  try {
    result = await foundry.applications.api.DialogV2.wait({
      window: {title: "HELPERHUB.TokenFrameTitle"},
      content: tokenFrameDialogContent(initial),
      modal: true,
      rejectClose: false,
      position: {width: 420},
      buttons: [
        {
          action: "ok",
          label: "Confirm",
          icon: "fa-solid fa-check",
          default: true,
          callback: (_event, button) => readTokenFrameRole(button)
        },
        {
          action: "cancel",
          label: "Cancel",
          icon: "fa-solid fa-xmark",
          callback: () => false
        }
      ]
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not open the token frame dialog.`, err);
    return null;
  }
  return isRole(result) ? result : null;
}

/**
 * Header control on dnd5e character and NPC sheets. The label is an i18n key;
 * ActorSheetV2 localizes it while drawing the control.
 */
export function registerTokenFrames() {
  Hooks.once("ready", () => {
    if (!game.user.isGM) return;
    ensureStorageDirectory(TOKEN_STORAGE).catch(err => {
      console.warn(`${MODULE_ID} | Could not prepare the token portrait folder.`, err);
    });
  });

  Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => {
    if (game.system?.id !== "dnd5e") return;
    if (!sheet?.isEditable || !Array.isArray(controls)) return;
    const actor = sheet.document ?? sheet.actor;
    const type = actor?.type;
    if ((type !== "character") && (type !== "npc")) return;
    controls.push({
      action: "tokenFrame",
      icon: "fa-solid fa-circle",
      label: "HELPERHUB.TokenFrameMenu",
      onClick: () => {
        void onTokenFrameClick(actor);
      }
    });
  });
}

/**
 * A saved frame opens the picker. Otherwise a detected role is applied at once,
 * and an unknown actor asks the user. Cancel leaves the token unchanged.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
async function onTokenFrameClick(actor) {
  if (!actor) return;
  const saved = actor.getFlag(MODULE_ID, "tokenFrame");
  if (isRole(saved)) {
    const role = await chooseTokenFrameRole(saved);
    if (role) await applyTokenFrame(actor, role);
    return;
  }
  const detected = detectTokenFrameRole(actor);
  if (detected) {
    await applyTokenFrame(actor, detected);
    return;
  }
  const role = await chooseTokenFrameRole(null);
  if (role) await applyTokenFrame(actor, role);
}

/**
 * @param {string | null | undefined} value
 * @returns {value is TokenFrameRole}
 */
function isRole(value) {
  return (typeof value === "string") && FRAME_ROLES.includes(/** @type {TokenFrameRole} */ (value));
}

/**
 * @param {unknown} raw
 * @returns {TokenFrameRole | null}
 */
function roleFromAlignment(raw) {
  if (typeof raw === "string") return roleFromAlignmentString(raw);
  if (!Array.isArray(raw)) return null;
  if (raw.some(value => typeof value !== "string")) return roleFromAlignmentChoices(raw);
  return roleFromAlignmentCodes(raw);
}

/**
 * @param {string[]} values
 * @returns {TokenFrameRole | null}
 */
function roleFromAlignmentCodes(values) {
  /** @type {string[]} */
  const codes = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const parts = codeParts(trimmed);
    if (!parts) return roleFromAlignmentWords(alignmentText(values));
    codes.push(...parts);
  }
  return decideCodes(codes);
}

/**
 * One entry is one choice. `special` stays unknown. Otherwise each object's
 * alignment array is read on its own. Mixed choices stay unknown.
 * @param {unknown[]} values
 * @returns {TokenFrameRole | null}
 */
function roleFromAlignmentChoices(values) {
  /** @type {TokenFrameRole | null | undefined} */
  let agreed;
  for (const value of values) {
    const choice = alignmentChoice(value);
    if (agreed === undefined) {
      agreed = choice;
      continue;
    }
    if (choice !== agreed) return null;
  }
  return agreed ?? null;
}

/**
 * @param {unknown} value
 * @returns {TokenFrameRole | null}
 */
function alignmentChoice(value) {
  if (typeof value === "string") return roleFromAlignmentString(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if ("special" in value) return null;
  const entry = /** @type {{alignment?: unknown}} */ (value);
  if (!("alignment" in entry)) return null;
  return roleFromAlignment(entry.alignment);
}

/**
 * @param {unknown[]} values
 * @returns {string}
 */
function alignmentText(values) {
  return values.filter(value => typeof value === "string").join(" ");
}

/**
 * @param {string} text
 * @returns {TokenFrameRole | null}
 */
function roleFromAlignmentString(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = codeParts(trimmed);
  if (parts) return decideCodes(parts);
  return roleFromAlignmentWords(trimmed);
}

/**
 * A string of codes, or null when any piece is a word rather than a code.
 * @param {string} text
 * @returns {string[] | null}
 */
function codeParts(text) {
  const parts = text.split(/[^A-Za-z]+/).filter(Boolean).map(part => part.toUpperCase());
  if (!parts.length || parts.some(part => !ALIGNMENT_CODES.has(part))) return null;
  return parts;
}

/**
 * Good and evil decide the frame. A lone L or C, or both together, stays unknown.
 * One of L or C beside moral neutral (N or NY), and without NX, is neutral.
 * @param {string[]} codes
 * @returns {TokenFrameRole | null}
 */
function decideCodes(codes) {
  if (!codes.length) return null;
  const set = new Set(codes);
  const hasG = set.has("G");
  const hasE = set.has("E");
  if (set.has("U") || set.has("A") || (hasG && hasE)) return null;
  if (hasE) return "enemy";
  if (hasG) return "ally";

  const hasL = set.has("L");
  const hasC = set.has("C");
  if (hasL && hasC) return null;

  const moralNeutral = set.has("N") || set.has("NY");
  if ((hasL || hasC) && moralNeutral && !set.has("NX")) {
    set.delete("L");
    set.delete("C");
  }

  for (const code of set) {
    if (!NEUTRAL_CODES.has(code)) return null;
  }
  return set.size ? "neutral" : null;
}

/**
 * Evil is tested before neutral so "neutral evil" and "нейтрально-злой" are enemies.
 * Notes in parentheses are ignored. "non-good" and "non-evil" are unknown.
 * @param {string} text
 * @returns {TokenFrameRole | null}
 */
function roleFromAlignmentWords(text) {
  const value = text.toLowerCase().replace(/\([^)]*\)/g, " ");
  if (value.includes("non-good") || value.includes("non-evil")) return null;
  const evil = hasAlignmentWord(value, "evil") || value.includes("зл");
  const good = hasAlignmentWord(value, "good") || value.includes("добр");
  if (evil && !good) return "enemy";
  if (good && !evil) return "ally";
  if (evil && good) return null;
  if (isUnknownAlignment(value)) return null;
  if (value.includes("neutral") || value.includes("нейтрал")) return "neutral";
  return null;
}

/**
 * @param {string} value Lowercase alignment text.
 * @param {string} word
 * @returns {boolean}
 */
function hasAlignmentWord(value, word) {
  return new RegExp(`(?:^|[^a-z])(?:${word})(?:[^a-z]|$)`).test(value);
}

/**
 * "any" and "unaligned" are whole words. The Russian phrases are matched as written.
 * @param {string} value Lowercase alignment text.
 * @returns {boolean}
 */
function isUnknownAlignment(value) {
  if (value.includes("без мировоззрения") || value.includes("любое")) return true;
  return hasAlignmentWord(value, "unaligned") || hasAlignmentWord(value, "any");
}

/**
 * @param {TokenFrameRole | null} selected
 * @returns {HTMLDivElement}
 */
function tokenFrameDialogContent(selected) {
  const content = document.createElement("div");
  const list = document.createElement("div");
  list.className = "helper-hub-token-frames";

  for (const role of FRAME_ROLES) {
    const colors = FRAME_COLORS[role];
    const choice = document.createElement("label");
    choice.className = "helper-hub-token-frame";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "role";
    input.value = role;
    // defaultChecked is what innerHTML keeps. The checked property alone is dropped.
    if (role === selected) input.defaultChecked = true;

    const swatch = document.createElement("span");
    swatch.className = "helper-hub-token-frame-swatch";
    swatch.style.setProperty("--helper-hub-frame-ring", colors.ring);
    swatch.style.setProperty("--helper-hub-frame-background", colors.background);

    const name = document.createElement("span");
    name.className = "helper-hub-token-frame-name";
    name.textContent = game.i18n.localize(ROLE_LABELS[role]);

    choice.append(input, swatch, name);
    list.append(choice);
  }

  content.append(list);
  return content;
}

/**
 * False is not a role, so a confirm with nothing picked does not become the "ok" action.
 * @param {HTMLButtonElement | undefined} button
 * @returns {TokenFrameRole | false}
 */
function readTokenFrameRole(button) {
  const form = button?.form;
  if (!(form instanceof HTMLFormElement)) return false;
  const picked = new FormData(form).get("role");
  return isRole(picked) ? picked : false;
}
