const MODULE_ID = "helper-hub";
const FLAG = "displayScreen";
const BODY_CLASS = "helper-hub-display";
const FIELD_NAME = `flags.${MODULE_ID}.${FLAG}`;
const ALLOWED_KEYS = new Set(["F5", "F11", "CONTROL", "META"]);

/** `?helper-hub-display=off` switches the mode off for one page load, on this browser only. */
const QUERY_PARAM = "helper-hub-display";

/** Option keys carried on User updates. */
const STASH_OPTION = "helperHubPreviousDisplayFlag";
const REVERT_OPTION = "helperHubDisplayRevert";

/** Blocked input events. Capture phase on window, so Foundry's own listeners never see them. */
const BLOCKED_EVENTS = ["wheel", "contextmenu", "keydown", "keyup", "dblclick", "mousedown"];

const POSITION_EPSILON = 0.01;
const SCALE_EPSILON = 1e-6;

/** Smallest role that counts as a Gamemaster (ASSISTANT). Used only when CONST is not available. */
const FALLBACK_GM_ROLE = 3;

/**
 * Token methods that start selection, dragging, or any interaction. All are defined on Token.prototype and all
 * take the acting User as their first argument (see PlaceableObject#_canControl and friends).
 */
const TOKEN_GUARDED_METHODS = ["_canControl", "_canDrag", "_canHUD", "_canConfigure", "_canView", "_canHover"];

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * The display-screen mode belongs to a non-GM account whose flag is exactly true.
 * @param {{isGM?: boolean, flag?: unknown}} [state]
 * @returns {boolean}
 */
export function isDisplayScreen({isGM, flag} = {}) {
  return !isGM && flag === true;
}

/**
 * Keys that stay usable on a display screen: reload (F5, whatever the modifiers), full screen (F11), the
 * modifier keys Control and Meta themselves, and anything pressed with Ctrl or Meta held.
 * Matching is case-insensitive.
 * @param {{key?: string, ctrlKey?: boolean, metaKey?: boolean}} [event]
 * @returns {boolean}
 */
export function displayKeyAllowed({key, ctrlKey, metaKey} = {}) {
  if (ctrlKey || metaKey) return true;
  return (typeof key === "string") && ALLOWED_KEYS.has(key.toUpperCase());
}

/**
 * Should the display screen swallow this event completely (preventDefault and stopPropagation)?
 * Allowed keys are only kept from Foundry (stopPropagation) so the browser still handles them.
 * @param {{type?: string, key?: string, ctrlKey?: boolean, metaKey?: boolean}} [event]
 * @returns {boolean}
 */
export function shouldBlockEvent({type, key, ctrlKey, metaKey} = {}) {
  if ((type === "keydown") || (type === "keyup")) return !displayKeyAllowed({key, ctrlKey, metaKey});
  return true;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPositive(value) {
  return (typeof value === "number") && Number.isFinite(value) && (value > 0);
}

/**
 * "Contain" view: the whole scene rectangle fits inside the screen, centered.
 * @param {{sceneRect?: {x: number, y: number, width: number, height: number}, width?: number, height?: number}} [input]
 * @returns {{x: number, y: number, scale: number} | null}
 */
export function fitSceneView({sceneRect, width, height} = {}) {
  if (!sceneRect || !isPositive(sceneRect.width) || !isPositive(sceneRect.height)) return null;
  if (!isPositive(width) || !isPositive(height)) return null;
  const {x, y} = sceneRect;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: x + (sceneRect.width / 2),
    y: y + (sceneRect.height / 2),
    scale: Math.min(width / sceneRect.width, height / sceneRect.height)
  };
}

/**
 * True when the current view already equals the target within a small tolerance.
 * @param {{x: number, y: number, scale: number}} current
 * @param {{x: number, y: number, scale: number}} target
 * @returns {boolean}
 */
export function sameView(current, target) {
  return (Math.abs(current.x - target.x) <= POSITION_EPSILON)
    && (Math.abs(current.y - target.y) <= POSITION_EPSILON)
    && (Math.abs(current.scale - target.scale) <= SCALE_EPSILON);
}

/**
 * Decide whether the view must be panned: never while our own pan is running, never without a target,
 * and not when the view already matches.
 * @param {{x: number, y: number, scale: number} | null | undefined} current
 * @param {{x: number, y: number, scale: number} | null | undefined} target
 * @param {boolean} applying   True while our own pan is in progress.
 * @returns {boolean}
 */
