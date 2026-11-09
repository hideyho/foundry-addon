/**
 * GM controls on each combat-tracker row: current hit points, damage, healing, and status effects.
 * Importing this file does not read Foundry. `game`, `Hooks`, and `CONFIG` are used only from
 * `registerCombatVitals` and the handlers it registers.
 */

const MODULE_ID = "helper-hub";

/** @type {HTMLElement | null} */
let statusPanel = null;

/** @type {HTMLButtonElement | null} */
let statusAnchor = null;

/** @type {WeakMap<HTMLElement, object>} */
const trackerApps = new WeakMap();

/**
 * Typed amounts saved before Foundry replaces the tracker rows.
 * Keyed by the tracker application, then by combatant id.
 * @type {WeakMap<object, Map<string, {value: string, start: number | null, end: number | null, focused: boolean}>>}
 */
const amountDrafts = new WeakMap();

/**
 * The in-flight hit-point change for each actor. The next click waits for it.
 * @type {WeakMap<object, Promise<void>>}
 */
const hpChanges = new WeakMap();

/**
 * Signed hit-point change for `actor.applyDamage`.
 * A positive result is damage. A negative result is healing.
 * An empty or whitespace field means 1. Zero, a negative typed number, and other text return null,
 * which means the click should not change hit points.
 * @param {{direction: string, raw: unknown}} input
 * @returns {number | null}
 */
export function combatHpDelta({direction, raw}) {
  const amount = amountFromRaw(raw);
  if (amount === null) return null;
  if (direction === "damage") return amount;
  if (direction === "heal") return -amount;
  return null;
}

/**
 * Text from the amount field.
 * A number input hides invalid text: `validity.badInput` is true and `.value` is empty.
 * That hidden text is not the empty-field default of 1, so the click does nothing.
 * A missing field is the empty default.
 * @param {{value?: unknown, validity?: {badInput?: boolean}} | null | undefined} field
 * @returns {string | null}
 */
export function combatAmountRaw(field) {
  if (!field || (typeof field !== "object")) return "";
  if (field.validity?.badInput === true) return null;
  return (typeof field.value === "string") ? field.value : "";
}

/**
 * Next `system.attributes.hp.value` after a signed delta, or null when there is no hit-point pool.
 * `delta` uses the same sign as `combatHpDelta`: positive subtracts, negative heals.
 * The result stays within 0 and `max` when `max` is a finite number. A missing max has no upper bound.
 * @param {{value: unknown, max: unknown, delta: unknown}} input
 * @returns {number | null}
 */
export function combatHpUpdate({value, max, delta}) {
  if ((typeof value !== "number") || !Number.isFinite(value)) return null;
  if ((typeof delta !== "number") || !Number.isFinite(delta)) return null;
  const next = Math.max(value - delta, 0);
  if ((typeof max !== "number") || !Number.isFinite(max)) return next;
  return Math.min(next, Math.max(max, 0));
}

/**
 * True when this actor, or this hit-point record, has a numeric current value.
 * Without that value the row gets no hit-point buttons.
 * @param {object | null | undefined} subject
 * @returns {boolean}
 */
export function showCombatHp(subject) {
  const hp = hitPointsOf(subject);
  return (typeof hp?.value === "number") && Number.isFinite(hp.value);
}

/**
 * Players, and a world with the setting turned off, get no combat-tracker markup.
 * @param {{isGM: boolean, enabled: boolean}} input
 * @returns {boolean}
 */
export function showCombatVitals({isGM, enabled}) {
  return (isGM === true) && (enabled === true);
}

/**
 * Status icons from a Foundry array or from dnd5e's plain object of effects.
 * `active` is true when the id is in `activeIds`. Entries without a string id are skipped.
 * A string is not treated as a list of letters.
 * @param {unknown} list
 * @param {Iterable<string> | null | undefined} activeIds
 * @returns {{id: string, img: string, name: string, active: boolean}[]}
 */
