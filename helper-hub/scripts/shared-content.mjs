import {isDisplayScreen} from "./display-screen.mjs";

const MODULE_ID = "helper-hub";

/** Module socket channel. Needs `"socket": true` in module.json. */
export const SOCKET_EVENT = `module.${MODULE_ID}`;

export const MESSAGE_TYPE = "closeShared";
export const SCROLL_MESSAGE_TYPE = "scrollShared";
export const KIND_IMAGE = "image";
export const KIND_JOURNAL = "journal";

/** `closeShared` kind that closes every window opened as shared content on the receiver. */
export const KIND_ALL = "all";

/** Classes put on the window element of content that was shown to this client. */
export const SHARED_CLASS = "helper-hub-shared";
const KIND_CLASSES = {
  [KIND_IMAGE]: "helper-hub-shared-image",
  [KIND_JOURNAL]: "helper-hub-shared-journal"
};

/** How long a received "show journal" request waits for its sheet to render. */
const PENDING_TTL_MS = 20000;

/**
 * Longest string accepted as an identifier. A longer image source (a `data:` URL, for example) is not rejected:
 * it is reduced to a short stable hash by normalizeSrc, so the sender and every receiver still agree on it.
 */
const MAX_STRING = 2048;

/** The element of a journal sheet that scrolls its pages (templates/journal/pages.hbs). */
export const SCROLL_SELECTOR = ".journal-entry-pages";

/** At most one scroll message per interval from the GM, plus a trailing one so the final position always arrives. */
const SCROLL_INTERVAL_MS = 100;

/** Delay before the GM sends the initial scroll state; the GM's own sheet may still be navigating to the page. */
const INITIAL_SYNC_DELAY_MS = 600;

/** Remembered scroll states for journals that have not rendered on this client yet. */
const MAX_BUFFERED_SCROLLS = 8;

/** Shared images remembered on the GM client. */
const MAX_TRACKED_IMAGES = 50;

const VIEW_MODE_NAMES = ["single", "multiple"];

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

/**
 * @param {unknown} value
 * @returns {string | null}   A trimmed, non-empty, bounded string, or null.
 */
function cleanString(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return (text && (text.length <= MAX_STRING)) ? text : null;
}

/**
 * A short, stable, non-cryptographic hash (cyrb53) of a string. It only has to make equal inputs agree.
 * @param {string} text
 * @returns {string}   Base 36, at most 11 characters.
 */
export function shortHash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The identifier of an image source. Short sources are kept as they are (trimmed); a source longer than the
 * identifier limit becomes `hash:<length>:<hash>`. The result is short, so normalizing it again changes nothing.
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeSrc(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return (text.length <= MAX_STRING) ? text : `hash:${text.length}:${shortHash(text)}`;
}

/**
 * Classes for the window of shared content of a kind: the common class plus a kind class.
 * @param {string} kind   "image" or "journal".
 * @returns {string[]}    Empty for an unknown kind.
 */
export function sharedClassesFor(kind) {
  const kindClass = Object.hasOwn(KIND_CLASSES, kind) ? KIND_CLASSES[kind] : null;
  return kindClass ? [SHARED_CLASS, kindClass] : [];
}

/**
 * Is this element the window of shared content? Exactly the elements carrying the shared class.
 * @param {{classList?: {contains?: (name: string) => boolean}} | null | undefined} element
 * @returns {boolean}
 */
export function isSharedContentElement(element) {
  return element?.classList?.contains?.(SHARED_CLASS) === true;
}

/**
 * Split the UUID passed to the `showEntry` event. A page UUID has a `JournalEntryPage.<id>` tail; the journal
 * entry UUID is everything before it.
 * @param {unknown} uuid
 * @returns {{entryUuid: string, pageId: string | null} | null}
 */
export function journalShareKeys(uuid) {
  const text = cleanString(uuid);
  if (!text) return null;
  const parts = text.split(".");
  const index = parts.lastIndexOf("JournalEntryPage");
  if (index < 0) return {entryUuid: text, pageId: null};
  const entryUuid = parts.slice(0, index).join(".");
  const pageId = cleanString(parts[index + 1]);
  if (!entryUuid || !parts[index - 1]) return null;
  return {entryUuid, pageId};
}

/**
 * What an image popout shows. `src` is exactly what `shareImage` sends and `_handleShareImage` receives (after
 * normalizeSrc, which only changes sources over the length limit).
 * @param {{src?: unknown, uuid?: unknown}} [options]   ImagePopout#options
 * @returns {{kind: "image", src: string, uuid: string | null} | null}
 */