export function shouldRefit(current, target, applying) {
  if (applying || !current || !target) return false;
  return !sameView(current, target);
}

/**
 * Pan controller with a reentrancy guard. canvas.pan fires `canvasPan` synchronously, and the pan target may be
 * clamped, so a handler that calls apply() from inside pan() must be a no-op.
 * @param {object} deps
 * @param {() => ({x: number, y: number, scale: number} | null)} deps.getCurrent
 * @param {() => ({x: number, y: number, scale: number} | null)} deps.getTarget
 * @param {(target: {x: number, y: number, scale: number}) => void} deps.pan
 * @returns {{apply: () => boolean, readonly applying: boolean}}
 */
export function createFitController({getCurrent, getTarget, pan}) {
  let applying = false;
  return {
    get applying() {
      return applying;
    },
    apply() {
      if (applying) return false;
      const target = getTarget();
      if (!shouldRefit(getCurrent(), target, applying)) return false;
      applying = true;
      try {
        pan(target);
      } finally {
        applying = false;
      }
      return true;
    }
  };
}

/**
 * Scene fields that make the scene exactly as large as its background image.
 * @param {{imageWidth?: number, imageHeight?: number}} [input]
 * @returns {{width: number, height: number, padding: 0, shiftX: 0, shiftY: 0} | null}
 */
export function sceneFitUpdate({imageWidth, imageHeight} = {}) {
  if (!isPositive(imageWidth) || !isPositive(imageHeight)) return null;
  const width = Math.round(imageWidth);
  const height = Math.round(imageHeight);
  if ((width < 1) || (height < 1)) return null;
  return {width, height, padding: 0, shiftX: 0, shiftY: 0};
}

/**
 * Does a changes object (one level, as passed to preUpdateUser) touch the display flag anywhere?
 * Covers nested, dotted, and deletion forms, and anything that replaces or removes `flags`
 * or the whole `helper-hub` namespace.
 * @param {object} changes
 * @returns {boolean}
 */
export function touchesDisplayFlag(changes) {
  if (!changes || (typeof changes !== "object")) return false;
  const flagKeys = [FLAG, `-=${FLAG}`];

  // Dotted keys at the top level.
  const dotted = [
    "-=flags",
    `flags.${MODULE_ID}`, `flags.-=${MODULE_ID}`,
    ...flagKeys.map(name => `flags.${MODULE_ID}.${name}`)
  ];
  if (dotted.some(key => Object.hasOwn(changes, key))) return true;

  // Nested form.
  if (!Object.hasOwn(changes, "flags")) return false;
  const flags = changes.flags;
  if (flags === undefined) return false;
  if (!flags || (typeof flags !== "object")) return true; // null (or junk) replaces every flag
  if (Object.hasOwn(flags, `-=${MODULE_ID}`)) return true;
  if ([`${MODULE_ID}.${FLAG}`, `${MODULE_ID}.-=${FLAG}`].some(key => Object.hasOwn(flags, key))) return true;
  if (!Object.hasOwn(flags, MODULE_ID)) return false;
  const scoped = flags[MODULE_ID];
  if (scoped === undefined) return false;
  if (!scoped || (typeof scoped !== "object")) return true; // `helper-hub: null` replaces the namespace
  return flagKeys.some(key => Object.hasOwn(scoped, key));
}

/**
 * Should the active GM undo this update of the display flag? Only changes made by a known non-GM are undone,
 * and never our own corrections.
 * @param {{changes?: object, initiatorIsGM?: boolean | null | undefined, isRevert?: boolean}} [input]
 *   `initiatorIsGM` must be exactly false (a known non-GM) for the change to be reverted.
 * @returns {boolean}
 */
export function shouldRevertDisplayFlag({changes, initiatorIsGM, isRevert} = {}) {
  if (isRevert) return false;
  if (initiatorIsGM !== false) return false;
  return touchesDisplayFlag(changes);
}

/**
 * @param {unknown} role   A User role number.
 * @returns {boolean}      True for Assistant and Gamemaster.
 */
export function roleIsGM(role) {
  if (typeof role !== "number") return false;
  const minimum = globalThis.CONST?.USER_ROLES?.ASSISTANT ?? FALLBACK_GM_ROLE;
  return role >= minimum;
}

