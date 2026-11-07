/**
 * Status overlay presets. Run with node; Foundry is not required.
 * node helper-hub/tests/status-overlays.test.mjs
 */
import assert from "node:assert/strict";
import {
  arcPulse,
  createGlyph,
  drawGraphics,
  drawStatusGraphics,
  dripBand,
  glyphTextureFor,
  maskIsFastRect,
  painterKinds,
  paintPixelFrame,
  pixelCanvasSize,
  pixelPlacement,
  pixelSamplingModes,
  pixelScale,
  placeDripSegment,
  overlayPresence,
  overlaySpritePlan,
  portraitMaskShapes,
  stepStatusPlans,
  styleForStatus
} from "../scripts/status-overlays.mjs";

/** @type {[string, string, number][]} */
const cases = [
  ["bleeding", "drip", 0x8b1e1e],
  ["bloodied", "vignette", 0x4a1010],
  ["burning", "rise", 0xe85d04],
  ["fireShield", "rise", 0xe85d04],
  ["shock", "rise", 0xf4d35e],
  ["corrode", "drip", 0xb5c94a],
  ["poisoned", "rise", 0x3d9b4a],
  ["poison", "rise", 0x3d9b4a],
  ["diseased", "rise", 0x6b8f3a],
  ["disease", "rise", 0x6b8f3a],
  ["cursed", "orbit", 0x7b2cbf],
  ["curse", "orbit", 0x7b2cbf],
  ["dehydration", "drip", 0xc4a574],
  ["malnutrition", "rise", 0x8a8f6a],
  ["degen", "rise", 0x8a8f6a],
  ["exhaustion", "vignette", 0x8d8d8d],
  ["encumbered", "vignette", 0x5c5c5c],
  ["heavilyEncumbered", "vignette", 0x3a3a3a],
  ["exceedingCarryingCapacity", "vignette", 0x3a3a3a],
  ["frightened", "vignette", 0x2a1438],
  ["fear", "vignette", 0x2a1438],
  ["stunned", "orbit", 0xe6c15a],
  ["stun", "orbit", 0xe6c15a],
  ["surprised", "text", 0xf0a202],
  ["grappled", "lines", 0x8a5a32],
  ["restrained", "lines", 0xa8b0b8],
  ["restrain", "lines", 0xa8b0b8],
  ["petrified", "lines", 0x9aa0a6],
  ["paralyzed", "orbit", 0x4cc9f0],
  ["paralysis", "orbit", 0x4cc9f0],
  ["blinded", "lines", 0x1c1c1c],
  ["blind", "lines", 0x1c1c1c],
  ["deafened", "shimmer", 0x8ecae6],
  ["deaf", "shimmer", 0x8ecae6],
  ["silenced", "shimmer", 0x8ecae6],
  ["silence", "shimmer", 0x8ecae6],
  ["suffocation", "rise", 0x90e0ef],
  ["sleeping", "text", 0xa0c4ff],
  ["sleep", "text", 0xa0c4ff],
  ["unconscious", "vignette", 0x141820],
  ["incapacitated", "vignette", 0x141820],
  ["concentrating", "arc", 0x4d96ff],
  ["charmed", "rise", 0xff6b9a],
  ["bless", "rise", 0xe8c15a],
  ["stable", "rise", 0xe8c15a],
  ["regen", "rise", 0xe8c15a],
  ["upgrade", "rise", 0xe8c15a],
  ["coverHalf", "arc", 0x8ecae6],
  ["coverThreeQuarters", "arc", 0x8ecae6],
  ["coverTotal", "arc", 0x8ecae6],
  ["coldShield", "arc", 0xbde0fe],
  ["magicShield", "arc", 0xb388ff],
  ["holyShield", "arc", 0xfff3c4],
  ["dodging", "streak", 0xf8f9fa],
  ["flying", "streak", 0x90e0ef],
  ["fly", "streak", 0x90e0ef],
  ["hovering", "streak", 0x90e0ef],
  ["hover", "streak", 0x90e0ef],
  ["falling", "streak", 0x6c757d],
  ["burrowing", "drip", 0x6b4f3a],
  ["burrow", "drip", 0x6b4f3a],
  ["invisible", "shimmer", 0x9bf6ff],
  ["ethereal", "shimmer", 0x9bf6ff],
  ["hiding", "shimmer", 0x9bf6ff],
  ["transformed", "orbit", 0xff4d6d],
  ["marked", "mark", 0xe63946],
  ["eye", "mark", 0xe63946],
  ["target", "mark", 0xe63946],
  ["dead", "vignette", 0x1a0a0a],
  ["prone", "vignette", 0x3d2b1f],
  ["frozen", "shimmer", 0xa8dadc],
  ["downgrade", "rise", 0x6c757d]
];

