/**
 * NPC token names. Run with node; Foundry is not required.
 * node helper-hub/tests/token-names.test.mjs
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {npcTokenName, npcTokenUpdate, releaseNpcTokenName} from "../scripts/token-names.mjs";

assert.equal(globalThis.game, undefined);
assert.equal(globalThis.Hooks, undefined);
assert.equal(globalThis.PIXI, undefined);
assert.equal(globalThis.canvas, undefined);

const ru = [
  {m: "Сердитый", f: "Сердитая", n: "Сердитое"},
  {m: "Настороженный", f: "Настороженная", n: "Настороженное"}
];

/**
 * @param {Record<string, unknown>} [over]
 * @returns {string | null}
 */
function named(over = {}) {
  return npcTokenName({
    actorType: "npc",
    actorName: "Гоблин",
    tokenName: "Гоблин",
    adjectives: ru,
    used: [],
    roll: 0,
    ...over
  });
}

assert.equal(named({actorType: "character", actorName: "Aldric", tokenName: "Aldric", adjectives: ["Angry"]}), null, "a player character keeps its name");
assert.equal(named({actorType: "character", tokenName: ""}), null, "a character with an empty token name stays unchanged");
assert.equal(named({actorName: ""}), null, "an empty actor name is left alone");
assert.equal(named({actorName: "   ", tokenName: ""}), null, "a blank actor name is left alone");
assert.equal(named({actorName: "Goblin", tokenName: "", adjectives: ["Angry"]}), "Angry Goblin", "an empty token name takes an adjective");
assert.equal(named({actorName: "Goblin", tokenName: "   ", adjectives: ["Angry"]}), "Angry Goblin", "a blank token name takes an adjective");
assert.equal(named({actorName: "Goblin", tokenName: "Goblin", adjectives: ["Angry", "Wary"]}), "Angry Goblin", "the creature name takes an adjective");
assert.equal(named({tokenName: "Страж ворот"}), null, "a custom prototype name is kept");
assert.equal(named({tokenName: "Сердитый Гоблин"}), null, "a name that already has an adjective is kept");
assert.equal(named({tokenName: "Страж ворот (1)"}), null, "a numbered custom name is kept");
assert.equal(named({tokenName: "Гоблин (1)"}), "Сердитый Гоблин", "Foundry's numbered copy takes an adjective");
assert.equal(named({tokenName: "Гоблин (12)"}), "Сердитый Гоблин", "a larger Foundry number still takes an adjective");
assert.equal(named({tokenName: "Гоблин (0)"}), null, "a zero suffix is not a Foundry copy number");
assert.equal(named({actorName: "Крыса", tokenName: "Крыса"}), "Сердитая Крыса", "a name ending in а takes the feminine adjective");
assert.equal(named({actorName: "Змея", tokenName: "Змея"}), "Сердитая Змея", "a name ending in я takes the feminine adjective");
assert.equal(named({actorName: "Чудовище", tokenName: "Чудовище"}), "Сердитое Чудовище", "a name ending in е takes the neuter adjective");
assert.equal(named({actorName: "Лихо", tokenName: "Лихо"}), "Сердитое Лихо", "a name ending in о takes the neuter adjective");
assert.equal(named({actorName: "Ружьё", tokenName: "Ружьё"}), "Сердитое Ружьё", "a name ending in ё takes the neuter adjective");
assert.equal(named({actorName: "  Крыса  ", tokenName: "Крыса"}), "Сердитая Крыса", "the actor name keeps its capital letter");
assert.equal(named({
  adjectives: ["Angry"],
  used: ["Angry Гоблин"],
  roll: 0
}), "Angry Гоблин", "a used combination is repeated when it is the only one");
assert.equal(named({
  adjectives: ["Angry", "Wary"],
  used: ["Angry Гоблин"],
  roll: 0
}), "Wary Гоблин", "a used combination is skipped");
assert.equal(named({
  actorName: "Goblin",
  tokenName: "Goblin",
  adjectives: ["Angry", "Wary", "Old"],
  used: ["Angry Goblin", "Wary Goblin"],
  roll: 0.999
}), "Old Goblin", "roll picks inside the adjectives that are still free");
assert.equal(named({
  actorName: "Goblin",
  tokenName: "Goblin",
  adjectives: ["Angry", "Wary"],
  used: ["Angry Goblin", "Wary Goblin"],
  roll: 0
}), "Angry Goblin", "every combination taken allows a repeat");
assert.equal(named({
  actorName: "Goblin",
  tokenName: "Goblin",
  adjectives: ["Angry", "Wary"],
  used: ["Angry Goblin", "Wary Goblin"],
  roll: 0.999
}), "Wary Goblin", "a repeat still follows the roll");
assert.equal(named({adjectives: []}), null, "an empty adjective list makes no change");
assert.equal(named({adjectives: ["", "  "]}), null, "blank adjectives make no change");
assert.equal(named({actorName: "Крыса", tokenName: "Крыса", adjectives: [{m: "Сердитый"}]}), null, "a missing feminine form makes no change");
assert.equal(named({
  actorName: "Goblin",
  tokenName: "Goblin",
  adjectives: ["Angry", "Wary"],
  roll: 0.999
}), "Wary Goblin", "a high roll picks the later adjective");