export function combatStatusChoices(list, activeIds) {
  const active = idSet(activeIds);
  /** @type {{id: string, img: string, name: string, active: boolean}[]} */
  const choices = [];
  for (const entry of statusEntries(list)) {
    if (!entry || (typeof entry.id !== "string") || !entry.id) continue;
    choices.push({
      id: entry.id,
      img: (typeof entry.img === "string") ? entry.img : "",
      name: statusEntryName(entry),
      active: active.has(entry.id)
    });
  }
  return choices;
}

/**
 * Hooks the combat tracker. Safe to call only after Foundry has created `Hooks`.
 */
export function registerCombatVitals() {
  globalThis.Hooks?.on?.("preRenderCombatTracker", onPreRenderCombatTracker);
  globalThis.Hooks?.on?.("renderCombatTracker", onRenderCombatTracker);
}

/**
 * Re-renders the combat tracker that is already on screen, and its popout when that window is open.
 * A tracker that has never been shown is left alone.
 * The sidebar tab's own render also paints `tracker.popout`, so that window is not rendered twice.
 */
export function refreshCombatTrackers() {
  const tracker = globalThis.ui?.combat;
  const linked = tracker?.popout;
  const popout = linked ?? globalThis.ui?.sidebar?.popouts?.combat;
  const sidebarOpen = tracker?.rendered === true;
  if (sidebarOpen) renderTracker(tracker);
  const covered = sidebarOpen && (popout === linked) && (linked?.rendered === true);
  if (!covered && (popout !== tracker) && (popout?.rendered === true)) renderTracker(popout);
}

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
function amountFromRaw(raw) {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !(raw > 0)) return null;
    return raw;
  }
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return 1;
  const amount = Number(text);
  if (!Number.isFinite(amount) || !(amount > 0)) return null;
  return amount;
}

/**
 * @param {object | null | undefined} subject
 * @returns {object | null}
 */
function hitPointsOf(subject) {
  if (!subject || (typeof subject !== "object")) return null;
  const nested = subject.system?.attributes?.hp;
  if (nested && (typeof nested === "object")) return nested;
  if (Object.prototype.hasOwnProperty.call(subject, "value") || Object.prototype.hasOwnProperty.call(subject, "max")) {
    return subject;
  }
  return null;
}

/**
 * @param {unknown} list
 * @returns {Iterable<object>}
 */
function statusEntries(list) {
  if (!list || (typeof list === "string")) return [];
  if (typeof list[Symbol.iterator] === "function") return list;
  if (typeof list === "object") return Object.values(list);
  return [];
}

/**
 * @param {object} entry
 * @returns {string}
 */
function statusEntryName(entry) {
  if (typeof entry.name === "string") return entry.name;
  if (typeof entry.label === "string") return entry.label;
  return "";
}

/**
 * @param {Iterable<string> | null | undefined} activeIds
 * @returns {Set<string>}
 */
function idSet(activeIds) {
  if (activeIds instanceof Set) return activeIds;
  const found = new Set();
  if (!isIterable(activeIds)) return found;
  for (const id of activeIds) {
    if ((typeof id === "string") && id) found.add(id);
  }
  return found;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isIterable(value) {
  return !!value && (typeof value !== "string") && (typeof value[Symbol.iterator] === "function");
}

/**
 * Foundry replaces the tracker HTML after this hook and before `renderCombatTracker`.
 * The half-typed amount has to be copied here, while the field is still in the document.
 * @param {object} app
 */
function onPreRenderCombatTracker(app) {
  const root = hookElement(app?.element);
  if (!(root instanceof HTMLElement)) return;
  /** @type {Map<string, {value: string, start: number | null, end: number | null, focused: boolean}>} */
  const drafts = new Map();
  for (const field of root.querySelectorAll("input.helper-hub-combat-hp-amount")) {
    const draft = amountDraft(field);
    const id = field.closest("li.combatant[data-combatant-id]")?.dataset.combatantId;
    if (draft && id) drafts.set(id, draft);
  }
  if (drafts.size) amountDrafts.set(app, drafts);
  else amountDrafts.delete(app);
}

/**
 * @param {object} app
 * @param {unknown} html
 */
function onRenderCombatTracker(app, html) {
  closeStatusPanel();
  if (!showCombatVitals({isGM: isGameMaster(), enabled: combatVitalsEnabled()})) return;
  const root = hookElement(html) ?? hookElement(app?.element);
  if (!(root instanceof HTMLElement)) return;
  trackerApps.set(root, app);
  bindTracker(root);
  for (const row of root.querySelectorAll("li.combatant[data-combatant-id]")) {
    if (row instanceof HTMLElement) paintRow(row, app);
  }
}

/**
 * The render hook's second argument is the application element in Foundry 14.
 * Older callers pass a jQuery object whose first entry is that node.
 * @param {unknown} html
 * @returns {HTMLElement | null}
 */
function hookElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html && (typeof html === "object")) {
    const first = /** @type {{0?: unknown}} */ (html)[0];
    if (first instanceof HTMLElement) return first;
  }
  return null;
}

