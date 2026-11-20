/**
 * Shared content helpers (display screen popouts, "Close for everyone"). Run with node; Foundry is not required.
 * node helper-hub/tests/shared-content.test.mjs
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const forbidden = ["game", "Hooks", "PIXI", "canvas", "document", "ui"];
for (const name of forbidden) assert.equal(globalThis[name], undefined, `${name} must start undefined`);

const {
  KIND_ALL,
  SHARED_CLASS,
  SOCKET_EVENT,
  canCloseForEveryone,
  clampFraction,
  closeSharedMessage,
  createPendingShares,
  createThrottle,
  imageIdentity,
  isSharedContentElement,
  journalIdentity,
  journalShareKeys,
  normalizeSrc,
  parseCloseShared,
  parseScrollShared,
  registerSharedContent,
  scrollFraction,
  scrollRenderPlan,
  scrollSharedMessage,
  scrollTopFor,
  sharedClassesFor,
  sharedMatches,
  shortHash,
  shouldBroadcastOnClose,
  shouldClaimJournal
} = await import("../scripts/shared-content.mjs");

for (const name of forbidden) assert.equal(globalThis[name], undefined, `importing must not define ${name}`);

// Channel and classes
assert.equal(SOCKET_EVENT, "module.helper-hub");
assert.deepEqual(sharedClassesFor("image"), [SHARED_CLASS, "helper-hub-shared-image"]);
assert.deepEqual(sharedClassesFor("journal"), [SHARED_CLASS, "helper-hub-shared-journal"]);
assert.deepEqual(sharedClassesFor("toString"), []);
assert.deepEqual(sharedClassesFor(undefined), []);

const el = classes => ({classList: {contains: name => classes.includes(name)}});
assert.equal(isSharedContentElement(el([SHARED_CLASS, "application"])), true);
assert.equal(isSharedContentElement(el(["application", "image-popout"])), false);
assert.equal(isSharedContentElement(null), false);
assert.equal(isSharedContentElement({}), false);

// journalShareKeys
assert.deepEqual(journalShareKeys("JournalEntry.abc"), {entryUuid: "JournalEntry.abc", pageId: null});
assert.deepEqual(journalShareKeys("JournalEntry.abc.JournalEntryPage.p1"), {entryUuid: "JournalEntry.abc", pageId: "p1"});
assert.deepEqual(
  journalShareKeys("Compendium.world.notes.JournalEntry.abc.JournalEntryPage.p1"),
  {entryUuid: "Compendium.world.notes.JournalEntry.abc", pageId: "p1"}
);
for (const bad of [undefined, null, "", "  ", 5, {}, "JournalEntryPage.p1", "x".repeat(3000)]) {
  assert.equal(journalShareKeys(bad), null, String(bad).slice(0, 20));
}

// Identities
assert.deepEqual(imageIdentity({src: " a/b.webp ", uuid: "Actor.1"}), {kind: "image", src: "a/b.webp", uuid: "Actor.1"});
assert.deepEqual(imageIdentity({src: "a.png"}), {kind: "image", src: "a.png", uuid: null});
assert.equal(imageIdentity({src: ""}), null);
assert.equal(imageIdentity({}), null);
assert.equal(imageIdentity(), null);

// Oversized sources (data: URLs) are hashed, not dropped, and sender and receiver agree on the result
{
  const dataUrl = `data:image/png;base64,${"A".repeat(5000)}`;
  const identity = imageIdentity({src: dataUrl});
  assert.equal(identity.kind, "image");
  assert.match(identity.src, /^hash:\d+:[0-9a-z]+$/);
  assert.ok(identity.src.length < 40);
  assert.equal(imageIdentity({src: `  ${dataUrl}  `}).src, identity.src, "trimmed first");
  assert.equal(normalizeSrc(identity.src), identity.src, "normalizing is idempotent");
  assert.notEqual(imageIdentity({src: `${dataUrl}B`}).src, identity.src, "other data, other hash");
  const message = closeSharedMessage(identity);
  assert.equal(message.src, identity.src);
  assert.equal(closeSharedMessage({kind: "image", src: dataUrl}).src, identity.src, "raw src is hashed too");
  const parsed = parseCloseShared(message, {senderIsGM: true});
  assert.equal(sharedMatches(identity, parsed), true);
  assert.equal(sharedMatches(imageIdentity({src: `${dataUrl}B`}), parsed), false);
  assert.equal(shortHash("abc"), shortHash("abc"), "stable");
  assert.notEqual(shortHash("abc"), shortHash("abd"));
  assert.equal(shortHash("abc"), "1dtlchkfkb1", "pinned: the hash must not change between versions");
  assert.equal(normalizeSrc("  a.png "), "a.png");
  for (const bad of [undefined, null, "", "   ", 5, {}]) assert.equal(normalizeSrc(bad), null);
}
assert.deepEqual(journalIdentity({entryUuid: "JournalEntry.a", pageId: "p"}), {kind: "journal", entryUuid: "JournalEntry.a", pageId: "p"});
assert.deepEqual(journalIdentity({entryUuid: "JournalEntry.a"}), {kind: "journal", entryUuid: "JournalEntry.a", pageId: null});
assert.equal(journalIdentity({pageId: "p"}), null);

// closeSharedMessage
assert.deepEqual(closeSharedMessage(imageIdentity({src: "a.png", uuid: "Actor.1"})), {
  type: "closeShared", kind: "image", src: "a.png", uuid: "Actor.1"
});
assert.deepEqual(closeSharedMessage(imageIdentity({src: "a.png"})), {type: "closeShared", kind: "image", src: "a.png"});
assert.deepEqual(closeSharedMessage(journalIdentity({entryUuid: "JournalEntry.a", pageId: "p"})), {
  type: "closeShared", kind: "journal", entryUuid: "JournalEntry.a", pageId: "p"
});
assert.deepEqual(closeSharedMessage(journalIdentity({entryUuid: "JournalEntry.a"})), {
  type: "closeShared", kind: "journal", entryUuid: "JournalEntry.a"
});
for (const bad of [null, undefined, 5, "image", {}, {kind: "image"}, {kind: "journal"}, {kind: "other", src: "a"}]) {
  assert.equal(closeSharedMessage(bad), null, JSON.stringify(bad));
}

// Kind "all"
assert.equal(KIND_ALL, "all");
assert.deepEqual(closeSharedMessage({kind: "all"}), {type: "closeShared", kind: "all"});
assert.deepEqual(parseCloseShared({type: "closeShared", kind: "all", src: "x", extra: 1}, {senderIsGM: true}),
  {type: "closeShared", kind: "all"}, "only the known fields");
assert.equal(parseCloseShared({type: "closeShared", kind: "all"}, {senderIsGM: false}), null, "a player cannot close all");

// parseCloseShared: only a GM sender, only a valid payload, only known fields
const imageMessage = {type: "closeShared", kind: "image", src: "a.png", uuid: "Actor.1"};
assert.deepEqual(parseCloseShared(imageMessage, {senderIsGM: true}), imageMessage);
assert.deepEqual(
  parseCloseShared({...imageMessage, extra: "x", __proto__: {polluted: 1}}, {senderIsGM: true}),
  imageMessage
);
for (const senderIsGM of [false, undefined, null, "true", 1]) {
  assert.equal(parseCloseShared(imageMessage, {senderIsGM}), null, `senderIsGM ${String(senderIsGM)}`);
}
assert.equal(parseCloseShared(imageMessage), null);
assert.equal(parseCloseShared(imageMessage, {}), null);
for (const bad of [null, undefined, 3, "closeShared", [], {}, {type: "other", kind: "image", src: "a"},
  {type: "closeShared"}, {type: "closeShared", kind: "image"}, {type: "closeShared", kind: "image", src: 4},
  {type: "closeShared", kind: "journal", entryUuid: ""}, {type: "closeShared", kind: "everything"},
  {type: "closeShared", kind: "toString"}]) {
  assert.equal(parseCloseShared(bad, {senderIsGM: true}), null, JSON.stringify(bad));
}

// sharedMatches
const popout = imageIdentity({src: "a.png", uuid: "Actor.1"});
assert.equal(sharedMatches(popout, {kind: "image", src: "a.png"}), true);
assert.equal(sharedMatches(popout, {kind: "image", src: "a.png", uuid: "Actor.other"}), true, "src decides");
assert.equal(sharedMatches(popout, {kind: "image", src: "b.png", uuid: "Actor.1"}), false, "same uuid, other image");
assert.equal(sharedMatches(popout, {kind: "image", uuid: "Actor.1"}), false, "no src, no match");
assert.equal(sharedMatches(popout, {kind: "journal", entryUuid: "a.png"}), false);
assert.equal(sharedMatches(popout, {kind: "all"}), true, "all closes any image");
assert.equal(sharedMatches(journalIdentity({entryUuid: "JournalEntry.z"}), {kind: "all"}), true, "all closes any journal");
assert.equal(sharedMatches(null, {kind: "all"}), false);
assert.equal(sharedMatches({kind: "other"}, {kind: "all"}), false);
const sheet = journalIdentity({entryUuid: "JournalEntry.a", pageId: "p2"});
assert.equal(sharedMatches(sheet, {kind: "journal", entryUuid: "JournalEntry.a"}), true);
assert.equal(sharedMatches(sheet, {kind: "journal", entryUuid: "JournalEntry.a", pageId: "p1"}), true, "page turned");
assert.equal(sharedMatches(sheet, {kind: "journal", entryUuid: "JournalEntry.b"}), false);
assert.equal(sharedMatches(sheet, {kind: "image", src: "JournalEntry.a"}), false);
for (const [identity, message] of [[null, {kind: "image", src: "a"}], [popout, null], [popout, {}], [popout, {kind: "image"}],
  [sheet, {kind: "journal"}], [undefined, undefined], [{kind: "other"}, {kind: "other"}]]) {
  assert.equal(sharedMatches(identity, message), false, JSON.stringify([identity, message]));
}

// A built message always matches the window it was built from (round trip through the parser)
for (const identity of [popout, imageIdentity({src: "x y/z.webm"}), sheet, journalIdentity({entryUuid: "JournalEntry.q"})]) {
  const parsed = parseCloseShared(closeSharedMessage(identity), {senderIsGM: true});
  assert.equal(sharedMatches(identity, parsed), true, JSON.stringify(identity));
}

// shouldBroadcastOnClose
assert.equal(shouldBroadcastOnClose({isGM: true, sharedByMe: true}), true);
assert.equal(shouldBroadcastOnClose({isGM: true, sharedByMe: true, alreadyBroadcast: false}), true);
assert.equal(shouldBroadcastOnClose({isGM: true, sharedByMe: true, alreadyBroadcast: true}), false);
assert.equal(shouldBroadcastOnClose({isGM: true, sharedByMe: false}), false);
assert.equal(shouldBroadcastOnClose({isGM: false, sharedByMe: true}), false);
assert.equal(shouldBroadcastOnClose({}), false);
assert.equal(shouldBroadcastOnClose(), false);

// canCloseForEveryone and shouldClaimJournal
assert.equal(canCloseForEveryone({isGM: true, sharedByMe: true}), true);
assert.equal(canCloseForEveryone({isGM: true, received: true}), true);
assert.equal(canCloseForEveryone({isGM: true}), false, "never shared, never received");
assert.equal(canCloseForEveryone({isGM: false, sharedByMe: true, received: true}), false);
assert.equal(canCloseForEveryone(), false);
assert.equal(shouldClaimJournal({isFirstRender: true, isGM: false}), true);
assert.equal(shouldClaimJournal({isFirstRender: true}), true);
assert.equal(shouldClaimJournal({isFirstRender: false, isGM: false}), false, "an already open sheet is not claimed");
assert.equal(shouldClaimJournal({isFirstRender: undefined, isGM: false}), false);
assert.equal(shouldClaimJournal({isFirstRender: true, isGM: true}), false, "GM working sheets are never claimed");
assert.equal(shouldClaimJournal(), false);

// Scroll helpers
assert.equal(clampFraction(0.5), 0.5);
assert.equal(clampFraction(-3), 0);
assert.equal(clampFraction(7), 1);
for (const bad of [NaN, Infinity, -Infinity, "0.5", null, undefined, {}, [], true]) assert.equal(clampFraction(bad), null, String(bad));
assert.equal(scrollFraction({scrollTop: 400, scrollHeight: 1000, clientHeight: 200}), 0.5);
assert.equal(scrollFraction({scrollTop: 900, scrollHeight: 1000, clientHeight: 200}), 1, "clamped");
assert.equal(scrollFraction({scrollTop: -5, scrollHeight: 1000, clientHeight: 200}), 0);
assert.equal(scrollFraction({scrollTop: 10, scrollHeight: 200, clientHeight: 200}), 0, "nothing scrolls");
assert.equal(scrollFraction({scrollTop: 10, scrollHeight: 100, clientHeight: 200}), 0);
assert.equal(scrollFraction({scrollTop: NaN, scrollHeight: 1000, clientHeight: 200}), 0);
assert.equal(scrollFraction(), 0);
assert.equal(scrollTopFor(0.5, {scrollHeight: 1000, clientHeight: 200}), 400);
assert.equal(scrollTopFor(1, {scrollHeight: 1000, clientHeight: 200}), 800);
assert.equal(scrollTopFor(9, {scrollHeight: 1000, clientHeight: 200}), 800, "clamped high");
assert.equal(scrollTopFor(-1, {scrollHeight: 1000, clientHeight: 200}), 0, "clamped low");
assert.equal(scrollTopFor("0.5", {scrollHeight: 1000, clientHeight: 200}), 0);
assert.equal(scrollTopFor(0.5, {scrollHeight: 100, clientHeight: 200}), 0);
assert.equal(scrollTopFor(0.5), 0);

// scrollShared messages
assert.deepEqual(scrollSharedMessage({entryUuid: "JournalEntry.a", pageId: "p", viewMode: "single", scroll: 0.123456}),
  {type: "scrollShared", entryUuid: "JournalEntry.a", scroll: 0.1235, pageId: "p", viewMode: "single"});
assert.deepEqual(scrollSharedMessage({entryUuid: "JournalEntry.a", scroll: 3, viewMode: "weird"}),
  {type: "scrollShared", entryUuid: "JournalEntry.a", scroll: 1});
for (const bad of [undefined, {}, {entryUuid: "JournalEntry.a"}, {entryUuid: "JournalEntry.a", scroll: NaN},
  {entryUuid: "JournalEntry.a", scroll: "0.5"}, {entryUuid: "", scroll: 0.5}, {scroll: 0.5}]) {
  assert.equal(scrollSharedMessage(bad), null, JSON.stringify(bad));
}
{
  const good = {type: "scrollShared", entryUuid: "JournalEntry.a", pageId: "p", viewMode: "multiple", scroll: 0.25};
  assert.deepEqual(parseScrollShared(good, {senderIsGM: true}), good);
  assert.deepEqual(parseScrollShared({...good, extra: 1, scroll: 4}, {senderIsGM: true}), {...good, scroll: 1}, "known fields, clamped");
  for (const senderIsGM of [false, undefined, "true", 1, null]) assert.equal(parseScrollShared(good, {senderIsGM}), null);
  assert.equal(parseScrollShared(good), null);
  for (const bad of [null, undefined, 3, "x", [], {}, {...good, type: "closeShared"}, {...good, scroll: "a"},
    {...good, scroll: NaN}, {...good, entryUuid: 5}]) {
    assert.equal(parseScrollShared(bad, {senderIsGM: true}), null, JSON.stringify(bad));
  }
  assert.equal(parseCloseShared(good, {senderIsGM: true}), null, "the two message types do not mix");
  assert.equal(parseScrollShared({type: "closeShared", kind: "all"}, {senderIsGM: true}), null);
}

// scrollRenderPlan
assert.equal(scrollRenderPlan({pageId: "p1", viewMode: "single"}, {pageId: "p1", isMultiple: false}), null, "already there");
assert.deepEqual(scrollRenderPlan({pageId: "p2", viewMode: "single"}, {pageId: "p1", isMultiple: false}), {pageId: "p2"});
assert.deepEqual(scrollRenderPlan({pageId: "p2"}, {pageId: "p1", isMultiple: false}), {pageId: "p2"}, "mode defaults to the current one");
assert.equal(scrollRenderPlan({pageId: "p2", viewMode: "multiple"}, {pageId: "p1", isMultiple: true}), null,
  "in multi-page mode the scroll position carries the page");
assert.deepEqual(scrollRenderPlan({pageId: "p2", viewMode: "multiple"}, {pageId: "p1", isMultiple: false}),
  {viewMode: "multiple", pageId: "p2"});
assert.deepEqual(scrollRenderPlan({viewMode: "single"}, {pageId: "p1", isMultiple: true}), {viewMode: "single"});
assert.equal(scrollRenderPlan({}, {pageId: "p1", isMultiple: false}), null);
assert.equal(scrollRenderPlan(null, {}), null);

// createThrottle: first call runs at once, calls inside the interval collapse into one trailing call
{
  let time = 0;
  const timers = [];
  const calls = [];
  const throttled = createThrottle(() => calls.push(time), 100, {
    now: () => time,
    setTimer: (fn, ms) => (timers.push({fn, ms}), timers.length),
    clearTimer: () => {}
  });
  throttled();
  assert.deepEqual(calls, [0]);
  time = 30;
  throttled();
  throttled();
  throttled();
  assert.deepEqual(calls, [0], "held back");
  assert.equal(timers.length, 1, "one trailing timer");
  assert.equal(timers[0].ms, 70);
  time = 100;
  timers[0].fn();
  assert.deepEqual(calls, [0, 100], "one trailing call");
  time = 250;
  throttled();
  assert.deepEqual(calls, [0, 100, 250], "after the interval it runs at once again");
  time = 260;
  throttled();
  throttled.flush();
  assert.deepEqual(calls, [0, 100, 250, 260], "flush runs the queued call now");
  throttled.flush();
  assert.equal(calls.length, 4, "flush with nothing queued does nothing");
  time = 270;
  throttled();
  throttled.cancel();
  timers.at(-1).fn();
  assert.equal(calls.length, 4, "cancel drops the queued call");
}

// createPendingShares
{
  let time = 1000;
  const pending = createPendingShares({ttl: 100, now: () => time});
  pending.add("JournalEntry.a");
  assert.equal(pending.size, 1);
  assert.equal(pending.take("JournalEntry.b"), false);
  assert.equal(pending.take("JournalEntry.a"), true);
  assert.equal(pending.take("JournalEntry.a"), false, "claimed once");
  pending.add("JournalEntry.a");
  time += 99;
  assert.equal(pending.take("JournalEntry.a"), true, "still fresh");
  pending.add("JournalEntry.c");
  time += 100;
  assert.equal(pending.size, 0, "expired entries are dropped");
  assert.equal(pending.take("JournalEntry.c"), false, "expired");
  for (const bad of [undefined, null, "", 4, {}]) {
    pending.add(bad);
    assert.equal(pending.take(bad), false);
  }
  assert.equal(pending.size, 0);
  assert.equal(createPendingShares().size, 0, "defaults work");
  pending.add("JournalEntry.d");
  pending.clear();
  assert.equal(pending.take("JournalEntry.d"), false, "clear drops everything");
}

// Wiring with fake globals. They are defined only now, after the import: the module must not need them to load.
const tick = () => new Promise(resolve => setImmediate(resolve));

const hookCalls = [];
const onceCalls = [];
const hooks = new Map();
const onceHooks = new Map();
globalThis.Hooks = {
  on(name, fn) {
    hookCalls.push(name);
    hooks.set(name, [...(hooks.get(name) ?? []), fn]);
  },
  once(name, fn) {
    onceCalls.push(name);
    onceHooks.set(name, [...(onceHooks.get(name) ?? []), fn]);
  }
};
const fire = (name, ...args) => (hooks.get(name) ?? []).forEach(fn => fn(...args));

const makeClassList = () => {
  const names = new Set();
  return {add: (...list) => list.forEach(name => names.add(name)), contains: name => names.has(name), names};
};

/** A sheet-like window with a scroll container. */
function makeWindow({uuid, pageId = "p1", isMultiple = false, pages = ["p1", "p2"], scroll = {top: 0, height: 1000, client: 200}} = {}) {
  const container = {
    scrollTop: scroll.top, scrollHeight: scroll.height, clientHeight: scroll.client,
    classList: {contains: name => name === "journal-entry-pages"}
  };
  const listeners = [];
  return {
    document: uuid ? {uuid} : undefined,
    pageId,
    isMultiple,
    _pages: Object.fromEntries(pages.map(id => [id, {}])),
    closeCalls: [],
    renderCalls: [],
    container,
    listeners,
    element: {
      classList: makeClassList(),
      addEventListener: (type, fn, options) => listeners.push({type, fn, options}),
      querySelector: selector => (selector === ".journal-entry-pages" ? container : null)
    },
    async close(options) { this.closeCalls.push(options); },
    async render(options) { this.renderCalls.push(options); }
  };
}

