const MODULE_ID = "helper-hub";
const DROP_CLASS = "helper-hub-drop";
const BOUND_ATTR = "data-helper-hub-drop";

/** Chat roots with an upload still in flight. A second drop on the same element is ignored. */
const uploading = new WeakSet();

/**
 * Bind file-drop handling to each chat log, including the popped-out window.
 * renderChatLog passes the application element as an HTMLElement.
 */
export function registerChatImageDrop() {
  Hooks.once("ready", () => {
    if (!game.user.isGM) return;
    ensureChatDirectory().catch(err => {
      console.warn(`${MODULE_ID} | Could not prepare the chat image folder.`, err);
    });
  });

  Hooks.on("renderChatLog", (app, html) => {
    const root = html instanceof HTMLElement ? html : app?.element;
    if (!(root instanceof HTMLElement)) return;
    if (root.getAttribute(BOUND_ATTR) === "1") return;
    root.setAttribute(BOUND_ATTR, "1");
    bindChatImageDrop(root);
  });
}

/**
 * @param {HTMLElement} root
 */
function bindChatImageDrop(root) {
  let depth = 0;

  const clearDropHighlight = () => {
    depth = 0;
    root.classList.remove(DROP_CLASS);
  };

  root.addEventListener("dragenter", event => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    depth += 1;
    root.classList.add(DROP_CLASS);
  });

  root.addEventListener("dragover", event => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  root.addEventListener("dragleave", () => {
    if (depth === 0) return;
    depth -= 1;
    if (depth === 0) root.classList.remove(DROP_CLASS);
  });

  root.addEventListener("dragend", clearDropHighlight);

  root.addEventListener("drop", event => {
    clearDropHighlight();
    void handleDrop(root, event).finally(() => {
      // A newer drag may already be hovering. Only clear a highlight this drop left behind.
      if (depth === 0) root.classList.remove(DROP_CLASS);
    });
  });
}

/**
 * @param {HTMLElement} root
 * @param {DragEvent} event
 */
async function handleDrop(root, event) {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) return;

  const images = files.filter(isImageFile);
  if (!images.length) {
    // Keep Foundry on screen. Document drops have no files and already returned,
    // and this does not stopPropagation, so other listeners still see the event.
    event.preventDefault();
    ui.notifications.warn(game.i18n.localize("HELPERHUB.DropNotImage"));
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (uploading.has(root)) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.DropBusy"));
    return;
  }
  if (!game.user.hasPermission("FILES_UPLOAD")) {
    ui.notifications.error(game.i18n.localize("HELPERHUB.DropNoPermission"));
    return;
  }

  uploading.add(root);
  let failed = false;
  const paths = [];
  try {
    await ensureChatDirectory();
    for (const file of images) {
      const path = await uploadChatImage(file);
      if (path) paths.push(path);
      else failed = true;
    }
  }
  catch (err) {
    failed = true;
    console.warn(`${MODULE_ID} | Could not upload dropped chat images.`, err);
  }
  finally {
    uploading.delete(root);
  }

  if (failed) ui.notifications.warn(game.i18n.localize("HELPERHUB.DropUploadFailed"));
  if (!paths.length) return;

  try {
    await ChatMessage.create({
      content: imageMessageContent(paths),
      style: CONST.CHAT_MESSAGE_STYLES.OOC
    }, {messageMode: "public"});
  }
  catch (err) {
    console.warn(`${MODULE_ID} | Failed to post dropped chat images.`, err);
    ui.notifications.warn(game.i18n.localize("HELPERHUB.DropPostFailed"));
  }
}

/**
 * Create modules/helper-hub/storage/chat when a GM is present.
 * browse rejects with an Error when the directory is missing. createDirectory is not recursive
 * and the server only allows it for a GM, so players never call it.
 * @returns {Promise<void>}
 */
async function ensureChatDirectory() {
  if (!game.user.isGM) return;

  const picker = foundry.applications.apps.FilePicker;
  const storage = `modules/${MODULE_ID}/storage`;
  const chat = `${storage}/chat`;
  for (const target of [storage, chat]) {
    try {
      await picker.browse("data", target);
    }
    catch {
      try {
        await picker.createDirectory("data", target);
      }
      catch (createErr) {
        // Another client can create the folder between the failed browse and this call.
        try {
          await picker.browse("data", target);
        }
        catch (stillMissing) {
          console.warn(`${MODULE_ID} | Could not create ${target}.`, createErr);
          throw stillMissing;
        }
      }
    }
  }
}

/**
 * @param {DataTransfer | null | undefined} dataTransfer
 * @returns {boolean}
 */
function dragHasFiles(dataTransfer) {
  const types = dataTransfer?.types;
  if (!types) return false;
  for (const type of types) {
    if (type === "Files") return true;
  }
  return false;
}

/**
 * @param {File} file
 * @returns {boolean}
 */
function isImageFile(file) {
  const name = typeof file?.name === "string" ? file.name : "";
  const dot = name.lastIndexOf(".");
  if (dot < 0 || (dot === name.length - 1)) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(CONST.IMAGE_FILE_EXTENSIONS, ext);
}

/**
 * @param {File} file
 * @returns {Promise<string | null>} A safe relative path, or null when the upload failed.
 */
async function uploadChatImage(file) {
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const renamed = new File([file], `${foundry.utils.randomID()}-${safe}`, {type: file.type});

  try {
    const response = await foundry.applications.apps.FilePicker.uploadPersistent(
      MODULE_ID,
      "chat",
      renamed,
      {},
      {notify: false}
    );
    const path = response?.path;
    return isSafeUploadPath(path) ? path : null;
  }
  catch (err) {
    console.warn(`${MODULE_ID} | Image upload failed.`, err);
    return null;
  }
}

/**
 * Relative Foundry paths only. Reject quotes, spaces, schemes, and any `..` or empty segment.
 * @param {unknown} path
 * @returns {path is string}
 */
function isSafeUploadPath(path) {
  if (typeof path !== "string" || !path) return false;
  if (/[\s"'<>`]/.test(path)) return false;
  if (path.includes("\\")) return false;
  if (/javascript:/i.test(path)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  if (path.startsWith("/") || path.startsWith(".")) return false;
  const segments = path.split("/");
  if (segments.some(segment => (segment === "") || (segment === ".."))) return false;
  return true;
}

/**
 * @param {string[]} paths
 * @returns {string}
 */
function imageMessageContent(paths) {
  const wrapper = document.createElement("div");
  wrapper.className = "helper-hub-images";
  for (const path of paths) {
    const img = document.createElement("img");
    img.setAttribute("alt", "");
    img.setAttribute("src", path);
    wrapper.append(img);
  }
  return wrapper.outerHTML;
}