export function imageIdentity({src, uuid} = {}) {
  const cleanSrc = normalizeSrc(src);
  if (!cleanSrc) return null;
  return {kind: KIND_IMAGE, src: cleanSrc, uuid: cleanString(uuid)};
}

/**
 * What a journal sheet shows.
 * @param {{entryUuid?: unknown, pageId?: unknown}} [input]
 * @returns {{kind: "journal", entryUuid: string, pageId: string | null} | null}
 */
export function journalIdentity({entryUuid, pageId} = {}) {
  const cleanUuid = cleanString(entryUuid);
  if (!cleanUuid) return null;
  return {kind: KIND_JOURNAL, entryUuid: cleanUuid, pageId: cleanString(pageId)};
}

/**
 * Build the `closeShared` socket payload for something the GM shared. Only identifiers are sent; the sender's
 * identity comes from the server (see parseCloseShared).
 * @param {object | null | undefined} identity   From imageIdentity or journalIdentity, or `{kind: "all"}`.
 * @returns {{type: "closeShared", kind: string, src?: string, uuid?: string, entryUuid?: string, pageId?: string} | null}
 */
export function closeSharedMessage(identity) {
  if (!identity || (typeof identity !== "object")) return null;
  if (identity.kind === KIND_ALL) return {type: MESSAGE_TYPE, kind: KIND_ALL};
  if (identity.kind === KIND_IMAGE) {
    const src = normalizeSrc(identity.src);
    if (!src) return null;
    const message = {type: MESSAGE_TYPE, kind: KIND_IMAGE, src};
    const uuid = cleanString(identity.uuid);
    if (uuid) message.uuid = uuid;
    return message;
  }
  if (identity.kind === KIND_JOURNAL) {
    const entryUuid = cleanString(identity.entryUuid);
    if (!entryUuid) return null;
    const message = {type: MESSAGE_TYPE, kind: KIND_JOURNAL, entryUuid};
    const pageId = cleanString(identity.pageId);
    if (pageId) message.pageId = pageId;
    return message;
  }
  return null;
}

/**
 * Validate a received socket payload. The server appends the sending user's id to custom module events
 * (`handleCustomSocket` emits `(data, userId)`), so `senderIsGM` comes from `game.users.get(userId)?.isGM`.
 * The identifiers are rebuilt from known fields only, so extra data is dropped.
 * @param {unknown} data
 * @param {{senderIsGM?: boolean}} [context]
 * @returns {ReturnType<typeof closeSharedMessage>}   Null unless the sender is a GM and the payload is valid.
 */
export function parseCloseShared(data, {senderIsGM} = {}) {
  if (senderIsGM !== true) return null;
  if (!data || (typeof data !== "object") || (data.type !== MESSAGE_TYPE)) return null;
  return closeSharedMessage(data);
}

/**
 * Does a received `closeShared` message target the window with this identity? Images match by `src` (the
 * related uuid is not enough: one actor has several images). Journals match by journal entry, not by page,
 * because the viewer may have turned to another page. Kind "all" matches every window that has an identity.
 * Any other message without usable identifiers matches nothing.
 * @param {object | null | undefined} identity   Computed from the open window.
 * @param {object | null | undefined} message    A parsed message.
 * @returns {boolean}
 */
export function sharedMatches(identity, message) {
  if (!identity || !message) return false;
  if (message.kind === KIND_ALL) return (identity.kind === KIND_IMAGE) || (identity.kind === KIND_JOURNAL);
  if (identity.kind !== message.kind) return false;
  if (message.kind === KIND_IMAGE) return !!message.src && (identity.src === message.src);
  if (message.kind === KIND_JOURNAL) return !!message.entryUuid && (identity.entryUuid === message.entryUuid);
  return false;
}

/**
 * Should the GM broadcast `closeShared` when this window closes by itself (not through "Close for everyone")?
 * @param {{isGM?: boolean, sharedByMe?: boolean, alreadyBroadcast?: boolean}} [state]
 * @returns {boolean}
 */
export function shouldBroadcastOnClose({isGM, sharedByMe, alreadyBroadcast} = {}) {
  return isGM === true && sharedByMe === true && alreadyBroadcast !== true;
}

/**
 * May a window show the "Close for everyone" header control? Only a GM, and only for windows that were shared
 * (by this GM) or received as shared content. A GM's own working windows never get it.
 * @param {{isGM?: boolean, sharedByMe?: boolean, received?: boolean}} [state]
 * @returns {boolean}
 */
export function canCloseForEveryone({isGM, sharedByMe, received} = {}) {
  return isGM === true && ((sharedByMe === true) || (received === true));
}

