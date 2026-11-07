import {ensureChatDirectory, isSafeUploadPath, uploadChatImage} from "./chat-images.mjs";
import {chooseTokenFrameRole, detectTokenFrameRole, fitTokenFramePortrait, notifyTokenFrame, notifyTokenFrameFitFailed, removeStoredTokenBake, ringUpdate} from "./token-frame.mjs";

const MODULE_ID = "helper-hub";
const BOUND_ATTR = "data-helper-hub-actor";
const IMAGE_SELECTOR = ".helper-hub-images img";
const MAX_MATCHES = 100;

/** @type {object[] | null} */
let creatureCache = null;

/** @type {Promise<object[]> | null} */
let creatureLoad = null;

/**
 * Right-click menu on images this module posted. renderChatLog passes the application element
 * as an HTMLElement. Bind once per root, including the popped-out log.
 */
export function registerChatActors() {
  Hooks.on("renderChatLog", (app, html) => {
    const root = html instanceof HTMLElement ? html : app?.element;
    if (!(root instanceof HTMLElement)) return;
    if (root.getAttribute(BOUND_ATTR) === "1") return;
    root.setAttribute(BOUND_ATTR, "1");
    bindChatActorMenu(root);
  });
}

/**
 * ChatLog's own menu is on this same root and stops the event for any click inside a message.
 * A capture listener claims helper-hub images first. The setting and the other gates are read
 * when the menu is opened, so turning the setting off hides the action without a reload.
 * ContextMenu delegates from the root, so messages posted later are included.
 * The menu is fixed so the scrollable log does not clip it.
 * @param {HTMLElement} root
 */
function bindChatActorMenu(root) {
  /** @type {HTMLImageElement | null} */
  let pendingImage = null;

  const menu = new foundry.applications.ux.ContextMenu(root, IMAGE_SELECTOR, [{
    label: "HELPERHUB.ChatActorMenu",
    icon: "fa-solid fa-user-plus",
    visible: () => canCreateChatActor(),
    onClick: (_event, target) => {
      const img = isChatImage(target) ? target : pendingImage;
      if (isChatImage(img)) void createCharacterFromImage(img);
    }
  }], {jQuery: false, fixed: true});

  root.addEventListener("contextmenu", event => {
    const img = imageFromEvent(event);
    if (!img) return;
    if (!canCreateChatActor()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pendingImage = img;
    void openActorMenu(menu, img, event);
  }, true);
}

/**
 * Popout chat can hold the image in another window, where instanceof HTMLImageElement is false.
 * @param {Event} event
 * @returns {HTMLImageElement | null}
 */
function imageFromEvent(event) {
  const target = event.target;
  if (!target || (typeof target.closest !== "function")) return null;
  const img = target.closest(IMAGE_SELECTOR);
  return isChatImage(img) ? img : null;
}

/**
 * @param {unknown} value
 * @returns {value is HTMLImageElement}
 */
function isChatImage(value) {
  return !!value && (value.tagName === "IMG") && (typeof value.getAttribute === "function");
}

/**
 * @param {foundry.applications.ux.ContextMenu} menu
 * @param {HTMLImageElement} img
 * @param {Event} event
 * @returns {Promise<void>}
 */
async function openActorMenu(menu, img, event) {
  if (ui.context && (ui.context !== menu)) await ui.context.close({animate: false});
  if ((ui.context === menu) && menu.element?.isConnected && img.classList.contains("context")) {
    await menu.close({animate: false});
    return;
  }
  ui.context = menu;
  try {
    await menu.render(img, {event});
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not open the character menu.`, err);
  }
  if (!menu.element?.isConnected && (ui.context === menu)) delete ui.context;
}

/**
 * @returns {boolean}
 */
function canCreateChatActor() {
  if (game.system?.id !== "dnd5e") return false;
  if (!game.modules.get("plutonium")?.active) return false;
  if (!game.user?.hasPermission("ACTOR_CREATE")) return false;
  try {
    return game.settings.get(MODULE_ID, "chatActors") === true;
  } catch {
    return false;
  }
}

/**
 * @param {HTMLImageElement} img
 * @returns {Promise<void>}
 */
async function createCharacterFromImage(img) {
  if (!canCreateChatActor()) return;

  const kind = classifyImageSource(readImageSource(img));
  if (kind.kind === "bad") {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.ChatActorBadImage"));
    return;
  }
  if ((kind.kind === "https") && !game.user.hasPermission("FILES_UPLOAD")) {
    ui.notifications.error(game.i18n.localize("HELPERHUB.DropNoPermission"));
    return;
  }

  const choice = await askForCharacter();
  if (!choice || !canCreateChatActor()) return;

  const imagePath = await resolveActorImage(kind);
  if (!imagePath || !canCreateChatActor()) return;
  await importCreatureActor(choice.name, choice.creature, imagePath);
}

/**
 * @param {HTMLImageElement} img
 * @returns {string}
 */
function readImageSource(img) {
  const attr = img.getAttribute("src");
  if (typeof attr === "string" && (attr.length > 0)) return attr;
  return typeof img.currentSrc === "string" ? img.currentSrc : "";
}

/**
 * A relative Foundry path must pass the same checks as an uploaded chat image.
 * Only https is copied into storage. Every other scheme is refused.
 * @param {string} raw
 * @returns {{kind: "path", path: string} | {kind: "https", url: URL} | {kind: "bad"}}
 */
function classifyImageSource(raw) {
  if (isSafeUploadPath(raw)) return {kind: "path", path: raw};
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return {kind: "https", url};
  } catch {
    // A relative path that failed the safety check is not fetched.
  }
  return {kind: "bad"};
}

/**
 * @param {{kind: "path", path: string} | {kind: "https", url: URL}} kind
 * @returns {Promise<string | null>}
 */
async function resolveActorImage(kind) {
  if (kind.kind === "path") return kind.path;
  return uploadRemoteImage(kind.url);
}

/**
 * Portrait and token art cannot rely on another site, so the bytes are stored with the module.
 * @param {URL} url
 * @returns {Promise<string | null>}
 */
async function uploadRemoteImage(url) {
  if (!game.user.hasPermission("FILES_UPLOAD")) {
    ui.notifications.error(game.i18n.localize("HELPERHUB.DropNoPermission"));
    return null;
  }

  try {
    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
    const blob = await response.blob();
    if (!blob.size) throw new Error("The image response was empty.");
    const type = typeof blob.type === "string" ? blob.type.toLowerCase() : "";
    if (type && !type.startsWith("image/") && (type !== "application/octet-stream")) {
      throw new Error(`Refusing to save a ${type} file as a portrait.`);
    }
    await ensureChatDirectory();
    const path = await uploadChatImage(imageFile(blob, url));
    if (path) return path;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not save a chat image for an actor.`, err);
  }

  ui.notifications.warn(game.i18n.localize("HELPERHUB.ChatActorImageFailed"));
  return null;
}