/**
 * The scene id behind a context menu target. The scene directory renders `data-entry-id` rows; scene
 * navigation (same `getSceneContextOptions` hook) renders `data-scene-id` rows and has no entry id.
 * @param {{closest?: (selector: string) => ({dataset?: {entryId?: string}} | null)} | null | undefined} li
 * @returns {string | null}
 */
export function sceneIdFromMenuEntry(li) {
  const id = li?.closest?.("[data-entry-id]")?.dataset?.entryId;
  return (typeof id === "string") && id ? id : null;
}

/**
 * Is the mode switched off locally with `?helper-hub-display=off`?
 * @param {string | null | undefined} search   `location.search`
 * @returns {boolean}
 */
export function displayDisabledByQuery(search) {
  try {
    return new URLSearchParams(search ?? "").get(QUERY_PARAM) === "off";
  } catch {
    return false;
  }
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

let active = false;
let listenersBound = false;
let panHooked = false;
let locallyOff = null;

/** Prototypes already given token wrappers. */
const wrappedPrototypes = new WeakSet();

/**
 * Last known display flag per user, kept on GM clients. A non-GM can edit their own flag, so the previous
 * value is remembered here rather than trusted from the update itself.
 * @type {Map<string, unknown>}
 */
const knownFlags = new Map();

const fitController = createFitController({
  getCurrent: () => {
    const stage = canvas.stage;
    return {x: stage.pivot.x, y: stage.pivot.y, scale: stage.scale.x};
  },
  getTarget: () => fitSceneView({
    sceneRect: canvas.dimensions?.sceneRect,
    width: window.innerWidth,
    height: window.innerHeight
  }),
  pan: target => canvas.pan(target)
});

/**
 * Hooks and the GM menu entry. Token wrappers are registered separately because they need libWrapper.
 */
export function registerDisplayScreen() {
  Hooks.on("renderUserConfig", onRenderUserConfig);
  Hooks.on("preUpdateUser", onPreUpdateUser);
  Hooks.on("updateUser", onUpdateUser);
  Hooks.on("getSceneContextOptions", onSceneContextOptions);
  Hooks.on("canvasReady", onCanvasReady);
  // game.user already exists in setup, so the interface is hidden before the first render. Ready is the fallback.
  Hooks.once("setup", refreshDisplayMode);
  Hooks.once("ready", refreshDisplayMode);
  // A system may replace CONFIG.Token.objectClass after our init hook ran; wrap it too.
  Hooks.once("setup", () => {
    if (globalThis.libWrapper) registerDisplayScreenWrappers();
  });
}

/**
 * Token guards. Each wrapper calls through unless the acting user is a display screen.
 * Wraps the core Token and, when different, the configured CONFIG.Token.objectClass. Safe to call again:
 * a prototype that is already wrapped is skipped. Only when libWrapper exists.
 */
export function registerDisplayScreenWrappers() {
  const base = globalThis.foundry?.canvas?.placeables?.Token;
  if (base && !wrappedPrototypes.has(base.prototype)) {
    wrappedPrototypes.add(base.prototype);
    for (const method of TOKEN_GUARDED_METHODS) {
      wrapFirst([
        `foundry.canvas.placeables.Token.prototype.${method}`,
        `Token.prototype.${method}`
      ]);
    }
  }

  const objectClass = globalThis.CONFIG?.Token?.objectClass;
  if (objectClass?.prototype && (objectClass !== base) && !wrappedPrototypes.has(objectClass.prototype)) {
    wrappedPrototypes.add(objectClass.prototype);
    for (const method of TOKEN_GUARDED_METHODS) wrapFirst([`CONFIG.Token.objectClass.prototype.${method}`]);
  }
}

/**
 * @param {string[]} targets   libWrapper targets, tried in order until one registers.
 */
function wrapFirst(targets) {
  for (const target of targets) {
    try {
      libWrapper.register(MODULE_ID, target, denyForDisplayScreen, "WRAPPER");
      return;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not wrap ${target}.`, err);
    }
  }
}

/**
 * Every guarded method is `_canXxx(user, event)`, so the first argument is the acting User.
 * @param {Function} wrapped
 * @param {...unknown} args
 * @returns {unknown}
 */
function denyForDisplayScreen(wrapped, ...args) {
  if (userIsDisplay(args[0] ?? game.user)) return false;
  return wrapped(...args);
}

/**
 * @returns {boolean}
 */
function isLocallyOff() {
  locallyOff ??= displayDisabledByQuery(globalThis.location?.search);
  return locallyOff;
}

/**
 * @param {User} [user]
 * @returns {boolean}
 */
function userIsDisplay(user) {
  if (!user) return false;
  if (isLocallyOff() && (user.id === globalThis.game?.user?.id)) return false;
  return isDisplayScreen({isGM: user.isGM, flag: flagOf(user)});
}

/**
 * @param {User} user
 * @returns {unknown}
 */
function flagOf(user) {
  return user?.flags?.[MODULE_ID]?.[FLAG];
}

/**
 * @returns {boolean}
 */
function currentUserIsDisplay() {
  return userIsDisplay(globalThis.game?.user);
}

/**
 * Turn the mode on or off to match the current user. Safe to call repeatedly.
 */
function refreshDisplayMode() {
  if (game.user?.isGM) primeKnownFlags();
  setDisplayMode(currentUserIsDisplay());
}

/**
 * @param {boolean} enabled
 */
function setDisplayMode(enabled) {
  const wasActive = active;
  active = enabled;
  document.body.classList.toggle(BODY_CLASS, enabled);
  if (enabled) {
    bindInputBlockers();
    // The pan hook is only needed while the mode is on.
    if (!panHooked) {
      panHooked = true;
      Hooks.on("canvasPan", onCanvasPan);
    }
  }
  else {
    unbindInputBlockers();
    if (panHooked) {
      panHooked = false;
      Hooks.off("canvasPan", onCanvasPan);
    }
  }
  if (!canvas?.ready) return;
  if (!enabled && !wasActive) return; // nothing of ours to undo
  prepareCanvas(enabled);
  if (enabled) applyFit();
}

/**
 * @param {boolean} enabled
 */
function prepareCanvas(enabled) {
  if (enabled) canvas.tokens?.releaseAll();
  // Other users' cursors are Pixi objects, so CSS cannot hide them.
  if (canvas.controls?.cursors) canvas.controls.cursors.visible = !enabled;
  // Nothing on the stage reacts to the pointer: covers tokens, doors, notes, tiles, templates and any control icon.
  if (canvas.stage) canvas.stage.interactiveChildren = !enabled;
}

function bindInputBlockers() {
  if (listenersBound) return;
  listenersBound = true;
  for (const type of BLOCKED_EVENTS) {
    window.addEventListener(type, blockInput, {capture: true, passive: false});
  }
}

function unbindInputBlockers() {
  if (!listenersBound) return;
  listenersBound = false;
  for (const type of BLOCKED_EVENTS) {
    window.removeEventListener(type, blockInput, {capture: true});
  }
}

/**
 * Allowed keys (reload, full screen, Ctrl or Meta combinations) are hidden from Foundry with stopPropagation
 * only, never preventDefault, so the browser still acts on them. Foundry's KeyboardManager then sees no key at
 * all, so a Control or Meta press can never be left stuck. Everything else is swallowed.
 * @param {Event} event
 */
function blockInput(event) {
  if (!shouldBlockEvent(event)) {
    event.stopPropagation();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

/* -------------------------------------------- */
/*  Fit to screen                               */
/* -------------------------------------------- */

function onCanvasReady() {
  if (!active) return;
  prepareCanvas(true);
  applyFit();
}

/**
 * The window resize needs no listener of its own: Canvas#_onResize calls canvas.pan, which fires `canvasPan`.
 * canvas.pan fires this hook synchronously, so the controller's guard stops our own correction from recursing.
 */
function onCanvasPan() {
  if (!active || !canvas?.ready) return;
  applyFit();
}

/**
 * Pan to the "contain" view. Skipped when the view already matches the target.
 * canvas.pan clamps scale to canvas.dimensions.scale and the pivot to the canvas, so a clamped
 * target is never reached exactly. The reentrancy guard keeps that from looping.
 */
function applyFit() {
  fitController.apply();
}

/* -------------------------------------------- */
/*  User flag                                   */
/* -------------------------------------------- */

/**
 * Add the checkbox to the user configuration window. Only a GM sees it, and not on GM accounts,
 * because the mode never applies to them.
 * @param {object} app      The UserConfig application
 * @param {HTMLElement} element
 */
function onRenderUserConfig(app, element) {
  if (!game.user.isGM || !(element instanceof HTMLElement)) return;
  const user = app.document;
  if (!user || user.isGM) return;
  if (element.querySelector(`input[name="${FIELD_NAME}"]`)) return;

  const part = element.querySelector('[data-application-part="form"]') ?? element;
  const {createFormGroup, createCheckboxInput} = foundry.applications.fields;
  const input = createCheckboxInput({
    name: FIELD_NAME,
    id: `${app.id}-${MODULE_ID}-${FLAG}`,
    value: flagOf(user) === true
  });
  const group = createFormGroup({
    input,
    label: "HELPERHUB.DisplayScreenName",
    hint: "HELPERHUB.DisplayScreenHint",
    localize: true
  });
  const legend = document.createElement("legend");
  legend.textContent = game.i18n.localize("HELPERHUB.DisplayScreenLegend");
  const fieldset = document.createElement("fieldset");
  fieldset.append(legend, group);
  const container = part.querySelector(".standard-form") ?? part;
  container.append(fieldset);
  app.setPosition({height: "auto"});
}

/**
 * Only a GM may change the display flag. This client-side check is a convenience, not security: the server lets
 * a user edit their own flags, and a modified client skips it. The active GM client also undoes such changes
 * (see onUpdateUser), which is a second convenience guard, not a security boundary.
 * @param {User} user
 * @param {object} changes
 * @param {object} options
 * @returns {boolean | void}
 */
function onPreUpdateUser(user, changes, options) {
  if (game.user.isGM) return;
  if (!touchesDisplayFlag(changes)) return;
  // Kept for the GM client's revert if the update gets through anyway. The GM's own record wins over this.
  if (options && (typeof options === "object")) {
    const previous = flagOf(user);
    options[STASH_OPTION] = (previous === undefined) ? {unset: true} : {value: previous};
  }
  return false;
}

/**
 * Seed the GM-side record of every user's flag.
 */
function primeKnownFlags() {
  for (const user of game.users ?? []) {
    if (!knownFlags.has(user.id)) knownFlags.set(user.id, flagOf(user));
  }
}

/**
 * @returns {boolean}
 */
function isActiveGMClient() {
  return !!game.user?.isGM && !!game.users?.activeGM?.isSelf;
}

/**
 * Apply a change to the current user's own flag or role without a reload. On GM clients, also keep the flag
 * honest: undo edits made by a non-GM, and clear the flag of a user who has just become a GM.
 * @param {User} user
 * @param {object} changes
 * @param {object} [options]
 * @param {string} [userId]   The user who made the update.
 */
function onUpdateUser(user, changes, options, userId) {
  if (game.user.isGM && guardFlag(user, changes, options, userId)) return;
  if (user.id !== game.user.id) return;
  if (touchesDisplayFlag(changes) || ("role" in changes)) refreshDisplayMode();
}

/**
 * GM-side bookkeeping for the flag.
 * @param {User} user
 * @param {object} changes
 * @param {object} [options]
 * @param {string} [userId]
 * @returns {boolean}   True when a correction was sent, so the record waits for the corrected update.
 */
function guardFlag(user, changes, options, userId) {
  const touched = touchesDisplayFlag(changes);
  if (touched && isActiveGMClient()) {
    const initiator = game.users.get(userId);
    const revert = shouldRevertDisplayFlag({
      changes,
      initiatorIsGM: initiator ? initiator.isGM : null,
      isRevert: options?.[REVERT_OPTION] === true
    });
    if (revert) {
      restoreFlag(user, previousFlag(user, options));
      return true;
    }
  }

  // Stale flag: a user promoted to Assistant or Gamemaster no longer needs it. It would only come back to
  // life if they were demoted again.
  if (isActiveGMClient() && ("role" in changes) && roleIsGM(changes.role) && (flagOf(user) !== undefined)) {
    clearFlag(user);
  }

  knownFlags.set(user.id, flagOf(user));
  return false;
}

/**
 * The flag value from before an unwanted edit. The GM's own record is trusted first, because the stash in the
 * update options comes from the (possibly modified) editing client.
 * @param {User} user
 * @param {object} [options]
 * @returns {unknown}
 */
function previousFlag(user, options) {
  if (knownFlags.has(user.id)) return knownFlags.get(user.id);
  const stash = options?.[STASH_OPTION];
  if (stash && (typeof stash === "object") && !stash.unset) return stash.value;
  return undefined;
}

/**
 * @param {User} user
 * @param {unknown} previous   The value to restore; undefined removes the flag.
 * @returns {Promise<void>}
 */
async function restoreFlag(user, previous) {
  const change = (previous === undefined)
    ? {[`flags.${MODULE_ID}.-=${FLAG}`]: null}
    : {[FIELD_NAME]: previous};
  try {
    await user.update(change, {[REVERT_OPTION]: true});
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not restore the display flag of ${user.name}.`, err);
  }
}

/**
 * @param {User} user
 * @returns {Promise<void>}
 */
function clearFlag(user) {
  return restoreFlag(user, undefined);
}

/* -------------------------------------------- */
/*  GM action: fit the scene to its background  */
/* -------------------------------------------- */

/**
 * The scene directory and scene navigation share the `getSceneContextOptions` hook, but only the directory
 * rows carry `data-entry-id`. The entry is hidden wherever no scene can be resolved.
 * @param {HTMLElement} li
 * @returns {Scene | undefined}
 */
function sceneOf(li) {
  const id = sceneIdFromMenuEntry(li);
  return id ? game.scenes.get(id) : undefined;
}

/**
 * @param {object} app
 * @param {object[]} menuItems
 */
function onSceneContextOptions(app, menuItems) {
  if (!Array.isArray(menuItems)) return;
  menuItems.push({
    label: "HELPERHUB.FitSceneName",
    icon: "fa-solid fa-expand",
    visible: li => game.user.isGM && !!sceneOf(li),
    onClick: (event, li) => {
      const scene = sceneOf(li);
      if (scene) void fitSceneToBackground(scene);
    }
  });
}

/**
 * Resize the scene to its background image after confirmation, as the scene configuration does for a size
 * change: the update carries `autoReposition: true` so placed objects (tokens, walls, lights, ...) move with the
 * scene rectangle, and `grid.size` is passed explicitly so the grid is not rescaled with the new dimensions.
 * Size, padding, shift, and the initial level's background placement go in one Scene update. The level is
 * updated through the `levels` array, as the scene configuration does.
 * Failures are reported with a notification and never rejected.
 * @param {Scene} scene
 * @returns {Promise<void>}
 */
async function fitSceneToBackground(scene) {
  if (!game.user.isGM) return;
  try {
    await runSceneFit(scene);
  } catch (err) {
    console.error(`${MODULE_ID} | Could not fit ${scene?.name} to its background.`, err);
    ui.notifications.error("HELPERHUB.FitSceneUpdateFailed", {localize: true});
  }
}

/**
 * @param {Scene} scene
 * @returns {Promise<void>}
 */
async function runSceneFit(scene) {
  const level = scene.initialLevel;
  const src = level?.background?.src;
  if (!src) {
    ui.notifications.warn("HELPERHUB.FitSceneNoBackground", {localize: true});
    return;
  }

  let update = null;
  try {
    await foundry.canvas.TextureLoader.loader.load([src], {
      localize: true,
      message: "SCENE.DeterminingDimensions"
    });
    const texture = foundry.canvas.getTexture(src);
    update = sceneFitUpdate({imageWidth: texture?.width, imageHeight: texture?.height});
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not load ${src}.`, err);
  }
  if (!update) {
    ui.notifications.error("HELPERHUB.FitSceneFailed", {localize: true});
    return;
  }

  // Changing the scene size moves the scene rectangle, not the placed objects, unless they are repositioned.
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: {title: "HELPERHUB.FitSceneConfirmTitle"},
    content: `<p>${game.i18n.localize("HELPERHUB.FitSceneConfirm")}</p>`
  });
  if (!confirmed) return;

  const updated = await scene.update({
    ...update,
    "grid.size": scene._source.grid.size,
    levels: [{
      _id: level.id,
      textures: {fit: "fill", offsetX: 0, offsetY: 0, anchorX: 0.5, anchorY: 0.5, scaleX: 1, scaleY: 1, rotation: 0}
    }]
  }, {autoReposition: true});
  if (updated) ui.notifications.info("HELPERHUB.FitSceneDone", {localize: true, format: {name: scene.name}});
}