class FakeImagePopout {
  constructor(options = {}) {
    this.options = options;
    this.element = {classList: makeClassList()};
    this.closeCalls = [];
  }
  async close(options) { this.closeCalls.push(options); }
  shareImage(options = {}) {
    game.socket.emit("shareImage", {image: options.image ?? this.options.src});
  }
  static _handleShareImage({image, uuid} = {}) {
    return new FakeImagePopout({src: image, uuid});
  }
}

const Journal = {
  async _showEntry() {},
  async show(doc) { return doc; },
  showImage(src, options) { game.socket.emit("shareImage", {image: src, ...options}); }
};
globalThis.foundry = {
  applications: {apps: {ImagePopout: FakeImagePopout}},
  documents: {collections: {Journal}}
};

const wrapped = [];
globalThis.libWrapper = {
  register(id, target, wrapper, type) {
    assert.equal(id, "helper-hub");
    assert.equal(type, "WRAPPER");
    wrapped.push(target);
    const parts = target.split(".");
    const name = parts.pop();
    const owner = parts.reduce((value, key) => value[key], globalThis);
    const original = owner[name];
    assert.equal(typeof original, "function", `${target} exists`);
    owner[name] = function (...args) { return wrapper.call(this, original.bind(this), ...args); };
  }
};

const users = {gm1: {isGM: true}, gm2: {isGM: true}, p2: {isGM: false}};
const emitted = [];
const socketHandlers = [];
const moduleMessages = type => emitted.filter(([name, data]) => name === SOCKET_EVENT && data.type === type).map(([, data]) => data);
const closeMessages = () => moduleMessages("closeShared");
const scrollMessages = () => moduleMessages("scrollShared");
const modules = new Map([["helper-hub", {}]]);
globalThis.game = {
  user: {id: "p1", isGM: false, getFlag: () => undefined},
  users: {get: id => users[id]},
  socket: {
    emit: (...args) => emitted.push(args),
    on: (name, fn) => socketHandlers.push([name, fn])
  },
  modules
};
const asPlayer = () => Object.assign(game.user, {isGM: false, getFlag: () => undefined});
const asDisplay = () => Object.assign(game.user, {
  isGM: false,
  getFlag: (scope, key) => ((scope === "helper-hub") && (key === "displayScreen") ? true : undefined)
});
const asGM = () => Object.assign(game.user, {isGM: true, getFlag: () => undefined});
const send = (data, senderId = "gm1") => socketHandlers.find(([name]) => name === SOCKET_EVENT)[1](data, senderId);