/**
 * Should a pending "show journal" request be claimed by this render, marking the sheet as shared content?
 * Only the first render of the sheet can be the one the show request opened: a sheet the user already had open
 * keeps being the user's own (closing it for them could lose unsaved edits). A GM's sheet is a working
 * document and is never marked as received, whatever opened it.
 * @param {{isFirstRender?: boolean, isGM?: boolean}} [state]
 * @returns {boolean}
 */
export function shouldClaimJournal({isFirstRender, isGM} = {}) {
  return isFirstRender === true && isGM !== true;
}

/**
 * Journal show requests that arrived but whose sheet has not rendered yet. The `showEntry` handler renders the
 * sheet without awaiting it, so the request is remembered and taken by the sheet's render hook.
 * Entries expire so a request that never rendered (no permission) cannot mark a later, unrelated render.
 * @param {{ttl?: number, now?: () => number}} [options]
 * @returns {{add: (key: unknown) => void, take: (key: unknown) => boolean, clear: () => void, readonly size: number}}
 */
export function createPendingShares({ttl = PENDING_TTL_MS, now = () => Date.now()} = {}) {
  /** @type {Map<string, number>} */
  const pending = new Map();
  const prune = () => {
    const time = now();
    for (const [key, expires] of pending) if (expires <= time) pending.delete(key);
  };
  return {
    get size() {
      prune();
      return pending.size;
    },
    add(key) {
      const text = cleanString(key);
      if (!text) return;
      prune();
      pending.set(text, now() + ttl);
    },
    take(key) {
      const text = cleanString(key);
      if (!text) return false;
      prune();
      return pending.delete(text);
    },
    clear() {
      pending.clear();
    }
  };
}

/* -------------------------------------------- */
/*  Scroll mirroring                            */
/* -------------------------------------------- */

/**
 * @param {unknown} value
 * @returns {number | null}   The number clamped to 0..1, or null if it is not a finite number.
 */