/**
 * One delegated listener on the tracker shell. The render hook replaces the rows inside it.
 * The click listener is capture-phase: Foundry's `activateCombatant` listener is bubble-phase
 * on this same element and was registered first, so a later bubble listener runs too late.
 * `pointerdown` stays in the bubble phase so the amount field can still take focus.
 * @param {HTMLElement} root
 */
function bindTracker(root) {
  if (root.dataset.helperHubCombatVitals === "1") return;
  root.dataset.helperHubCombatVitals = "1";
  root.addEventListener("pointerdown", onTrackerPointerDown);
  root.addEventListener("click", onTrackerClick, {capture: true});
  root.addEventListener("keydown", onTrackerKeyDown);
  root.addEventListener("scroll", onTrackerScroll, {capture: true, passive: true});
}

/**
 * Scrolling the list moves the anchor. The panel is fixed, so it is placed again.
 */
function onTrackerScroll() {
  if (!statusPanel || !statusAnchor?.isConnected) {
    if (statusPanel) closeStatusPanel();
    return;
  }
  placePanel(statusPanel, statusAnchor);
}

/**
 * @param {Event} event
 */
function onTrackerPointerDown(event) {
  if (!controlTarget(event)) return;
  event.stopPropagation();
}

/**
 * @param {Event} event
 */
function onTrackerKeyDown(event) {
  const element = eventElement(event);
  if (!element?.closest(".helper-hub-combat-vitals")) return;
  if (event.key === "Escape") return;
  event.stopPropagation();
}

/**
 * @param {MouseEvent} event
 */
function onTrackerClick(event) {
  const control = controlTarget(event);
  if (!control) return;
  event.stopPropagation();
  if (!(control instanceof HTMLButtonElement)) return;
  event.preventDefault();
  if (!isGameMaster()) return;
  const row = control.closest("li.combatant[data-combatant-id]");
  if (!(row instanceof HTMLElement)) return;
  const id = row.dataset.combatantId;
  if (!id) return;
  const root = event.currentTarget;
  const app = root instanceof HTMLElement ? trackerApps.get(root) : null;
  const actor = actorFor(app, id);
  if (control.classList.contains("helper-hub-combat-status")) {
    onStatusButton(control, app, id, actor);
    return;
  }
  if (!actor) return;
  const field = row.querySelector("input.helper-hub-combat-hp-amount");
  const raw = combatAmountRaw(field);
  if (raw === null) return;
  const direction = control.classList.contains("helper-hub-combat-heal") ? "heal" : "damage";
  const delta = combatHpDelta({direction, raw});
  if (delta === null) return;
  changeHitPoints(actor, delta, row);
}

/**
 * @param {Event} event
 * @returns {Element | null}
 */
function controlTarget(event) {
  const element = eventElement(event);
  if (!element) return null;
  const vitals = element.closest(".helper-hub-combat-vitals");
  if (!vitals) return null;
  const control = element.closest("button, input");
  if (control && vitals.contains(control)) return control;
  return vitals;
}

