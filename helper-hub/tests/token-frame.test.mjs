/**
 * Alignment rules and the portrait square check. Run with node; Foundry is not required.
 * node helper-hub/tests/token-frame.test.mjs
 */
import assert from "node:assert/strict";
import {detectTokenFrameRole, needsTokenFramePlacement, ringUpdate, subjectCircleFraction} from "../scripts/token-frame.mjs";

/**
 * @param {unknown} alignment
 * @returns {string | null}
 */
function role(alignment) {
  return detectTokenFrameRole(null, {alignment});
}

/** @type {[unknown, string | null, string][]} */
const cases = [
  [["L", "N"], "neutral", "lawful neutral codes"],
  [["C", "N"], "neutral", "chaotic neutral codes"],
  [["C", "NY"], "neutral", "chaotic neutral on the moral axis"],
  [["L"], null, "lawful alone stays unknown"],
  [["L", "C"], null, "both law and chaos stay unknown"],
  [["L", "NX"], null, "law beside NX stays unknown"],
  [["L", "N", "NX"], null, "NX blocks ignoring a law code"],
  ["Any Non-Good Alignment", null, "non-good is not good"],
  ["Any Non-Evil Alignment", null, "non-evil is not evil"],
  ["any non-good alignment", null, "lowercase non-good stays unknown"],
  ["Lawful Neutral", "neutral", "lawful neutral words"],
  ["neutral evil", "enemy", "neutral evil stays enemy"],
  ["Lawful Neutral (Good/Evil Axis)", "neutral", "parenthetical axis is a note"],
  ["нейтрально-злой", "enemy", "russian neutral evil"],
  ["без мировоззрения", null, "russian unaligned"],
  [[{alignment: ["N"]}], "neutral", "object alignment codes"],
  [[{alignment: ["C", "E"], chance: 75}], "enemy", "weighted evil codes"],
  [[{alignment: ["L", "E"]}, {alignment: ["C", "E"], chance: 75}], "enemy", "choices that agree"],
  [[{alignment: ["N"]}, {alignment: ["C", "E"], chance: 75}], null, "choices that disagree"],
  [[{special: "any chaotic alignment"}], null, "special text stays unknown"]
];

for (const [alignment, expected, label] of cases) {
  assert.equal(role(alignment), expected, label);
}

/** @type {[number, number, boolean, string][]} */
const placement = [
  [512, 512, false, "square image skips the modal"],
  [3, 4, true, "3:4 image opens the modal"],
  [110, 100, false, "1.1 ratio skips the modal"]
];

for (const [width, height, expected, label] of placement) {
  assert.equal(needsTokenFramePlacement(width, height), expected, label);
}

/** Steel's default colorBand.startRadius. The portrait sits 2% inside that edge. */
const STEEL_START = 0.666;
const RADIUS_INSET = 0.98;

/** @type {[number | null, number | undefined, number, string][]} */
const circles = [
  [0.666, undefined, STEEL_START * RADIUS_INSET, "steel start radius insets the portrait"],
  [0.6, undefined, 0.6 * RADIUS_INSET, "bronze start radius insets the portrait"],
  [0.666, 2, (STEEL_START * RADIUS_INSET) / 2, "subject scale halves the steel circle"],
  [null, undefined, STEEL_START * RADIUS_INSET, "missing start radius uses steel"],
  [Number.NaN, undefined, STEEL_START * RADIUS_INSET, "NaN start radius uses steel"],
  [Number.NaN, 2, (STEEL_START * RADIUS_INSET) / 2, "a failed lookup still reads subject scale"],
  [2, undefined, 1, "a circle larger than the canvas stays on the canvas"]
];

for (const [startRadius, scale, expected, label] of circles) {
  const actual = subjectCircleFraction(startRadius, scale);
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} vs ${expected}`);
}

const painted = ringUpdate("ally", "modules/helper-hub/storage/tokens/a.png");
assert.equal(painted.ring.subject?.texture, "modules/helper-hub/storage/tokens/a.png");
assert.equal(painted.ring.subject?.scale, undefined, "subject scale is not written back");

console.log(`token-frame alignment: ${cases.length} cases passed`);
console.log(`token-frame placement: ${placement.length} cases passed`);
console.log(`token-frame circle: ${circles.length} cases passed`);