for (const [id, motion, color] of cases) {
  const style = styleForStatus(id);
  assert.equal(style.motion, motion, `${id} motion`);
  assert.equal(style.color, color, `${id} color`);
}

const bleeding = styleForStatus("bleeding");
const bloodied = styleForStatus("bloodied");
assert.equal(bleeding.motion, "drip");
assert.notEqual(bleeding, bloodied);

const unknown = styleForStatus("not-a-real-status");
assert.equal(unknown.motion, "veil");
assert.equal(unknown, styleForStatus("another-unknown-status"));
assert.notEqual(unknown.color, bleeding.color);
assert.notEqual(styleForStatus("poisoned").color, styleForStatus("diseased").color);

assert.equal(styleForStatus("coverHalf").weight, 1);
assert.equal(styleForStatus("coverThreeQuarters").weight, 2);
assert.equal(styleForStatus("coverTotal").weight, 3);
assert.equal(styleForStatus("concentrating").weight, 2);
assert.equal(styleForStatus("surprised").glyph, "!");
assert.equal(styleForStatus("sleeping").glyph, "Z");
assert.equal(styleForStatus("sleep").glyph, "Z");
assert.equal(styleForStatus("dodging").direction, "sideways");
assert.equal(styleForStatus("flying").direction, "up");
assert.equal(styleForStatus("falling").direction, "down");
assert.equal(styleForStatus("charmed").hearts, true);
assert.equal(styleForStatus("dehydration").slow, true);
assert.equal(styleForStatus("downgrade").slow, true);
assert.equal(styleForStatus("prone").feet, true);
assert.equal(styleForStatus("dead").still, true);
assert.equal(styleForStatus("frightened").shake, true);
assert.equal(styleForStatus("blinded").bar, true);
assert.equal(styleForStatus("suffocation").ring, true);
assert.notEqual(styleForStatus("transformed").accent, styleForStatus("transformed").color);

assert.equal(styleForStatus("bloodied").accentMotion, "drip");
assert.equal(styleForStatus("bloodied").accentCount, 4);
assert.equal(styleForStatus("exhaustion").accentMotion, "mote");
assert.equal(styleForStatus("encumbered").accentMotion, "streak");
assert.ok(styleForStatus("heavilyEncumbered").accentCount > styleForStatus("encumbered").accentCount);
assert.ok(styleForStatus("exceedingCarryingCapacity").accentCount > styleForStatus("heavilyEncumbered").accentCount);
assert.equal(styleForStatus("frightened").accentMotion, "wisp");
assert.equal(styleForStatus("fear").accentCount, 5);
assert.equal(styleForStatus("unconscious").accentMotion, "glyph");
assert.equal(styleForStatus("unconscious").glyph, "Z");
assert.ok(styleForStatus("unconscious").accentCount > styleForStatus("incapacitated").accentCount);
assert.equal(styleForStatus("dead").accentMotion, "ring");
assert.equal(styleForStatus("prone").accentMotion, "mote");
assert.ok(styleForStatus("prone").alpha >= 0.4);
assert.equal(styleForStatus("burning").flames, true);
assert.equal(styleForStatus("shock").flames, true);
assert.equal(styleForStatus("diseased").bubbles, true);
assert.equal(styleForStatus("stunned").sparks, true);
assert.equal(styleForStatus("grappled").bent, true);