/**
 * @param {Event} event
 * @returns {Element | null}
 */
function eventElement(event) {
  const target = event.target;
  if (target instanceof Element) return target;
  if ((target instanceof Node) && target.parentElement) return target.parentElement;
  return null;
}

/**
 * @param {HTMLElement} row
 * @param {object} app
 */
function paintRow(row, app) {
  const id = row.dataset.combatantId;
  const draft = amountDraft(row.querySelector("input.helper-hub-combat-hp-amount"))
    ?? (id ? amountDrafts.get(app)?.get(id) : null)
    ?? null;
  row.querySelector(":scope .helper-hub-combat-vitals")?.remove();
  if (!id) return;
  const actor = actorFor(app, id);
  const vitals = document.createElement("div");
  vitals.className = "helper-hub-combat-vitals";
  if (showCombatHp(actor)) vitals.append(hpControls(actor.system.attributes.hp));
  vitals.append(statusButton());
  insertUnderName(row, vitals);
  if (showCombatHp(actor)) restoreAmount(vitals, draft);
}

/**
 * @param {object} hp
 * @returns {HTMLElement}
 */
function hpControls(hp) {
  const wrap = document.createElement("div");
  wrap.className = "helper-hub-combat-hp";

  const current = document.createElement("span");
  current.className = "helper-hub-combat-hp-current";
  current.textContent = hpLabel(hp);

  const amount = document.createElement("input");
  amount.type = "text";
  amount.className = "helper-hub-combat-hp-amount";
  amount.inputMode = "numeric";
  amount.placeholder = "1";
  amount.autocomplete = "off";
  const amountLabel = text("HELPERHUB.CombatVitalsAmount");
  amount.setAttribute("aria-label", amountLabel);
  amount.title = amountLabel;

  wrap.append(
    current,
    amount,
    iconButton("helper-hub-combat-damage", "−", "HELPERHUB.CombatVitalsDamage"),
    iconButton("helper-hub-combat-heal", "+", "HELPERHUB.CombatVitalsHeal")
  );
  return wrap;
}

/**
 * @param {object} hp
 * @returns {string}
 */
function hpLabel(hp) {
  const value = hp.value;
  if ((typeof value !== "number") || !Number.isFinite(value)) return "";
  if ((typeof hp.max === "number") && Number.isFinite(hp.max)) return `${value}/${hp.max}`;
  return String(value);
}

/**
 * @returns {HTMLButtonElement}
 */
function statusButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "helper-hub-combat-status";
  const label = text("HELPERHUB.CombatVitalsStatuses");
  button.setAttribute("aria-label", label);
  button.title = label;
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-sparkles";
  icon.setAttribute("aria-hidden", "true");
  icon.style.pointerEvents = "none";
  button.append(icon);
  return button;
}

/**
 * @param {string} className
 * @param {string} symbol
 * @param {string} labelKey
 * @returns {HTMLButtonElement}
 */
function iconButton(className, symbol, labelKey) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = symbol;
  const label = text(labelKey);
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

/**
 * @param {HTMLElement} row
 * @param {HTMLElement} vitals
 */
function insertUnderName(row, vitals) {
  const nameBox = row.querySelector(".token-name");
  if (nameBox instanceof HTMLElement) {
    const title = nameBox.querySelector(".name, h4, h3");
    if (title instanceof HTMLElement) title.insertAdjacentElement("afterend", vitals);
    else nameBox.prepend(vitals);
    return;
  }
  const title = row.querySelector(".name, h4, .combatant-name");
  if (title instanceof HTMLElement) title.insertAdjacentElement("afterend", vitals);
  else row.append(vitals);
}

/**
 * @param {HTMLButtonElement} button
 * @param {object | undefined} app
 * @param {string} combatantId
 * @param {object | null} actor
 */
function onStatusButton(button, app, combatantId, actor) {
  if (!isGameMaster()) return;
  if (statusPanel && (statusAnchor === button)) {
    closeStatusPanel();
    return;
  }
  if (!actor) return;
  openStatusPanel(button, app, combatantId, actor);
}

