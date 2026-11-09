/**
 * Adjective names for NPC tokens placed on a scene.
 * The actor document and the prototype token are not renamed.
 * A player character keeps the name it already has.
 */

const MODULE_ID = "helper-hub";

/**
 * Names chosen earlier in this create batch, keyed by scene id, then actor id.
 * `preCreateToken` runs before that token joins `parent.tokens`, so another copy in the
 * same `createEmbeddedDocuments` call cannot see it there. `createToken` removes the name.
 * The create loop can await another document's `_preCreate` between those hooks, so the
 * reservation has to outlive a microtask.
 * @type {Map<string, Map<string, string[]>>}
 */
const pendingNames = new Map();

/**
 * A random adjective plus the creature name, or null when the token should keep its name.
 * `roll` is in [0, 1). Adjectives already used for this creature are skipped until every one is taken.
 * English adjectives are strings. Russian adjectives are `{m, f, n}` and agree with the actor name's ending.
 * @param {{
 *   actorType: string | null | undefined,
 *   actorName: string | null | undefined,
 *   tokenName: string | null | undefined,
 *   adjectives: Array<string | {m?: string, f?: string, n?: string}> | null | undefined,
 *   used: string[] | null | undefined,
 *   roll: number
 * }} input
 * @returns {string | null}
 */
export function npcTokenName({actorType, actorName, tokenName, adjectives, used, roll}) {
  if (!canRenameNpcToken(actorType, actorName, tokenName)) return null;
  const actor = actorName.trim();

  const forms = [];
  if (Array.isArray(adjectives)) {
    for (const entry of adjectives) {
      const text = adjectiveText(entry, actor);
      if (text) forms.push(text);
    }
  }
  if (!forms.length) return null;

  const taken = new Set(Array.isArray(used) ? used : []);
  const open = forms.filter(text => !taken.has(`${text} ${actor}`));
  const pool = open.length ? open : forms;
  const adjective = pool[indexForRoll(roll, pool.length)];
  return `${adjective} ${actor}`;
}

/**
 * The object `updateSource` would receive, or null when the token keeps its name.
 * `npcTokenNames` false returns before a name is chosen. An unlinked token also writes
 * `delta.name`; a linked token writes `name` only. A chosen name is reserved for later
 * tokens of the same actor on the same scene until `releaseNpcTokenName`.
 * @param {{
 *   npcTokenNames: boolean,
 *   actorLink?: boolean,
 *   sceneId?: string | null,
 *   actorId?: string | null,
 *   actorType: string | null | undefined,
 *   actorName: string | null | undefined,
 *   tokenName: string | null | undefined,
 *   adjectives: Array<string | {m?: string, f?: string, n?: string}> | null | undefined,
 *   used: string[] | null | undefined,
 *   roll: number
 * }} input
 * @returns {{name: string, delta?: {name: string}} | null}
 */
export function npcTokenUpdate(input) {
  if (input.npcTokenNames !== true) return null;
  if (!canRenameNpcToken(input.actorType, input.actorName, input.tokenName)) return null;
  const name = npcTokenName({
    actorType: input.actorType,
    actorName: input.actorName,
    tokenName: input.tokenName,
    adjectives: input.adjectives,
    used: withPendingNames(input.used, input.sceneId, input.actorId),
    roll: input.roll
  });
  if (typeof name !== "string") return null;
  reserveName(input.sceneId, input.actorId, name);
  /** @type {{name: string, delta?: {name: string}}} */
  const update = {name};
  if (input.actorLink !== true) update.delta = {name};
  return update;
}

/**
 * Drops one name reserved during preCreate. `createToken` calls this once the scene has the token.
 * @param {string | null | undefined} sceneId
 * @param {string | null | undefined} actorId
 * @param {string | null | undefined} name
 */
export function releaseNpcTokenName(sceneId, actorId, name) {
  if ((typeof sceneId !== "string") || (typeof actorId !== "string") || (typeof name !== "string")) return;
  const byActor = pendingNames.get(sceneId);
  const names = byActor?.get(actorId);
  if (!names) return;
  const index = names.indexOf(name);
  if (index < 0) return;
  names.splice(index, 1);
  if (names.length) return;
  byActor.delete(actorId);
  if (byActor.size) return;
  pendingNames.delete(sceneId);
}

/**
 * Names an NPC token on the client that creates it, including a drag from the actors list and a summon.
 * Foundry saves the document after preCreateToken, so `updateSource` is the write that sticks.
 * createToken drops the adjective reserved for the rest of that create batch.
 */
export function registerNpcTokenNames() {
  Hooks.on("preCreateToken", onPreCreateToken);
  Hooks.on("createToken", onCreateToken);
}

/**
 * @param {TokenDocument} token
 */
function onPreCreateToken(token) {
  if (game.settings.get(MODULE_ID, "npcTokenNames") !== true) return;
  const actor = game.actors.get(token.actorId) ?? token.actor;
  if (!canRenameNpcToken(actor?.type, actor?.name, token.name)) return;
  const update = npcTokenUpdate({
    npcTokenNames: true,
    actorLink: token.actorLink === true,
    sceneId: token.parent?.id,
    actorId: token.actorId,
    actorType: actor.type,
    actorName: actor.name,
    tokenName: token.name,
    adjectives: adjectivesFromTranslations(),
    used: namesForCreature(token),
    roll: Math.random()
  });
  if (!update) return;
  token.updateSource(update);
}

