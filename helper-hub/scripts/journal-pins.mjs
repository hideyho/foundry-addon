const MODULE_ID = "helper-hub";
const DEFAULT_ICON = "icons/svg/book.svg";
const PREVIEW_LIMIT = 2000;

/** Icons shipped in Foundry's public directory. */
const PIN_ICONS = [
  "icons/svg/book.svg",
  "icons/svg/castle.svg",
  "icons/svg/tower.svg",
  "icons/svg/house.svg",
  "icons/svg/village.svg",
  "icons/svg/city.svg",
  "icons/svg/mountain.svg",
  "icons/svg/cave.svg",
  "icons/svg/bridge.svg",
  "icons/svg/ruins.svg",
  "icons/svg/temple.svg",
  "icons/svg/oak.svg",
  "icons/svg/chest.svg",
  "icons/svg/sword.svg",
  "icons/svg/shield.svg",
  "icons/svg/skull.svg",
  "icons/svg/door-closed.svg",
  "icons/svg/fire.svg",
  "icons/svg/anchor.svg",
  "icons/svg/obelisk.svg",
  "icons/svg/hanging-sign.svg",
  "icons/svg/portal.svg"
];

/** @type {number} */
let placementGeneration = 0;

/** @type {(() => void) | null} */
let cancelPendingClick = null;

/** @type {foundry.applications.api.DialogV2 | null} */
let pinDialog = null;

/** @type {WeakSet<object>} */
const closedPinDialogs = new WeakSet();

/** @type {WeakSet<object>} */
const dialogListeners = new WeakSet();

/** Chosen icon for the open dialog. Survives DialogV2 rebuilding the form. */
let chosenIconPath = DEFAULT_ICON;

/** @type {number} */
let hoverSerial = 0;

/** @type {HTMLElement | null} */
let hoverPanel = null;

/** @type {object | null} */
let hoverNote = null;

/**
 * Page menu does not need libWrapper. Wrappers are registered separately.
 */
export function registerJournalPins() {
  Hooks.on("getJournalEntryPageContextOptions", onJournalPageContext);
  Hooks.on("canvasTearDown", () => {
    cancelPendingClick?.();
    hideHoverPreview();
  });
}

/**
 * Drop and hover need libWrapper. The caller skips this when the library is missing.
 */
export function registerJournalPinWrappers() {
  registerWrapper([
    "foundry.canvas.layers.NotesLayer.prototype._onDropData",
    "NotesLayer.prototype._onDropData"
  ], onJournalPageDrop, "MIXED");
  registerWrapper([
    "foundry.canvas.placeables.Note.prototype._onHoverIn",
    "Note.prototype._onHoverIn"
  ], onJournalPinHoverIn, "WRAPPER");
  registerWrapper([
    "foundry.canvas.placeables.Note.prototype._onHoverOut",
    "Note.prototype._onHoverOut"
  ], onJournalPinHoverOut, "WRAPPER");
}

/**
 * libWrapper walks from globalThis. The namespaced class is tried first.
 * @param {string[]} targets
 * @param {Function} fn
 * @param {"MIXED" | "WRAPPER"} type
 */
function registerWrapper(targets, fn, type) {
  for (const target of targets) {
    try {
      libWrapper.register(MODULE_ID, target, fn, type);
      return;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not wrap ${target}.`, err);
    }
  }
}

/**
 * @param {object} sheet
 * @param {object[]} menuItems
 */
function onJournalPageContext(sheet, menuItems) {
  if (!Array.isArray(menuItems)) return;
  menuItems.push({
    label: "HELPERHUB.JournalPinMenu",
    icon: "fa-solid fa-map-pin",
    visible: () => journalPinsOn() && !!canvas?.ready && game.user.hasPermission("NOTE_CREATE"),
    onClick: (_event, target) => {
      const pageId = target?.dataset?.pageId;
      const page = pageId ? sheet.entry?.pages?.get(pageId) : null;
      if (page) void placeFromMenu(page);
    }
  });
}

/**
 * Journal page drops open the icon dialog and create the note here.
 * Other drops, and this drop while the setting is off, stay with core.
 * A compendium page is refused without calling core, so Foundry does not import a copy.
 * @param {Function} wrapped
 * @param {DragEvent} event
 * @param {object} data
 * @this {object}
 */
async function onJournalPageDrop(wrapped, event, data) {
  if (!journalPinsOn() || (data?.type !== "JournalEntryPage")) return wrapped(event, data);
  try {
    await placeDroppedPage.call(this, event, data);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not place a dropped journal page.`, err);
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinCreateFailed"));
  }
}