/**
 * @param {HTMLButtonElement} anchor
 * @param {object | undefined} app
 * @param {string} combatantId
 * @param {object} actor
 */
function openStatusPanel(anchor, app, combatantId, actor) {
  closeStatusPanel();
  const panel = document.createElement("div");
  panel.className = "helper-hub-combat-statuses";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", text("HELPERHUB.CombatVitalsStatuses"));
  const choices = combatStatusChoices(globalThis.CONFIG?.statusEffects, activeStatusIds(actor));
  for (const choice of choices) panel.append(statusChoice(choice));
  panel.addEventListener("pointerdown", event => {
    event.stopPropagation();
  });
  panel.addEventListener("click", event => onPanelClick(event, app, combatantId));
  document.body.append(panel);
  placePanel(panel, anchor);
  statusPanel = panel;
  statusAnchor = anchor;
  document.addEventListener("keydown", onStatusKeydown, true);
  document.addEventListener("click", onStatusDismiss, true);
}

/**
 * @param {MouseEvent} event
 * @param {object | undefined} app
 * @param {string} combatantId
 */
function onPanelClick(event, app, combatantId) {
  event.stopPropagation();
  const choice = eventElement(event)?.closest("button.helper-hub-combat-status-choice");
  if (!(choice instanceof HTMLButtonElement)) return;
  event.preventDefault();
  if (!isGameMaster()) return;
  const id = choice.dataset.statusId;
  if (!id) return;
  const actor = actorFor(app, combatantId);
  if (!actor) return;
  toggleStatus(actor, id, choice);
}

/**
 * @param {{id: string, img: string, name: string, active: boolean}} choice
 * @returns {HTMLButtonElement}
 */
function statusChoice(choice) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "helper-hub-combat-status-choice";
  if (choice.active) button.classList.add("is-active");
  button.dataset.statusId = choice.id;
  button.setAttribute("aria-pressed", choice.active ? "true" : "false");
  if (choice.img) {
    const img = document.createElement("img");
    img.src = choice.img;
    img.alt = "";
    img.draggable = false;
    button.append(img);
  }
  const name = document.createElement("span");
  name.textContent = localize(choice.name) || choice.id;
  button.append(name);
  return button;
}

/**
 * Fixed positioning uses the button's viewport rectangle, so the tracker's overflow cannot clip it.
 * The node is on `document.body` so that rectangle matches `position: fixed`.
 * @param {HTMLElement} panel
 * @param {HTMLElement} anchor
 */
function placePanel(panel, anchor) {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  panel.style.position = "fixed";
  let top = rect.bottom + 4;
  let left = rect.left;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.left = `${Math.round(left)}px`;
  const bounds = panel.getBoundingClientRect();
  if (bounds.bottom > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - bounds.height - 4);
  }
  if (bounds.right > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - bounds.width - margin);
  }
  panel.style.top = `${Math.round(top)}px`;
  panel.style.left = `${Math.round(left)}px`;
}

/**
 * @param {KeyboardEvent} event
 */
function onStatusKeydown(event) {
  if ((event.key !== "Escape") || !statusPanel) return;
  event.preventDefault();
  event.stopPropagation();
  closeStatusPanel();
}

/**
 * @param {MouseEvent} event
 */
function onStatusDismiss(event) {
  if (!statusPanel) return;
  const element = eventElement(event);
  if (!element) return;
  if (statusPanel.contains(element)) return;
  if (statusAnchor?.contains(element)) return;
  closeStatusPanel();
}

function closeStatusPanel() {
  statusPanel?.remove();
  statusPanel = null;
  statusAnchor = null;
  document.removeEventListener("keydown", onStatusKeydown, true);
  document.removeEventListener("click", onStatusDismiss, true);
}

/**
 * @param {object} actor
 * @param {string} id
 * @param {HTMLButtonElement} button
 */