const random = Math.random;
let randomCalls = 0;
Math.random = () => {
  randomCalls += 1;
  return 0.5;
};
try {
  assert.equal(named({actorName: "Goblin", tokenName: "Goblin", adjectives: ["Angry", "Wary"], roll: 0}), "Angry Goblin");
  assert.equal(randomCalls, 0, "the pure function does not call Math.random");
} finally {
  Math.random = random;
}

const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const ruLang = JSON.parse(readFileSync(new URL("../lang/ru.json", import.meta.url), "utf8"));

assert.deepEqual(Object.keys(en).sort(), Object.keys(ruLang).sort(), "language keys match");

/**
 * @param {unknown} value
 * @param {string} path
 */
function assertFilled(value, path) {
  if (typeof value === "string") {
    assert.ok(value.trim(), `${path} is empty`);
    return;
  }
  assert.ok(value && (typeof value === "object"), path);
  const entries = Object.entries(value);
  assert.ok(entries.length, `${path} is empty`);
  for (const [key, child] of entries) assertFilled(child, `${path}.${key}`);
}

for (const [key, value] of Object.entries(en)) assertFilled(value, `en.${key}`);
for (const [key, value] of Object.entries(ruLang)) assertFilled(value, `ru.${key}`);

const adjectiveIds = [
  "angry", "wary", "old", "young", "scarred", "silent", "hungry", "bold",
  "grim", "wild", "cunning", "huge", "small", "swift", "lame", "oneEyed",
  "shaggy", "pale", "dark", "fierce", "sleepy", "stubborn", "cautious", "loud"
];
assert.deepEqual(Object.keys(en["HELPERHUB.NpcTokenAdjectives"]), adjectiveIds);
assert.deepEqual(Object.keys(ruLang["HELPERHUB.NpcTokenAdjectives"]), adjectiveIds);

const enAdjectives = Object.values(en["HELPERHUB.NpcTokenAdjectives"]);
const ruAdjectives = Object.values(ruLang["HELPERHUB.NpcTokenAdjectives"]);
assert.equal(enAdjectives.length, 24);
assert.equal(named({
  actorName: "Goblin",
  tokenName: "Goblin (2)",
  adjectives: enAdjectives,
  roll: 0
}), "Angry Goblin");
assert.equal(named({
  actorName: "Крыса",
  tokenName: "",
  adjectives: ruAdjectives,
  roll: 0
}), "Сердитая Крыса");
assert.equal(named({
  actorName: "Чудовище",
  tokenName: "Чудовище",
  adjectives: ruAdjectives,
  used: ["Сердитое Чудовище"],
  roll: 0
}), "Настороженное Чудовище");

/**
 * @param {Record<string, unknown>} [over]
 * @returns {{name: string, delta?: {name: string}} | null}
 */
function updated(over = {}) {
  return npcTokenUpdate({
    npcTokenNames: true,
    actorLink: false,
    actorType: "npc",
    actorName: "Goblin",
    tokenName: "Goblin",
    adjectives: ["Angry", "Wary"],
    used: [],
    roll: 0,
    ...over
  });
}

assert.equal(npcTokenUpdate({npcTokenNames: false}), null, "npcTokenNames off returns before a write");
assert.equal(
  updated({npcTokenNames: false, sceneId: "off", actorId: "goblin"}),
  null,
  "npcTokenNames off returns before a name is reserved"
);
assert.equal(updated({sceneId: "off", actorId: "goblin"}).name, "Angry Goblin", "a disabled setting does not reserve a name");
releaseNpcTokenName("off", "goblin", "Angry Goblin");

assert.equal(
  updated({actorType: "character", actorName: "Aldric", tokenName: "Aldric", sceneId: "chars", actorId: "aldric"}),
  null,
  "a character produces no update"
);
assert.equal(updated({sceneId: "chars", actorId: "aldric"}).name, "Angry Goblin", "a character does not reserve a name");
releaseNpcTokenName("chars", "aldric", "Angry Goblin");

assert.equal(
  updated({tokenName: "Страж ворот", sceneId: "custom", actorId: "guard"}),
  null,
  "a custom name produces no update"
);
assert.equal(updated({sceneId: "custom", actorId: "guard"}).name, "Angry Goblin", "a custom name does not reserve an adjective");
releaseNpcTokenName("custom", "guard", "Angry Goblin");

assert.deepEqual(
  updated(),
  {name: "Angry Goblin", delta: {name: "Angry Goblin"}},
  "an unlinked token writes name and delta.name"
);
assert.deepEqual(updated({actorLink: true}), {name: "Angry Goblin"}, "a linked token writes name only");

