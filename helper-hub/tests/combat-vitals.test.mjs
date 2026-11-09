/**
 * Combat tracker hit points and status choices. Run with node; Foundry is not required.
 * node helper-hub/tests/combat-vitals.test.mjs
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  combatAmountRaw,
  combatHpDelta,
  combatHpUpdate,
  combatStatusChoices,
  showCombatHp,
  showCombatVitals
} from "../scripts/combat-vitals.mjs";

assert.equal(combatHpDelta({direction: "damage", raw: "5"}), 5, "damage of 5");
assert.equal(combatHpDelta({direction: "damage", raw: 5}), 5, "numeric damage of 5");
assert.equal(combatHpDelta({direction: "heal", raw: "5"}), -5, "healing of 5");
assert.equal(combatHpDelta({direction: "heal", raw: 5}), -5, "numeric healing of 5");

assert.equal(combatHpDelta({direction: "damage", raw: ""}), 1, "empty damage");
assert.equal(combatHpDelta({direction: "heal", raw: ""}), -1, "empty healing");
assert.equal(combatHpDelta({direction: "damage", raw: "   "}), 1, "blank damage");
assert.equal(combatHpDelta({direction: "heal", raw: " \n\t "}), -1, "blank healing");

assert.equal(combatHpDelta({direction: "damage", raw: "0"}), null, "zero damage");
assert.equal(combatHpDelta({direction: "heal", raw: "0"}), null, "zero healing");
assert.equal(combatHpDelta({direction: "damage", raw: 0}), null, "numeric zero");
assert.equal(combatHpDelta({direction: "damage", raw: "-4"}), null, "negative damage");
assert.equal(combatHpDelta({direction: "heal", raw: "-2"}), null, "negative healing");
assert.equal(combatHpDelta({direction: "heal", raw: -3}), null, "numeric negative");
assert.equal(combatHpDelta({direction: "damage", raw: "abc"}), null, "garbage damage");
assert.equal(combatHpDelta({direction: "heal", raw: "12px"}), null, "garbage healing");
assert.equal(combatHpDelta({direction: "other", raw: "5"}), null, "unknown direction");

assert.equal(combatAmountRaw(null), "", "a missing amount field is empty");
assert.equal(combatAmountRaw(undefined), "", "an undefined amount field is empty");
assert.equal(combatAmountRaw({validity: {badInput: true}, value: ""}), null, "bad input is not an empty amount");
assert.equal(combatAmountRaw({validity: {badInput: true}, value: "1"}), null, "bad input ignores the cleared value");
assert.equal(combatAmountRaw({validity: {badInput: false}, value: ""}), "", "a cleared field stays empty");
assert.equal(combatAmountRaw({validity: {badInput: false}, value: "12px"}), "12px", "invalid text stays available");
assert.equal(combatAmountRaw({validity: {badInput: false}, value: "-"}), "-", "a lone minus sign stays available");
assert.equal(combatAmountRaw({validity: {badInput: false}, value: "e"}), "e", "a lone exponent stays available");
assert.equal(combatAmountRaw({value: "4"}), "4", "a field without validity still yields its text");
assert.equal(
  combatHpDelta({direction: "damage", raw: combatAmountRaw({validity: {badInput: true}, value: ""})}),
  null,
  "bad input does not become 1 damage"
);
assert.equal(
  combatHpDelta({direction: "heal", raw: combatAmountRaw({validity: {badInput: true}, value: ""})}),
  null,
  "bad input does not become 1 healing"
);
assert.equal(
  combatHpDelta({direction: "damage", raw: combatAmountRaw({validity: {badInput: false}, value: "12px"})}),
  null,
  "pasted units are not damage"
);
assert.equal(
  combatHpDelta({direction: "damage", raw: combatAmountRaw({validity: {badInput: false}, value: ""})}),
  1,
  "an empty field is still 1"
);

assert.equal(combatHpUpdate({value: 10, max: 10, delta: 5}), 5, "damage lowers hit points");
assert.equal(combatHpUpdate({value: 8, max: 10, delta: -5}), 10, "healing stops at the maximum");
assert.equal(combatHpUpdate({value: 2, max: 10, delta: 9}), 0, "damage stops at zero");
assert.equal(combatHpUpdate({value: 4, max: undefined, delta: -3}), 7, "a missing maximum does not invent a ceiling");
assert.equal(combatHpUpdate({value: undefined, max: 10, delta: 1}), null, "no hit-point value");
assert.equal(combatHpUpdate({value: "10", max: 10, delta: 1}), null, "a non-numeric value is not a pool");
assert.equal(combatHpUpdate({value: Number.NaN, max: 10, delta: 1}), null, "NaN is not a pool");

const bystander = {name: "Villager", system: {attributes: {ac: {value: 10}}}};
assert.equal(showCombatHp(bystander), false, "a character with no hit points");
assert.equal(showCombatHp({system: {attributes: {hp: {max: 8}}}}), false, "max without a current value");
assert.equal(showCombatHp({system: {attributes: {hp: {value: Number.NaN, max: 8}}}}), false, "non-finite value");
assert.equal(showCombatHp({system: {attributes: {hp: {value: 4, max: 8}}}}), true, "a numeric pool");
assert.equal(showCombatHp({value: 0, max: 8}), true, "zero hit points is still a pool");
assert.equal(combatHpUpdate({value: bystander.system.attributes.hp?.value, max: null, delta: 1}), null);

assert.equal(showCombatVitals({isGM: false, enabled: true}), false, "a player sees nothing");
assert.equal(showCombatVitals({isGM: true, enabled: false}), false, "the setting hides the controls");
assert.equal(showCombatVitals({isGM: false, enabled: false}), false, "both gates closed");
assert.equal(showCombatVitals({isGM: true, enabled: true}), true, "the GM sees the controls");

const fromArray = combatStatusChoices([
  {id: "prone", img: "icons/prone.svg", name: "Prone"},
  {id: "stun", img: "icons/stun.svg", name: "Stunned"},
  {name: "Missing id"},
  {id: "", img: "icons/blank.svg", name: "Blank"},
  {id: 4, img: "icons/num.svg", name: "Number"}
], new Set(["prone"]));
assert.deepEqual(fromArray, [
  {id: "prone", img: "icons/prone.svg", name: "Prone", active: true},
  {id: "stun", img: "icons/stun.svg", name: "Stunned", active: false}
]);

const fromObject = combatStatusChoices({
  prone: {id: "prone", img: "icons/prone.svg", name: "Prone"},
  dead: {id: "dead", img: "icons/dead.svg", name: "Dead"},
  nope: {img: "icons/x.svg", name: "Missing"}
}, ["dead"]);
assert.equal(fromObject.length, 2, "a plain object still yields choices");
assert.equal(fromObject.find(choice => choice.id === "dead")?.active, true, "the active id is marked");
assert.equal(fromObject.find(choice => choice.id === "prone")?.active, false, "another id stays inactive");
assert.deepEqual(combatStatusChoices("prone", []), [], "a string is not a list of effects");

assert.equal(globalThis.game, undefined, "import leaves game undefined");
assert.equal(globalThis.Hooks, undefined, "import leaves Hooks undefined");
assert.equal(globalThis.PIXI, undefined, "import leaves PIXI undefined");
assert.equal(globalThis.canvas, undefined, "import leaves canvas undefined");

const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const ru = JSON.parse(readFileSync(new URL("../lang/ru.json", import.meta.url), "utf8"));
for (const key of [
  "HELPERHUB.SettingsCombat",
  "HELPERHUB.CombatVitalsName",
  "HELPERHUB.CombatVitalsHint",
  "HELPERHUB.CombatVitalsDamage",
  "HELPERHUB.CombatVitalsHeal",
  "HELPERHUB.CombatVitalsAmount",
  "HELPERHUB.CombatVitalsStatuses"
]) {
  assert.equal(typeof en[key], "string", `${key} in English`);
  assert.equal(typeof ru[key], "string", `${key} in Russian`);
  assert.ok(en[key].trim(), `${key} is not empty in English`);
  assert.ok(ru[key].trim(), `${key} is not empty in Russian`);
}

console.log("combat-vitals: passed");