const box = {w: 100, h: 80, cx: 50, cy: 40};
const pixi8 = ["rect", "circle", "stroke", "fill"];

function fakeGraphics() {
  const calls = [];
  const gfx = {};
  for (const name of [
    "clear", "lineStyle", "drawRect", "drawCircle", "arc",
    "beginFill", "endFill", "moveTo", "lineTo",
    ...pixi8
  ]) {
    gfx[name] = (...args) => {
      calls.push({name, args});
      return gfx;
    };
  }
  return {gfx, calls};
}

function named(calls, name) {
  return calls.filter((call) => call.name === name);
}

function assertPixi7(calls) {
  for (const name of pixi8) assert.equal(named(calls, name).length, 0, name);
}

function before(calls, earlier, later) {
  const order = calls.map((call) => call.name);
  const left = order.indexOf(earlier);
  const right = order.indexOf(later);
  assert.ok(left >= 0, earlier);
  assert.ok(right >= 0, later);
  assert.ok(left < right, `${earlier} before ${later}`);
}

function draw(id, time = 1) {
  const fake = fakeGraphics();
  drawStatusGraphics(fake.gfx, styleForStatus(id), box, time);
  assertPixi7(fake.calls);
  assert.equal(fake.calls[0].name, "clear", id);
  return fake.calls;
}

const span = Math.min(box.w, box.h);
const scale = pixelScale(span);
const grappled = draw("grappled");
const ropeRects = named(grappled, "drawRect");
assert.equal(ropeRects.length, 40, "five ropes of eight links");
for (const call of ropeRects) {
  assert.equal(call.args[2], 2 * scale);
  assert.equal(call.args[3], 2 * scale);
}
assert.equal(named(grappled, "lineTo").length, 0);
assert.equal(named(grappled, "moveTo").length, 0);
assert.equal(named(grappled, "beginFill")[0].args[0], 0x8a5a32);
before(grappled, "beginFill", "drawRect");
before(grappled, "drawRect", "endFill");

const blinded = draw("blinded");
assert.equal(named(blinded, "lineStyle").length, 0);
assert.deepEqual(named(blinded, "beginFill")[0].args, [0x1c1c1c, 0.9]);
before(blinded, "beginFill", "drawRect");
before(blinded, "drawRect", "endFill");
const bar = named(blinded, "drawRect")[0].args;
assert.deepEqual(bar, [
  Math.round(box.w * 0.06),
  Math.round(box.h * 0.32),
  Math.round(box.w * 0.88),
  Math.max(8, Math.round(box.h * 0.2))
]);
assert.ok(bar[2] > box.w * 0.7);
assert.ok(bar[3] >= 8);
assert.ok(named(blinded, "beginFill").length >= 2);
assert.ok(named(blinded, "beginFill")[1].args[1] < 0.9);

const deafened = draw("deafened");
const earBlocks = named(deafened, "drawRect");
assert.ok(earBlocks.length >= 8);
assert.equal(named(deafened, "drawCircle").length, 0);
assert.equal(named(deafened, "arc").length, 0);
for (const call of earBlocks) {
  assert.ok(call.args[2] <= 6);
  assert.ok(call.args[3] <= 6);
}
const earX = earBlocks.map((call) => call.args[0]);
assert.ok(Math.max(...earX) - Math.min(...earX) > 10);

function blockAngles(calls) {
  return named(calls, "drawRect").map((call) => {
    const x = call.args[0] + (call.args[2] / 2);
    const y = call.args[1] + (call.args[3] / 2);
    let angle = Math.atan2(y - box.cy, x - box.cx);
    if (angle < 0) angle += Math.PI * 2;
    return angle;
  });
}