function toggleStatus(actor, id, button) {
  if (!isGameMaster()) return;
  if (typeof actor.toggleStatusEffect !== "function") return;
  const wasActive = button.classList.contains("is-active");
  button.classList.toggle("is-active", !wasActive);
  button.setAttribute("aria-pressed", wasActive ? "false" : "true");
  settle(() => actor.toggleStatusEffect(id), () => {
    button.classList.toggle("is-active", wasActive);
    button.setAttribute("aria-pressed", wasActive ? "true" : "false");
    console.warn(`${MODULE_ID} | Could not toggle a status effect.`);
  });
}

/**
 * @param {{render?: Function, rendered?: boolean} | null | undefined} app
 */
function renderTracker(app) {
  if (!app || (app.rendered !== true) || (typeof app.render !== "function")) return;
  try {
    const result = app.render();
    if (result && (typeof result.catch === "function")) result.catch(() => {});
  } catch {
    // The tracker was closing. The setting change still stands.
  }
}

/**
 * @param {Element | null} field
 * @returns {{value: string, start: number | null, end: number | null, focused: boolean} | null}
 */
function amountDraft(field) {
  if (!(field instanceof HTMLInputElement)) return null;
  let start = null;
  let end = null;
  try {
    start = field.selectionStart;
    end = field.selectionEnd;
  } catch {
    start = null;
    end = null;
  }
  return {
    value: field.value,
    start,
    end,
    focused: field.ownerDocument?.activeElement === field
  };
}

/**
 * @param {HTMLElement} vitals
 * @param {{value: string, start: number | null, end: number | null, focused: boolean} | null} draft
 */
function restoreAmount(vitals, draft) {
  if (!draft || (typeof draft.value !== "string")) return;
  const field = vitals.querySelector("input.helper-hub-combat-hp-amount");
  if (!(field instanceof HTMLInputElement)) return;
  field.value = draft.value;
  if (!draft.focused) return;
  field.focus();
  if ((typeof draft.start !== "number") || (typeof draft.end !== "number")) return;
  try {
    field.setSelectionRange(draft.start, draft.end);
  } catch {
    // The caret only matters while the field still accepts a selection.
  }
}

/**
 * Prefer `applyDamage` so temporary hit points and the real maximum stay in the system.
 * A positive delta damages. A negative delta heals. Without that method, write the clamped value.
 * The click's delta is fixed here. The actor's current hit points are read when this turn runs,
 * after the previous change for the same actor has finished.
 * @param {object} actor
 * @param {number} delta
 * @param {HTMLElement} row
 */
function changeHitPoints(actor, delta, row) {
  if (!isGameMaster()) return;
  const previous = hpChanges.get(actor) ?? Promise.resolve();
  const job = previous.then(
    () => commitHitPoints(actor, delta, row),
    () => commitHitPoints(actor, delta, row)
  );
  hpChanges.set(actor, job.then(() => undefined, () => undefined));
}

/**
 * @param {object} actor
 * @param {number} delta
 * @param {HTMLElement} row
 * @returns {Promise<void>}
 */
async function commitHitPoints(actor, delta, row) {
  if (!isGameMaster()) return;
  try {
    if (typeof actor.applyDamage === "function") {
      await actor.applyDamage(delta);
    } else {
      const hp = actor.system?.attributes?.hp;
      if (!hp || (typeof hp !== "object") || (typeof actor.update !== "function")) return;
      const max = ((typeof hp.effectiveMax === "number") && Number.isFinite(hp.effectiveMax)) ? hp.effectiveMax : hp.max;
      const next = combatHpUpdate({value: hp.value, max, delta});
      if ((next === null) || (next === hp.value)) return;
      await actor.update({"system.attributes.hp.value": next});
    }
  } catch {
    console.warn(`${MODULE_ID} | Could not change hit points.`);
    return;
  }
  showCurrentHitPoints(actor, row);
}

/**
 * Core does not re-render the tracker when hit points change. Paint the number that is already on screen.
 * @param {object} actor
 * @param {HTMLElement} row
 */