/** Run a block with setTimeout captured, so scheduled callbacks can be run by hand. */
async function withTimers(block) {
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => (timers.push({fn, ms}), {unref() {}});
  try {
    await block(timers);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

// Registration: hooks, wrappers, and the setup callbacks are really registered
registerSharedContent();
registerSharedContent();
for (const name of ["renderImagePopout", "renderJournalEntrySheet", "closeImagePopout", "closeJournalEntrySheet",
  "getHeaderControlsImagePopout", "getHeaderControlsJournalEntrySheet", "getUserContextOptions"]) {
  assert.equal(hookCalls.filter(hook => hook === name).length, 1, `${name} registered once through Hooks.on`);
}
assert.deepEqual(onceCalls, ["setup"], "the socket listener is set up in setup, not in ready");
assert.deepEqual([...wrapped].sort(), [
  "foundry.applications.apps.ImagePopout._handleShareImage",
  "foundry.applications.apps.ImagePopout.prototype.shareImage",
  "foundry.documents.collections.Journal._showEntry",
  "foundry.documents.collections.Journal.show",
  "foundry.documents.collections.Journal.showImage"
].sort());

// What core's activateSocketListeners captures just before "ready": the wrapped functions
const showEntry = Journal._showEntry.bind(Journal);
const handleShareImage = FakeImagePopout._handleShareImage;

// setup: one socket listener, registered before any buffered event is replayed, and the API
assert.equal(socketHandlers.length, 0, "no listener before setup");
onceHooks.get("setup")[0]();
onceHooks.get("setup")[0]();
assert.equal(socketHandlers.length, 1, "registered once even if setup ran twice");
assert.equal(socketHandlers[0][0], SOCKET_EVENT);
assert.equal(typeof modules.get("helper-hub").api.closeShared, "function");

// Player: a show request opens the sheet for the first time; it is claimed and closed by the GM
{
  asPlayer();
  await showEntry("JournalEntry.fresh");
  const sheet = makeWindow({uuid: "JournalEntry.fresh"});
  fire("renderJournalEntrySheet", sheet, sheet.element, {}, {isFirstRender: true});
  assert.deepEqual([...sheet.element.classList.names], ["helper-hub-shared", "helper-hub-shared-journal"]);
  send({type: "closeShared", kind: "journal", entryUuid: "JournalEntry.other"});
  assert.equal(sheet.closeCalls.length, 0, "another entry");
  send({type: "closeShared", kind: "journal", entryUuid: "JournalEntry.fresh"});
  assert.deepEqual(sheet.closeCalls, [{animate: false}], "closed without the transition");
  send({type: "closeShared", kind: "journal", entryUuid: "JournalEntry.fresh"});
  assert.equal(sheet.closeCalls.length, 1, "closed once");
}

// Flaw 1: the player's own, already open sheet is never claimed or closed
{
  asPlayer();
  await showEntry("JournalEntry.own");
  const own = makeWindow({uuid: "JournalEntry.own"});
  fire("renderJournalEntrySheet", own, own.element, {}, {isFirstRender: false});
  assert.equal(own.element.classList.names.size, 0, "not tagged");
  send({type: "closeShared", kind: "journal", entryUuid: "JournalEntry.own"});
  send({type: "closeShared", kind: "all"});
  assert.equal(own.closeCalls.length, 0, "the player's own sheet survives a GM close");
  // The pending key was dropped by that render, so a later first render does not claim it either.
  const later = makeWindow({uuid: "JournalEntry.own"});
  fire("renderJournalEntrySheet", later, later.element, {}, {});
  fire("renderJournalEntrySheet", later, later.element, {}, {isFirstRender: true});
  assert.equal(later.element.classList.names.size, 0);
  // A render with no options at all (some other caller) never claims
  await showEntry("JournalEntry.noopts");
  const bare = makeWindow({uuid: "JournalEntry.noopts"});
  fire("renderJournalEntrySheet", bare, bare.element);
  assert.equal(bare.element.classList.names.size, 0);
  // A page UUID claims the journal entry's sheet
  await showEntry("JournalEntry.paged.JournalEntryPage.p9");
  const paged = makeWindow({uuid: "JournalEntry.paged"});
  fire("renderJournalEntrySheet", paged, paged.element, {}, {isFirstRender: true});
  assert.equal(paged.element.classList.contains("helper-hub-shared"), true);
}

// Sender filter: only a GM counts, and the sender comes from the server's id
{
  asPlayer();
  await showEntry("JournalEntry.sender");
  const sheet = makeWindow({uuid: "JournalEntry.sender"});
  fire("renderJournalEntrySheet", sheet, sheet.element, {}, {isFirstRender: true});
  const message = {type: "closeShared", kind: "journal", entryUuid: "JournalEntry.sender"};
  send(message, "p2");
  send(message, "nobody");
  send(message, null);
  send({...message, sender: "gm1"}, "p2");
  assert.equal(sheet.closeCalls.length, 0, "players and unknown senders are ignored");
  for (const junk of [null, undefined, 5, "closeShared", {}, {type: "closeShared"}, {type: "closeShared", kind: "journal"},
    {type: "closeShared", kind: "bogus"}, {type: "other", kind: "all"}]) send(junk);
  assert.equal(sheet.closeCalls.length, 0, "junk payloads are ignored");
  send(message, "gm2");
  assert.equal(sheet.closeCalls.length, 1, "any GM may close");
}

// Images: received popouts are matched by src; kind "all" closes everything shared; long sources use the hash
{
  asPlayer();
  const a = handleShareImage({image: "a.png", uuid: "Actor.1"});
  const b = handleShareImage({image: "b.png"});
  const long = `data:image/png;base64,${"B".repeat(4000)}`;
  const c = handleShareImage({image: long});
  await showEntry("JournalEntry.all");
  const j = makeWindow({uuid: "JournalEntry.all"});
  fire("renderJournalEntrySheet", j, j.element, {}, {isFirstRender: true});
  for (const popout of [a, b, c]) fire("renderImagePopout", popout, popout.element);
  assert.deepEqual([...a.element.classList.names], ["helper-hub-shared", "helper-hub-shared-image"]);
  send({type: "closeShared", kind: "image", src: "a.png"});
  assert.equal(a.closeCalls.length, 1);
  assert.equal(b.closeCalls.length, 0, "other image");
  send({type: "closeShared", kind: "image", src: "a.png", uuid: "Actor.other"});
  assert.equal(a.closeCalls.length, 1, "closed once");
  send(closeSharedMessage(imageIdentity({src: long})));
  assert.equal(c.closeCalls.length, 1, "a data: URL still matches through the hash");
  send({type: "closeShared", kind: "all"});
  assert.equal(b.closeCalls.length, 1, "all closes the remaining image");
  assert.equal(j.closeCalls.length, 1, "and the shared journal");
  assert.deepEqual(b.closeCalls, [{animate: false}]);
  // A popout the player opened themselves (no share request) is never touched
  const mine = new FakeImagePopout({src: "b.png"});
  fire("renderImagePopout", mine, mine.element);
  send({type: "closeShared", kind: "all"});
  assert.equal(mine.closeCalls.length, 0);
  assert.equal(mine.element.classList.names.size, 0);
}

// Header control: GM only, and only for windows that were shared or received
{
  const controlsFor = (hook, app) => {
    const controls = [{action: "existing"}];
    fire(hook, app, controls);
    assert.equal(controls[0].action, "existing", "keeps the other controls");
    return controls.find(control => control.action === "helperHubCloseForEveryone");
  };
  asGM();
  const neverShared = makeWindow({uuid: "JournalEntry.work"});
  const workControl = controlsFor("getHeaderControlsJournalEntrySheet", neverShared);
  assert.equal(workControl.label, "HELPERHUB.CloseForEveryone");
  assert.equal(typeof workControl.visible, "function", "visible is evaluated per render");
  assert.equal(workControl.visible(), false, "a GM's unshared window has no control");
  const plainPopout = new FakeImagePopout({src: "plain.png"});
  assert.equal(controlsFor("getHeaderControlsImagePopout", plainPopout).visible(), false);
  fire("getHeaderControlsImagePopout", plainPopout, "not an array");

  // Shared through the popout's own button: now it shows, and sending then closing broadcasts once
  plainPopout.shareImage();
  const control = controlsFor("getHeaderControlsImagePopout", plainPopout);
  assert.equal(control.visible(), true, "the control turns visible after sharing");
  emitted.length = 0;
  control.onClick();
  assert.deepEqual(closeMessages(), [{type: "closeShared", kind: "image", src: "plain.png"}]);
  assert.equal(plainPopout.closeCalls.length, 1);
  fire("closeImagePopout", plainPopout);
  assert.equal(closeMessages().length, 1, "the close hook after the control does not echo again");
  assert.equal(control.visible(), false, "forgotten once closed");

  // A player never sees it, and its click does nothing
  asPlayer();
  const received = handleShareImage({image: "seen.png"});
  const playerControl = controlsFor("getHeaderControlsImagePopout", received);
  assert.equal(playerControl.visible(), false);
  emitted.length = 0;
  playerControl.onClick();
  assert.equal(emitted.length, 0);
  assert.equal(received.closeCalls.length, 0);
}

// GM: Journal.show marks the sheet; closing it by itself broadcasts once; the control closes and broadcasts once
await withTimers(async timers => {
  asGM();
  const sheet = makeWindow({uuid: "JournalEntry.gm"});
  const entry = {documentName: "JournalEntry", sheet};
  emitted.length = 0;
  assert.equal(await Journal.show(entry), entry);
  const controls = [];
  fire("getHeaderControlsJournalEntrySheet", sheet, controls);
  assert.equal(controls[0].visible(), true);
  // A page shown through its parent's sheet
  const pageSheet = makeWindow({uuid: "JournalEntry.pg"});
  await Journal.show({documentName: "JournalEntryPage", parent: {sheet: pageSheet}});
  const pageControls = [];
  fire("getHeaderControlsJournalEntrySheet", pageSheet, pageControls);
  assert.equal(pageControls[0].visible(), true);
  // Nothing returned (not a journal document): nothing marked
  assert.equal(await Journal.show(undefined), undefined);

  // Closing the sheet on its own broadcasts once, with the journal identity
  emitted.length = 0;
  fire("closeJournalEntrySheet", sheet);
  assert.deepEqual(closeMessages(), [{type: "closeShared", kind: "journal", entryUuid: "JournalEntry.gm", pageId: "p1"}]);
  fire("closeJournalEntrySheet", sheet);
  assert.equal(closeMessages().length, 1, "once");

  // Header control: broadcast, close, and the following close hook does not echo
  emitted.length = 0;
  pageControls[0].onClick();
  assert.equal(closeMessages().length, 1);
  assert.equal(pageSheet.closeCalls.length, 1);
  fire("closeJournalEntrySheet", pageSheet);
  assert.equal(closeMessages().length, 1);

  assert.ok(timers.some(timer => timer.ms > 0), "the initial scroll sync was scheduled");
});

// Flaw 7: a GM's working sheet is never claimed, even when a show request opened it, so another GM cannot close it
{
  asGM();
  await showEntry("JournalEntry.gmwork");
  const sheet = makeWindow({uuid: "JournalEntry.gmwork"});
  fire("renderJournalEntrySheet", sheet, sheet.element, {}, {isFirstRender: true});
  assert.equal(sheet.element.classList.names.size, 0);
  send({type: "closeShared", kind: "journal", entryUuid: "JournalEntry.gmwork"}, "gm2");
  send({type: "closeShared", kind: "all"}, "gm2");
  assert.equal(sheet.closeCalls.length, 0);
  // Policy: image popouts a GM received are displays, so another GM's close does close them
  const popout = handleShareImage({image: "fromgm2.png"});
  fire("renderImagePopout", popout, popout.element);
  send({type: "closeShared", kind: "image", src: "fromgm2.png"}, "gm2");
  assert.equal(popout.closeCalls.length, 1);
}

// Flaw 6: shareImage is tracked under the identity that was broadcast
{
  asGM();
  const popout = new FakeImagePopout({src: "own.png", uuid: "Actor.1"});
  emitted.length = 0;
  popout.shareImage({image: "override.png"});
  assert.equal(emitted[0][1].image, "override.png", "the override is what is sent");
  emitted.length = 0;
  fire("closeImagePopout", popout);
  assert.deepEqual(closeMessages(), [{type: "closeShared", kind: "image", src: "override.png", uuid: "Actor.1"}]);

  const plain = new FakeImagePopout({src: "own.png"});
  plain.shareImage({});
  emitted.length = 0;
  fire("closeImagePopout", plain);
  assert.deepEqual(closeMessages(), [{type: "closeShared", kind: "image", src: "own.png"}]);

  // Shared first with an override, then again without: the identity follows the last share
  const twice = new FakeImagePopout({src: "own.png"});
  twice.shareImage({image: "first.png"});
  twice.shareImage();
  emitted.length = 0;
  fire("closeImagePopout", twice);
  assert.equal(closeMessages()[0].src, "own.png");
}

// Echo guard: a popout that is both received and shared closes because another GM asked, without echoing back
{
  asGM();
  const popout = handleShareImage({image: "echo.png"});
  fire("renderImagePopout", popout, popout.element);
  popout.shareImage();
  emitted.length = 0;
  send({type: "closeShared", kind: "image", src: "echo.png"}, "gm2");
  assert.equal(popout.closeCalls.length, 1);
  fire("closeImagePopout", popout);
  assert.equal(closeMessages().length, 0, "no echo");
}

// Flaw 4: images shown without a window; GM-only "close everything" in the players list, and the API
await withTimers(async () => {
  asGM();
  emitted.length = 0;
  Journal.showImage("loose.png", {users: [], uuid: "Actor.9"});
  Journal.showImage("other.png", {image: "winner.png"});
  assert.equal(emitted.filter(([name]) => name === "shareImage").length, 2, "the original still emits");
  const api = modules.get("helper-hub").api;
  emitted.length = 0;
  assert.equal(api.closeShared({kind: "image", src: "winner.png"}), true);
  assert.deepEqual(closeMessages(), [{type: "closeShared", kind: "image", src: "winner.png"}]);
  emitted.length = 0;
  assert.equal(api.closeShared({kind: "image"}), false, "invalid target sends nothing");
  assert.equal(api.closeShared({kind: "bogus"}), false);
  assert.equal(emitted.length, 0);

  const items = [{label: "existing"}];
  fire("getUserContextOptions", {}, items);
  fire("getUserContextOptions", {}, undefined);
  const item = items.find(entry => entry.label === "HELPERHUB.CloseAllShared");
  assert.ok(item, "entry added to the players list menu");
  assert.equal(items[0].label, "existing");
  assert.equal(item.visible(), true);
  // A shared window of this GM is forgotten (its later close must not close a newer show) but stays open
  const sheet = makeWindow({uuid: "JournalEntry.forget"});
  await Journal.show({documentName: "JournalEntry", sheet});
  emitted.length = 0;
  item.onClick();
  assert.deepEqual(closeMessages(), [{type: "closeShared", kind: "all"}]);
  assert.equal(sheet.closeCalls.length, 0, "the GM's own window stays");
  emitted.length = 0;
  fire("closeJournalEntrySheet", sheet);
  assert.equal(closeMessages().length, 0, "no stale broadcast afterwards");

  asPlayer();
  assert.equal(item.visible(), false, "players do not get the entry");
  emitted.length = 0;
  assert.equal(api.closeShared(), false, "and the API refuses");
  item.onClick();
  assert.equal(emitted.length, 0);
});

// Flaw 2: scroll mirroring. GM side: throttled, fraction of the scrollable height, with page and mode
await withTimers(async timers => {
  asGM();
  const sheet = makeWindow({uuid: "JournalEntry.scroll", pageId: "p2", isMultiple: false, scroll: {top: 400, height: 1000, client: 200}});
  await Journal.show({documentName: "JournalEntry", sheet});
  fire("renderJournalEntrySheet", sheet, sheet.element, {}, {isFirstRender: true});
  fire("renderJournalEntrySheet", sheet, sheet.element, {}, {});
  assert.equal(sheet.listeners.length, 1, "one capturing listener per element");
  const [listener] = sheet.listeners;
  assert.equal(listener.type, "scroll");
  assert.equal(listener.options.capture, true, "scroll does not bubble, so the listener captures");

  emitted.length = 0;
  listener.fn({target: {classList: {contains: () => false}}});
  assert.equal(scrollMessages().length, 0, "scrolling something else is ignored");
  listener.fn({target: sheet.container});
  assert.deepEqual(scrollMessages(), [
    {type: "scrollShared", entryUuid: "JournalEntry.scroll", scroll: 0.5, pageId: "p2", viewMode: "single"}
  ]);
  sheet.container.scrollTop = 800;
  listener.fn({target: sheet.container});
  listener.fn({target: sheet.container});
  assert.equal(scrollMessages().length, 1, "throttled: the rest wait for the trailing call");
  timers.at(-1).fn();
  assert.equal(scrollMessages().length, 2);
  assert.equal(scrollMessages()[1].scroll, 1, "the final position arrives");

  // Page turns are sent at once, with the new page
  sheet.pageId = "p3";
  emitted.length = 0;
  fire("renderJournalEntrySheet", sheet, sheet.element, {}, {pageChanged: true});
  assert.equal(scrollMessages()[0].pageId, "p3");
  sheet.isMultiple = true;
  fire("renderJournalEntrySheet", sheet, sheet.element, {}, {modeChanged: true});
  assert.equal(scrollMessages().at(-1).viewMode, "multiple");
  emitted.length = 0;
  fire("renderJournalEntrySheet", sheet, sheet.element, {}, {});
  assert.equal(scrollMessages().length, 0, "a plain re-render sends nothing");

  // The initial sync after sharing
  emitted.length = 0;
  const initial = timers.find(timer => timer.ms === 600);
  assert.ok(initial, "initial sync scheduled");
  initial.fn();
  assert.equal(scrollMessages().length, 1);

  // Not shared by this GM: no messages
  const work = makeWindow({uuid: "JournalEntry.workscroll"});
  fire("renderJournalEntrySheet", work, work.element, {}, {isFirstRender: true, pageChanged: true});
  emitted.length = 0;
  work.listeners[0].fn({target: work.container});
  assert.equal(scrollMessages().length, 0);
});

// Scroll mirroring, display side: validation and application
{
  const claim = async uuid => {
    await showEntry(uuid);
    const sheet = makeWindow({uuid, scroll: {top: 0, height: 1000, client: 200}});
    fire("renderJournalEntrySheet", sheet, sheet.element, {}, {isFirstRender: true});
    return sheet;
  };
  const scrollMessage = (uuid, extra = {}) => ({type: "scrollShared", entryUuid: uuid, scroll: 0.75, ...extra});

  asDisplay();
  const sheet = await claim("JournalEntry.disp");
  send(scrollMessage("JournalEntry.disp"));
  await tick();
  assert.equal(sheet.container.scrollTop, 600, "0.75 of the 800 scrollable pixels");
  assert.equal(sheet.renderCalls.length, 0, "no page change needed");

  send(scrollMessage("JournalEntry.disp", {scroll: 9}));
  await tick();
  assert.equal(sheet.container.scrollTop, 800, "clamped to 1");
  send(scrollMessage("JournalEntry.disp", {scroll: -9}));
  await tick();
  assert.equal(sheet.container.scrollTop, 0, "clamped to 0");

  sheet.container.scrollTop = 123;
  for (const bad of [{scroll: NaN}, {scroll: "0.5"}, {scroll: Infinity}, {scroll: null}, {scroll: undefined}]) {
    send(scrollMessage("JournalEntry.disp", bad));
  }
  send(scrollMessage("JournalEntry.disp"), "p2");
  send(scrollMessage("JournalEntry.disp"), "nobody");
  send(scrollMessage("JournalEntry.disp", {type: "other"}));
  send(scrollMessage("JournalEntry.other"));
  await tick();
  assert.equal(sheet.container.scrollTop, 123, "invalid, non-GM, and other-journal messages change nothing");

  // Page turn in single-page mode: render at that page, then scroll
  send(scrollMessage("JournalEntry.disp", {pageId: "p2", viewMode: "single", scroll: 0.5}));
  await tick();
  assert.deepEqual(sheet.renderCalls, [{pageId: "p2"}]);
  assert.equal(sheet.container.scrollTop, 400);
  // A page the display cannot see is not requested
  send(scrollMessage("JournalEntry.disp", {pageId: "ghost", viewMode: "single", scroll: 0.25}));
  await tick();
  assert.equal(sheet.renderCalls.length, 1, "no render for an unknown page");
  assert.equal(sheet.container.scrollTop, 200);
  // A mode change is mapped to the sheet's mode constants (the fake has no VIEW_MODES, so the defaults apply)
  send(scrollMessage("JournalEntry.disp", {pageId: "p1", viewMode: "multiple", scroll: 0}));
  await tick();
  assert.deepEqual(sheet.renderCalls.at(-1), {mode: 2, pageId: "p1"});

  // A message that arrives before the sheet renders is kept and applied when the sheet claims its request
  send(scrollMessage("JournalEntry.early", {scroll: 0.5}));
  const early = await claim("JournalEntry.early");
  await tick();
  assert.equal(early.container.scrollTop, 400, "buffered state applied on first render");
  send({type: "closeShared", kind: "journal", entryUuid: "JournalEntry.early"});
  const reopened = await claim("JournalEntry.early");
  await tick();
  assert.equal(reopened.container.scrollTop, 0, "a closed journal's buffered state is dropped");

  // A player (not a display screen) keeps control of their own scrolling
  asPlayer();
  const reading = await claim("JournalEntry.reading");
  reading.container.scrollTop = 50;
  send(scrollMessage("JournalEntry.reading"));
  await tick();
  assert.equal(reading.container.scrollTop, 50);

  // A GM does not follow another GM either
  asGM();
  const gmSheet = makeWindow({uuid: "JournalEntry.gmfollow"});
  gmSheet.container.scrollTop = 50;
  send(scrollMessage("JournalEntry.gmfollow"), "gm2");
  await tick();
  assert.equal(gmSheet.container.scrollTop, 50);
}

// Manifest, entry point, CSS, and localization
{
  const root = new URL("..", import.meta.url);
  const read = path => readFileSync(new URL(path, root), "utf8");
  const manifest = JSON.parse(read("module.json"));
  assert.equal(manifest.socket, true, "module.json enables the module socket");

  const entry = read("scripts/module.mjs");
  assert.match(entry, /import \{registerSharedContent\} from "\.\/shared-content\.mjs"/);
  assert.match(entry, /registerSharedContent\(\);/);
  assert.match(entry, /libWrapper is not available; shared images and journals/);

  const css = read("styles/helper-hub.css");
  const rules = parseCssRules(css);
  const hide = rules.find(rule => rule.selectors.includes("body.helper-hub-display .application"));
  assert.ok(hide && /display:\s*none\s*!important/.test(hide.body), "the hide rule exists");
  const exemptionSelector = "body.helper-hub-display .application.helper-hub-shared";
  const shared = rules.find(rule => rule.selectors.includes(exemptionSelector));
  assert.ok(shared && /display:\s*flex\s*!important/.test(shared.body), "the shared exemption exists");
  assert.deepEqual(specificity("body.helper-hub-display .application"), [0, 2, 1], "specificity of the hide selector");
  assert.deepEqual(specificity(exemptionSelector), [0, 3, 1]);
  assert.ok(compareSpecificity(specificity(exemptionSelector), specificity("body.helper-hub-display .application")) > 0
    || shared.order > hide.order, "the shared rule wins over the hide rule");
  // Every rule that hides an `.application` is beaten by the exemption: higher specificity, or equal and later
  for (const rule of rules) {
    if (!/display:\s*none\s*!important/.test(rule.body)) continue;
    for (const selector of rule.selectors.filter(item => /\.application$/.test(item))) {
      const wins = compareSpecificity(specificity(exemptionSelector), specificity(selector));
      assert.ok(wins > 0 || ((wins === 0) && (shared.order > rule.order)), `the exemption beats ${selector}`);
    }
  }
  for (const selector of ["body.helper-hub-display .application.helper-hub-shared-image",
    "body.helper-hub-display .application.helper-hub-shared-journal"]) {
    assert.ok(rules.some(rule => rule.selectors.includes(selector)), selector);
  }
  const scroller = rules.find(rule => rule.selectors.includes(
    "body.helper-hub-display .application.helper-hub-shared-journal .journal-entry-pages"));
  assert.ok(scroller, "journal scroll container rule");
  assert.match(scroller.body, /overflow-y:\s*auto\s*!important/, "the display's journal stays a scroll container");
  assert.match(scroller.body, /scroll-behavior:\s*auto\s*!important/);

  const source = read("scripts/shared-content.mjs");
  const en = JSON.parse(read("lang/en.json"));
  const ru = JSON.parse(read("lang/ru.json"));
  const used = new Set(source.match(/HELPERHUB\.[A-Za-z0-9_]+/g));
  assert.ok(used.has("HELPERHUB.CloseForEveryone"));
  assert.ok(used.has("HELPERHUB.CloseAllShared"));
  for (const key of used) {
    assert.equal(typeof en[key], "string", `${key} missing from en.json`);
    assert.equal(typeof ru[key], "string", `${key} missing from ru.json`);
    assert.notEqual(en[key].trim(), "");
    assert.notEqual(ru[key].trim(), "");
  }
  assert.notEqual(en["HELPERHUB.CloseAllShared"], ru["HELPERHUB.CloseAllShared"]);
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort(), "en and ru keys are in parity");
}

/**
 * Leaf rules of a stylesheet, in source order. At-rules such as @layer are walked through.
 * @param {string} css
 * @returns {{selectors: string[], body: string, order: number}[]}
 */
function parseCssRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const stack = [];
  let buffer = "";
  for (const char of text) {
    if (char === "{") {
      stack.push(buffer.trim());
      buffer = "";
    } else if (char === "}") {
      const prelude = stack.pop();
      if (!prelude.startsWith("@")) {
        rules.push({selectors: prelude.split(",").map(item => item.trim()), body: buffer.trim(), order: rules.length});
      }
      buffer = "";
    } else buffer += char;
  }
  return rules;
}

/**
 * Specificity of a simple selector (no :is/:where/:not), as [ids, classes/attributes/pseudo-classes, elements].
 * @param {string} selector
 * @returns {number[]}
 */
function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (selector.replace(/\[[^\]]*\]/g, "").match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return [ids, classes, elements];
}

function compareSpecificity(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

console.log("shared-content tests passed");