const concentrating = draw("concentrating");
const arcStart = Math.PI * 0.62;
const arcEnd = Math.PI * 1.38;
const angles = blockAngles(concentrating);
assert.ok(angles.length >= 4);
for (const angle of angles) {
  assert.ok(angle >= arcStart - 0.15, `angle ${angle}`);
  assert.ok(angle <= arcEnd + 0.15, `angle ${angle}`);
}
assert.ok(Math.abs(angles[0] - arcStart) < 0.15);
assert.ok(Math.abs(angles[angles.length - 1] - arcEnd) < 0.15);
const shieldRects = (time) => named(draw("holyShield", time), "drawRect").map((call) => call.args);
assert.deepEqual(shieldRects(0), shieldRects(4));
const arcAlpha = (time) => named(draw("concentrating", time), "beginFill")[0].args[1];
assert.notEqual(arcAlpha(0), arcAlpha(0.9));

const marked = draw("marked");
assert.equal(named(marked, "moveTo").length, 2);
assert.equal(named(marked, "lineTo").length, 2);
assert.ok(named(marked, "lineStyle")[0].args[0].width >= 4);
assert.ok(named(marked, "drawRect").length >= 1);
before(marked, "lineStyle", "moveTo");
before(marked, "moveTo", "lineTo");

const dead = draw("dead");
assert.ok(named(dead, "drawCircle").length >= 1);
assert.ok(named(dead, "lineStyle")[0].args[0].alpha > 0.6);
assert.ok(named(dead, "lineStyle")[0].args[0].width >= 4);
assert.equal(named(dead, "lineStyle")[0].args[0].color, 0x1a0a0a);
assert.ok(named(dead, "drawRect").length >= 8);

const suffocation = draw("suffocation", 0);
before(suffocation, "lineStyle", "drawCircle");
const radiusAt = (time) => named(draw("suffocation", time), "drawCircle")[0].args[2];
assert.notEqual(radiusAt(0), radiusAt(0.9));
assert.ok(named(suffocation, "drawRect").length >= 8);

const alphaAt = (time) => named(draw("invisible", time), "beginFill")[0].args[1];
assert.notEqual(alphaAt(0), alphaAt(1));
const frozenAlpha = (time) => named(draw("frozen", time), "beginFill")[0].args[1];
assert.notEqual(frozenAlpha(0), frozenAlpha(1));

function blockSize(id) {
  return named(draw(id), "drawRect")[0].args[2];
}
assert.ok(blockSize("coverTotal") > blockSize("coverThreeQuarters"));
assert.ok(blockSize("coverThreeQuarters") > blockSize("coverHalf"));
assert.equal(blockSize("coverHalf"), 2 * scale);
assert.equal(blockSize("coverThreeQuarters"), 4 * scale);
assert.equal(blockSize("coverTotal"), 6 * scale);
assert.equal(blockSize("concentrating"), 4 * scale);
assert.equal(blockSize("holyShield"), 4 * scale);

const pooled = [grappled, blinded, deafened, concentrating, marked, dead, suffocation].flat();
for (const name of ["lineStyle", "drawRect", "drawCircle", "arc", "beginFill", "endFill", "moveTo", "lineTo"]) {
  assert.ok(pooled.some((call) => call.name === name), name);
}

function viewFor(id) {
  const fake = fakeGraphics();
  return {
    fake,
    view: {gfx: fake.gfx, preset: styleForStatus(id), time: 1.2, gfxBox: ""}
  };
}