/**
 * @param {TokenDocument} token
 */
function onCreateToken(token) {
  releaseNpcTokenName(token.parent?.id, token.actorId, token.name);
}

/**
 * The module list lives under one i18n key. Foundry keeps that object on `game.i18n.translations`.
 * @returns {Array<string | {m?: string, f?: string, n?: string}>}
 */
function adjectivesFromTranslations() {
  const translations = game.i18n?.translations;
  const stored = translations?.HELPERHUB?.NpcTokenAdjectives
    ?? translations?.["HELPERHUB.NpcTokenAdjectives"];
  if (Array.isArray(stored)) return stored;
  if (stored && (typeof stored === "object")) return Object.values(stored);
  return [];
}

/**
 * Names already on this scene for the same actor. A repeated adjective is avoided when another is free.
 * Copies placed in the same create call are not here yet; `pendingNames` holds those.
 * @param {TokenDocument} token
 * @returns {string[]}
 */
function namesForCreature(token) {
  const actorId = token.actorId;
  const tokens = token.parent?.tokens;
  if (!actorId || !tokens) return [];
  const names = [];
  for (const other of tokens) {
    if (!other || (other === token) || (other.id === token.id)) continue;
    if (other.actorId !== actorId) continue;
    if (typeof other.name === "string") names.push(other.name);
  }
  return names;
}

/**
 * Scene names plus adjectives reserved earlier in this create batch.
 * @param {string[] | null | undefined} used
 * @param {string | null | undefined} sceneId
 * @param {string | null | undefined} actorId
 * @returns {string[] | null | undefined}
 */
function withPendingNames(used, sceneId, actorId) {
  const pending = pendingFor(sceneId, actorId);
  if (!pending.length) return used;
  const names = Array.isArray(used) ? used : [];
  return names.concat(pending);
}

/**
 * @param {string | null | undefined} sceneId
 * @param {string | null | undefined} actorId
 * @returns {string[]}
 */
function pendingFor(sceneId, actorId) {
  if ((typeof sceneId !== "string") || (typeof actorId !== "string")) return [];
  return pendingNames.get(sceneId)?.get(actorId) ?? [];
}

/**
 * @param {string | null | undefined} sceneId
 * @param {string | null | undefined} actorId
 * @param {string} name
 */
function reserveName(sceneId, actorId, name) {
  if ((typeof sceneId !== "string") || !sceneId) return;
  if ((typeof actorId !== "string") || !actorId) return;
  let byActor = pendingNames.get(sceneId);
  if (!byActor) {
    byActor = new Map();
    pendingNames.set(sceneId, byActor);
  }
  const names = byActor.get(actorId);
  if (names) names.push(name);
  else byActor.set(actorId, [name]);
}

/**
 * An NPC whose token name is still the actor name, empty, or a Foundry "Name (n)" copy.
 * @param {string | null | undefined} actorType
 * @param {string | null | undefined} actorName
 * @param {string | null | undefined} tokenName
 * @returns {boolean}
 */
function canRenameNpcToken(actorType, actorName, tokenName) {
  if (actorType !== "npc") return false;
  if (typeof actorName !== "string") return false;
  const actor = actorName.trim();
  if (!actor) return false;
  return defaultTokenName(tokenName, actor);
}

/**
 * An empty name, the creature name, or Foundry's "Name (n)" copy can take an adjective.
 * A custom prototype name, including one that already starts with an adjective, stays as it is.
 * @param {string | null | undefined} tokenName
 * @param {string} actor
 * @returns {boolean}
 */
function defaultTokenName(tokenName, actor) {
  if (typeof tokenName !== "string") return tokenName == null;
  const token = tokenName.trim();
  if (!token || (token === actor)) return true;
  const numbered = /^(.*) \(([1-9]\d*)\)$/u.exec(token);
  return numbered?.[1] === actor;
}

/**
 * @param {string | {m?: string, f?: string, n?: string}} entry
 * @param {string} actor
 * @returns {string}
 */
function adjectiveText(entry, actor) {
  if (typeof entry === "string") return entry.trim();
  if (!entry || (typeof entry !== "object")) return "";
  const form = entry[genderOf(actor)];
  return typeof form === "string" ? form.trim() : "";
}

/**
 * Guessed from the last letter. "а" and "я" are feminine, "о", "е", and "ё" are neuter.
 * The ending is not always the real gender.
 * @param {string} actor
 * @returns {"m" | "f" | "n"}
 */
function genderOf(actor) {
  const last = actor.at(-1).toLowerCase();
  if ((last === "а") || (last === "я")) return "f";
  if ((last === "о") || (last === "е") || (last === "ё")) return "n";
  return "m";
}

/**
 * @param {number} roll
 * @param {number} count
 * @returns {number}
 */
function indexForRoll(roll, count) {
  const value = Number(roll);
  const unit = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1 - Number.EPSILON) : 0;
  return Math.floor(unit * count);
}
