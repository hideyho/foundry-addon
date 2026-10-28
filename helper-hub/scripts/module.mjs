import {refreshChatYouTubeVolume, registerChatImageDrop} from "./chat-images.mjs";
import {
  onPlaylistDrop,
  refreshPlaylistYouTubeVolumes,
  registerPlaylistYouTubeMenu,
  stopLivePlaylistYouTube,
  syncPlaylistSound,
  watchPlaylistYouTubeSetting
} from "./playlist-youtube.mjs";
import {TvStaticFilter, bindTvStaticFrame} from "./tv-static-filter.mjs";

const MODULE_ID = "helper-hub";
const TRANSITION_ID = "tvStatic";
const SILENCE_MS = 100;

/** @type {{ctx: AudioContext, source: AudioBufferSourceNode, highpass: BiquadFilterNode, lowpass: BiquadFilterNode, gain: GainNode} | null} */
let hiss = null;

/** @type {AudioBuffer | null} */
let noiseBuffer = null;

/** @type {AudioContext | null} */
let noiseContext = null;

let appliedGain = -1;
let lastAppliedAt = 0;
let watching = false;
let resumeAttempted = false;
let loggedFilterError = false;

Hooks.once("init", () => {
  for (const [id, label, defaultDuration] of [
    [TRANSITION_ID, "HELPERHUB.Type", 1200],
    ["hhSmoke", "HELPERHUB.Smoke", 1600],
    ["hhSpinner", "HELPERHUB.Spinner", 1400],
    ["hhWhip", "HELPERHUB.Whip", 900],
    ["hhCustom", "HELPERHUB.Custom", 1500]
  ]) {
    CONFIG.Canvas.sceneTransitions[id] = {
      id,
      label,
      filterClass: TvStaticFilter,
      filterType: id,
      defaultDuration
    };
  }

  registerSettings();
  registerChatImageDrop();
  watchPlaylistYouTubeSetting();

  Hooks.on("globalPlaylistVolumeChanged", volume => {
    refreshChatYouTubeVolume(volume);
    refreshPlaylistYouTubeVolumes("music", volume);
  });
  Hooks.on("globalAmbientVolumeChanged", volume => {
    refreshPlaylistYouTubeVolumes("environment", volume);
  });
  Hooks.on("globalInterfaceVolumeChanged", volume => {
    refreshPlaylistYouTubeVolumes("interface", volume);
  });

  if (globalThis.libWrapper) {
    libWrapper.register(MODULE_ID, "Scene.prototype.view", viewWithTransition, "WRAPPER");
    libWrapper.register(MODULE_ID, "PlaylistSound.prototype.sync", syncPlaylistSound, "MIXED");
    registerPlaylistDrop();
    registerPlaylistYouTubeMenu();
  }
  else {
    console.warn(`${MODULE_ID} | libWrapper is not available; automatic scene transitions are disabled.`);
    console.warn(`${MODULE_ID} | libWrapper is not available; YouTube playlist tracks will not play.`);
  }

  bindTvStaticFrame(onFilterApplied);
});

/**
 * libWrapper walks from globalThis. The namespaced class is the real PlaylistDirectory.
 * The global of the same name is only a compatibility getter, used if the namespace cannot be seen.
 */