const arc = viewFor("concentrating");
drawGraphics(arc.view, box);
const arcDrawn = arc.fake.calls.length;
assert.ok(arcDrawn > 1);
drawGraphics(arc.view, box);
assert.equal(arc.fake.calls.length, arcDrawn);
arc.view.time = 0;
arc.view.gfxBox = "";
arc.fake.calls.length = 0;
drawGraphics(arc.view, box);
const pulseDrawn = arc.fake.calls.length;
assert.ok(pulseDrawn > 1);
drawGraphics(arc.view, box);
assert.equal(arc.fake.calls.length, pulseDrawn);
assert.equal(Math.floor(0 * 3), Math.floor(0.2 * 3));
assert.notEqual(arcPulse(0), arcPulse(0.2));
arc.view.time = 0.2;
drawGraphics(arc.view, box);
assert.ok(arc.fake.calls.length > pulseDrawn);
const beforeResize = arc.fake.calls.length;
drawGraphics(arc.view, {w: 120, h: 90, cx: 60, cy: 45});
assert.ok(arc.fake.calls.length > beforeResize);
assertPixi7(arc.fake.calls);

const shimmer = viewFor("frozen");
drawGraphics(shimmer.view, box);
const shimmerDrawn = shimmer.fake.calls.length;
drawGraphics(shimmer.view, box);
assert.ok(shimmer.fake.calls.length > shimmerDrawn);

const constructed = [];
class Text {
  constructor(text, style) {
    assert.equal(arguments.length, 2);
    assert.equal(typeof text, "string");
    assert.equal(typeof style, "object");
    assert.equal(typeof style.fill, "number");
    this.text = text;
    this.style = style;
    this.texture = {owner: this};
    constructed.push(this);
  }

  updateText(respectDirty) {
    this.respectDirty = respectDirty;
  }
}

const pixi = {Text};
const surprised = createGlyph(pixi, styleForStatus("surprised").glyph, {
  fill: styleForStatus("surprised").color,
  fontFamily: "serif",
  fontWeight: "bold",
  fontSize: 32
});
assert.equal(surprised.text, "!");
assert.equal(surprised.style.fill, 0xf0a202);
assert.equal(constructed.length, 1);

const sleeping = glyphTextureFor(pixi, "Z", styleForStatus("sleeping").color);
const sleepingAgain = glyphTextureFor(pixi, "Z", styleForStatus("sleep").color);
assert.equal(sleeping, sleepingAgain);
assert.equal(constructed.length, 2);
assert.equal(sleeping.owner.text, "Z");
assert.equal(sleeping.owner.style.fill, 0xa0c4ff);
assert.equal(sleeping.owner.style.fontFamily, "serif");
assert.equal(sleeping.owner.style.fontWeight, "bold");
assert.equal(sleeping.owner.style.fontSize, 32);
assert.equal(sleeping.owner.respectDirty, true);
const otherColor = glyphTextureFor(pixi, "Z", 0x111111);
assert.notEqual(otherColor, sleeping);
assert.equal(constructed.length, 3);
assert.equal(otherColor.owner.style.fill, 0x111111);

for (const call of named(draw("restrained"), "drawRect")) {
  assert.equal(call.args[2], 3 * scale, "chain link width");
  assert.equal(call.args[3], 2 * scale, "chain link height");
}
for (const call of named(draw("petrified"), "drawRect")) {
  assert.ok(call.args[2] >= 2 * scale, "crack width");
  assert.ok(call.args[3] >= 2 * scale, "crack height");
  assert.equal(call.args[2] % scale, 0);
  assert.equal(call.args[3] % scale, 0);
}

const big = {w: 800, h: 800, cx: 400, cy: 400};
const bigScale = pixelScale(800);
function drawOn(id, target) {
  const fake = fakeGraphics();
  drawStatusGraphics(fake.gfx, styleForStatus(id), target, 1);
  assertPixi7(fake.calls);
  return fake.calls;
}
assert.ok(bigScale > scale);
assert.equal(named(drawOn("grappled", big), "drawRect")[0].args[2], 2 * bigScale);
assert.equal(named(drawOn("restrained", big), "drawRect")[0].args[2], 3 * bigScale);
assert.equal(named(drawOn("coverTotal", big), "drawRect")[0].args[2], 6 * bigScale);