/**
 * Core hover still runs. The preview is added only after it accepts the hover.
 * @param {Function} wrapped
 * @param {PIXI.FederatedEvent} event
 * @param {object} [options]
 * @this {object}
 */
function onJournalPinHoverIn(wrapped, event, options) {
  const wasHover = this.hover;
  const result = wrapped(event, options);
  if (wasHover || !this.hover || !journalPinsOn() || pinCushionActive()) return result;
  if ((this === hoverNote) && hoverPanel?.isConnected) return result;
  void showHoverPreview(this, event);
  return result;
}

/**
 * @param {Function} wrapped
 * @param {PIXI.FederatedEvent} event
 * @param {object} [options]
 * @this {object}
 */
function onJournalPinHoverOut(wrapped, event, options) {
  const result = wrapped(event, options);
  if ((this !== hoverNote) || this.hover || pointerInsideHoverPanel(event)) return result;
  hideHoverPreview();
  return result;
}

/**
 * @param {object} page
 * @returns {Promise<void>}
 */
async function placeFromMenu(page) {
  const generation = takePlacement();
  if (pageInCompendium(page)) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinCompendium"));
    return;
  }
  if (!canvas?.ready || !canvas.scene) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinNoScene"));
    return;
  }
  const sceneId = canvas.scene.id;
  const icon = await choosePinIcon(page, "menu");
  if (!icon || (generation !== placementGeneration) || !journalPinsOn()) return;
  if (!canvas.scene || (canvas.scene.id !== sceneId)) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinNoScene"));
    return;
  }
  const point = await waitForMapClick(generation, sceneId);
  if (!point || (generation !== placementGeneration) || !journalPinsOn()) return;
  await createJournalNote(page, point, icon, sceneId);
}

/**
 * @param {DragEvent} event
 * @param {object} data
 * @this {object}
 * @returns {Promise<void>}
 */
async function placeDroppedPage(event, data) {
  const NoteDocument = foundry.utils.getDocumentClass("Note");
  if (!NoteDocument.canUserCreate(game.user)) {
    ui.notifications.warn("PERMISSION.WarningNoCreate", {format: {document: NoteDocument.documentName}});
    return;
  }
  const generation = takePlacement();
  if (!canvas?.scene || !canvas.dimensions?.rect) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinNoScene"));
    return;
  }
  const sceneId = canvas.scene.id;
  const origin = dropOrigin(this, event, data);
  if (!origin) return;
  const page = await droppedPage(data);
  if (generation !== placementGeneration) return;
  if (!page) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinCreateFailed"));
    return;
  }
  if (pageInCompendium(page)) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinCompendium"));
    return;
  }
  const icon = await choosePinIcon(page, "drop");
  if (!icon || (generation !== placementGeneration) || !journalPinsOn()) return;
  if (!canvas.scene || (canvas.scene.id !== sceneId)) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinNoScene"));
    return;
  }
  await createJournalNote(page, origin, icon, sceneId);
}

/**
 * Same origin rules as NotesLayer#_onDropData. Shift keeps the raw point.
 * @param {object} layer
 * @param {DragEvent} event
 * @param {object} data
 * @returns {{x: number, y: number} | null}
 */
function dropOrigin(layer, event, data) {
  let origin;
  if ((data?.x === undefined) || (data?.y === undefined)) {
    const coords = layer._canvasCoordinatesFromDrop(event, {center: false});
    if (!coords) return null;
    origin = {x: coords[0], y: coords[1]};
  } else {
    origin = {x: data.x, y: data.y};
  }
  if (!event.shiftKey) {
    const snapped = layer.getSnappedPoint(origin);
    origin = {x: snapped.x, y: snapped.y};
  }
  if (!canvas.dimensions?.rect?.contains(origin.x, origin.y)) return null;
  return origin;
}

/**
 * Resolve the dragged page without copying it into the world.
 * @param {object} data
 * @returns {Promise<object | null>}
 */