/**
 * @param {Blob} blob
 * @param {URL} url
 * @returns {File}
 */
function imageFile(blob, url) {
  let name = fileNameFromUrl(url);
  if (!/\.[A-Za-z0-9]+$/.test(name)) {
    const ext = imageExtension(blob.type);
    if (ext) name = `${name}.${ext}`;
  }
  return new File([blob], name, {type: blob.type || "application/octet-stream"});
}

/**
 * @param {URL} url
 * @returns {string}
 */
function fileNameFromUrl(url) {
  const slash = url.pathname.lastIndexOf("/");
  const base = slash >= 0 ? url.pathname.slice(slash + 1) : "";
  let name = "";
  try {
    name = base ? decodeURIComponent(base) : "";
  } catch {
    name = base;
  }
  if (!name || (name === ".") || (name === "..")) return "image";
  return name;
}

/**
 * @param {string} type
 * @returns {string}
 */
function imageExtension(type) {
  if (typeof type !== "string") return "";
  const match = /^image\/([a-z0-9.+-]+)$/i.exec(type.trim());
  if (!match) return "";
  const subtype = match[1].toLowerCase();
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  if (!/^[a-z0-9]+$/.test(subtype)) return "";
  return subtype;
}

/**
 * @returns {Promise<{name: string, creature: object} | null>}
 */