for (const value of [1, 16, 80, 100, 400, 401, 800]) {
  const next = pixelScale(value);
  assert.equal(next, Math.round(next));
  assert.ok(next >= 2);
}
const placedPixel = pixelPlacement(10.4, 8.5, span);
assert.equal(placedPixel.x, Math.round(10.4));
assert.equal(placedPixel.y, Math.round(8.5));
assert.equal(placedPixel.scale, scale);
assert.equal(Number.isInteger(placedPixel.scale), true);

const square = {w: 100, h: 100, cx: 50, cy: 50};
const band = dripBand(square, 50, false);
assert.equal(band.top, 0.08);
assert.equal(band.bottom, 0.86);
const bandTop = band.top * square.h;
const dripStep = 3 * pixelScale(Math.min(square.w, square.h));
for (let index = 0; index < 4; index += 1) {
  const segment = placeDripSegment(50, bandTop - ((index + 1) * dripStep), square, false, band.top);
  assert.equal(segment.visible, false, `tail ${index} above the band`);
  assert.ok(segment.y < bandTop);
}
const shown = placeDripSegment(50, bandTop + dripStep, square, false, band.top);
assert.equal(shown.visible, true);
assert.ok(shown.y >= bandTop);
assert.ok(shown.y <= band.bottom * square.h);
const clamped = placeDripSegment(-10, 50, square, false, band.top);
assert.equal(clamped.visible, true);
assert.equal(clamped.x, 2);
assert.equal(clamped.y, 50);

const ringBox = {w: 100, h: 100, cx: 50, cy: 50};
const ringTop = dripBand(ringBox, 50, true);
assert.ok(ringTop.top >= 0.08);
assert.ok(ringTop.bottom <= 0.86);
const aboveRing = placeDripSegment(50, (ringTop.top * ringBox.h) - 24, ringBox, true, ringTop.top);
assert.equal(aboveRing.visible, false);
assert.ok(aboveRing.y < ringTop.top * ringBox.h);
const pulled = placeDripSegment(4, 50, ringBox, true, ringTop.top);
assert.equal(pulled.visible, true);
assert.ok(pulled.y >= ringTop.top * ringBox.h);
const ringLimit = Math.min(ringBox.w, ringBox.h) * 0.42;
assert.ok(Math.hypot(pulled.x - ringBox.cx, pulled.y - ringBox.cy) <= ringLimit + 1e-6);

const squareMask = portraitMaskShapes({w: 100, h: 80}, false);
assert.equal(squareMask.length, 1);
assert.equal(squareMask[0].type, "rect");
assert.equal(squareMask[0].lineWidth, 1);
assert.equal(squareMask[0].lineAlpha, 1);
assert.equal(squareMask[0].lineAlignment, 1);
assert.equal(squareMask.some((shape) => shape.type === "circle"), false);
assert.equal(maskIsFastRect(squareMask), false);
assert.equal(maskIsFastRect([{type: "rect"}]), true);
assert.equal(maskIsFastRect([{type: "rect", lineWidth: 1, lineAlpha: 1}, {type: "circle"}]), false);
const ringMask = portraitMaskShapes(ringBox, true);
assert.equal(ringMask.length, 1);
assert.equal(ringMask[0].type, "circle");
assert.equal(maskIsFastRect(ringMask), false);

const sampling = pixelSamplingModes();
assert.equal(sampling.scaleMode, "NEAREST");
assert.equal(sampling.mipmap, "OFF");

