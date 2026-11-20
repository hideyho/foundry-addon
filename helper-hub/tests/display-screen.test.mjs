/**
 * Display screen helpers. Run with node; Foundry is not required.
 * node helper-hub/tests/display-screen.test.mjs
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// The module must import in Node without touching any Foundry or browser global.
const forbidden = ["game", "Hooks", "PIXI", "canvas", "document", "ui"];
for (const name of forbidden) assert.equal(globalThis[name], undefined, `${name} must start undefined`);

const {
  createFitController,
  displayDisabledByQuery,
  displayKeyAllowed,
  fitSceneView,
  isDisplayScreen,
  roleIsGM,
  sameView,
  sceneFitUpdate,
  sceneIdFromMenuEntry,
  shouldBlockEvent,
  shouldRefit,
  shouldRevertDisplayFlag,
  touchesDisplayFlag
} = await import("../scripts/display-screen.mjs");

for (const name of forbidden) assert.equal(globalThis[name], undefined, `importing must not define ${name}`);

const map = {x: 200, y: 100, width: 4000, height: 2000};

// Wide screen: height limits the scale.
{
  const view = fitSceneView({sceneRect: map, width: 3840, height: 1080});
  assert.deepEqual(view, {x: 2200, y: 1100, scale: 0.54});
}

// Tall screen: width limits the scale.
{
  const view = fitSceneView({sceneRect: map, width: 1000, height: 2000});
  assert.deepEqual(view, {x: 2200, y: 1100, scale: 0.25});
}

// Map smaller than the screen: scale goes above 1 so the map still fills one axis.
{
  const view = fitSceneView({sceneRect: {x: 0, y: 0, width: 500, height: 250}, width: 1000, height: 1000});
  assert.deepEqual(view, {x: 250, y: 125, scale: 2});
}

// Negative origin (shifted scene rectangle).
{
  const view = fitSceneView({sceneRect: {x: -300, y: -150, width: 600, height: 300}, width: 1200, height: 1200});
  assert.deepEqual(view, {x: 0, y: 0, scale: 2});
}

// Non-integer sizes.
{
  const view = fitSceneView({sceneRect: {x: 0.5, y: 0.25, width: 1000.5, height: 500.5}, width: 1920.5, height: 1080.5});
  assert.equal(view.x, 0.5 + 500.25);
  assert.equal(view.y, 0.25 + 250.25);
  assert.equal(view.scale, Math.min(1920.5 / 1000.5, 1080.5 / 500.5));
}

// Bad sizes.
for (const [width, height] of [[0, 1080], [1920, 0], [NaN, 1080], [1920, Infinity], [-1, 5]]) {
  assert.equal(fitSceneView({sceneRect: map, width, height}), null, `screen ${width}x${height}`);
}
assert.equal(fitSceneView({sceneRect: {x: 0, y: 0, width: 0, height: 100}, width: 10, height: 10}), null);
assert.equal(fitSceneView({sceneRect: {x: 0, y: 0, width: 100, height: NaN}, width: 10, height: 10}), null);
assert.equal(fitSceneView({sceneRect: {x: NaN, y: 0, width: 100, height: 100}, width: 10, height: 10}), null);
assert.equal(fitSceneView({width: 10, height: 10}), null);
assert.equal(fitSceneView(), null);

// sameView stops the fit loop. Boundaries: 0.01 px and 1e-6 scale are inclusive.
{
  const target = {x: 2200, y: 1100, scale: 0.5};
  assert.equal(sameView({...target}, target), true);
  assert.equal(sameView({x: 2200.005, y: 1100, scale: 0.5}, target), true);
  assert.equal(sameView({x: 2205, y: 1100, scale: 0.5}, target), false);
  assert.equal(sameView({x: 2200, y: 1100, scale: 0.51}, target), false);
  assert.equal(sameView({x: 0.01, y: 0, scale: 1}, {x: 0, y: 0, scale: 1}), true, "x at the epsilon");
  assert.equal(sameView({x: 0.0100001, y: 0, scale: 1}, {x: 0, y: 0, scale: 1}), false, "x past the epsilon");
  assert.equal(sameView({x: 0, y: -0.01, scale: 1}, {x: 0, y: 0, scale: 1}), true, "y at the epsilon");
  assert.equal(sameView({x: 0, y: -0.0100001, scale: 1}, {x: 0, y: 0, scale: 1}), false, "y past the epsilon");
  assert.equal(sameView({x: 0, y: 0, scale: 1 + 1e-6}, {x: 0, y: 0, scale: 1}), true, "scale at the epsilon");
  assert.equal(sameView({x: 0, y: 0, scale: 1 + 2e-6}, {x: 0, y: 0, scale: 1}), false, "scale past the epsilon");
}

// shouldRefit
{
  const target = {x: 10, y: 10, scale: 1};
  const far = {x: 500, y: 10, scale: 1};
  assert.equal(shouldRefit(far, target, false), true);
  assert.equal(shouldRefit(far, target, true), false, "never while applying");
  assert.equal(shouldRefit({...target}, target, false), false, "already there");
  assert.equal(shouldRefit(far, null, false), false);
  assert.equal(shouldRefit(far, undefined, false), false);
  assert.equal(shouldRefit(null, target, false), false);
}

// The fit controller: a pan that fires the canvasPan handler again must not recurse.
{
  const stage = {x: 0, y: 0, scale: 1};
  const target = {x: 100, y: 100, scale: 0.5};
  const calls = [];
  let controller;
  // Fake canvas.pan: clamps the scale (target never reached), then fires "canvasPan" synchronously.
  const pan = ({x, y}) => {
    calls.push({x, y});
    stage.x = x;
    stage.y = y;
    stage.scale = 0.6;
    controller.apply(); // the canvasPan handler
    controller.apply();
  };
  controller = createFitController({
    getCurrent: () => ({...stage}),
    getTarget: () => target,
    pan
  });
  assert.equal(controller.applying, false);
  assert.equal(controller.apply(), true);
  assert.equal(calls.length, 1, "re-entry is ignored");
  assert.equal(controller.applying, false, "guard released");
  // Clamped result still differs from the target, so a later pan (resize) tries once more, once.
  assert.equal(controller.apply(), true);
  assert.equal(calls.length, 2);

  // No target: nothing happens.
  const idle = createFitController({getCurrent: () => ({...stage}), getTarget: () => null, pan: () => assert.fail("pan")});
  assert.equal(idle.apply(), false);

  // The guard is released when pan throws.
  const failing = createFitController({
    getCurrent: () => ({...stage}),
    getTarget: () => target,
    pan: () => {
      throw new Error("pan failed");
    }
  });
  assert.throws(() => failing.apply(), /pan failed/);
  assert.equal(failing.applying, false);
}

// sceneFitUpdate
assert.deepEqual(sceneFitUpdate({imageWidth: 3000, imageHeight: 2000}),
  {width: 3000, height: 2000, padding: 0, shiftX: 0, shiftY: 0});
assert.deepEqual(sceneFitUpdate({imageWidth: 1919.6, imageHeight: 1080.4}),
  {width: 1920, height: 1080, padding: 0, shiftX: 0, shiftY: 0});
for (const [imageWidth, imageHeight] of [[0, 100], [100, 0], [-5, 100], [100, -5], [NaN, 100], [100, Infinity],
  [0.4, 100], ["100", 100], [undefined, 100]]) {
  assert.equal(sceneFitUpdate({imageWidth, imageHeight}), null, `image ${imageWidth}x${imageHeight}`);
}
assert.equal(sceneFitUpdate(), null);

// isDisplayScreen
assert.equal(isDisplayScreen({isGM: true, flag: true}), false);
assert.equal(isDisplayScreen({isGM: false, flag: true}), true);
assert.equal(isDisplayScreen({isGM: false}), false);
assert.equal(isDisplayScreen({isGM: false, flag: undefined}), false);
for (const flag of [false, null, "true", 1, "1", {}, []]) {
  assert.equal(isDisplayScreen({isGM: false, flag}), false, `flag ${JSON.stringify(flag)}`);
}
assert.equal(isDisplayScreen(), false);

// displayKeyAllowed
assert.equal(displayKeyAllowed({key: "F5"}), true);
assert.equal(displayKeyAllowed({key: "F11"}), true);
assert.equal(displayKeyAllowed({key: "r", ctrlKey: true}), true);
assert.equal(displayKeyAllowed({key: "r", metaKey: true}), true);
assert.equal(displayKeyAllowed({key: "F5", ctrlKey: true}), true);
assert.equal(displayKeyAllowed({key: "Control"}), true);
assert.equal(displayKeyAllowed({key: "Meta"}), true);
assert.equal(displayKeyAllowed({key: "f5"}), true, "case-insensitive");
assert.equal(displayKeyAllowed({key: "F5", altKey: true}), true, "F5 is allowed whatever Alt does");
assert.equal(displayKeyAllowed({key: "F11", shiftKey: true}), true);
for (const key of ["a", "Escape", "Enter", " ", "ArrowUp", "F1", "F12", "Tab", "Alt", "Shift", "", undefined, null, 5]) {
  assert.equal(displayKeyAllowed({key}), false, String(key));
  assert.equal(displayKeyAllowed({key, ctrlKey: false, metaKey: false, shiftKey: true}), false, String(key));
}
assert.equal(displayKeyAllowed(), false);

// shouldBlockEvent: pointer events are always blocked; keys follow displayKeyAllowed.
for (const type of ["wheel", "contextmenu", "dblclick", "mousedown"]) {
  assert.equal(shouldBlockEvent({type}), true, type);
  assert.equal(shouldBlockEvent({type, key: "F5", ctrlKey: true}), true, `${type} ignores key fields`);
}
assert.equal(shouldBlockEvent({type: "keydown", key: "a"}), true);
assert.equal(shouldBlockEvent({type: "keyup", key: "a"}), true);
assert.equal(shouldBlockEvent({type: "keydown", key: "F5"}), false);
assert.equal(shouldBlockEvent({type: "keyup", key: "F11"}), false);
assert.equal(shouldBlockEvent({type: "keydown", key: "Control", ctrlKey: true}), false);
assert.equal(shouldBlockEvent({type: "keyup", key: "Control", ctrlKey: false}), false, "Control keyup passes");
assert.equal(shouldBlockEvent({type: "keyup", key: "Meta", metaKey: false}), false, "Meta keyup passes");
assert.equal(shouldBlockEvent({type: "keydown", key: "r", metaKey: true}), false);
assert.equal(shouldBlockEvent(), true);

// touchesDisplayFlag
const touching = [
  {flags: {"helper-hub": {displayScreen: true}}},
  {flags: {"helper-hub": {displayScreen: false}}},
  {flags: {"helper-hub": {"-=displayScreen": null}}},
  {flags: {"helper-hub": {displayScreen: undefined}}},
  {flags: {"-=helper-hub": null}},
  {flags: {"helper-hub": null}},
  {flags: null},
  {flags: {"helper-hub.displayScreen": true}},
  {flags: {"helper-hub.-=displayScreen": null}},
  {"flags.helper-hub.displayScreen": true},
  {"flags.helper-hub.-=displayScreen": null},
  {"flags.helper-hub": {displayScreen: true}},
  {"flags.helper-hub": null},
  {"flags.-=helper-hub": null},
  {flags: null, name: "x"},
  {"-=flags": null}
];
for (const changes of touching) assert.equal(touchesDisplayFlag(changes), true, JSON.stringify(changes));
const untouched = [
  {flags: {"helper-hub": {other: 1}}},
  {flags: {other: {displayScreen: true}}},
  {flags: {"-=other": null}},
  {flags: {}},
  {flags: undefined},
  {flags: {"helper-hub": undefined}},
  {"flags.helper-hub.other": 1},
  {"flags.other.displayScreen": true},
  {name: "x"},
  {},
  null,
  undefined,
  "flags",
  42
];
for (const changes of untouched) assert.equal(touchesDisplayFlag(changes), false, JSON.stringify(changes));

// shouldRevertDisplayFlag
{
  const changes = {flags: {"helper-hub": {displayScreen: false}}};
  assert.equal(shouldRevertDisplayFlag({changes, initiatorIsGM: false}), true);
  assert.equal(shouldRevertDisplayFlag({changes, initiatorIsGM: true}), false, "GM edits stand");
  assert.equal(shouldRevertDisplayFlag({changes, initiatorIsGM: null}), false, "unknown initiator");
  assert.equal(shouldRevertDisplayFlag({changes, initiatorIsGM: undefined}), false);
  assert.equal(shouldRevertDisplayFlag({changes, initiatorIsGM: false, isRevert: true}), false, "no loops");
  assert.equal(shouldRevertDisplayFlag({changes: {name: "x"}, initiatorIsGM: false}), false);
  assert.equal(shouldRevertDisplayFlag(), false);
}

// roleIsGM: Assistant (3) and Gamemaster (4) count.
for (const [role, expected] of [[0, false], [1, false], [2, false], [3, true], [4, true], ["4", false],
  [undefined, false], [null, false]]) {
  assert.equal(roleIsGM(role), expected, `role ${role}`);
}

// sceneIdFromMenuEntry: scene directory rows carry data-entry-id, scene navigation rows do not.
{
  const row = {dataset: {entryId: "abc123"}};
  const inDirectory = {closest: selector => (selector === "[data-entry-id]" ? row : null)};
  assert.equal(sceneIdFromMenuEntry(inDirectory), "abc123");
  const inNavigation = {closest: () => null, dataset: {sceneId: "xyz"}};
  assert.equal(sceneIdFromMenuEntry(inNavigation), null);
  assert.equal(sceneIdFromMenuEntry({closest: () => ({dataset: {}})}), null);
  assert.equal(sceneIdFromMenuEntry({closest: () => ({dataset: {entryId: ""}})}), null);
  assert.equal(sceneIdFromMenuEntry({closest: () => ({})}), null);
  assert.equal(sceneIdFromMenuEntry({}), null);
  assert.equal(sceneIdFromMenuEntry(null), null);
  assert.equal(sceneIdFromMenuEntry(undefined), null);
}

// displayDisabledByQuery: ?helper-hub-display=off
assert.equal(displayDisabledByQuery("?helper-hub-display=off"), true);
assert.equal(displayDisabledByQuery("?a=1&helper-hub-display=off"), true);
assert.equal(displayDisabledByQuery("helper-hub-display=off"), true);
for (const search of ["", "?", "?helper-hub-display=on", "?helper-hub-display=", "?helper-hub-display", "?x=off",
  "?helper-hub-display=OFF", null, undefined]) {
  assert.equal(displayDisabledByQuery(search), false, String(search));
}

// Localization: every key the module uses exists in both languages, and the display keys stay in parity.
{
  const root = new URL("..", import.meta.url);
  const source = readFileSync(new URL("scripts/display-screen.mjs", root), "utf8");
  const en = JSON.parse(readFileSync(new URL("lang/en.json", root), "utf8"));
  const ru = JSON.parse(readFileSync(new URL("lang/ru.json", root), "utf8"));
  const used = new Set(source.match(/HELPERHUB\.[A-Za-z0-9_]+/g));
  assert.ok(used.size >= 10, "found the keys used by display-screen.mjs");
  for (const key of used) {
    assert.equal(typeof en[key], "string", `${key} missing from en.json`);
    assert.equal(typeof ru[key], "string", `${key} missing from ru.json`);
    assert.notEqual(en[key].trim(), "", `${key} is empty in en.json`);
    assert.notEqual(ru[key].trim(), "", `${key} is empty in ru.json`);
  }
  const own = lang => Object.keys(lang).filter(key => /^HELPERHUB\.(DisplayScreen|FitScene)/.test(key)).sort();
  assert.deepEqual(own(ru), own(en), "DisplayScreen* and FitScene* keys match between en and ru");
  for (const key of own(en)) {
    assert.deepEqual(en[key].match(/\{\w+\}/g) ?? [], ru[key].match(/\{\w+\}/g) ?? [], `${key} placeholders`);
  }
}

console.log("display-screen tests passed");