function showCurrentHitPoints(actor, row) {
  let label = "";
  try {
    const hp = actor?.system?.attributes?.hp;
    if (!hp || (typeof hp !== "object")) return;
    label = hpLabel(hp);
  } catch {
    // The actor hid its hit points. Leave the last painted number.
    return;
  }
  for (const live of liveHitPointRows(row)) {
    const span = live.querySelector(":scope .helper-hub-combat-hp-current");
    if (span) span.textContent = label;
  }
}

/**
 * The row from the click, plus any replacement Foundry inserted while the update was in flight.
 * @param {HTMLElement | null | undefined} row
 * @returns {HTMLElement[]}
 */
function liveHitPointRows(row) {
  /** @type {HTMLElement[]} */
  const rows = [];
  if (!(row instanceof HTMLElement)) return rows;
  const id = row.dataset.combatantId;
  if (id && (typeof document !== "undefined")) {
    let matches = [];
    try {
      matches = document.querySelectorAll(`li.combatant[data-combatant-id="${CSS.escape(id)}"]`);
    } catch {
      matches = [];
    }
    for (const match of matches) {
      if (match instanceof HTMLElement) rows.push(match);
    }
  }
  if (row.isConnected && !rows.includes(row)) rows.push(row);
  return rows;
}

/**
 * Runs document work that may throw or return a rejected promise.
 * The failure callback is a fixed warning. The caught value is not logged.
 * @param {() => unknown} work
 * @param {() => void} onError
 */
function settle(work, onError) {
  try {
    Promise.resolve(work()).catch(() => {
      onError();
    });
  } catch {
    onError();
  }
}

/**
 * A Set on the actor is the active list. Otherwise ids come from applied effects.
 * Failures stay off the console: effect documents can carry secrets.
 * @param {object} actor
 * @returns {Set<string>}
 */
function activeStatusIds(actor) {
  if (actor?.statuses instanceof Set) return actor.statuses;
  const found = new Set();
  try {
    const effects = isIterable(actor?.appliedEffects) ? actor.appliedEffects : actor?.effects;
    if (!isIterable(effects)) return found;
    for (const effect of effects) addEffectStatusIds(found, effect);
  } catch {
    return found;
  }
  return found;
}

/**
 * @param {Set<string>} found
 * @param {object | null | undefined} effect
 */
function addEffectStatusIds(found, effect) {
  if (!effect || (effect.disabled === true) || (effect.isSuppressed === true)) return;
  if (!isIterable(effect.statuses)) return;
  for (const id of effect.statuses) {
    if ((typeof id === "string") && id) found.add(id);
  }
}

/**
 * The viewed combat on this tracker, or the one `ui.combat` is showing.
 * @param {object | null | undefined} app
 * @returns {object | null}
 */
function viewedCombat(app) {
  const candidates = [app?.viewed, globalThis.ui?.combat?.viewed, globalThis.ui?.combat?.combat];
  for (const combat of candidates) {
    if (combat?.combatants && (typeof combat.combatants.get === "function")) return combat;
  }
  return null;
}

/**
 * @param {object | null | undefined} app
 * @param {string} id
 * @returns {object | null}
 */
function actorFor(app, id) {
  const combatant = viewedCombat(app)?.combatants.get(id);
  return combatant?.actor ?? null;
}

/**
 * @returns {boolean}
 */
function isGameMaster() {
  return globalThis.game?.user?.isGM === true;
}

/**
 * @returns {boolean}
 */
function combatVitalsEnabled() {
  try {
    return globalThis.game?.settings?.get(MODULE_ID, "combatVitals") === true;
  } catch (err) {
    return false;
  }
}

/**
 * @param {string} key
 * @returns {string}
 */
function text(key) {
  return localize(key) || key;
}

/**
 * @param {string} value
 * @returns {string}
 */
function localize(value) {
  if (typeof value !== "string") return "";
  try {
    const localized = globalThis.game?.i18n?.localize?.(value);
    if ((typeof localized === "string") && localized) return localized;
  } catch (err) {
    return value;
  }
  return value;
}