function fakePixelContext() {
  const pixels = [];
  return {
    pixels,
    fillStyle: "",
    fillRect(x, y, w, h) {
      pixels.push({x, y, w, h, fillStyle: this.fillStyle});
    }
  };
}
const palette = {dark: 0x111111, mid: 0x888888, light: 0xffffff};
const kinds = painterKinds();
assert.ok(kinds.length >= 8);
const canvasSize = pixelCanvasSize();
for (const kind of kinds) {
  const ctx = fakePixelContext();
  paintPixelFrame(ctx, kind, 0, palette);
  assert.ok(ctx.pixels.length > 0, kind);
  for (const pixel of ctx.pixels) {
    assert.equal(pixel.w, 1, kind);
    assert.equal(pixel.h, 1, kind);
    assert.equal(Number.isInteger(pixel.x), true, kind);
    assert.equal(Number.isInteger(pixel.y), true, kind);
    assert.ok(pixel.x >= 0 && pixel.x < canvasSize, kind);
    assert.ok(pixel.y >= 0 && pixel.y < canvasSize, kind);
  }
}
const headA = fakePixelContext();
const headB = fakePixelContext();
paintPixelFrame(headA, "dripHead", 0, palette);
paintPixelFrame(headB, "dripHead", 1, palette);
assert.notDeepEqual(
  headA.pixels.map((pixel) => [pixel.x, pixel.y]),
  headB.pixels.map((pixel) => [pixel.x, pixel.y])
);
const fallback = fakePixelContext();
paintPixelFrame(fallback, "not-a-painter", 0, palette);
assert.ok(fallback.pixels.length > 0);

function litHalves(kind, frame = 0) {
  const ctx = fakePixelContext();
  paintPixelFrame(ctx, kind, frame, palette);
  const mid = pixelCanvasSize() / 2;
  let upper = 0;
  let lower = 0;
  for (const pixel of ctx.pixels) {
    if (pixel.y < mid) upper += 1;
    else lower += 1;
  }
  return {upper, lower};
}
const dropHalves = litHalves("dripHead");
assert.ok(dropHalves.lower > dropHalves.upper, "teardrop is heavier below the midline");

const stillViews = [
  {id: "bleeding", time: 1, failed: false},
  {id: "burning", time: 2, failed: false}
];
const stillRan = [];
stepStatusPlans(stillViews, 0.25, true, (view, action) => {
  stillRan.push(`${view.id}:${action}`);
});
assert.deepEqual(stillRan, ["bleeding:still", "burning:still"]);
assert.equal(stillViews[0].time, 1);
assert.equal(stillViews[1].time, 2);

const moving = [
  {id: "bleeding", time: 1, failed: false},
  {id: "burning", time: 4, failed: false},
  {id: "cursed", time: 3, failed: false}
];
const played = [];
stepStatusPlans(moving, 0.5, false, (view, action) => {
  played.push(`${view.id}:${action}`);
  if (view.id === "burning") throw new Error("burning failed");
}, (view) => {
  played.push(`${view.id}:hidden`);
});
assert.deepEqual(played, ["bleeding:play", "burning:play", "burning:hidden", "cursed:play"]);
assert.equal(moving[0].failed, false);
assert.equal(moving[0].time, 1.5);
assert.equal(moving[1].failed, true);
assert.equal(moving[2].failed, false);
assert.equal(moving[2].time, 3.5);
const afterFailure = [];
stepStatusPlans(moving, 0.5, false, (view) => {
  afterFailure.push(view.id);
  if (view.id === "burning") throw new Error("failed status ran again");
});
assert.deepEqual(afterFailure, ["bleeding", "cursed"]);

function channelSum(color) {
  return ((color >> 16) & 255) + ((color >> 8) & 255) + (color & 255);
}

for (const id of [
  "grappled", "restrained", "restrain", "petrified", "blinded", "blind",
  "concentrating", "coverHalf", "coverThreeQuarters", "coverTotal",
  "coldShield", "magicShield", "holyShield",
  "marked", "eye", "target", "dead"
]) {
  const plan = overlaySpritePlan(styleForStatus(id));
  assert.ok(plan.sprites.length >= 4, `${id} sprites`);
}

