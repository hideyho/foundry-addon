import {
  chatYouTubeVolume,
  isImageUrl,
  parseHttpsUrl,
  parseYouTubeUrl,
  readDraggedUrl,
  youtubeEmbedURL
} from "./media-urls.mjs";

const MODULE_ID = "helper-hub";
const DROP_CLASS = "helper-hub-drop";
const BOUND_ATTR = "data-helper-hub-drop";

/** Chat roots with an upload still in flight. A second drop on the same element is ignored. */
const uploading = new WeakSet();

/** Chat messages whose YouTube player was already started this session. */
const startedChatVideos = new Set();

/** @type {YT.Player | null} */
let chatPlayer = null;

let chatToken = 0;

/**
 * Bind file-drop handling to each chat log, including the popped-out window.
 * renderChatLog passes the application element as an HTMLElement.
 */
export function registerChatImageDrop() {
  Hooks.on("chatMessage", onChatMessage);
  Hooks.on("renderChatMessageHTML", onRenderChatMessageHTML);
  Hooks.on("deleteChatMessage", message => {
    if (message?.id) startedChatVideos.delete(message.id);
  });

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
    if (dragHasFiles(event.dataTransfer)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      depth += 1;
      root.classList.add(DROP_CLASS);
      return;
    }
    if (dragHasLink(event.dataTransfer)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  });

  root.addEventListener("dragover", event => {
    if (dragHasFiles(event.dataTransfer)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      return;
    }
    if (dragHasLink(event.dataTransfer)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
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
  if (!files.length) {
    await handleUrlDrop(event);
    return;
  }

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
 * URL drags need dragover prevented or the browser never fires drop.
 * File drags stay on the existing path. The payload is only read on drop.
 * @param {DataTransfer | null | undefined} dataTransfer
 * @returns {boolean}
 */
function dragHasLink(dataTransfer) {
  const types = dataTransfer?.types;
  if (!types || dragHasFiles(dataTransfer)) return false;
  for (const type of types) {
    if ((type === "text/uri-list") || (type === "text/plain")) return true;
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
 * Hooks.call does not await. Return false immediately so Foundry does not also post the raw URL.
 * A sentence that merely contains a link is not a single https URL and falls through.
 * @param {ChatLog} _log
 * @param {string} message
 * @returns {false | void}
 */
function onChatMessage(_log, message) {
  const url = parseHttpsUrl(message);
  if (!url) return;
  const media = classifyHttpsUrl(url);
  if (!media) return;
  void postChatMedia(media).catch(err => {
    console.warn(`${MODULE_ID} | Failed to post a chat link.`, err);
    ui.notifications.warn(game.i18n.localize("HELPERHUB.LinkPostFailed"));
  });
  return false;
}

/**
 * @param {DragEvent} event
 * @returns {Promise<void>}
 */
async function handleUrlDrop(event) {
  const dragged = readDraggedUrl(event.dataTransfer);
  if (dragged.kind !== "url") return;

  const media = classifyHttpsUrl(dragged.url);
  event.preventDefault();
  if (!media) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.DropUrlUnsupported"));
    return;
  }

  event.stopPropagation();
  try {
    await postChatMedia(media);
  } catch (err) {
    console.warn(`${MODULE_ID} | Failed to post a dropped chat link.`, err);
    ui.notifications.warn(game.i18n.localize("HELPERHUB.LinkPostFailed"));
  }
}

/**
 * @param {URL} url
 * @returns {{kind: "image", url: URL} | {kind: "youtube", video: {id: string, start: number | null, href: string}} | null}
 */
function classifyHttpsUrl(url) {
  if (url.protocol !== "https:") return null;
  if (isImageUrl(url, CONST.IMAGE_FILE_EXTENSIONS)) return {kind: "image", url};
  const video = parseYouTubeUrl(url);
  return video ? {kind: "youtube", video} : null;
}

/**
 * @param {{kind: "image", url: URL} | {kind: "youtube", video: {id: string, start: number | null, href: string}}} media
 * @returns {Promise<void>}
 */
async function postChatMedia(media) {
  const content = media.kind === "image" ? imageUrlMessageContent(media.url) : youtubeMessageContent(media.video);
  await ChatMessage.create({
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OOC
  }, {messageMode: "public"});
}

/**
 * @param {{id: string, start: number | null, href: string}} video
 * @returns {string}
 */
function youtubeMessageContent(video) {
  const src = youtubeEmbedURL(video.href, video.id, video.start);
  const embed = new URL(src);
  if (embed.protocol !== "https:") throw new Error("Refusing a non-https YouTube embed.");

  const iframe = document.createElement("iframe");
  iframe.className = "helper-hub-youtube";
  iframe.setAttribute("src", embed.href);
  iframe.setAttribute("allow", "autoplay");
  iframe.setAttribute("title", "YouTube");
  return iframe.outerHTML;
}

/**
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
function onRenderChatMessageHTML(message, html) {
  if (!(html instanceof HTMLElement) || !message?.id || startedChatVideos.has(message.id)) return;
  const iframe = html.querySelector("iframe.helper-hub-youtube");
  if (!(iframe instanceof HTMLIFrameElement)) return;
  iframe.id = `helper-hub-yt-${message.id}-${foundry.utils.randomID()}`;
  iframe.setAttribute("allow", "autoplay");
  void startChatYouTube(message.id, iframe);
}

/**
 * Wait until the iframe is in the document. Foundry fires this hook before the chat log appends it,
 * and getYouTubePlayer only resolves from onReady, which needs getElementById to find the frame.
 * @param {string} messageId
 * @param {HTMLIFrameElement} iframe
 * @returns {Promise<void>}
 */
async function startChatYouTube(messageId, iframe) {
  const token = ++chatToken;
  stopChatPlayer();
  await new Promise(resolve => setTimeout(resolve, 0));
  if ((token !== chatToken) || !iframe.isConnected) return;
  try {
    const player = await game.video.getYouTubePlayer(iframe.id);
    if (token !== chatToken) {
      try { player.stopVideo(); } catch { /* replaced */ }
      return;
    }
    startedChatVideos.add(messageId);
    chatPlayer = player;
    releaseChatVideoWhenRemoved(messageId, iframe);
    try { player.setVolume(chatYouTubeVolume()); } catch { /* slider will retry */ }
    try { player.playVideo(); } catch { /* controls stay on the visible iframe */ }
  } catch (err) {
    if (token === chatToken) console.warn(`${MODULE_ID} | Could not start a chat YouTube player.`, err);
  }
}

/**
 * A deleted or replaced frame must be allowed to start again on the next render.
 * @param {string} messageId
 * @param {HTMLIFrameElement} iframe
 */
function releaseChatVideoWhenRemoved(messageId, iframe) {
  const drop = () => {
    if (iframe.isConnected) return false;
    startedChatVideos.delete(messageId);
    return true;
  };
  if (drop() || (typeof MutationObserver !== "function")) return;
  const observer = new MutationObserver(() => {
    if (!drop()) return;
    observer.disconnect();
  });
  const root = iframe.ownerDocument?.documentElement;
  if (root) observer.observe(root, {childList: true, subtree: true});
}

function stopChatPlayer() {
  const player = chatPlayer;
  chatPlayer = null;
  if (!player) return;
  try {
    player.stopVideo();
  } catch {
    try { player.pauseVideo(); } catch { /* the iframe was already removed */ }
  }
}

/**
 * @param {number} [volume] Live playlist gain from the volume hook.
 * @returns {void}
 */
export function refreshChatYouTubeVolume(volume) {
  if (!chatPlayer) return;
  try { chatPlayer.setVolume(chatYouTubeVolume(volume)); } catch { /* the player is gone */ }
}

/**
 * @param {URL} url
 * @returns {string}
 */
function imageUrlMessageContent(url) {
  if (!(url instanceof URL) || (url.protocol !== "https:")) throw new Error("Refusing a non-https image.");
  return imageMessageContent([url.href]);
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