function registerPlaylistDrop() {
  const targets = [
    "foundry.applications.sidebar.tabs.PlaylistDirectory.prototype._onDrop",
    "PlaylistDirectory.prototype._onDrop"
  ];
  for (const target of targets) {
    try {
      libWrapper.register(MODULE_ID, target, onPlaylistDrop, "MIXED");
      return;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not wrap ${target}.`, err);
    }
  }
}

function registerSettings() {
  const {BooleanField, NumberField, StringField} = foundry.data.fields;

  game.settings.register(MODULE_ID, "auto", {
    name: "HELPERHUB.AutoName",
    hint: "HELPERHUB.AutoHint",
    scope: "world",
    config: true,
    type: new BooleanField({initial: true}),
    default: true
  });

  game.settings.register(MODULE_ID, "force", {
    name: "HELPERHUB.ForceName",
    hint: "HELPERHUB.ForceHint",
    scope: "world",
    config: true,
    type: new BooleanField({initial: false}),
    default: false
  });

  game.settings.register(MODULE_ID, "duration", {
    name: "HELPERHUB.DurationName",
    hint: "HELPERHUB.DurationHint",
    scope: "world",
    config: true,
    type: new NumberField({
      required: true,
      nullable: false,
      integer: true,
      initial: 1200,
      min: 500,
      max: 10000,
      step: 100
    }),
    default: 1200
  });

  game.settings.register(MODULE_ID, "intensity", {
    name: "HELPERHUB.IntensityName",
    hint: "HELPERHUB.IntensityHint",
    scope: "world",
    config: true,
    type: new NumberField({
      required: true,
      nullable: false,
      initial: 1,
      min: 0,
      max: 1,
      step: 0.05
    }),
    default: 1
  });

  game.settings.register(MODULE_ID, "volume", {
    name: "HELPERHUB.VolumeName",
    hint: "HELPERHUB.VolumeHint",
    scope: "world",
    config: true,
    type: new NumberField({
      required: true,
      nullable: false,
      initial: 0.35,
      min: 0,
      max: 1,
      step: 0.05
    }),
    default: 0.35
  });

  // StringField writes the choice string into the option as-is, so localize here.
  game.settings.register(MODULE_ID, "transition", {
    name: "HELPERHUB.TransitionName",
    hint: "HELPERHUB.TransitionHint",
    scope: "world",
    config: true,
    type: new StringField({
      required: true,
      blank: false,
      nullable: false,
      initial: TRANSITION_ID,
      choices: transitionChoices
    }),
    default: TRANSITION_ID
  });

  game.settings.register(MODULE_ID, "customAnimation", {
    name: "HELPERHUB.CustomFileName",
    hint: "HELPERHUB.CustomFileHint",
    scope: "world",
    config: true,
    type: new ImageVideoPathField({
      required: true,
      blank: true,
      nullable: false,
      initial: ""
    }),
    default: ""
  });

  game.settings.register(MODULE_ID, "customMode", {
    name: "HELPERHUB.CustomModeName",
    hint: "HELPERHUB.CustomModeHint",
    scope: "world",
    config: true,
    type: new StringField({
      required: true,
      blank: false,
      nullable: false,
      initial: "play",
      choices: {
        play: game.i18n.localize("HELPERHUB.CustomModePlay"),
        mask: game.i18n.localize("HELPERHUB.CustomModeMask")
      }
    }),
    default: "play"
  });

  for (const [key, name, hint] of [
    ["chatImages", "HELPERHUB.ChatImagesName", "HELPERHUB.ChatImagesHint"],
    ["chatLinks", "HELPERHUB.ChatLinksName", "HELPERHUB.ChatLinksHint"]
  ]) {
    game.settings.register(MODULE_ID, key, {
      name,
      hint,
      scope: "world",
      config: true,
      type: new BooleanField({initial: true}),
      default: true
    });
  }

  game.settings.register(MODULE_ID, "playlistYouTube", {
    name: "HELPERHUB.PlaylistYouTubeName",
    hint: "HELPERHUB.PlaylistYouTubeHint",
    scope: "world",
    config: true,
    type: new BooleanField({initial: true}),
    default: true,
    onChange: value => {
      if (value === false) stopLivePlaylistYouTube();
    }
  });
}

/**
 * Image and video picker. FilePathField turns IMAGE+VIDEO into picker type "any".
 */
class ImageVideoPathField extends foundry.data.fields.StringField {
  /** @override */
  _toInput(config) {
    if (config.value === undefined) config.value = this.getInitialValue({});
    config.type = "imagevideo";
    return foundry.applications.elements.HTMLFilePickerElement.create(config);
  }
}

/**
 * Choice labels are not localized by the settings form.
 * Core entries already store keys such as SCENE.Transition.Types.fade.
 * @returns {Record<string, string>}
 */
function transitionChoices() {
  const choices = {};
  for (const [key, definition] of Object.entries(CONFIG.Canvas.sceneTransitions ?? {})) {
    const label = (definition && (typeof definition.label === "string")) ? definition.label : key;
    choices[key] = game.i18n.localize(label);
  }
  return choices;
}

/**
 * Inject the chosen transition when the world settings say to, without
 * touching an explicit caller transition or a scene that already chose one.
 * @param {Function} wrapped
 * @param {object} [options]
 * @this {Scene}
 */
function viewWithTransition(wrapped, options = {}) {
  if (!shouldInject(this, options)) return wrapped(options);

  const duration = game.settings.get(MODULE_ID, "duration");
  const viewOptions = foundry.utils.mergeObject(options, {
    transition: {type: chosenTransitionId(), duration}
  }, {inplace: false});
  return wrapped(viewOptions);
}

/**
 * @returns {string}
 */
function chosenTransitionId() {
  const saved = game.settings.get(MODULE_ID, "transition");
  if ((typeof saved === "string") && (saved in CONFIG.Canvas.sceneTransitions)) return saved;
  return TRANSITION_ID;
}

/**
 * @param {Scene} scene
 * @param {object} options
 * @returns {boolean}
 */
function shouldInject(scene, options) {
  if (!game.settings.get(MODULE_ID, "auto")) return false;
  if (!canvas?.ready || !canvas.scene) return false;
  if (!scene?.id || (canvas.scene.id === scene.id)) return false;
  if (options?.transition) return false;
  if (scene.transition?.type && !game.settings.get(MODULE_ID, "force")) return false;
  return true;
}

/* -------------------------------------------- */
/*  Synthesized hiss                            */
/* -------------------------------------------- */

function onFilterApplied() {
  try {
    lastAppliedAt = canvas.app.ticker.lastTime;
    if (playbackBlocked()) stopHiss();
    else if (!hiss) startHiss();
    else updateGain();
    armWatcher();
  }
  catch (err) {
    if (!loggedFilterError) {
      loggedFilterError = true;
      console.warn(`${MODULE_ID} | Failed while updating the TV static hiss.`, err);
    }
    stopHiss();
  }
}

function armWatcher() {
  if (watching || !canvas.app?.ticker) return;
  watching = true;
  // UTILITY (-50) runs after Pixi's render listener (LOW, -25), so this frame's apply() has already stamped lastAppliedAt.
  canvas.app.ticker.add(watchSilence, null, PIXI.UPDATE_PRIORITY.UTILITY);
}

function watchSilence() {
  const ticker = canvas.app?.ticker;
  if (!ticker) return;
  if ((ticker.lastTime - lastAppliedAt) < SILENCE_MS) {
    if (playbackBlocked()) stopHiss();
    return;
  }
  ticker.remove(watchSilence, null);
  watching = false;
  stopHiss();
}

/**
 * @returns {boolean}
 */
function playbackBlocked() {
  const audio = game.audio;
  if (!audio?.context || audio.locked || audio.globalMute) return true;
  return targetGain() <= 0;
}

/**
 * Module volume scaled by the core ambient slider, when that setting exists.
 * @returns {number}
 */
function targetGain() {
  const volume = game.settings.get(MODULE_ID, "volume");
  if ((typeof volume !== "number") || (volume <= 0)) return 0;

  let ambient = 1;
  if (game.settings.settings?.has("core.globalAmbientVolume")) {
    const value = game.settings.get("core", "globalAmbientVolume");
    if ((typeof value === "number") && Number.isFinite(value)) ambient = value;
  }
  return Math.max(0, volume * ambient);
}

/**
 * @param {AudioContext} ctx
 * @returns {AudioBuffer}
 */
function getNoiseBuffer(ctx) {
  if (noiseBuffer && (noiseContext === ctx)) return noiseBuffer;

  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2) - 1;

  noiseBuffer = buffer;
  noiseContext = ctx;
  return buffer;
}

function startHiss() {
  const ctx = game.audio?.context;
  if (!ctx || game.audio.locked || game.audio.globalMute) return;
  if (ctx.state === "suspended") {
    if (!resumeAttempted) {
      resumeAttempted = true;
      ctx.resume().catch(() => {});
    }
    return;
  }
  if (ctx.state !== "running") return;
  resumeAttempted = false;

  /** @type {AudioBufferSourceNode | undefined} */
  let source;
  /** @type {BiquadFilterNode | undefined} */
  let highpass;
  /** @type {BiquadFilterNode | undefined} */
  let lowpass;
  /** @type {GainNode | undefined} */
  let gain;

  try {
    source = ctx.createBufferSource();
    source.buffer = getNoiseBuffer(ctx);
    source.loop = true;

    highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 1100;
    highpass.Q.value = 0.7;

    lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 6500;
    lowpass.Q.value = 0.5;

    gain = ctx.createGain();
    const level = targetGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.04);
    appliedGain = level;

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(ctx.destination);
    source.start();

    hiss = {ctx, source, highpass, lowpass, gain};
  }
  catch (err) {
    disconnectNode(source);
    disconnectNode(highpass);
    disconnectNode(lowpass);
    disconnectNode(gain);
  }
}

function updateGain() {
  if (!hiss) return;
  const level = targetGain();
  if (Math.abs(level - appliedGain) < 0.0001) return;

  appliedGain = level;
  const now = hiss.ctx.currentTime;
  const param = hiss.gain.gain;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(Math.max(level, 0.0001), now + 0.05);
}

function stopHiss() {
  // A suspended resume() is not a user gesture and often fails. Allow the next transition to try again.
  resumeAttempted = false;
  const current = hiss;
  hiss = null;
  appliedGain = -1;
  if (!current) return;

  const {ctx, source, highpass, lowpass, gain} = current;
  const now = ctx.currentTime;
  try {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
    gain.gain.linearRampToValueAtTime(0.0001, now + 0.08);
    source.stop(now + 0.1);
  }
  catch (err) {
    // The context was closed, or this source was already stopped.
  }

  window.setTimeout(() => {
    disconnectNode(source);
    disconnectNode(highpass);
    disconnectNode(lowpass);
    disconnectNode(gain);
  }, 150);
}

/**
 * @param {AudioNode | undefined} node
 */
function disconnectNode(node) {
  try {
    node?.disconnect();
  }
  catch (err) {
    // Already disconnected.
  }
}