const grappledPlan = overlaySpritePlan(styleForStatus("grappled"));
assert.ok(grappledPlan.sprites.filter((sprite) => sprite.kind === "rope").length >= 8);
assert.equal(grappledPlan.color, styleForStatus("grappled").color);

const restrainedPlan = overlaySpritePlan(styleForStatus("restrained"));
assert.ok(restrainedPlan.sprites.filter((sprite) => sprite.kind === "chain").length >= 8);

const petrifiedStyle = styleForStatus("petrified");
const petrifiedPlan = overlaySpritePlan(petrifiedStyle);
assert.ok(petrifiedPlan.sprites.filter((sprite) => sprite.kind === "crack").length >= 6);
assert.equal(petrifiedStyle.color, 0x9aa0a6);

const blindedStyle = styleForStatus("blinded");
const blindedPlan = overlaySpritePlan(blindedStyle);
assert.equal(blindedStyle.color, 0x1c1c1c);
assert.notEqual(blindedPlan.color, blindedStyle.color);
assert.ok(channelSum(blindedStyle.color) < 90);
assert.ok(channelSum(blindedPlan.color) >= 90);
assert.ok(blindedPlan.sprites.some((sprite) => sprite.kind === "cloth" && sprite.wide === true));
assert.ok(blindedPlan.sprites.filter((sprite) => sprite.role === "stitch").length >= 4);
for (const sprite of blindedPlan.sprites) {
  assert.equal(sprite.color, blindedPlan.color);
  assert.notEqual(sprite.color, 0x1c1c1c);
}

const deadStyle = styleForStatus("dead");
const deadPlan = overlaySpritePlan(deadStyle);
assert.equal(deadStyle.color, 0x1a0a0a);
assert.equal(deadStyle.still, true);
assert.notEqual(deadPlan.color, deadStyle.color);
assert.ok(channelSum(deadPlan.color) >= 90);
assert.ok(deadPlan.sprites.filter((sprite) => sprite.kind === "ring").length >= 10);
for (const sprite of deadPlan.sprites) assert.equal(sprite.color, deadPlan.color);

for (const id of ["concentrating", "coverHalf", "coverThreeQuarters", "coverTotal", "coldShield", "magicShield", "holyShield"]) {
  const plan = overlaySpritePlan(styleForStatus(id));
  assert.ok(plan.sprites.filter((sprite) => sprite.role === "block").length >= 8, id);
}
const weightBoost = (id) => overlaySpritePlan(styleForStatus(id)).sprites[0].scaleBoost;
assert.ok(weightBoost("coverTotal") > weightBoost("coverThreeQuarters"));
assert.ok(weightBoost("coverThreeQuarters") > weightBoost("coverHalf"));
assert.equal(weightBoost("concentrating"), weightBoost("coverThreeQuarters"));

for (const id of ["marked", "eye", "target"]) {
  const plan = overlaySpritePlan(styleForStatus(id));
  assert.ok(plan.sprites.filter((sprite) => sprite.kind === "cross").length >= 5, id);
}

const veilPlan = overlaySpritePlan(styleForStatus("not-a-real-status"));
assert.equal(veilPlan.sprites.length, 0);
assert.equal(styleForStatus("not-a-real-status").motion, "veil");

for (const id of ["blinded", "charmed", "deafened", "exhaustion", "frightened", "paralyzed", "petrified", "poisoned"]) {
  const presence = overlayPresence(styleForStatus(id));
  assert.ok(presence.tint || (presence.scaleBoost >= 1), `${id} requests a tint or a scale boost`);
}

// holdStill's sprite hiding, the live Graphics stencil, and BaseTexture.mipmap on a
// real Pixi texture still need Foundry. The checks above lock the pure decisions those paths call.

console.log(`status overlays: ${cases.length} cases passed`);
console.log("status overlays: pixi 7 graphics and text checks passed");