export function clampFraction(value) {
  if ((typeof value !== "number") || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/**
 * Where a scroll container is, as a fraction of its scrollable range.
 * @param {{scrollTop?: number, scrollHeight?: number, clientHeight?: number}} [box]
 * @returns {number}   0..1; 0 when nothing scrolls.
 */
export function scrollFraction({scrollTop, scrollHeight, clientHeight} = {}) {
  const range = scrollHeight - clientHeight;
  if (![scrollTop, scrollHeight, clientHeight].every(Number.isFinite) || (range <= 0)) return 0;
  return clampFraction(scrollTop / range) ?? 0;
}

/**
 * The `scrollTop` that puts a scroll container at a fraction of its scrollable range.
 * @param {unknown} fraction
 * @param {{scrollHeight?: number, clientHeight?: number}} [box]
 * @returns {number}   Whole pixels, never negative.
 */
export function scrollTopFor(fraction, {scrollHeight, clientHeight} = {}) {
  const value = clampFraction(fraction);
  const range = scrollHeight - clientHeight;
  if ((value === null) || !Number.isFinite(range) || (range <= 0)) return 0;
  return Math.round(value * range);
}

/**
 * The `scrollShared` payload: where the GM's shared journal is.
 * @param {{entryUuid?: unknown, pageId?: unknown, viewMode?: unknown, scroll?: unknown}} [state]
 * @returns {{type: "scrollShared", entryUuid: string, scroll: number, pageId?: string, viewMode?: string} | null}
 */
export function scrollSharedMessage({entryUuid, pageId, viewMode, scroll} = {}) {
  const uuid = cleanString(entryUuid);
  const fraction = clampFraction(scroll);
  if (!uuid || (fraction === null)) return null;
  const message = {type: SCROLL_MESSAGE_TYPE, entryUuid: uuid, scroll: Math.round(fraction * 10000) / 10000};
  const page = cleanString(pageId);
  if (page) message.pageId = page;
  if (VIEW_MODE_NAMES.includes(viewMode)) message.viewMode = viewMode;
  return message;
}

/**
 * Validate a received `scrollShared` payload: only from a GM, only known fields, the position clamped to 0..1.
 * @param {unknown} data
 * @param {{senderIsGM?: boolean}} [context]
 * @returns {ReturnType<typeof scrollSharedMessage>}
 */
export function parseScrollShared(data, {senderIsGM} = {}) {
  if (senderIsGM !== true) return null;
  if (!data || (typeof data !== "object") || (data.type !== SCROLL_MESSAGE_TYPE)) return null;
  return scrollSharedMessage(data);
}

/**
 * What the receiving sheet must re-render with to show what the GM shows. Null when it already does.
 * Turning pages only exists in single-page mode; in multi-page mode the scroll position carries the page.
 * @param {{pageId?: string, viewMode?: string}} message   A parsed scrollShared message.
 * @param {{pageId?: string, isMultiple?: boolean}} current   The receiving sheet.
 * @returns {{viewMode?: string, pageId?: string} | null}
 */
export function scrollRenderPlan(message, {pageId, isMultiple} = {}) {
  const wantMultiple = message?.viewMode ? (message.viewMode === "multiple") : (isMultiple === true);
  const plan = {};
  const modeChanged = wantMultiple !== (isMultiple === true);
  if (modeChanged) plan.viewMode = wantMultiple ? "multiple" : "single";
  const pageChanged = !wantMultiple && !!message?.pageId && (message.pageId !== pageId);
  if (message?.pageId && (modeChanged || pageChanged)) plan.pageId = message.pageId;
  return Object.keys(plan).length ? plan : null;
}

/**
 * A trailing-edge throttle: calls at most once per interval, and always once more after the last request.
 * @param {() => void} fn
 * @param {number} interval   Milliseconds.
 * @param {{now?: () => number, setTimer?: Function, clearTimer?: Function}} [clock]
 * @returns {(() => void) & {flush: () => void, cancel: () => void}}
 */
export function createThrottle(fn, interval, {
  now = () => Date.now(),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = id => clearTimeout(id)
} = {}) {
  let last = -Infinity;
  let timer = null;
  let queued = false;
  const run = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    queued = false;
    last = now();
    fn();
  };
  const throttled = () => {
    const wait = last + interval - now();
    if (wait <= 0) {
      run();
      return;
    }
    queued = true;
    if (timer === null) timer = setTimer(() => {
      timer = null;
      if (queued) run();
    }, wait);
  };
  throttled.flush = () => {
    if (queued) run();
  };
  throttled.cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    queued = false;
  };
  return throttled;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const IMAGE_POPOUT_PATH = "foundry.applications.apps.ImagePopout";
const JOURNAL_PATH = "foundry.documents.collections.Journal";

/**
 * Windows opened by a `shareImage` or `showEntry` request received by this client.
 *
 * Policy: a GM client never records a journal sheet here, because a GM's journal sheet is a working document
 * (it may hold unsaved edits and another GM's "close" must not touch it). A GM client does record image popouts
 * it received, because those are only displays. So a `closeShared` from one GM closes received image popouts on
 * other GMs, never their journal sheets. A GM's own shared windows are tracked in `sharedByMe` instead.
 */
const receivedShared = new Set();

/** Windows the GM shared from this client; closing one closes it for everyone. */
const sharedByMe = new Set();

/** Images the GM shared through `Journal.showImage`, which has no window to close. Keyed by identity src. */
const sharedImagesByMe = new Map();

/** Image identity broadcast by `shareImage` when it differs from the popout's own `options.src`. */
const identityOverrides = new WeakMap();

/** Windows whose `closeShared` has already been broadcast. */
const broadcasted = new WeakSet();

const pendingJournals = createPendingShares();

/** Last scroll state received per journal entry, applied when its shared sheet first renders. */
const latestScroll = new Map();

/** Throttled GM scroll senders per sheet, the elements already watched, and the newest scroll request per sheet. */
const scrollSenders = new WeakMap();
const watchedFrames = new WeakSet();
const scrollTokens = new WeakMap();

let registered = false;
let listening = false;

/**
 * Hooks, wrappers, and the socket listener. Call from `init`. Wrapping must happen before the game activates its
 * socket listeners (they capture `_showEntry` and `_handleShareImage` by reference just before `ready`). The
 * socket listener itself is added in `setup`: `game.socket` exists from construction, and a listener added there
 * is in place before the buffered socket events are replayed, which happens just before `ready`.
 */
export function registerSharedContent() {
  if (registered) return;
  registered = true;

  Hooks.on("renderImagePopout", (app, element) => onRenderShared(app, element, KIND_IMAGE));
  Hooks.on("renderJournalEntrySheet", (app, element, context, options) => {
    onRenderShared(app, element, KIND_JOURNAL, options);
  });
  Hooks.on("closeImagePopout", onCloseShared);
  Hooks.on("closeJournalEntrySheet", onCloseShared);
  Hooks.on("getHeaderControlsImagePopout", (app, controls) => addCloseControl(app, controls));
  Hooks.on("getHeaderControlsJournalEntrySheet", (app, controls) => addCloseControl(app, controls));
  Hooks.on("getUserContextOptions", onUserContextOptions);
  Hooks.once("setup", onSetup);

  patchStatic(`${IMAGE_POPOUT_PATH}._handleShareImage`, wrapReceivedImage);
  patchStatic(`${JOURNAL_PATH}._showEntry`, wrapReceivedEntry);
  patchStatic(`${JOURNAL_PATH}.show`, wrapShownEntry);
  patchStatic(`${JOURNAL_PATH}.showImage`, wrapShowImage);
  patchStatic(`${IMAGE_POPOUT_PATH}.prototype.shareImage`, wrapShareImage);
}

/**
 * Wrap a method. libWrapper when present; otherwise a plain replacement.
 * @param {string} target   Path from globalThis.
 * @param {Function} wrapper   Called as wrapper(wrapped, ...args) with the original `this`.
 */
function patchStatic(target, wrapper) {
  if (globalThis.libWrapper) {
    try {
      libWrapper.register(MODULE_ID, target, wrapper, "WRAPPER");
      return;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not wrap ${target} with libWrapper.`, err);
    }
  }
  const index = target.lastIndexOf(".");
  const owner = resolvePath(target.slice(0, index));
  const name = target.slice(index + 1);
  if (!owner || (typeof owner[name] !== "function")) {
    console.warn(`${MODULE_ID} | Could not find ${target}; shared content will not be tracked.`);
    return;
  }
  const original = owner[name];
  owner[name] = function (...args) {
    return wrapper.call(this, original.bind(this), ...args);
  };
}

/**
 * @param {string} path
 * @returns {object | undefined}
 */
function resolvePath(path) {
  return path.split(".").reduce((value, key) => value?.[key], globalThis);
}

/**
 * `setup` work: the socket listener and the small public API (`game.modules.get("helper-hub").api.closeShared`).
 */
function onSetup() {
  listenForSocket();
  const module = game.modules?.get(MODULE_ID);
  if (!module) return;
  try {
    module.api = Object.assign(module.api ?? {}, {closeShared: closeSharedForEveryone});
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not publish the shared content API.`, err);
  }
}

/**
 * @param {unknown} element
 * @returns {boolean}   Does this look like a DOM element? (Duck typed; the module is importable without a DOM.)
 */
function isElementLike(element) {
  return !!element && (typeof element === "object") && (typeof element.classList?.add === "function");
}

/**
 * @param {object} app
 * @param {unknown} element   The element passed to the render hook, if any.
 * @returns {HTMLElement | null}
 */
function frameOf(app, element) {
  if (isElementLike(element)) return element;
  return isElementLike(app?.element) ? app.element : null;
}

/**
 * `ImagePopout._handleShareImage` creates and renders the popout and returns it. It is registered as a socket
 * handler, so it also receives the sender's data with whatever `this` the socket gives it.
 * @param {Function} wrapped
 * @param {...unknown} args
 * @returns {object | undefined}
 */
function wrapReceivedImage(wrapped, ...args) {
  const popout = wrapped(...args);
  if (popout && (typeof popout === "object")) receivedShared.add(popout);
  return popout;
}

/**
 * `Journal._showEntry(uuid, force)` renders the entry's sheet without awaiting it, so only the entry is noted
 * here and the sheet's render hook decides whether to claim it (see shouldClaimJournal).
 * @param {Function} wrapped
 * @param {unknown} uuid
 * @param {...unknown} rest
 * @returns {unknown}
 */
function wrapReceivedEntry(wrapped, uuid, ...rest) {
  const keys = journalShareKeys(uuid);
  if (keys) pendingJournals.add(keys.entryUuid);
  return wrapped(uuid, ...rest);
}

/**
 * GM side of `Journal.show(doc, options)` (also behind JournalEntry#show and the "Show Players" dialog). Its
 * promise resolves after the local `_showEntry`, so the entry's sheet exists by then.
 * @param {Function} wrapped
 * @param {object} doc   A JournalEntry or JournalEntryPage.
 * @param {...unknown} rest
 * @returns {Promise<unknown>}
 */
async function wrapShownEntry(wrapped, doc, ...rest) {
  const result = await wrapped(doc, ...rest);
  if (!game.user.isGM || !result) return result;
  // `show` resolves to the shown JournalEntry or JournalEntryPage; a page is shown through its parent's sheet.
  const entry = (result.documentName === "JournalEntryPage") ? result.parent : result;
  const sheet = entry?.sheet;
  if (!sheet) return result;
  sharedByMe.add(sheet);
  // Let the displays start from the GM's page and scroll position once the GM's own sheet has settled.
  const timer = setTimeout(() => sendScroll(sheet), INITIAL_SYNC_DELAY_MS);
  timer?.unref?.();
  return result;
}

/**
 * GM side of `Journal.showImage(src, options)`, which emits `shareImage` without any popout. What it emits is
 * `{image: src, users, ...options}`, so `options.image` wins over `src`. The image is remembered so the GM can
 * close it for everyone ("close all shared" or `api.closeShared({kind: "image", src})`).
 * @param {Function} wrapped
 * @param {unknown} src
 * @param {...unknown} rest
 * @returns {unknown}
 */
function wrapShowImage(wrapped, src, ...rest) {
  const result = wrapped(src, ...rest);
  if (!game.user?.isGM) return result;
  const options = rest[0];
  const identity = imageIdentity({src: options?.image ?? src, uuid: options?.uuid});
  if (identity) {
    sharedImagesByMe.delete(identity.src);
    sharedImagesByMe.set(identity.src, identity);
    while (sharedImagesByMe.size > MAX_TRACKED_IMAGES) sharedImagesByMe.delete(sharedImagesByMe.keys().next().value);
  }
  return result;
}

/**
 * GM side of `ImagePopout#shareImage`. The popout the GM shared from is remembered, under the identity that was
 * broadcast: core sends `options.image ?? this.options.src`, so receivers' popouts show `options.image`.
 * @param {Function} wrapped
 * @param {...unknown} args
 * @returns {unknown}
 */
function wrapShareImage(wrapped, ...args) {
  const result = wrapped(...args);
  if (!game.user.isGM || !this || (typeof this !== "object")) return result;
  sharedByMe.add(this);
  const options = args[0];
  const sent = (typeof options?.image === "string") ? imageIdentity({
    src: options.image,
    uuid: options.uuid ?? this.options?.uuid
  }) : null;
  if (sent) identityOverrides.set(this, sent);
  else identityOverrides.delete(this);
  return result;
}

/**
 * @param {object} app
 * @returns {object | null}   What the window shows.
 */
function identityOf(app) {
  const override = identityOverrides.get(app);
  if (override) return override;
  const ImagePopout = globalThis.foundry?.applications?.apps?.ImagePopout;
  if ((typeof ImagePopout === "function") && (app instanceof ImagePopout)) return imageIdentity(app.options);
  if (app?.document?.uuid) return journalIdentity({entryUuid: app.document.uuid, pageId: app.pageId});
  return null;
}

/**
 * Give windows that were shown to this client the shared classes. Runs on every render, since the class
 * names are cheap to re-apply and the frame survives re-renders.
 *
 * Shared windows are all `position: fixed; inset: 0` on the display screen, so they stack: the newest covers
 * the others, and closing it reveals the previous one.
 * @param {object} app
 * @param {HTMLElement} [element]
 * @param {string} kind
 * @param {{isFirstRender?: boolean, pageChanged?: boolean, modeChanged?: boolean}} [options]   Render options
 */
function onRenderShared(app, element, kind, options) {
  let claimed = false;
  if (kind === KIND_JOURNAL) {
    // A request is always consumed by the next render of that entry, so it cannot mark a later, unrelated one.
    const pending = pendingJournals.take(app?.document?.uuid);
    if (pending && shouldClaimJournal({isFirstRender: options?.isFirstRender, isGM: game.user?.isGM})) {
      receivedShared.add(app);
      claimed = true;
    }
    if (game.user?.isGM) {
      watchScroll(app, element);
      if (sharedByMe.has(app) && (options?.pageChanged || options?.modeChanged)) sendScroll(app);
    }
  }
  if (!receivedShared.has(app)) return;
  const frame = frameOf(app, element);
  if (frame) frame.classList.add(...sharedClassesFor(kind));
  if (claimed) {
    const buffered = latestScroll.get(app.document?.uuid);
    if (buffered) void applyScroll(app, buffered);
  }
}

/**
 * Forget a closed window. A GM's own shared window closing tells everyone else to close theirs.
 * @param {object} app
 */
function onCloseShared(app) {
  const identity = receivedShared.delete(app) ? identityOf(app) : null;
  if (identity?.kind === KIND_JOURNAL) latestScroll.delete(identity.entryUuid);
  scrollSenders.get(app)?.cancel();
  scrollSenders.delete(app);
  const mine = sharedByMe.delete(app);
  const send = shouldBroadcastOnClose({
    isGM: game.user.isGM,
    sharedByMe: mine,
    alreadyBroadcast: broadcasted.has(app)
  });
  if (send) broadcastClose(app);
  broadcasted.delete(app);
}

/**
 * @param {object} app
 */
function broadcastClose(app) {
  const message = closeSharedMessage(identityOf(app));
  if (!message) return;
  broadcasted.add(app);
  game.socket.emit(SOCKET_EVENT, message);
}

/**
 * Close the window of shared content without the closing transition. The display screen's shared windows have
 * `max-height: none !important`, which would make Foundry wait for the full one second transition timeout.
 * @param {object} app
 */
function closeWithoutAnimation(app) {
  Promise.resolve(app.close({animate: false})).catch(err => {
    console.warn(`${MODULE_ID} | Could not close a shared window.`, err);
  });
}

/**
 * The GM's "Close for everyone" header control: close on every other client, then here. It only shows on
 * windows that were shared or received as shared content, and `visible` is checked each time the header is
 * updated or the controls menu opens.
 * @param {object} app
 * @param {object[]} controls
 */
function addCloseControl(app, controls) {
  if (!Array.isArray(controls)) return;
  controls.push({
    icon: "fa-solid fa-circle-xmark",
    label: "HELPERHUB.CloseForEveryone",
    action: "helperHubCloseForEveryone",
    visible: () => canCloseForEveryone({
      isGM: game.user?.isGM,
      sharedByMe: sharedByMe.has(app),
      received: receivedShared.has(app)
    }),
    onClick: () => {
      if (!game.user.isGM) return;
      if (!broadcasted.has(app)) broadcastClose(app);
      sharedByMe.delete(app);
      if (receivedShared.has(app)) closeWithoutAnimation(app);
      else void app.close();
    }
  });
}

/**
 * GM only entry in the players list context menu: close everything shown to players, including images shown
 * without a window.
 * @param {object} _app
 * @param {object[]} menuItems
 */
function onUserContextOptions(_app, menuItems) {
  if (!Array.isArray(menuItems)) return;
  menuItems.push({
    label: "HELPERHUB.CloseAllShared",
    icon: "fa-solid fa-eye-slash",
    visible: () => game.user?.isGM === true,
    onClick: () => {
      closeSharedForEveryone();
    }
  });
}

/**
 * Close shared content on every other client. GM only; receivers verify the sender again.
 * @param {{kind: string, src?: string, entryUuid?: string}} [target]   Omit to close everything shown.
 * @returns {boolean}   Whether a message was sent.
 */
export function closeSharedForEveryone(target = {kind: KIND_ALL}) {
  if (!game.user?.isGM) return false;
  const message = closeSharedMessage(target);
  if (!message) return false;
  game.socket.emit(SOCKET_EVENT, message);
  // The GM's own windows stay open (they are working windows) but stop being "shared".
  if (message.kind === KIND_ALL) {
    sharedImagesByMe.clear();
    sharedByMe.clear();
    return true;
  }
  if (message.kind === KIND_IMAGE) sharedImagesByMe.delete(message.src);
  for (const app of [...sharedByMe]) if (sharedMatches(identityOf(app), message)) sharedByMe.delete(app);
  return true;
}

/* -------------------------------------------- */
/*  Socket                                      */
/* -------------------------------------------- */

/**
 * Receive `closeShared` and `scrollShared`. Registered once, in `setup`.
 */
function listenForSocket() {
  if (listening) return;
  if (!game.socket) {
    console.warn(`${MODULE_ID} | The game socket is not available; shared content cannot be closed remotely.`);
    return;
  }
  listening = true;
  game.socket.on(SOCKET_EVENT, onSocketMessage);
}

/**
 * `senderId` is added by the server, so it cannot be forged by the sender.
 * @param {unknown} data
 * @param {string} [senderId]
 */
function onSocketMessage(data, senderId) {
  const senderIsGM = game.users?.get(senderId)?.isGM === true;
  const close = parseCloseShared(data, {senderIsGM});
  if (close) {
    handleClose(close);
    return;
  }
  const scroll = parseScrollShared(data, {senderIsGM});
  if (scroll) handleScroll(scroll);
}

/**
 * @param {NonNullable<ReturnType<typeof parseCloseShared>>} message
 */
function handleClose(message) {
  if (message.kind === KIND_ALL) {
    pendingJournals.clear();
    latestScroll.clear();
  } else if (message.kind === KIND_JOURNAL) {
    pendingJournals.take(message.entryUuid);
    latestScroll.delete(message.entryUuid);
  }
  for (const app of [...receivedShared]) {
    if (!sharedMatches(identityOf(app), message)) continue;
    receivedShared.delete(app);
    sharedByMe.delete(app); // closing because another GM asked must not echo the message back
    closeWithoutAnimation(app);
  }
}

/* -------------------------------------------- */
/*  Scroll mirroring (integration)              */
/* -------------------------------------------- */

/**
 * @param {object} app   A journal sheet.
 * @returns {HTMLElement | null}
 */
function scrollContainerOf(app) {
  const container = app?.element?.querySelector?.(SCROLL_SELECTOR);
  return container ?? null;
}

/**
 * GM side: listen for scrolling of the pages of a journal sheet. `scroll` does not bubble, so the listener is a
 * capturing one on the sheet's element, which survives re-rendering of the pages part. Whether the sheet is
 * shared is checked when the event fires, because it is marked shared after it first renders.
 * @param {object} app
 * @param {unknown} element
 */
function watchScroll(app, element) {
  const frame = frameOf(app, element);
  if (!frame || (typeof frame.addEventListener !== "function") || watchedFrames.has(frame)) return;
  watchedFrames.add(frame);
  frame.addEventListener("scroll", event => {
    if (!sharedByMe.has(app) || !event?.target?.classList?.contains?.(SCROLL_SELECTOR.slice(1))) return;
    let sender = scrollSenders.get(app);
    if (!sender) {
      sender = createThrottle(() => sendScroll(app), SCROLL_INTERVAL_MS);
      scrollSenders.set(app, sender);
    }
    sender();
  }, {capture: true, passive: true});
}

/**
 * GM side: send where the shared journal is (page, mode, and scroll position as a fraction of the range).
 * @param {object} app   A journal sheet.
 */
function sendScroll(app) {
  if (!game.user?.isGM || !sharedByMe.has(app) || !app?.document?.uuid) return;
  const container = scrollContainerOf(app);
  const message = scrollSharedMessage({
    entryUuid: app.document.uuid,
    pageId: app.pageId,
    viewMode: app.isMultiple ? "multiple" : "single",
    scroll: container ? scrollFraction(container) : 0
  });
  if (message) game.socket.emit(SOCKET_EVENT, message);
}

/**
 * @returns {boolean}   Is this client a display screen (a non-GM account with the display flag)?
 */
function isDisplayClient() {
  const user = game.user;
  return isDisplayScreen({isGM: user?.isGM === true, flag: user?.getFlag?.(MODULE_ID, "displayScreen")});
}

/**
 * @param {NonNullable<ReturnType<typeof parseScrollShared>>} message
 */
function handleScroll(message) {
  // Only a display screen follows the GM. A player reading a shared journal keeps control of their own scrolling.
  if (!isDisplayClient()) return;
  latestScroll.delete(message.entryUuid);
  latestScroll.set(message.entryUuid, message);
  while (latestScroll.size > MAX_BUFFERED_SCROLLS) latestScroll.delete(latestScroll.keys().next().value);
  for (const app of receivedShared) {
    if (sharedMatches(identityOf(app), {kind: KIND_JOURNAL, entryUuid: message.entryUuid})) void applyScroll(app, message);
  }
}

/**
 * Display side: bring a received journal to the GM's page and mode, then to the GM's scroll position. Only the
 * newest request for a sheet is applied.
 * @param {object} app
 * @param {NonNullable<ReturnType<typeof parseScrollShared>>} message
 * @returns {Promise<void>}
 */
async function applyScroll(app, message) {
  const token = (scrollTokens.get(app) ?? 0) + 1;
  scrollTokens.set(app, token);
  const plan = scrollRenderPlan(message, {pageId: app.pageId, isMultiple: app.isMultiple === true});
  if (plan) {
    const modes = app.constructor?.VIEW_MODES ?? {SINGLE: 1, MULTIPLE: 2};
    const options = {};
    if (plan.viewMode) options.mode = (plan.viewMode === "multiple") ? modes.MULTIPLE : modes.SINGLE;
    if (plan.pageId && (!app._pages || (plan.pageId in app._pages))) options.pageId = plan.pageId;
    // A page this client cannot see was filtered out above; with nothing left to change there is no render.
    if (Object.keys(options).length) {
      try {
        await app.render(options);
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not turn the shared journal to the GM's page.`, err);
        return;
      }
      if (scrollTokens.get(app) !== token) return;
    }
  }
  const place = () => {
    const container = scrollContainerOf(app);
    if (container) container.scrollTop = scrollTopFor(message.scroll, container);
  };
  place();
  // Images and embedded content can still change the height right after a render.
  globalThis.requestAnimationFrame?.(() => {
    if (scrollTokens.get(app) === token) place();
  });
}