async function droppedPage(data) {
  try {
    if (typeof data?.uuid === "string" && data.uuid) {
      const document = await foundry.utils.fromUuid(data.uuid);
      if (document?.documentName === "JournalEntryPage") return document;
    }
    const PageDocument = foundry.utils.getDocumentClass("JournalEntryPage");
    const page = await PageDocument.fromDropData(data);
    if (page?.documentName === "JournalEntryPage") return page;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not read the dropped journal page.`, err);
  }
  return null;
}

/**
 * A newer menu or drop cancels the previous map click and closes its dialog.
 * @returns {number}
 */
function takePlacement() {
  placementGeneration += 1;
  cancelPendingClick?.();
  cancelPendingClick = null;
  chosenIconPath = DEFAULT_ICON;
  const dialog = pinDialog;
  pinDialog = null;
  if (dialog && !closedPinDialogs.has(dialog)) {
    closedPinDialogs.add(dialog);
    try {
      void dialog.close()?.catch(() => {});
    } catch (err) {
      // The dialog was already closing.
    }
  }
  return placementGeneration;
}

/**
 * The next left click inside the scene places the note. Escape cancels without a warning.
 * Other buttons are ignored and still reach the canvas. Clicks outside the scene are ignored.
 * Hold Shift to skip the same snap NotesLayer uses for a drop.
 * @param {number} generation
 * @param {string} sceneId
 * @returns {Promise<{x: number, y: number} | null>}
 */
function waitForMapClick(generation, sceneId) {
  cancelPendingClick?.();
  const view = canvas.app?.view;
  if (!view) return Promise.resolve(null);

  return new Promise(resolve => {
    let settled = false;
    const finish = point => {
      if (settled) return;
      settled = true;
      view.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      if (cancelPendingClick === cancel) cancelPendingClick = null;
      resolve(point);
    };
    const cancel = () => finish(null);
    const onKey = event => {
      if (settled || event.isComposing || (event.key !== "Escape")) return;
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    };
    const onDown = event => {
      if (settled || (generation !== placementGeneration)) {
        finish(null);
        return;
      }
      if (event.button !== 0) return;
      if (!journalPinsOn()) {
        finish(null);
        return;
      }
      if (!canvas.scene || (canvas.scene.id !== sceneId) || !canvas.dimensions?.rect) {
        finish(null);
        ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinNoScene"));
        return;
      }
      const raw = canvas.canvasCoordinatesFromClient({x: event.clientX, y: event.clientY});
      const point = snapPoint(raw, event.shiftKey);
      if (!canvas.dimensions.rect.contains(point.x, point.y)) return;
      event.preventDefault();
      event.stopPropagation();
      finish(point);
    };
    cancelPendingClick = cancel;
    view.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  });
}

/**
 * @param {{x: number, y: number}} point
 * @param {boolean} shiftKey
 * @returns {{x: number, y: number}}
 */
function snapPoint(point, shiftKey) {
  if (shiftKey) return {x: point.x, y: point.y};
  const snapped = canvas.notes?.getSnappedPoint(point);
  if (!snapped || !Number.isFinite(snapped.x) || !Number.isFinite(snapped.y)) {
    return {x: point.x, y: point.y};
  }
  return {x: snapped.x, y: snapped.y};
}

/**
 * @param {object} page
 * @param {{x: number, y: number}} point
 * @param {string} icon
 * @param {string} sceneId
 * @returns {Promise<void>}
 */
async function createJournalNote(page, point, icon, sceneId) {
  const scene = canvas.scene;
  if (!journalPinsOn()) return;
  if (!scene || (scene.id !== sceneId)) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinNoScene"));
    return;
  }
  if (pageInCompendium(page)) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinCompendium"));
    return;
  }
  const entryId = page.parent?.id;
  const pageId = page.id;
  const x = Math.round(Number(point.x));
  const y = Math.round(Number(point.y));
  if (!entryId || !pageId || !Number.isInteger(x) || !Number.isInteger(y)) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinCreateFailed"));
    return;
  }
  try {
    const NoteDocument = foundry.utils.getDocumentClass("Note");
    const sort = Math.max(canvas.notes.getMaxSort() + 1, 0);
    await NoteDocument.implementation.create({
      entryId,
      pageId,
      x,
      y,
      sort,
      text: page.name ?? "",
      texture: {src: icon}
    }, {parent: scene});
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not create a journal page note.`, err);
    ui.notifications.warn(game.i18n.localize("HELPERHUB.JournalPinCreateFailed"));
  }
}