async function askForCharacter() {
  /** @type {{phase: "loading" | "ready" | "failed", creatures: object[]}} */
  const state = {phase: "loading", creatures: []};

  let result;
  try {
    result = await foundry.applications.api.DialogV2.input({
      window: {title: "HELPERHUB.ChatActorTitle"},
      content: characterDialogContent(),
      modal: true,
      rejectClose: false,
      position: {width: 640},
      ok: {label: "HELPERHUB.ChatActorMenu", icon: "fa-solid fa-check"},
      render: (_event, dialog) => wireCharacterDialog(dialog, state)
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not open the character dialog.`, err);
    return null;
  }
  if (!result || (state.phase !== "ready")) return null;

  const name = typeof result.name === "string" ? result.name.trim() : "";
  if (!name) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.ChatActorNameEmpty"));
    return null;
  }
  const creature = creatureAt(result.creature, state.creatures);
  if (!creature) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.ChatActorNoCreature"));
    return null;
  }
  return {name, creature};
}

/**
 * DialogV2 copies the content element's innerHTML, so the root div stays attribute-free.
 * The inputs live inside it and are wired after render.
 * @returns {HTMLDivElement}
 */
function characterDialogContent() {
  const content = document.createElement("div");
  const suffix = foundry.utils.randomID();
  content.append(
    labeledControl("HELPERHUB.ChatActorName", `helper-hub-actor-name-${suffix}`, input => {
      input.type = "text";
      input.name = "name";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.autofocus = true;
    }),
    creatureFields(suffix)
  );
  return content;
}

/**
 * @param {string} key
 * @param {string} id
 * @param {(input: HTMLInputElement) => void} configure
 * @returns {HTMLDivElement}
 */
function labeledControl(key, id, configure) {
  const group = document.createElement("div");
  group.className = "form-group stacked";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = game.i18n.localize(key);
  const input = document.createElement("input");
  input.id = id;
  configure(input);
  group.append(label, input);
  return group;
}

/**
 * @param {string} suffix
 * @returns {HTMLDivElement}
 */
function creatureFields(suffix) {
  const group = document.createElement("div");
  group.className = "form-group stacked";

  const searchId = `helper-hub-actor-search-${suffix}`;
  const label = document.createElement("label");
  label.htmlFor = searchId;
  label.textContent = game.i18n.localize("HELPERHUB.ChatActorCreature");

  const search = document.createElement("input");
  search.id = searchId;
  search.type = "search";
  search.name = "search";
  search.placeholder = game.i18n.localize("HELPERHUB.ChatActorSearch");
  search.autocomplete = "off";
  search.spellcheck = false;

  const select = document.createElement("select");
  select.name = "creature";
  select.className = "helper-hub-creature-list";
  select.size = 16;
  select.disabled = true;
  select.setAttribute("aria-label", game.i18n.localize("HELPERHUB.ChatActorCreature"));

  const status = document.createElement("p");
  status.className = "hint";
  status.dataset.helperHubCreatureStatus = "1";
  status.textContent = game.i18n.localize("HELPERHUB.ChatActorLoading");

  group.append(label, search, select, status);
  return group;
}

/**
 * While the bestiary is loading the dialog stays open and will not submit.
 * An empty name, an empty list, or no selected row is refused with a warning.
 * @param {foundry.applications.api.DialogV2} dialog
 * @param {{phase: "loading" | "ready" | "failed", creatures: object[]}} state
 */
function wireCharacterDialog(dialog, state) {
  const form = dialog.element?.querySelector("form");
  if (!(form instanceof HTMLFormElement) || (form.dataset.helperHubActorForm === "1")) return;

  const search = form.elements.namedItem("search");
  const select = form.elements.namedItem("creature");
  const nameInput = form.elements.namedItem("name");
  const status = form.querySelector("[data-helper-hub-creature-status]");
  const ok = form.querySelector('button[data-action="ok"]');
  if (!(search instanceof HTMLInputElement) || !(select instanceof HTMLSelectElement)) return;
  if (!(status instanceof HTMLElement)) return;

  form.dataset.helperHubActorForm = "1";
  form.noValidate = true;

  const refuse = event => {
    if (state.phase === "loading") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (state.phase !== "ready") {
      event.preventDefault();
      event.stopImmediatePropagation();
      ui.notifications.warn(game.i18n.localize("HELPERHUB.ChatActorBestiaryFailed"));
      return;
    }
    const reason = rejectionReason(form, state.creatures);
    if (!reason) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ui.notifications.warn(game.i18n.localize(reason));
  };

  form.addEventListener("submit", refuse, true);
  dialog.element.addEventListener("click", event => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!target || (typeof target.closest !== "function")) return;
    if (!target.closest('button[data-action="ok"]')) return;
    refuse(event);
  }, true);

  search.addEventListener("input", () => {
    if (state.phase !== "ready") return;
    fillCreatureSelect(select, state.creatures, search.value);
  });

  if (ok instanceof HTMLButtonElement) ok.disabled = true;
  if (nameInput instanceof HTMLInputElement) nameInput.focus();

  const applyList = creatures => {
    if (!form.isConnected) return;
    state.creatures = creatures;
    state.phase = "ready";
    select.disabled = false;
    if (ok instanceof HTMLButtonElement) ok.disabled = false;
    status.hidden = true;
    fillCreatureSelect(select, creatures, search.value);
  };

  if (creatureCache) {
    applyList(creatureCache);
    return;
  }

  void loadCreatures().then(applyList).catch(err => {
    console.warn(`${MODULE_ID} | Could not load the Plutonium bestiary.`, err);
    if (!form.isConnected) return;
    state.phase = "failed";
    status.textContent = game.i18n.localize("HELPERHUB.ChatActorBestiaryFailed");
    ui.notifications.warn(game.i18n.localize("HELPERHUB.ChatActorBestiaryFailed"));
  });
}

/**
 * @param {HTMLFormElement} form
 * @param {object[]} creatures
 * @returns {string}
 */
function rejectionReason(form, creatures) {
  const nameInput = form.elements.namedItem("name");
  const name = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : "";
  if (!name) return "HELPERHUB.ChatActorNameEmpty";
  const select = form.elements.namedItem("creature");
  if (!(select instanceof HTMLSelectElement) || !creatureAt(select.value, creatures)) {
    return "HELPERHUB.ChatActorNoCreature";
  }
  return "";
}

/**
 * The same name is printed in several books, so the label keeps the source.
 * The option value is an index into the cached array. At most 100 rows are shown.
 * A list box can stay unselected, so submit is refused until the user picks a row.
 * @param {HTMLSelectElement} select
 * @param {object[]} creatures
 * @param {string} query
 */
function fillCreatureSelect(select, creatures, query) {
  const previous = select.value;
  const matches = matchingIndices(creatures, query);
  select.replaceChildren();
  for (const index of matches) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = creatureLabel(creatures[index]);
    select.append(option);
  }
  if (matches.some(index => String(index) === previous)) select.value = previous;
  else select.selectedIndex = -1;
}

/**
 * Case-insensitive match on name or source. An empty query keeps the first 100 creatures.
 * @param {object[]} creatures
 * @param {string} query
 * @returns {number[]}
 */
function matchingIndices(creatures, query) {
  const needle = query.trim().toLowerCase();
  /** @type {number[]} */
  const matches = [];
  for (let index = 0; index < creatures.length; index += 1) {
    const creature = creatures[index];
    if (!creature || (typeof creature !== "object")) continue;
    const name = fieldText(creature.name);
    const source = fieldText(creature.source);
    if (!name && !source) continue;
    const hayName = name.toLowerCase();
    const haySource = source.toLowerCase();
    if (needle && !hayName.includes(needle) && !haySource.includes(needle)) continue;
    matches.push(index);
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches;
}

/**
 * @param {object} creature
 * @returns {string}
 */
function creatureLabel(creature) {
  const name = fieldText(creature?.name);
  const source = fieldText(creature?.source);
  if (name && source) return `${name} (${source})`;
  return name || source;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function fieldText(value) {
  return typeof value === "string" ? value : "";
}

/**
 * @param {unknown} value
 * @param {object[]} creatures
 * @returns {object | null}
 */
function creatureAt(value, creatures) {
  const index = typeof value === "number" ? value : (/^\d+$/.test(String(value)) ? Number(value) : NaN);
  if (!Number.isInteger(index) || (index < 0) || (index >= creatures.length)) return null;
  const creature = creatures[index];
  return creature && (typeof creature === "object") ? creature : null;
}

/**
 * One bestiary load per session. A failed load can be tried again from the next dialog.
 * @returns {Promise<object[]>}
 */
function loadCreatures() {
  if (creatureCache) return Promise.resolve(creatureCache);
  if (!creatureLoad) {
    const vetools = game.modules.get("plutonium")?.api?.salphar?.Vetools;
    if (typeof vetools?.pGetAllCreatures !== "function") {
      return Promise.reject(new Error("Plutonium bestiary is unavailable."));
    }
    creatureLoad = Promise.resolve()
      .then(() => vetools.pGetAllCreatures())
      .then(result => {
        const monsters = result?.monster;
        if (!Array.isArray(monsters)) throw new Error("Plutonium did not return a creature list.");
        creatureCache = monsters;
        return monsters;
      })
      .catch(err => {
        creatureLoad = null;
        throw err;
      });
  }
  return creatureLoad;
}

/**
 * The bestiary sheet in dnd5e is an NPC. Plutonium fills that actor, then the chat image
 * replaces creature art. Token width and height from the creature are left alone.
 * A known frame is written in that same portrait update. The sheet image stays the chat portrait.
 * When a role is chosen, the token image is that portrait clipped to the ring.
 * Cancelling the picker leaves the ring off.
 * A thrown import, or a failed summary, deletes the actor so an empty NPC is not left behind.
 * Plutonium also returns a warning when the overwrite is declined. That actor is removed too.
 * @param {string} name
 * @param {object} creature
 * @param {string} imagePath
 * @returns {Promise<void>}
 */
async function importCreatureActor(name, creature, imagePath) {
  /** @type {Actor | undefined} */
  let actor;
  try {
    actor = await Actor.create({name, type: "npc"}, {renderSheet: false});
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not create an NPC.`, err);
    ui.notifications.warn(game.i18n.localize("HELPERHUB.ChatActorCreateFailed"));
    return;
  }
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.ChatActorCreateFailed"));
    return;
  }

  try {
    const importEntry = game.modules.get("plutonium")?.api?.importer?.creature?.pImportEntry;
    if (typeof importEntry !== "function") throw new Error("Plutonium creature import is unavailable.");
    const summary = await importEntry(creature, {actor});
    const outcome = importOutcome(summary);
    if (outcome !== "ok") {
      console.warn(`${MODULE_ID} | Creature import did not finish.`, summary);
      await deleteActor(actor);
      if (outcome === "failed") ui.notifications.warn(game.i18n.localize("HELPERHUB.ChatActorImportFailed"));
      return;
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | Creature import failed.`, err);
    await deleteActor(actor);
    ui.notifications.warn(game.i18n.localize("HELPERHUB.ChatActorImportFailed"));
    return;
  }

  const current = game.actors.get(actor.id) ?? actor;
  let role = detectTokenFrameRole(current, creature);
  if (role == null) role = await chooseTokenFrameRole(null);

  const prototypeToken = {
    name,
    texture: {src: imagePath}
  };
  /** @type {object} */
  const update = {name, img: imagePath, prototypeToken};
  const previousTexture = current.prototypeToken?.texture?.src;
  let baked = "";
  if (role) {
    const fitted = await fitTokenFramePortrait(imagePath, role, {token: current.prototypeToken});
    baked = fitted?.path ?? "";
    if (baked) prototypeToken.texture.src = baked;
    Object.assign(prototypeToken, ringUpdate(role, baked || undefined));
    /** @type {Record<string, unknown>} */
    const frameFlags = {tokenFrame: role};
    if ((typeof imagePath === "string") && imagePath && !imagePath.includes("*")) {
      frameFlags.tokenFrameSource = imagePath;
    }
    if (fitted?.crop) frameFlags.tokenFrameCrop = fitted.crop;
    update.flags = {[MODULE_ID]: frameFlags};
  }

  try {
    await current.update(update);
    if (role && baked) {
      await removeStoredTokenBake(previousTexture, baked);
      notifyTokenFrame(role);
    } else if (role) {
      notifyTokenFrameFitFailed();
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not apply the chat image to the actor.`, err);
    ui.notifications.warn(game.i18n.localize("HELPERHUB.ChatActorPortraitFailed"));
  }

  try {
    current.sheet?.render(true);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not open the actor sheet.`, err);
  }
}

/**
 * Plutonium swallows importer exceptions and returns a failed summary. A declined overwrite
 * is a warning, not a thrown error, and did not fill the actor.
 * @param {unknown} summary
 * @returns {"ok" | "failed" | "cancelled"}
 */
function importOutcome(summary) {
  if (summary == null || (typeof summary !== "object")) return "failed";
  try {
    if (typeof summary.isFailed === "function" && summary.isFailed()) return "failed";
    const meta = typeof summary.getNotificationMeta === "function" ? summary.getNotificationMeta() : null;
    if (meta?.level === "error") return "failed";
    if (meta?.level === "warn") return "cancelled";
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not read the creature import result.`, err);
    return "failed";
  }
  return "ok";
}

/**
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
async function deleteActor(actor) {
  try {
    await actor.delete();
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not delete the unfinished NPC.`, err);
  }
}