const batch = {sceneId: "batch", actorId: "goblin"};
try {
  assert.deepEqual(updated(batch), {name: "Angry Goblin", delta: {name: "Angry Goblin"}});
  assert.deepEqual(
    updated(batch),
    {name: "Wary Goblin", delta: {name: "Wary Goblin"}},
    "the next token in the batch skips the reserved adjective"
  );
  assert.equal(
    updated({sceneId: "batch", actorId: "wolf", actorName: "Wolf", tokenName: "Wolf"}).name,
    "Angry Wolf",
    "another actor keeps its own adjectives"
  );
  assert.equal(
    updated({sceneId: "other", actorId: "goblin"}).name,
    "Angry Goblin",
    "a different scene does not see the reservation"
  );
  assert.equal(
    updated({...batch, adjectives: ["Angry", "Wary", "Old"], used: ["Wary Goblin"]}).name,
    "Old Goblin",
    "scene names and the batch reservation are both skipped"
  );
  assert.deepEqual(
    updated({actorLink: true, sceneId: "linked-batch", actorId: "goblin"}),
    {name: "Angry Goblin"}
  );
  assert.deepEqual(
    updated({actorLink: true, sceneId: "linked-batch", actorId: "goblin"}),
    {name: "Wary Goblin"},
    "linked copies in one batch still avoid a shared adjective"
  );
} finally {
  releaseNpcTokenName("batch", "goblin", "Angry Goblin");
  releaseNpcTokenName("batch", "goblin", "Wary Goblin");
  releaseNpcTokenName("batch", "goblin", "Old Goblin");
  releaseNpcTokenName("batch", "wolf", "Angry Wolf");
  releaseNpcTokenName("other", "goblin", "Angry Goblin");
  releaseNpcTokenName("linked-batch", "goblin", "Angry Goblin");
  releaseNpcTokenName("linked-batch", "goblin", "Wary Goblin");
}
assert.equal(updated(batch).name, "Angry Goblin", "createToken releases the reserved name");
assert.equal(updated(batch).name, "Wary Goblin", "a released name can be chosen again");
releaseNpcTokenName("batch", "goblin", "Angry Goblin");
releaseNpcTokenName("batch", "goblin", "Wary Goblin");

/**
 * Index of the brace that closes the one at `open`.
 * @param {string} source
 * @param {number} open
 * @returns {number}
 */
function blockEnd(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const moduleSource = readFileSync(new URL("../scripts/module.mjs", import.meta.url), "utf8");
const initAt = moduleSource.indexOf('Hooks.once("init"');
const initOpen = moduleSource.indexOf("{", initAt);
const initClose = blockEnd(moduleSource, initOpen);
const registerCall = "registerNpcTokenNames()";
const registerAt = moduleSource.indexOf(registerCall);
assert.ok(initAt >= 0, "init hook exists");
assert.ok((registerAt > initOpen) && (registerAt < initClose), "registerNpcTokenNames runs inside init");
assert.equal(moduleSource.indexOf(registerCall, registerAt + registerCall.length), -1, "the hook is not registered again");
assert.equal(moduleSource.includes("preCreateToken"), false, "module.mjs does not register preCreateToken itself");
assert.equal(moduleSource.includes("createToken"), false, "module.mjs does not register createToken itself");

const tokenSource = readFileSync(new URL("../scripts/token-names.mjs", import.meta.url), "utf8");
const registerOpen = tokenSource.indexOf("{", tokenSource.indexOf("export function registerNpcTokenNames"));
const registerBody = tokenSource.slice(registerOpen, blockEnd(tokenSource, registerOpen));
assert.match(registerBody, /Hooks\.on\("preCreateToken", onPreCreateToken\);/);
assert.match(registerBody, /Hooks\.on\("createToken", onCreateToken\);/);
assert.deepEqual(tokenSource.match(/Hooks\.on\(/g), ["Hooks.on(", "Hooks.on("]);
const preOpen = tokenSource.indexOf("{", tokenSource.indexOf("function onPreCreateToken"));
const preBody = tokenSource.slice(preOpen, blockEnd(tokenSource, preOpen));
const gate = preBody.indexOf("canRenameNpcToken");
assert.ok(gate > preBody.indexOf("npcTokenNames"), "the setting is checked before the token is named");
assert.ok(preBody.indexOf("namesForCreature") > gate, "the scene is scanned after the token qualifies");
assert.ok(preBody.indexOf("adjectivesFromTranslations") > gate, "adjectives load after the token qualifies");
assert.ok(preBody.indexOf("Math.random") > gate, "the roll happens after the token qualifies");
const createOpen = tokenSource.indexOf("{", tokenSource.indexOf("function onCreateToken"));
const createBody = tokenSource.slice(createOpen, blockEnd(tokenSource, createOpen));
assert.match(createBody, /releaseNpcTokenName\(token\.parent\?\.id, token\.actorId, token\.name\);/);

console.log("token-names: passed");