/**
 * One dialog for the menu and the drop. Cancel and dismiss resolve to null.
 * The click hint is only for the menu. A drop already has its point.
 * DialogV2 copies the content element's innerHTML, so the root div stays attribute-free.
 * The chosen path is read from the hidden input inside the content after render.
 * The dialog is not modal: a modal dialog would make the file picker inert.
 * @param {object} page
 * @param {"menu" | "drop"} mode
 * @returns {Promise<string | null>}
 */
async function choosePinIcon(page, mode) {
  let result;
  try {
    result = await foundry.applications.api.DialogV2.wait({
      window: {title: "HELPERHUB.JournalPinTitle"},
      content: pinDialogContent(mode),
      modal: false,
      rejectClose: false,
      position: {width: 640},
      buttons: [
        {
          action: "confirm",
          label: "Confirm",
          icon: "fa-solid fa-check",
          default: true,
          callback: (_event, _button, dialog) => readChosenIcon(dialog)
        },
        {
          action: "cancel",
          label: "Cancel",
          icon: "fa-solid fa-xmark",
          callback: () => false
        }
      ],
      render: (_event, dialog) => wirePinDialog(dialog, page)
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not open the journal pin dialog.`, err);
    return null;
  }
  if (typeof result !== "string") return null;
  const icon = result.trim();
  return icon || null;
}

/**
 * The click hint is omitted for a drop. The icon grid and the page preview share one row.
 * @param {"menu" | "drop"} mode
 * @returns {HTMLDivElement}
 */
function pinDialogContent(mode) {
  const content = document.createElement("div");
  if (mode === "menu") {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = game.i18n.localize("HELPERHUB.JournalPinClick");
    content.append(hint);
  }

  const grid = document.createElement("div");
  grid.className = "helper-hub-pin-icons";
  grid.dataset.helperHubPinGrid = "1";
  for (const path of PIN_ICONS) grid.append(iconButton(path, path === DEFAULT_ICON));

  const custom = document.createElement("button");
  custom.type = "button";
  custom.className = "helper-hub-pin-custom";
  custom.dataset.helperHubPinCustom = "1";
  custom.textContent = game.i18n.localize("HELPERHUB.JournalPinCustom");

  const icons = document.createElement("div");
  icons.className = "helper-hub-pin-icon-column";
  icons.append(grid, custom);

  const preview = document.createElement("div");
  preview.className = "helper-hub-pin-preview";
  preview.dataset.helperHubPinPreview = "1";

  const row = document.createElement("div");
  row.className = "helper-hub-pin-picker";
  row.append(icons, preview);

  const input = document.createElement("input");
  input.type = "hidden";
  input.dataset.helperHubPinValue = "1";
  input.setAttribute("value", DEFAULT_ICON);
  input.value = DEFAULT_ICON;

  content.append(row, input);
  return content;
}

/**
 * @param {string} path
 * @param {boolean} selected
 * @returns {HTMLButtonElement}
 */
function iconButton(path, selected) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = selected ? "helper-hub-pin-icon is-selected" : "helper-hub-pin-icon";
  button.setAttribute("data-icon", path);
  button.setAttribute("aria-pressed", selected ? "true" : "false");
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  img.setAttribute("src", path);
  button.append(img);
  return button;
}

/**
 * @param {foundry.applications.api.DialogV2} dialog
 * @param {object} page
 */
function wirePinDialog(dialog, page) {
  if (closedPinDialogs.has(dialog)) return;
  const form = dialog.element?.querySelector("form");
  if (!(form instanceof HTMLFormElement)) return;
  pinDialog = dialog;
  if (!dialogListeners.has(dialog)) {
    dialogListeners.add(dialog);
    dialog.addEventListener("close", () => {
      if (pinDialog === dialog) pinDialog = null;
    }, {once: true});
  }

  const preview = form.querySelector("[data-helper-hub-pin-preview]");
  if (preview instanceof HTMLElement) void fillPagePreview(preview, page);
  selectIcon(form, chosenIconPath || DEFAULT_ICON);
  if (form.dataset.helperHubPinForm === "1") return;
  form.dataset.helperHubPinForm = "1";

  const grid = form.querySelector("[data-helper-hub-pin-grid]");
  const custom = form.querySelector("[data-helper-hub-pin-custom]");
  if (grid instanceof HTMLElement) {
    grid.addEventListener("click", event => {
      const target = event.target;
      const button = target instanceof Element ? target.closest(".helper-hub-pin-icon") : null;
      if (!(button instanceof HTMLButtonElement) || !grid.contains(button)) return;
      event.preventDefault();
      const path = button.getAttribute("data-icon");
      if (path) selectIcon(form, path);
    });
  }
  if (custom instanceof HTMLButtonElement) {
    custom.addEventListener("click", event => {
      event.preventDefault();
      const current = readIconInput(form) || DEFAULT_ICON;
      openIconBrowser(current, path => selectIcon(form, path));
    });
  }
}

/**
 * @param {string} current
 * @param {(path: string) => void} onChoose
 */
function openIconBrowser(current, onChoose) {
  const FilePicker = foundry.applications.apps.FilePicker;
  const Picker = FilePicker?.implementation ?? FilePicker;
  if (typeof Picker !== "function") return;
  const dialog = pinDialog;
  const picker = new Picker({
    type: "image",
    current,
    callback: path => {
      if (pinDialog !== dialog) return;
      if (typeof path === "string" && path.trim()) onChoose(path.trim());
    }
  });
  void picker.render({force: true});
}

/**
 * @param {ParentNode} scope
 * @param {string} path
 */
function selectIcon(scope, path) {
  const grid = scope.querySelector("[data-helper-hub-pin-grid]");
  const input = scope.querySelector("[data-helper-hub-pin-value]");
  if (!(grid instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;

  let custom = grid.querySelector("[data-helper-hub-pin-custom-slot]");
  if (PIN_ICONS.includes(path)) {
    custom?.remove();
  } else if (custom instanceof HTMLButtonElement) {
    custom.setAttribute("data-icon", path);
    custom.querySelector("img")?.setAttribute("src", path);
  } else {
    custom = iconButton(path, false);
    custom.dataset.helperHubPinCustomSlot = "1";
    grid.append(custom);
  }

  for (const button of grid.querySelectorAll(".helper-hub-pin-icon")) {
    const selected = button.getAttribute("data-icon") === path;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }
  input.value = path;
  input.setAttribute("value", path);
  chosenIconPath = path;
}

/**
 * @param {foundry.applications.api.DialogV2} dialog
 * @returns {string}
 */
function readChosenIcon(dialog) {
  const form = dialog.element?.querySelector("form");
  return (form instanceof HTMLFormElement && readIconInput(form)) || DEFAULT_ICON;
}

/**
 * @param {ParentNode} scope
 * @returns {string}
 */
function readIconInput(scope) {
  const input = scope.querySelector("[data-helper-hub-pin-value]");
  if (!(input instanceof HTMLInputElement)) return "";
  return input.value.trim();
}

/**
 * @param {object} note
 * @param {PIXI.FederatedEvent} event
 * @returns {Promise<void>}
 */
async function showHoverPreview(note, event) {
  hideHoverPreview();
  const serial = hoverSerial;
  hoverNote = note;
  const page = note.document?.page;
  if (!page) {
    releaseHoverNote(note, serial);
    return;
  }

  try {
    if (!note._canView(game.user)) {
      releaseHoverNote(note, serial);
      return;
    }
    const point = clientPoint(event) ?? clientPointFromNote(note);
    if (!point) {
      releaseHoverNote(note, serial);
      return;
    }
    const panel = document.createElement("aside");
    panel.className = "helper-hub-pin-hover";
    panel.setAttribute("role", "tooltip");
    await fillPagePreview(panel, page, note);
    if ((serial !== hoverSerial) || (hoverNote !== note) || !journalPinsOn() || pinCushionActive()) return;
    if (!note._canView(game.user)) {
      releaseHoverNote(note, serial);
      return;
    }
    watchHoverPanel(panel);
    hoverPanel = panel;
    document.body.append(panel);
    if (hoverPanel !== panel) return;
    placeHoverPanel(panel, point.x, point.y);
    for (const img of panel.querySelectorAll("img")) {
      if (img.complete) continue;
      img.addEventListener("load", () => {
        if (panel.isConnected && (hoverPanel === panel)) placeHoverPanel(panel, point.x, point.y);
      }, {once: true});
    }
  } catch (err) {
    releaseHoverNote(note, serial);
    console.warn(`${MODULE_ID} | Could not preview a journal pin.`, err);
  }
}

function hideHoverPreview() {
  hoverSerial += 1;
  hoverNote = null;
  hoverPanel?.remove();
  hoverPanel = null;
}

/**
 * @param {object} note
 * @param {number} serial
 */
function releaseHoverNote(note, serial) {
  if ((hoverNote === note) && (serial === hoverSerial)) hoverNote = null;
}

/**
 * Wheel stays on the panel. It closes when the pointer leaves both the note and the panel.
 * @param {HTMLElement} panel
 */
function watchHoverPanel(panel) {
  panel.addEventListener("wheel", event => {
    event.stopPropagation();
  }, {capture: true});
  panel.addEventListener("pointerleave", event => {
    if (hoverPanel !== panel) return;
    const related = event.relatedTarget;
    if ((related instanceof Node) && panel.contains(related)) return;
    const view = canvas.app?.view;
    const ontoCanvas = !!view && (related instanceof Node) && ((related === view) || view.contains(related));
    if (!ontoCanvas) {
      hideHoverPreview();
      return;
    }
    requestAnimationFrame(() => {
      if ((hoverPanel !== panel) || hoverNote?.hover || panel.matches(":hover")) return;
      hideHoverPreview();
    });
  });
}

/**
 * The note's hover-out fires when the pointer moves onto the panel. That is still inside the preview.
 * @param {PIXI.FederatedEvent | MouseEvent} event
 * @returns {boolean}
 */
function pointerInsideHoverPanel(event) {
  const panel = hoverPanel;
  if (!panel) return false;
  const related = domRelatedTarget(event);
  if (related && panel.contains(related)) return true;
  const point = clientPoint(event);
  if (!point) return false;
  const hit = document.elementFromPoint(point.x, point.y);
  return (hit instanceof Node) && panel.contains(hit);
}

/**
 * PIXI clears relatedTarget on the federated event. The DOM event still has it.
 * @param {PIXI.FederatedEvent | MouseEvent} event
 * @returns {Node | null}
 */
function domRelatedTarget(event) {
  const native = event?.nativeEvent?.relatedTarget;
  if (native instanceof Node) return native;
  const related = event?.relatedTarget;
  return related instanceof Node ? related : null;
}

/**
 * @param {PIXI.FederatedEvent | MouseEvent} event
 * @returns {{x: number, y: number} | null}
 */
function clientPoint(event) {
  const native = event?.nativeEvent ?? event;
  const x = native?.clientX ?? event?.clientX;
  const y = native?.clientY ?? event?.clientY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {x, y};
}

/**
 * Jump to pin hovers with a synthetic event that has no cursor position.
 * @param {object} note
 * @returns {{x: number, y: number} | null}
 */
function clientPointFromNote(note) {
  const x = note?.document?.x ?? note?.x;
  const y = note?.document?.y ?? note?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (typeof canvas?.clientCoordinatesFromCanvas !== "function") return null;
  try {
    const converted = canvas.clientCoordinatesFromCanvas({x, y});
    if (!Number.isFinite(converted?.x) || !Number.isFinite(converted?.y)) return null;
    return {x: converted.x, y: converted.y};
  } catch (err) {
    return null;
  }
}

/**
 * @param {HTMLElement} panel
 * @param {number} x
 * @param {number} y
 */
function placeHoverPanel(panel, x, y) {
  const margin = 8;
  const offset = 16;
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  let left = x + offset;
  let top = y + offset;
  if (left > maxLeft) left = Math.max(margin, x - width - offset);
  if (top > maxTop) top = Math.max(margin, y - height - offset);
  panel.style.left = `${Math.round(Math.min(Math.max(left, margin), maxLeft))}px`;
  panel.style.top = `${Math.round(Math.min(Math.max(top, margin), maxTop))}px`;
}

/**
 * Text uses enrichHTML. Image is an img element. Anything else is the name and type.
 * Hover uses Note#_canView. The dialog has no note, so it keeps the same gate locally.
 * A viewer who would fail that gate gets the name and type only.
 * @param {HTMLElement} container
 * @param {object} page
 * @param {object | null} [note]
 * @returns {Promise<void>}
 */
async function fillPagePreview(container, page, note = null) {
  const token = String((Number(container.dataset.helperHubPinPreviewToken) || 0) + 1);
  container.dataset.helperHubPinPreviewToken = token;
  container.replaceChildren();
  if (!page) return;
  const canView = note ? note._canView(game.user) : canViewJournalPage(page);

  if ((page.type === "text") && canView) {
    const source = textPreviewSource(page);
    const html = source ? await enrichPreview(page, source) : "";
    if (container.dataset.helperHubPinPreviewToken !== token) return;
    const body = document.createElement("div");
    body.className = "helper-hub-pin-preview-text";
    if (html) body.innerHTML = html;
    else body.append(nameAndType(page));
    container.replaceChildren(body);
    return;
  }

  if ((page.type === "image") && page.src && canView) {
    const img = document.createElement("img");
    img.alt = page.name ?? "";
    img.draggable = false;
    img.setAttribute("src", page.src);
    container.append(img);
    return;
  }

  container.append(nameAndType(page));
}

/**
 * @param {object} page
 * @param {string} source
 * @returns {Promise<string>}
 */
async function enrichPreview(page, source) {
  try {
    const TextEditor = foundry.applications.ux.TextEditor;
    const editor = TextEditor?.implementation ?? TextEditor;
    const html = await editor.enrichHTML(source, {secrets: game.user.isGM, relativeTo: page});
    return typeof html === "string" ? html : "";
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not enrich a journal pin preview.`, err);
    return "";
  }
}

/**
 * Keep the cut near 2000 characters and avoid ending inside a tag.
 * @param {object} page
 * @returns {string}
 */
function textPreviewSource(page) {
  const content = page.text?.content;
  const raw = typeof content === "string" ? content : "";
  if (raw.length <= PREVIEW_LIMIT) return raw;
  let cut = raw.slice(0, PREVIEW_LIMIT);
  const open = cut.lastIndexOf("<");
  const close = cut.lastIndexOf(">");
  if (open > close) cut = cut.slice(0, open);
  return cut;
}

/**
 * @param {object} page
 * @returns {HTMLDivElement}
 */
function nameAndType(page) {
  const wrap = document.createElement("div");
  wrap.className = "helper-hub-pin-preview-fallback";
  const name = document.createElement("p");
  name.className = "helper-hub-pin-preview-name";
  name.textContent = page.name ?? "";
  const type = document.createElement("p");
  type.className = "helper-hub-pin-preview-type";
  type.textContent = pageTypeLabel(page.type);
  wrap.append(name, type);
  return wrap;
}

/**
 * @param {unknown} type
 * @returns {string}
 */
function pageTypeLabel(type) {
  if (typeof type !== "string" || !type) return "";
  const key = `TYPES.JournalEntryPage.${type}`;
  const label = game.i18n.localize(key);
  return label === key ? type : label;
}

/**
 * Same gate as Note#_canView. No journal, no preview. A GM may view it.
 * Exact LIMITED permission shows an image page only. Otherwise the page, or the
 * journal when the page is missing, must be at least OBSERVER.
 * @param {object | null | undefined} page
 * @param {object | null | undefined} [entry]
 * @returns {boolean}
 */
function canViewJournalPage(page, entry) {
  const journal = entry ?? page?.parent;
  if (!journal) return false;
  if (game.user.isGM) return true;
  try {
    if (page?.testUserPermission(game.user, "LIMITED", {exact: true})) {
      return page.type === "image";
    }
    const accessTest = page ?? journal;
    return !!accessTest.testUserPermission(game.user, "OBSERVER");
  } catch (err) {
    return false;
  }
}

/**
 * @param {object} page
 * @returns {boolean}
 */
function pageInCompendium(page) {
  if (!page) return false;
  if (page.parent?.inCompendium || page.pack || page.inCompendium) return true;
  try {
    if (page.compendium) return true;
  } catch (err) {
    // The getter failed. The uuid prefix below is still a valid check.
  }
  let uuid = "";
  try {
    uuid = typeof page.uuid === "string" ? page.uuid : "";
  } catch (err) {
    return false;
  }
  return uuid.startsWith("Compendium.");
}

/**
 * @returns {boolean}
 */
function journalPinsOn() {
  return game.settings.get(MODULE_ID, "journalPins") === true;
}

/**
 * Pin Cushion draws its own note tooltip. Leave that hover alone.
 * @returns {boolean}
 */
function pinCushionActive() {
  return game.modules.get("pin-cushion")?.active === true;
}
