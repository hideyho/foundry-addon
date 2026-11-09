import {ensureChatDirectory, isSafeUploadPath, uploadChatImage} from "./chat-images.mjs";

const MODULE_ID = "helper-hub";
const MENU_KEY = "discordChat";
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

/** GUILDS, GUILD_MESSAGES, and MESSAGE_CONTENT. History is never requested. */
const DISCORD_INTENTS = (1 << 0) | (1 << 9) | (1 << 15);

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

/** Guild text and announcement channels. Voice and threads stay out of the list. */
const TEXT_CHANNEL_TYPES = new Set([0, 5]);

const IMAGE_EXTENSIONS = new Set(["apng", "avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);
const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "ogv", "webm"]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "wav"]);

/** Attachment bytes live here. Embed media on any other host is left as a link. */
const DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

/** A mirrored file larger than this stays a remote link. */
const DISCORD_FETCH_MAX_BYTES = 10 * 1024 * 1024;

/** Abort a CDN fetch that does not finish. Redirects are not followed. */
const DISCORD_FETCH_TIMEOUT_MS = 15000;

/** Recent Discord ids on this page. The chat-message flag is the record that survives reload. */
const POSTED_LIMIT = 500;

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gu;

/**
 * One Gateway connection for this page.
 * The token lives here only while a socket is wanted. It is never written to a log.
 * @type {{
 *   socket: WebSocket | null,
 *   token: string,
 *   want: boolean,
 *   sessionId: string | null,
 *   sequence: number | null,
 *   ready: boolean,
 *   accept: boolean,
 *   botUserId: string | null,
 *   heartbeat: number,
 *   heartbeatInterval: number,
 *   heartbeatAck: boolean,
 *   reconnect: number,
 *   backoff: number,
 *   guilds: Map<string, DiscordGuild>,
 *   guildsSettled: boolean,
 *   awaitingGuilds: boolean,
 *   pendingGuilds: Set<string>,
 *   listeners: Set<() => void>,
 *   posted: Set<string>,
 *   dialog: boolean,
 *   previewing: boolean,
 *   fatalToken: string,
 *   parked: DiscordPark | null
 * }}
 */
const gateway = {
  socket: null,
  token: "",
  want: false,
  sessionId: null,
  sequence: null,
  ready: false,
  accept: false,
  botUserId: null,
  heartbeat: 0,
  heartbeatInterval: 0,
  heartbeatAck: true,
  reconnect: 0,
  backoff: 1000,
  guilds: new Map(),
  guildsSettled: false,
  awaitingGuilds: false,
  pendingGuilds: new Set(),
  listeners: new Set(),
  posted: new Set(),
  dialog: false,
  previewing: false,
  fatalToken: "",
  parked: null
};

/**
 * @typedef {{id: string, name: string, channels: DiscordChannel[]}} DiscordGuild
 * @typedef {{id: string, name: string, position: number}} DiscordChannel
 * @typedef {{
 *   token: string,
 *   sessionId: string | null,
 *   sequence: number | null,
 *   botUserId: string | null,
 *   guilds: Map<string, DiscordGuild>,
 *   guildsSettled: boolean
 * }} DiscordPark
 */

/**
 * Whether one Discord message should be posted into Foundry.
 * A webhook id is not a reason to drop the message. The bot's own user id is.
 * `seen` is the set of Discord ids already posted on this page.
 * A payload with no text, attachment, or embed is not posted.
 * @param {object | null | undefined} message
 * @param {{ready?: boolean, channelId?: string, botUserId?: string, seen?: Set<string>}} [options]
 * @returns {boolean}
 */
export function shouldMirrorDiscordMessage(message, options = {}) {
  if (options.ready !== true) return false;
  if (!message || (typeof message !== "object")) return false;
  const channelId = options.channelId;
  if ((typeof channelId !== "string") || (channelId === "") || (message.channel_id !== channelId)) return false;
  const botUserId = options.botUserId;
  const authorId = (message.author && (typeof message.author === "object")) ? message.author.id : undefined;
  if ((typeof botUserId === "string") && (botUserId !== "") && (authorId === botUserId)) return false;
  if ((typeof message.id !== "string") || (message.id === "")) return false;
  if ((options.seen instanceof Set) && options.seen.has(message.id)) return false;
  if (!discordMessageHasBody(message)) return false;
  return true;
}

/**
 * Redacted gateway payloads leave these fields empty. They are not chat lines.
 * @param {object} message
 * @returns {boolean}
 */
function discordMessageHasBody(message) {
  if ((typeof message.content === "string") && message.content.trim()) return true;
  if (Array.isArray(message.attachments) && message.attachments.some(entry => entry && (typeof entry === "object"))) {
    return true;
  }
  if (Array.isArray(message.embeds) && message.embeds.some(entry => entry && (typeof entry === "object"))) {
    return true;
  }
  return false;
}

/**
 * Escaped HTML for a Discord message. Text becomes text. Only https URLs and
 * safe Foundry file paths are used as href or src.
 * @param {object | null | undefined} message
 * @returns {string}
 */
export function discordMessageContent(message) {
  const root = element("div");
  root.className = "helper-hub-discord-message";

  const text = (typeof message?.content === "string") ? message.content : "";
  if (text) {
    const body = element("div");
    body.className = "helper-hub-discord-text";
    appendLinkedText(body, text);
    root.append(body);
  }

  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  for (const attachment of attachments) appendAttachment(root, attachment);

  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  for (const embed of embeds) appendEmbed(root, embed);

  return root.outerHTML;
}

/**
 * Register the client-only Discord settings, the Chat menu, and the Gateway.
 * Foundry globals are used only from this function and the ones it calls.
 */
export function registerDiscordChat() {
  registerDiscordSettings();
  registerDiscordMenu();
  Hooks.once("ready", () => {
    if (!game.user?.isGM) return;
    syncFromSettings();
  });
}

/**
 * @param {string} tag
 * @returns {HTMLElement}
 */
function element(tag) {
  const doc = globalThis.document;
  if (!doc || (typeof doc.createElement !== "function")) {
    throw new Error("Discord chat HTML needs a document.");
  }
  return doc.createElement(tag);
}

/**
 * @param {HTMLElement} parent
 * @param {string} text
 */
function appendLinkedText(parent, text) {
  let cursor = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const index = match.index ?? 0;
    if (index > cursor) appendText(parent, text.slice(cursor, index));
    const token = match[0];
    const {hrefPart, rest} = splitUrlTail(token);
    const href = httpsHref(hrefPart);
    if (href) {
      const link = element("a");
      link.setAttribute("href", href);
      link.setAttribute("rel", "noreferrer noopener");
      link.setAttribute("target", "_blank");
      link.textContent = hrefPart;
      parent.append(link);
    }
    else appendText(parent, hrefPart);
    if (rest) appendText(parent, rest);
    cursor = index + token.length;
  }
  if (cursor < text.length) appendText(parent, text.slice(cursor));
}

/**
 * Trim punctuation that is outside the URL, and only when the remainder is still https.
 * @param {string} token
 * @returns {{hrefPart: string, rest: string}}
 */
function splitUrlTail(token) {
  let hrefPart = token;
  let rest = "";
  while (/[.,;:!?)]$/u.test(hrefPart)) {
    const shorter = hrefPart.slice(0, -1);
    if (!httpsHref(shorter)) break;
    rest = hrefPart.slice(-1) + rest;
    hrefPart = shorter;
  }
  return {hrefPart, rest};
}

/**
 * @param {HTMLElement} parent
 * @param {string} text
 */
function appendText(parent, text) {
  const lines = text.split(/\r\n|\n|\r/u);
  lines.forEach((line, index) => {
    if (index > 0) parent.append(element("br"));
    if (line) parent.append(line);
  });
}

/**
 * @param {HTMLElement} parent
 * @param {object} attachment
 */
function appendAttachment(parent, attachment) {
  if (!attachment || (typeof attachment !== "object")) return;
  const source = mediaSource(attachment.url);
  if (!source) return;
  const label = fileLabel(attachment.filename, source);
  appendMedia(parent, attachmentKind(attachment, source), source, label);
}

/**
 * @param {HTMLElement} parent
 * @param {object} embed
 */
function appendEmbed(parent, embed) {
  if (!embed || (typeof embed !== "object")) return;
  const block = element("div");
  block.className = "helper-hub-discord-embed";
  if (typeof embed.title === "string" && embed.title) {
    const title = element("p");
    title.className = "helper-hub-discord-embed-title";
    appendLinkedText(title, embed.title);
    block.append(title);
  }
  if (typeof embed.description === "string" && embed.description) {
    const description = element("p");
    appendLinkedText(description, embed.description);
    block.append(description);
  }
  appendRemoteMedia(block, embed.image?.url, "image");
  appendRemoteMedia(block, embed.thumbnail?.url, "image");
  appendRemoteMedia(block, embed.video?.url, "video");
  if (block.childNodes.length) parent.append(block);
}

/**
 * @param {HTMLElement} parent
 * @param {unknown} url
 * @param {"image" | "video" | "audio" | "file"} kind
 */
function appendRemoteMedia(parent, url, kind) {
  const source = mediaSource(url);
  if (!source) return;
  appendMedia(parent, kind, source, fileLabel("", source));
}

/**
 * @param {HTMLElement} parent
 * @param {"image" | "video" | "audio" | "file"} kind
 * @param {string} source
 * @param {string} label
 */
function appendMedia(parent, kind, source, label) {
  if (kind === "image") {
    const image = element("img");
    image.setAttribute("src", source);
    image.setAttribute("alt", label);
    parent.append(image);
    return;
  }
  if ((kind === "video") || (kind === "audio")) {
    const media = element(kind);
    media.setAttribute("controls", "");
    media.setAttribute("src", source);
    parent.append(media);
    return;
  }
  const link = element("a");
  link.setAttribute("href", source);
  link.setAttribute("rel", "noreferrer noopener");
  link.setAttribute("target", "_blank");
  link.textContent = label || source;
  parent.append(link);
}

/**
 * @param {object} attachment
 * @param {string} source
 * @returns {"image" | "video" | "audio" | "file"}
 */
function attachmentKind(attachment, source) {
  const type = typeof attachment.content_type === "string"
    ? attachment.content_type.toLowerCase().split(";")[0].trim()
    : "";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  const ext = fileExtension(attachment.filename, source);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "file";
}

/**
 * @param {unknown} filename
 * @param {string} source
 * @returns {string}
 */
function fileExtension(filename, source) {
  const name = (typeof filename === "string" && filename) ? filename : source;
  const path = name.split("?")[0].split("#")[0];
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if ((dot <= 0) || (dot === base.length - 1)) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * @param {unknown} filename
 * @param {string} source
 * @returns {string}
 */
function fileLabel(filename, source) {
  if (typeof filename === "string" && filename.trim()) return filename.trim();
  const path = source.split("?")[0].split("#")[0];
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (!base) return source;
  try {
    return decodeURIComponent(base);
  }
  catch {
    return base;
  }
}

/**
 * https URLs, or a file this module stored under its chat folder.
 * javascript: and other schemes are dropped.
 * @param {unknown} value
 * @returns {string | null}
 */
function mediaSource(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isChatFilePath(trimmed)) return trimmed;
  return httpsHref(trimmed);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isChatFilePath(value) {
  return isSafeUploadPath(value) && value.startsWith(`modules/${MODULE_ID}/storage/chat/`);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function httpsHref(value) {
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value.trim());
  }
  catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.href;
}

/**
 * Exact Discord CDN hosts. A lookalike suffix is not a match.
 * @param {unknown} hostname
 * @returns {boolean}
 */
export function isDiscordCdnHost(hostname) {
  return (typeof hostname === "string") && DISCORD_CDN_HOSTS.has(hostname.toLowerCase());
}

/**
 * Https URL on a Discord CDN host, or null when the URL must not be fetched.
 * `javascript:` and every non-CDN host fail here.
 * @param {unknown} value
 * @returns {string | null}
 */
export function discordCdnHref(value) {
  const href = httpsHref(value);
  if (!href) return null;
  try {
    if (!isDiscordCdnHost(new URL(href).hostname)) return null;
  }
  catch {
    return null;
  }
  return href;
}

/**
 * Fetch plan for one Discord file. Null means do not call fetch.
 * Credentials are omitted and redirects are errors, so a CDN URL cannot
 * land on the Foundry host carrying the GM's cookies.
 * @param {unknown} value
 * @returns {{href: string, credentials: "omit", redirect: "error", timeoutMs: number, maxBytes: number} | null}
 */
export function discordMediaRequest(value) {
  const href = discordCdnHref(value);
  if (!href) return null;
  return {
    href,
    credentials: "omit",
    redirect: "error",
    timeoutMs: DISCORD_FETCH_TIMEOUT_MS,
    maxBytes: DISCORD_FETCH_MAX_BYTES
  };
}

/**
 * Image, video, and audio can be copied into chat storage.
 * HTML and every other type stay remote links.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDiscordMirrorMediaType(value) {
  if (typeof value !== "string") return false;
  const type = value.toLowerCase().split(";")[0].trim();
  if (!type || (type === "text/html") || (type === "application/xhtml+xml")) return false;
  return type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/");
}

/**
 * Sending Resume does not start mirroring. READY and RESUMED do.
 * Events replayed before RESUMED are history, and history is not posted.
 * @param {string | undefined} event
 * @returns {boolean}
 */
export function discordAcceptsMessages(event) {
  return (event === "READY") || (event === "RESUMED");
}

/**
 * 4004 and 4010–4014 will not succeed if retried. 4007 and 4009 must Identify.
 * @param {unknown} code
 * @returns {"stop" | "identify" | "retry"}
 */
export function discordCloseAction(code) {
  if (code === 4004) return "stop";
  if ((typeof code === "number") && (code >= 4010) && (code <= 4014)) return "stop";
  if ((code === 4007) || (code === 4009)) return "identify";
  return "retry";
}

/**
 * A forced connect clears a refusal only when it was recorded for this token.
 * Connecting a different token leaves the saved token's refusal in place.
 * @param {unknown} fatalToken
 * @param {unknown} token
 * @param {unknown} force
 * @returns {string}
 */
export function fatalTokenAfterConnect(fatalToken, token, force) {
  const recorded = (typeof fatalToken === "string") ? fatalToken : "";
  const next = (typeof token === "string") ? token : "";
  if ((force === true) && (recorded === next)) return "";
  return recorded;
}

/**
 * An outage sets `unavailable` true. That guild stays in the dropdown.
 * @param {object | null | undefined} data
 * @returns {boolean}
 */
export function shouldForgetDiscordGuild(data) {
  if (!data || (typeof data !== "object")) return false;
  if ((typeof data.id !== "string") || (data.id === "")) return false;
  return data.unavailable !== true;
}

/**
 * A GUILD_CREATE answers one id from the READY pending set.
 * `unavailable: true` still answers that id. The row is not stored.
 * @param {object | null | undefined} data
 * @returns {string}
 */
export function guildCreateAnswerId(data) {
  if (!data || (typeof data !== "object")) return "";
  if ((typeof data.id !== "string") || (data.id === "")) return "";
  return data.id;
}

/**
 * The placeholder option is an empty string. Before this token's guild list
 * has arrived, that empty string is not a choice, so the saved channel stays.
 * @param {{selectValue?: unknown, savedChannelId?: unknown, guildListReady?: boolean}} [input]
 * @returns {string}
 */
export function discordChannelIdToSave(input = {}) {
  const selectValue = (typeof input.selectValue === "string") ? input.selectValue : "";
  if (selectValue !== "") return selectValue;
  if (input.guildListReady === true) return "";
  return (typeof input.savedChannelId === "string") ? input.savedChannelId : "";
}

/**
 * Dialog status for the token typed in the field.
 * An empty token, or a token that is not the one on the socket, is idle.
 * A fatal close for this token is refused. A settled guild list is ready.
 * Any other open attempt for this token is still connecting.
 * @param {{token?: unknown, socketToken?: unknown, guildsSettled?: unknown, fatalToken?: unknown}} [input]
 * @returns {"idle" | "connecting" | "ready" | "refused"}
 */
export function discordDialogPhase(input = {}) {
  const data = (input && (typeof input === "object")) ? input : {};
  const token = (typeof data.token === "string") ? data.token : "";
  if (token === "") return "idle";
  const socketToken = (typeof data.socketToken === "string") ? data.socketToken : "";
  if (token !== socketToken) return "idle";
  const fatalToken = (typeof data.fatalToken === "string") ? data.fatalToken : "";
  if (fatalToken === token) return "refused";
  if (data.guildsSettled === true) return "ready";
  return "connecting";
}

/**
 * Guild text and announcement channels only. A type change away from those removes the row.
 * @param {DiscordChannel[]} channels
 * @param {string | undefined} type
 * @param {object | null | undefined} data
 * @returns {DiscordChannel[]}
 */
export function discordChannelsAfterEvent(channels, type, data) {
  const list = Array.isArray(channels) ? channels.slice() : [];
  if (!data || (typeof data !== "object") || (typeof data.id !== "string") || !data.id) return list;
  if (type === "CHANNEL_DELETE") return list.filter(channel => channel.id !== data.id);
  if ((type !== "CHANNEL_CREATE") && (type !== "CHANNEL_UPDATE")) return list;
  const without = list.filter(channel => channel.id !== data.id);
  const record = textChannelRecord(data);
  if (!record) return without;
  without.push(record);
  return sortChannels(without);
}

/**
 * @param {object | null | undefined} channel
 * @returns {DiscordChannel | null}
 */
function textChannelRecord(channel) {
  if (!channel || (typeof channel !== "object")) return null;
  if (!TEXT_CHANNEL_TYPES.has(channel.type)) return null;
  if ((typeof channel.id !== "string") || !channel.id) return null;
  const name = (typeof channel.name === "string" && channel.name) ? channel.name : channel.id;
  const position = (typeof channel.position === "number" && Number.isFinite(channel.position)) ? channel.position : 0;
  return {id: channel.id, name, position};
}

/**
 * @param {DiscordChannel[]} channels
 * @returns {DiscordChannel[]}
 */
function sortChannels(channels) {
  channels.sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name));
  return channels;
}

function registerDiscordSettings() {
  const {BooleanField, StringField} = foundry.data.fields;
  game.settings.register(MODULE_ID, "discordToken", {
    name: "HELPERHUB.DiscordToken",
    scope: "client",
    config: false,
    type: new StringField({required: true, blank: true, nullable: false, initial: ""}),
    default: ""
  });
  game.settings.register(MODULE_ID, "discordChannelId", {
    name: "HELPERHUB.DiscordChannel",
    scope: "client",
    config: false,
    type: new StringField({required: true, blank: true, nullable: false, initial: ""}),
    default: ""
  });
  game.settings.register(MODULE_ID, "discordEnabled", {
    name: "HELPERHUB.DiscordEnabled",
    scope: "client",
    config: false,
    type: new BooleanField({initial: false}),
    default: false
  });
}

/**
 * The menu class is created here so importing this file does not touch Foundry.
 * Settings opens it with `new type(); type.render(true)`, which shows the dialog.
 */
function registerDiscordMenu() {
  const DiscordChatConfig = class DiscordChatConfig extends foundry.applications.api.ApplicationV2 {
    static register() {
      game.settings.registerMenu(MODULE_ID, MENU_KEY, {
        name: "HELPERHUB.DiscordName",
        label: "HELPERHUB.DiscordLabel",
        hint: "HELPERHUB.DiscordMenuHint",
        icon: "fa-brands fa-discord",
        type: this,
        restricted: true
      });
    }

    /**
     * @returns {Promise<this>}
     */
    async render() {
      if (!game.user?.isGM) return this;
      try {
        await openDiscordDialog();
      }
      catch (err) {
        console.warn(`${MODULE_ID} | Could not open the Discord chat dialog.`, err);
      }
      return this;
    }
  };
  DiscordChatConfig.register();
}

/**
 * GM only. Confirm writes the three client settings and reconnects.
 * Cancel leaves the saved settings and restores the socket those settings describe.
 * @returns {Promise<void>}
 */
async function openDiscordDialog() {
  if (!game.user?.isGM) return;
  if (gateway.dialog) return;
  gateway.dialog = true;
  /** @type {{saved: boolean, cleanup: () => void, token?: string, guildId?: string, channelId?: string, enabled?: boolean}} */
  const fields = {saved: false, cleanup: () => {}};
  try {
    await foundry.applications.api.DialogV2.wait({
      window: {title: "HELPERHUB.DiscordTitle"},
      content: discordDialogContent(),
      modal: true,
      rejectClose: false,
      position: {width: 480},
      render: (_event, dialog) => {
        fields.cleanup = bindDiscordDialog(dialog?.element, fields);
      },
      buttons: [
        {
          action: "ok",
          label: "Confirm",
          icon: "fa-solid fa-check",
          default: true,
          callback: (_event, _button, dialog) => saveDiscordDialog(fields, dialog)
        },
        {
          action: "cancel",
          label: "Cancel",
          icon: "fa-solid fa-xmark",
          callback: () => false
        }
      ],
      close: () => {
        fields.cleanup();
        finishDiscordDialog(fields);
      }
    });
  }
  catch (err) {
    finishDiscordDialog(fields);
    throw err;
  }
  finally {
    fields.cleanup();
    gateway.dialog = false;
  }
}

/**
 * The preview socket exists only while the dialog is open. Closing it leaves
 * `want` set for the saved mirror, and clear for a token that was only typed.
 * @param {{saved: boolean}} fields
 */
function finishDiscordDialog(fields) {
  gateway.previewing = false;
  if (!fields.saved) syncFromSettings();
}

/**
 * DialogV2 copies this element's innerHTML and drops attributes on the root,
 * so the root div has none and the fields live inside it.
 * The password value is an attribute the browser escapes. It is not logged.
 * @returns {HTMLDivElement}
 */
function discordDialogContent() {
  const content = document.createElement("div");
  const body = document.createElement("div");
  body.className = "helper-hub-discord";
  body.append(
    textField("HELPERHUB.DiscordToken", "helper-hub-discord-token", input => {
      input.type = "password";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.defaultValue = settingString("discordToken");
    }),
    discordConnectRow(),
    selectField("HELPERHUB.DiscordGuild", "helper-hub-discord-guild", "HELPERHUB.DiscordGuildPlaceholder"),
    selectField("HELPERHUB.DiscordChannel", "helper-hub-discord-channel", "HELPERHUB.DiscordChannelPlaceholder"),
    enabledField(settingEnabled()),
    intentHint()
  );
  content.append(body);
  return content;
}

/**
 * @param {string} labelKey
 * @param {string} className
 * @param {(input: HTMLInputElement) => void} configure
 * @returns {HTMLDivElement}
 */
function textField(labelKey, className, configure) {
  const group = document.createElement("div");
  group.className = "form-group stacked";
  const label = document.createElement("label");
  label.htmlFor = className;
  label.textContent = game.i18n.localize(labelKey);
  const input = document.createElement("input");
  input.id = className;
  input.className = className;
  configure(input);
  group.append(label, input);
  return group;
}

/**
 * @param {string} labelKey
 * @param {string} className
 * @param {string} placeholderKey
 * @returns {HTMLDivElement}
 */
function selectField(labelKey, className, placeholderKey) {
  const group = document.createElement("div");
  group.className = "form-group stacked";
  const label = document.createElement("label");
  label.htmlFor = className;
  label.textContent = game.i18n.localize(labelKey);
  const select = document.createElement("select");
  select.id = className;
  select.className = className;
  const option = document.createElement("option");
  option.value = "";
  option.defaultSelected = true;
  option.textContent = game.i18n.localize(placeholderKey);
  select.append(option);
  group.append(label, select);
  return group;
}

/**
 * @param {boolean} enabled
 * @returns {HTMLLabelElement}
 */
function enabledField(enabled) {
  const label = document.createElement("label");
  label.className = "helper-hub-discord-enabled";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "helper-hub-discord-enabled-input";
  input.defaultChecked = enabled;
  const text = document.createElement("span");
  text.textContent = game.i18n.localize("HELPERHUB.DiscordEnabled");
  label.append(input, text);
  return label;
}

/**
 * The button and status live under the token field, inside `.helper-hub-discord`.
 * DialogV2 copies innerHTML and would drop attributes placed on the root.
 * @returns {HTMLDivElement}
 */
function discordConnectRow() {
  const row = document.createElement("div");
  row.className = "helper-hub-discord-connect";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "helper-hub-discord-connect-button";
  button.textContent = game.i18n.localize("HELPERHUB.DiscordConnect");
  const status = document.createElement("p");
  status.className = "helper-hub-discord-status";
  const spinner = document.createElement("i");
  spinner.className = "fa-solid fa-spinner fa-spin";
  spinner.hidden = true;
  spinner.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "helper-hub-discord-status-text";
  status.append(spinner, text);
  row.append(button, status);
  return row;
}

/**
 * @returns {HTMLParagraphElement}
 */
function intentHint() {
  const hint = document.createElement("p");
  hint.className = "hint helper-hub-discord-hint";
  hint.textContent = game.i18n.localize("HELPERHUB.DiscordIntentHint");
  return hint;
}

/**
 * @param {HTMLElement | undefined} root
 * @param {{
 *   cleanup?: () => void,
 *   token?: string,
 *   guildId?: string,
 *   channelId?: string,
 *   enabled?: boolean
 * }} fields
 * @returns {() => void}
 */
function bindDiscordDialog(root, fields) {
  if (!(root instanceof HTMLElement)) return () => {};
  const tokenInput = root.querySelector("input.helper-hub-discord-token");
  const connectButton = root.querySelector("button.helper-hub-discord-connect-button");
  const status = root.querySelector("p.helper-hub-discord-status");
  const guildSelect = root.querySelector("select.helper-hub-discord-guild");
  const channelSelect = root.querySelector("select.helper-hub-discord-channel");
  const enabledInput = root.querySelector("input.helper-hub-discord-enabled-input");
  if (!(tokenInput instanceof HTMLInputElement)) return () => {};
  if (!(connectButton instanceof HTMLButtonElement)) return () => {};
  if (!(status instanceof HTMLElement)) return () => {};
  if (!(guildSelect instanceof HTMLSelectElement)) return () => {};
  if (!(channelSelect instanceof HTMLSelectElement)) return () => {};
  if (!(enabledInput instanceof HTMLInputElement)) return () => {};
  // DialogV2 can rebuild the form. Listeners belong to the form that is on screen.
  const marker = (tokenInput.closest("form") instanceof HTMLElement) ? tokenInput.closest("form") : root;
  if (marker.dataset.helperHubDiscord === "1") return fields.cleanup ?? (() => {});
  fields.cleanup?.();
  marker.dataset.helperHubDiscord = "1";

  // DialogV2 builds a new form on render. Put the typed draft back first.
  // A rebuilt select only has its placeholder, so guild and channel also live on fields.
  writeDiscordDraft(fields, tokenInput, guildSelect, channelSelect, enabledInput);
  const refresh = () => refreshDiscordSelects(tokenInput, guildSelect, channelSelect, status, fields);
  // A saved token that is already connected fills the lists. Connect opens anything else.
  refresh();

  const unsubscribe = onGuildsChanged(refresh);
  guildSelect.addEventListener("change", () => {
    fields.guildId = guildSelect.value;
    fillChannelSelect(channelSelect, guildSelect.value, settingString("discordChannelId"));
    fields.channelId = channelSelect.value;
  });
  channelSelect.addEventListener("change", () => {
    fields.channelId = channelSelect.value;
  });
  enabledInput.addEventListener("change", () => {
    fields.enabled = enabledInput.checked;
  });
  connectButton.addEventListener("click", event => {
    event.preventDefault();
    const typed = tokenInput.value.trim();
    tokenInput.value = typed;
    fields.token = typed;
    if (typed === "") {
      refresh();
      return;
    }
    // force clears a refusal of this token. A refused token must be allowed to try again.
    connectForDialog(typed, {force: true});
    refresh();
  });
  // Editing the token clears the lists. The socket waits for Connect.
  tokenInput.addEventListener("input", () => {
    fields.token = tokenInput.value;
    refresh();
  });

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
  };
}

/**
 * Copy the typed draft onto a form DialogV2 just built.
 * Token and the enabled checkbox stick. A new guild or channel select has only
 * its placeholder, so those two are applied again when the list is ready.
 * @param {{token?: string, guildId?: string, channelId?: string, enabled?: boolean}} fields
 * @param {HTMLInputElement} tokenInput
 * @param {HTMLSelectElement} guildSelect
 * @param {HTMLSelectElement} channelSelect
 * @param {HTMLInputElement} enabledInput
 */
function writeDiscordDraft(fields, tokenInput, guildSelect, channelSelect, enabledInput) {
  if (typeof fields.token === "string") tokenInput.value = fields.token;
  if (typeof fields.guildId === "string") guildSelect.value = fields.guildId;
  if (typeof fields.channelId === "string") channelSelect.value = fields.channelId;
  if (typeof fields.enabled === "boolean") enabledInput.checked = fields.enabled;
}

/**
 * Lists stay empty until this token's guild list has settled.
 * A different token, a refusal, and an in-flight gateway all disable the selects.
 * @param {HTMLInputElement} tokenInput
 * @param {HTMLSelectElement} guildSelect
 * @param {HTMLSelectElement} channelSelect
 * @param {HTMLElement} status
 * @param {{guildId?: string, channelId?: string}} fields
 */
function refreshDiscordSelects(tokenInput, guildSelect, channelSelect, status, fields) {
  const phase = discordDialogPhase({
    token: tokenInput.value,
    socketToken: gateway.token,
    guildsSettled: gateway.guildsSettled,
    fatalToken: gateway.fatalToken
  });
  const ready = phase === "ready";
  guildSelect.disabled = !ready;
  channelSelect.disabled = !ready;
  if (!ready) {
    fillSelect(guildSelect, [], "", game.i18n.localize("HELPERHUB.DiscordGuildPlaceholder"));
    fillSelect(channelSelect, [], "", game.i18n.localize("HELPERHUB.DiscordChannelPlaceholder"));
  }
  else {
    const savedChannel = settingString("discordChannelId");
    const guilds = listGuilds();
    const draftedGuild = (typeof fields.guildId === "string") ? fields.guildId : "";
    const guildId = guildSelect.value || draftedGuild || guildIdForChannel(savedChannel);
    const selectedGuild = guilds.some(guild => guild.id === guildId) ? guildId : "";
    fillSelect(guildSelect, guilds, selectedGuild, game.i18n.localize("HELPERHUB.DiscordGuildPlaceholder"));
    const draftedChannel = (typeof fields.channelId === "string") ? fields.channelId : "";
    const preferred = channelSelect.value || draftedChannel || savedChannel;
    fillChannelSelect(channelSelect, guildSelect.value, preferred);
  }
  paintDiscordStatus(status, phase);
}

/**
 * @param {HTMLElement} status
 * @param {"idle" | "connecting" | "ready" | "refused"} phase
 */
function paintDiscordStatus(status, phase) {
  const text = status.querySelector(".helper-hub-discord-status-text");
  const spinner = status.querySelector(".fa-spinner");
  const connecting = phase === "connecting";
  status.classList.toggle("is-connecting", connecting);
  // Font Awesome sets display outside this stylesheet's layer, so hidden keeps the icon off.
  if (spinner instanceof HTMLElement) spinner.hidden = !connecting;
  let key = "";
  if (connecting) key = "HELPERHUB.DiscordConnecting";
  else if (phase === "ready") key = "HELPERHUB.DiscordConnected";
  else if (phase === "refused") key = "HELPERHUB.DiscordConnectionRefused";
  if (text instanceof HTMLElement) text.textContent = key ? game.i18n.localize(key) : "";
}

/**
 * @param {HTMLSelectElement} select
 * @param {string} guildId
 * @param {string} preferredId
 */
function fillChannelSelect(select, guildId, preferredId) {
  const channels = gateway.guilds.get(guildId)?.channels ?? [];
  const selected = channels.some(channel => channel.id === preferredId) ? preferredId : "";
  fillSelect(select, channels, selected, game.i18n.localize("HELPERHUB.DiscordChannelPlaceholder"));
}

/**
 * @param {HTMLSelectElement} select
 * @param {Array<{id: string, name: string}>} choices
 * @param {string} selectedId
 * @param {string} placeholder
 */
function fillSelect(select, choices, selectedId, placeholder) {
  const doc = select.ownerDocument;
  select.replaceChildren();
  const blank = doc.createElement("option");
  blank.value = "";
  blank.textContent = placeholder;
  select.append(blank);
  for (const choice of choices) {
    const option = doc.createElement("option");
    option.value = choice.id;
    option.textContent = choice.name;
    if (choice.id === selectedId) option.selected = true;
    select.append(option);
  }
  select.value = choices.some(choice => choice.id === selectedId) ? selectedId : "";
}

/**
 * Read the form DialogV2 is showing now. The nodes from the first render can be stale.
 * @param {{element?: HTMLElement} | null | undefined} dialog
 * @returns {{token: string, channelId: string, enabled: boolean} | null}
 */
function readDiscordDialogInputs(dialog) {
  const root = dialog?.element;
  if (!(root instanceof HTMLElement)) return null;
  const tokenInput = root.querySelector("input.helper-hub-discord-token");
  const channelSelect = root.querySelector("select.helper-hub-discord-channel");
  const enabledInput = root.querySelector("input.helper-hub-discord-enabled-input");
  if (!(tokenInput instanceof HTMLInputElement)) return null;
  if (!(channelSelect instanceof HTMLSelectElement)) return null;
  if (!(enabledInput instanceof HTMLInputElement)) return null;
  return {
    token: tokenInput.value,
    channelId: channelSelect.value,
    enabled: enabledInput.checked
  };
}

/**
 * @param {{saved: boolean}} fields
 * @param {{element?: HTMLElement} | null | undefined} dialog
 * @returns {Promise<boolean>}
 */
async function saveDiscordDialog(fields, dialog) {
  const inputs = readDiscordDialogInputs(dialog);
  if (!inputs) return false;
  const previous = {
    token: settingString("discordToken"),
    channelId: settingString("discordChannelId"),
    enabled: settingEnabled()
  };
  const channelId = discordChannelIdToSave({
    selectValue: inputs.channelId,
    savedChannelId: previous.channelId,
    guildListReady: guildListReadyFor(inputs.token)
  });
  try {
    await game.settings.set(MODULE_ID, "discordChannelId", channelId);
    await game.settings.set(MODULE_ID, "discordEnabled", inputs.enabled);
    await game.settings.set(MODULE_ID, "discordToken", inputs.token);
  }
  catch {
    await restoreDiscordSettings(previous);
    console.warn(`${MODULE_ID} | Could not save the Discord chat settings.`);
    globalThis.ui?.notifications?.error(game.i18n.localize("HELPERHUB.DiscordSaveFailed"));
    return false;
  }
  fields.saved = true;
  syncFromSettings({force: true});
  return true;
}

/**
 * Put all three client settings back when one write fails, so a token error
 * cannot leave a new channel id beside the old token.
 * @param {{token: string, channelId: string, enabled: boolean}} previous
 * @returns {Promise<void>}
 */
async function restoreDiscordSettings(previous) {
  const writes = [
    ["discordChannelId", previous.channelId],
    ["discordEnabled", previous.enabled],
    ["discordToken", previous.token]
  ];
  for (const [key, value] of writes) {
    try {
      await game.settings.set(MODULE_ID, key, value);
    }
    catch {
      console.warn(`${MODULE_ID} | Could not restore the Discord chat settings.`);
    }
  }
}

/**
 * True once this token's guild list has been applied. A preview that has not
 * reached READY, and a token that is not the one on the socket, are not ready.
 * @param {string} token
 * @returns {boolean}
 */
function guildListReadyFor(token) {
  return gateway.guildsSettled && (token !== "") && (gateway.token === token);
}

/**
 * Connect only for a GM who has a token and has turned the mirror on.
 * A refused token stays down until Confirm asks for that token again.
 * @param {{force?: boolean}} [options]
 */
function syncFromSettings({force = false} = {}) {
  if (!game.user?.isGM) {
    disconnectDiscord();
    return;
  }
  const enabled = settingEnabled();
  const token = settingString("discordToken");
  if (!enabled || (token === "")) {
    disconnectDiscord();
    return;
  }
  if (!force && (gateway.fatalToken === token)) return;
  if (gateway.parked && (gateway.parked.token !== token)) gateway.parked = null;
  connectWith(token, {force, persist: true});
}

/**
 * @param {string} key
 * @returns {string}
 */
function settingString(key) {
  const value = game.settings.get(MODULE_ID, key);
  return typeof value === "string" ? value : "";
}

/**
 * @returns {boolean}
 */
function settingEnabled() {
  return game.settings.get(MODULE_ID, "discordEnabled") === true;
}

/**
 * @returns {boolean}
 */
function socketIsLive() {
  const socket = gateway.socket;
  if (!socket) return false;
  return (socket.readyState === WebSocket.CONNECTING) || (socket.readyState === WebSocket.OPEN);
}

/**
 * Open a socket so the dialog can list servers, including when the mirror is off.
 * `want` stays false unless the saved settings already mirror this same token.
 * The preview ends in finishDiscordDialog, so a token that was only typed
 * does not keep reconnecting after the dialog closes.
 * `force` clears a refusal of this token so Connect can try it again.
 * @param {string} token
 * @param {{force?: boolean}} [options]
 */
function connectForDialog(token, {force = false} = {}) {
  const persist = settingEnabled() && (settingString("discordToken") === token);
  connectWith(token, {force, persist});
}

/**
 * @param {string} token
 * @param {{force?: boolean, persist?: boolean}} [options]
 */
function connectWith(token, {force = false, persist = true} = {}) {
  if (typeof token !== "string" || (token === "")) {
    disconnectDiscord();
    return;
  }
  gateway.fatalToken = fatalTokenAfterConnect(gateway.fatalToken, token, force);
  if (!force && (gateway.fatalToken === token)) return;

  const sameToken = gateway.token === token;
  if (!sameToken) {
    parkCurrent();
    if (!unpark(token)) {
      gateway.sessionId = null;
      gateway.sequence = null;
      gateway.botUserId = null;
      gateway.guilds = new Map();
      gateway.guildsSettled = false;
      gateway.awaitingGuilds = false;
      gateway.pendingGuilds = new Set();
    }
    gateway.ready = false;
    gateway.accept = false;
    gateway.backoff = 1000;
    notifyGuilds();
  }

  gateway.token = token;
  gateway.want = persist;
  gateway.previewing = !persist;
  // Confirm force-reconnects. Skip that when this token's session is already on this socket.
  if (sameToken && socketIsLive()) return;
  openSocket();
}

/**
 * Keep the previous session when the dialog tries another token, so Cancel can resume it.
 * A preview must not replace the parked saved session.
 */
function parkCurrent() {
  if (!gateway.token) return;
  const saved = settingString("discordToken");
  if (gateway.parked && (gateway.parked.token === saved) && (gateway.token !== saved)) return;
  gateway.parked = {
    token: gateway.token,
    sessionId: gateway.sessionId,
    sequence: gateway.sequence,
    botUserId: gateway.botUserId,
    guilds: gateway.guilds,
    guildsSettled: gateway.guildsSettled
  };
}

/**
 * @param {string} token
 * @returns {boolean}
 */
function unpark(token) {
  if (!gateway.parked || (gateway.parked.token !== token)) return false;
  const parked = gateway.parked;
  gateway.parked = null;
  gateway.sessionId = parked.sessionId;
  gateway.sequence = parked.sequence;
  gateway.botUserId = parked.botUserId;
  gateway.guilds = parked.guilds;
  gateway.guildsSettled = parked.guildsSettled === true;
  gateway.awaitingGuilds = false;
  gateway.pendingGuilds = new Set();
  return true;
}

function disconnectDiscord() {
  gateway.want = false;
  gateway.previewing = false;
  gateway.fatalToken = "";
  gateway.token = "";
  gateway.sessionId = null;
  gateway.sequence = null;
  gateway.ready = false;
  gateway.accept = false;
  gateway.botUserId = null;
  gateway.guilds = new Map();
  gateway.guildsSettled = false;
  gateway.awaitingGuilds = false;
  gateway.pendingGuilds = new Set();
  gateway.parked = null;
  gateway.backoff = 1000;
  stopReconnectTimer();
  stopHeartbeat();
  retireSocket(gateway.socket);
  gateway.socket = null;
  notifyGuilds();
}

function openSocket() {
  // A dialog preview leaves want false. previewing is enough to open the socket.
  if ((gateway.token === "") || (!gateway.want && !gateway.previewing)) return;
  stopReconnectTimer();
  retireSocket(gateway.socket);
  gateway.socket = null;
  stopHeartbeat();
  gateway.ready = false;
  gateway.accept = false;

  /** @type {WebSocket} */
  let socket;
  try {
    socket = new WebSocket(GATEWAY_URL);
  }
  catch {
    console.warn(`${MODULE_ID} | Discord gateway could not be opened.`);
    scheduleReconnect();
    return;
  }
  gateway.socket = socket;

  socket.onerror = () => {
    console.warn(`${MODULE_ID} | Discord gateway socket error.`);
  };
  socket.onclose = event => {
    if (gateway.socket !== socket) return;
    gateway.socket = null;
    gateway.ready = false;
    gateway.accept = false;
    stopHeartbeat();
    const code = (typeof event?.code === "number") ? event.code : 0;
    const action = discordCloseAction(code);
    if (action === "stop") {
      gateway.want = false;
      gateway.previewing = false;
      gateway.fatalToken = gateway.token;
      gateway.sessionId = null;
      gateway.sequence = null;
      // The list is not ready. Confirm must keep the saved channel id.
      gateway.guildsSettled = false;
      gateway.awaitingGuilds = false;
      notifyDiscordRefused(code);
      notifyGuilds();
      return;
    }
    if (action === "identify") {
      gateway.sessionId = null;
      gateway.sequence = null;
      gateway.guildsSettled = false;
      gateway.awaitingGuilds = false;
    }
    if (gateway.want || gateway.previewing) scheduleReconnect();
  };
  socket.onmessage = event => {
    if (gateway.socket !== socket) return;
    if (typeof event.data !== "string") {
      console.warn(`${MODULE_ID} | Discord gateway sent a binary frame.`);
      return;
    }
    let payload;
    try {
      payload = JSON.parse(event.data);
    }
    catch {
      console.warn(`${MODULE_ID} | Discord gateway sent a message that was not JSON.`);
      return;
    }
    if (!payload || (typeof payload !== "object")) return;
    onGatewayPayload(payload);
  };
}

/**
 * @param {WebSocket | null} socket
 */
function retireSocket(socket) {
  if (!socket) return;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  try {
    socket.close();
  }
  catch {
    // Already closed.
  }
}

/**
 * @param {object} payload
 */
function onGatewayPayload(payload) {
  if (typeof payload.s === "number") gateway.sequence = payload.s;
  switch (payload.op) {
    case OP_HELLO:
      onGatewayHello(payload);
      break;
    case OP_HEARTBEAT_ACK:
      gateway.heartbeatAck = true;
      break;
    case OP_HEARTBEAT:
      // The server asked now. This beat is in flight, so the interval starts over
      // and must not treat the missing ack as a dead socket.
      sendHeartbeat();
      if (gateway.heartbeatInterval > 0) scheduleHeartbeat(gateway.heartbeatInterval);
      break;
    case OP_RECONNECT:
      console.warn(`${MODULE_ID} | Discord gateway asked to reconnect.`);
      gateway.socket?.close();
      break;
    case OP_INVALID_SESSION:
      console.warn(`${MODULE_ID} | Discord gateway rejected the session.`);
      gateway.sessionId = null;
      gateway.sequence = null;
      gateway.ready = false;
      gateway.accept = false;
      gateway.guildsSettled = false;
      gateway.awaitingGuilds = false;
      gateway.socket?.close();
      break;
    case OP_DISPATCH:
      onGatewayDispatch(payload.t, payload.d);
      break;
    default:
      break;
  }
}

/**
 * Hello carries the heartbeat interval. Resume when this page still has a session,
 * so messages from the gap are delivered. Otherwise Identify and wait for READY.
 * @param {object} payload
 */
function onGatewayHello(payload) {
  const interval = payload?.d?.heartbeat_interval;
  if ((typeof interval !== "number") || !Number.isFinite(interval) || (interval <= 0)) {
    console.warn(`${MODULE_ID} | Discord gateway hello did not include a heartbeat interval.`);
    return;
  }
  startHeartbeat(interval);
  const token = gateway.token;
  if (!token) return;
  const canResume = (typeof gateway.sessionId === "string") && (gateway.sessionId !== "")
    && (typeof gateway.sequence === "number");
  if (canResume) {
    // Accept stays false until RESUMED. Events replayed before that are not posted.
    gateway.accept = discordAcceptsMessages("RESUME");
    sendGateway({
      op: OP_RESUME,
      d: {token, session_id: gateway.sessionId, seq: gateway.sequence}
    });
    return;
  }
  gateway.accept = discordAcceptsMessages("IDENTIFY");
  gateway.sessionId = null;
  gateway.guilds = new Map();
  gateway.guildsSettled = false;
  gateway.awaitingGuilds = false;
  gateway.pendingGuilds = new Set();
  notifyGuilds();
  sendGateway({
    op: OP_IDENTIFY,
    d: {
      token,
      intents: DISCORD_INTENTS,
      properties: gatewayProperties()
    }
  });
}

/**
 * @returns {{os: string, browser: string, device: string}}
 */
function gatewayProperties() {
  const platform = globalThis.navigator?.platform;
  const os = (typeof platform === "string" && platform) ? platform : "browser";
  return {os, browser: "helper-hub", device: "helper-hub"};
}

/**
 * @param {number} interval
 */
function startHeartbeat(interval) {
  stopHeartbeat();
  gateway.heartbeatInterval = interval;
  gateway.heartbeatAck = true;
  const jitter = Math.floor(interval * Math.random());
  scheduleHeartbeat(jitter);
}

/**
 * @param {number} delay
 */
function scheduleHeartbeat(delay) {
  if (gateway.heartbeat) clearTimeout(gateway.heartbeat);
  gateway.heartbeat = setTimeout(runHeartbeat, delay);
}

function runHeartbeat() {
  gateway.heartbeat = 0;
  const interval = gateway.heartbeatInterval;
  if (!gateway.socket || (gateway.socket.readyState !== WebSocket.OPEN)) return;
  if (!gateway.heartbeatAck) {
    console.warn(`${MODULE_ID} | Discord gateway heartbeat was not acknowledged.`);
    gateway.socket.close();
    return;
  }
  sendHeartbeat();
  if (interval > 0) scheduleHeartbeat(interval);
}

function sendHeartbeat() {
  gateway.heartbeatAck = false;
  sendGateway({op: OP_HEARTBEAT, d: gateway.sequence});
}

function stopHeartbeat() {
  gateway.heartbeatInterval = 0;
  if (!gateway.heartbeat) return;
  clearTimeout(gateway.heartbeat);
  gateway.heartbeat = 0;
}

/**
 * Authentication and intent failures stop retries until Connect or Confirm asks again.
 * The message never includes the bot token.
 * @param {number} code
 */
function notifyDiscordRefused(code) {
  console.warn(`${MODULE_ID} | Discord refused the bot connection (${code}). Retrying has stopped.`);
  const text = game.i18n.localize("HELPERHUB.DiscordConnectionRefused");
  const notifications = globalThis.ui?.notifications;
  if (typeof notifications?.error === "function") notifications.error(text);
}

function scheduleReconnect() {
  // A preview retries while the dialog is open. want stays false for a typed token.
  if (gateway.reconnect || (!gateway.want && !gateway.previewing)) return;
  const delay = gateway.backoff;
  gateway.backoff = Math.min(delay * 2, 30000);
  gateway.reconnect = setTimeout(() => {
    gateway.reconnect = 0;
    if (gateway.want || gateway.previewing) openSocket();
  }, delay);
}

function stopReconnectTimer() {
  if (!gateway.reconnect) return;
  clearTimeout(gateway.reconnect);
  gateway.reconnect = 0;
}

/**
 * @param {object} payload
 */
function sendGateway(payload) {
  const socket = gateway.socket;
  if (!socket || (socket.readyState !== WebSocket.OPEN)) return;
  try {
    socket.send(JSON.stringify(payload));
  }
  catch {
    console.warn(`${MODULE_ID} | Discord gateway could not send a payload.`);
  }
}

/**
 * @param {string | undefined} type
 * @param {object | undefined} data
 */
function onGatewayDispatch(type, data) {
  if (type === "READY") {
    const sessionId = data?.session_id;
    const userId = data?.user?.id;
    if (typeof sessionId === "string") gateway.sessionId = sessionId;
    gateway.botUserId = (typeof userId === "string") ? userId : null;
    gateway.ready = true;
    gateway.accept = discordAcceptsMessages(type);
    gateway.backoff = 1000;
    noteReadyGuilds(data);
    notifyGuilds();
    return;
  }
  if (type === "RESUMED") {
    gateway.ready = true;
    gateway.accept = discordAcceptsMessages(type);
    gateway.backoff = 1000;
    gateway.awaitingGuilds = false;
    gateway.pendingGuilds = new Set();
    gateway.guildsSettled = true;
    notifyGuilds();
    return;
  }
  if (type === "GUILD_CREATE") {
    const answeredId = guildCreateAnswerId(data);
    if (answeredId) gateway.pendingGuilds.delete(answeredId);
    // Settle before the listener runs, so the dialog can leave "connecting".
    const settled = gateway.awaitingGuilds && (gateway.pendingGuilds.size === 0);
    if (settled) {
      gateway.awaitingGuilds = false;
      gateway.guildsSettled = true;
    }
    const stored = rememberGuild(data);
    // An unavailable create stores nothing, so rememberGuild does not notify.
    if (settled && !stored) notifyGuilds();
    return;
  }
  if (type === "GUILD_DELETE") {
    if (!shouldForgetDiscordGuild(data)) return;
    gateway.pendingGuilds.delete(data.id);
    const removed = gateway.guilds.delete(data.id);
    const settled = gateway.awaitingGuilds && (gateway.pendingGuilds.size === 0);
    if (settled) {
      gateway.awaitingGuilds = false;
      gateway.guildsSettled = true;
    }
    if (removed || settled) notifyGuilds();
    return;
  }
  if ((type === "CHANNEL_CREATE") || (type === "CHANNEL_UPDATE") || (type === "CHANNEL_DELETE")) {
    applyChannelDispatch(type, data);
    return;
  }
  if (type === "MESSAGE_CREATE") {
    void mirrorDiscordMessage(data);
  }
}

/**
 * READY lists guild ids before their GUILD_CREATE payloads arrive.
 * The list is settled only after each of those guilds has been created,
 * or immediately when the bot is in no guilds.
 * @param {object | undefined} data
 */
function noteReadyGuilds(data) {
  gateway.pendingGuilds = new Set();
  gateway.awaitingGuilds = true;
  const guilds = Array.isArray(data?.guilds) ? data.guilds : [];
  for (const guild of guilds) {
    if (guild && (typeof guild.id === "string") && guild.id) gateway.pendingGuilds.add(guild.id);
  }
  if (gateway.pendingGuilds.size === 0) {
    gateway.awaitingGuilds = false;
    gateway.guildsSettled = true;
    return;
  }
  gateway.guildsSettled = false;
}

/**
 * @param {string} type
 * @param {object | undefined} data
 */
function applyChannelDispatch(type, data) {
  const guildId = (data && (typeof data.guild_id === "string")) ? data.guild_id : "";
  const guild = gateway.guilds.get(guildId);
  if (!guild) return;
  const channels = discordChannelsAfterEvent(guild.channels, type, data);
  if (sameChannelList(guild.channels, channels)) return;
  guild.channels = channels;
  notifyGuilds();
}

/**
 * @param {DiscordChannel[]} left
 * @param {DiscordChannel[]} right
 * @returns {boolean}
 */
function sameChannelList(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if ((a.id !== b.id) || (a.name !== b.name) || (a.position !== b.position)) return false;
  }
  return true;
}

/**
 * @param {object | undefined} data
 * @returns {boolean} true when the guild was stored
 */
function rememberGuild(data) {
  if (!data || (typeof data.id !== "string") || !data.id || data.unavailable) return false;
  const channels = [];
  const rawChannels = Array.isArray(data.channels) ? data.channels : [];
  for (const channel of rawChannels) {
    const record = textChannelRecord(channel);
    if (record) channels.push(record);
  }
  sortChannels(channels);
  const name = (typeof data.name === "string" && data.name) ? data.name : data.id;
  gateway.guilds.set(data.id, {id: data.id, name, channels});
  notifyGuilds();
  return true;
}

/**
 * @returns {DiscordGuild[]}
 */
function listGuilds() {
  return [...gateway.guilds.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {string} channelId
 * @returns {string}
 */
function guildIdForChannel(channelId) {
  if (!channelId) return "";
  for (const guild of gateway.guilds.values()) {
    if (guild.channels.some(channel => channel.id === channelId)) return guild.id;
  }
  return "";
}

/**
 * @param {() => void} listener
 * @returns {() => void}
 */
function onGuildsChanged(listener) {
  gateway.listeners.add(listener);
  return () => gateway.listeners.delete(listener);
}

function notifyGuilds() {
  for (const listener of [...gateway.listeners]) {
    try {
      listener();
    }
    catch (err) {
      console.warn(`${MODULE_ID} | Discord server list failed to update.`, err);
    }
  }
}

/**
 * @param {object | undefined} message
 * @returns {Promise<void>}
 */
async function mirrorDiscordMessage(message) {
  if (!mirroringActive()) return;
  const decision = {
    ready: gateway.accept,
    channelId: settingString("discordChannelId"),
    botUserId: gateway.botUserId ?? "",
    seen: gateway.posted
  };
  if (!shouldMirrorDiscordMessage(message, decision)) return;
  if (worldHasDiscordMessage(message.id)) {
    rememberPosted(message.id);
    return;
  }
  rememberPosted(message.id);
  try {
    const prepared = await withLocalMedia(message);
    await ChatMessage.create({
      content: discordMessageContent(prepared),
      style: CONST.CHAT_MESSAGE_STYLES.OOC,
      speaker: {alias: discordSpeakerAlias(message)},
      flags: {
        [MODULE_ID]: {discordMessageId: message.id}
      }
    }, {messageMode: "public"});
    // The flag on the chat message is the world-wide record. Drop the page id once it is stored.
    if (worldHasDiscordMessage(message.id)) gateway.posted.delete(message.id);
  }
  catch (err) {
    gateway.posted.delete(message.id);
    console.warn(`${MODULE_ID} | Could not post a Discord message to chat.`, err);
  }
}

/**
 * @param {string} discordId
 * @returns {boolean}
 */
function worldHasDiscordMessage(discordId) {
  if ((typeof discordId !== "string") || (discordId === "")) return false;
  const messages = globalThis.game?.messages;
  if (!messages) return false;
  for (const chat of discordMessageDocuments(messages)) {
    if (discordMessageFlag(chat) === discordId) return true;
  }
  return false;
}

/**
 * Foundry collections iterate documents. A plain Map iterates entries.
 * @param {object} messages
 * @returns {object[]}
 */
function discordMessageDocuments(messages) {
  if (Array.isArray(messages.contents)) return messages.contents;
  if (typeof messages.values === "function") return [...messages.values()];
  return [];
}

/**
 * @param {object} chat
 * @returns {string}
 */
function discordMessageFlag(chat) {
  if (!chat || (typeof chat !== "object")) return "";
  if (typeof chat.getFlag === "function") {
    const flagged = chat.getFlag(MODULE_ID, "discordMessageId");
    if (typeof flagged === "string") return flagged;
  }
  const flagged = chat.flags?.[MODULE_ID]?.discordMessageId;
  return (typeof flagged === "string") ? flagged : "";
}

/**
 * Cap the page set. Ids already stored on a chat message go first.
 * @param {string} discordId
 */
function rememberPosted(discordId) {
  gateway.posted.add(discordId);
  if (gateway.posted.size <= POSTED_LIMIT) return;
  for (const old of [...gateway.posted]) {
    if (old === discordId) continue;
    if (!worldHasDiscordMessage(old)) continue;
    gateway.posted.delete(old);
    if (gateway.posted.size <= POSTED_LIMIT) return;
  }
  for (const old of gateway.posted) {
    if (old === discordId) continue;
    gateway.posted.delete(old);
    if (gateway.posted.size <= POSTED_LIMIT) return;
  }
}

/**
 * The alias is plain text. A missing username becomes Discord.
 * @param {object} message
 * @returns {string}
 */
function discordSpeakerAlias(message) {
  const username = message?.author?.username;
  const name = (typeof username === "string" && username.trim()) ? username.trim() : "Discord";
  return `Discord: ${name}`;
}

/**
 * @returns {boolean}
 */
function mirroringActive() {
  if (!game.user?.isGM) return false;
  if (!settingEnabled()) return false;
  const saved = settingString("discordToken");
  return (saved !== "") && (saved === gateway.token);
}

/**
 * Copy the message and replace Discord CDN media that can be stored in the chat folder.
 * Other https URLs, including embed links, keep their original address and are not fetched.
 * A failed file keeps its CDN URL. One failure does not drop the message.
 * @param {object} message
 * @returns {Promise<object>}
 */
async function withLocalMedia(message) {
  const attachments = Array.isArray(message.attachments) ? message.attachments.map(item => ({...item})) : [];
  const embeds = Array.isArray(message.embeds) ? message.embeds.map(cloneEmbed) : [];
  /** @type {Array<{url?: string, filename?: string, content_type?: string}>} */
  const jobs = [];
  for (const attachment of attachments) queueDiscordMedia(jobs, attachment);
  for (const embed of embeds) {
    for (const key of ["image", "thumbnail", "video"]) queueDiscordMedia(jobs, embed?.[key]);
  }
  if (!jobs.length) return {...message, attachments, embeds};

  try {
    await ensureChatDirectory();
  }
  catch (err) {
    console.warn(`${MODULE_ID} | Could not prepare the chat folder for a Discord file.`, err);
    return {...message, attachments, embeds};
  }

  await Promise.all(jobs.map(async item => {
    const stored = await storeRemoteFile(item.url, item.filename, item.content_type);
    if (stored) item.url = stored;
  }));
  return {...message, attachments, embeds};
}

/**
 * @param {object} embed
 * @returns {object}
 */
function cloneEmbed(embed) {
  if (!embed || (typeof embed !== "object")) return {};
  const copy = {...embed};
  for (const key of ["image", "thumbnail", "video"]) {
    if (copy[key] && (typeof copy[key] === "object")) copy[key] = {...copy[key]};
  }
  return copy;
}

/**
 * @param {Array<{url?: string, filename?: string, content_type?: string}>} jobs
 * @param {{url?: string, filename?: string, content_type?: string} | null | undefined} item
 */
function queueDiscordMedia(jobs, item) {
  if (!item || (typeof item !== "object")) return;
  if (!discordMediaRequest(item.url)) return;
  const declared = item.content_type;
  if ((typeof declared === "string") && declared.trim() && !isDiscordMirrorMediaType(declared)) return;
  jobs.push(item);
}

/**
 * Fetch only a Discord CDN URL. Anything else, including a redirect, is not stored.
 * Null keeps the original URL.
 * @param {unknown} url
 * @param {unknown} filename
 * @param {unknown} contentType
 * @returns {Promise<string | null>}
 */
async function storeRemoteFile(url, filename, contentType) {
  const request = discordMediaRequest(url);
  if (!request) return null;
  if ((typeof contentType === "string") && contentType.trim() && !isDiscordMirrorMediaType(contentType)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.href, {
      credentials: request.credentials,
      redirect: request.redirect,
      signal: controller.signal
    });
    if (!response.ok) return null;
    const headerType = responseHeader(response, "content-type");
    if (headerType && !isDiscordMirrorMediaType(headerType)) return null;
    const declaredLength = responseLength(response);
    if ((declaredLength !== null) && (declaredLength > request.maxBytes)) return null;
    const blob = await readBoundedBlob(response, request.maxBytes);
    if (!blob) return null;
    const type = mediaTypeForUpload(blob.type, headerType, contentType);
    if (!type) return null;
    const name = downloadName(filename, request.href);
    const file = new File([blob], name, {type});
    return await uploadChatImage(file);
  }
  catch (err) {
    console.warn(`${MODULE_ID} | Could not store a Discord file. The original link will be used.`, err);
    return null;
  }
  finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Response} response
 * @param {string} name
 * @returns {string}
 */
function responseHeader(response, name) {
  const headers = response?.headers;
  if (!headers || (typeof headers.get !== "function")) return "";
  const value = headers.get(name);
  return (typeof value === "string") ? value : "";
}

/**
 * @param {Response} response
 * @returns {number | null}
 */
function responseLength(response) {
  const raw = responseHeader(response, "content-length");
  if (!raw) return null;
  const length = Number(raw);
  if (!Number.isFinite(length) || (length < 0)) return null;
  return length;
}

/**
 * Stop reading once the cap is passed. The partial bytes are discarded.
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<Blob | null>}
 */
async function readBoundedBlob(response, maxBytes) {
  const body = response.body;
  if (!body || (typeof body.getReader !== "function")) {
    const blob = await response.blob();
    return blob.size > maxBytes ? null : blob;
  }
  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      const value = step.value;
      received += value?.byteLength ?? 0;
      if (received > maxBytes) {
        await reader.cancel();
        return null;
      }
      if (value) chunks.push(value);
    }
  }
  catch (err) {
    try {
      await reader.cancel();
    }
    catch {
      // The stream is already closed.
    }
    throw err;
  }
  return new Blob(chunks);
}

/**
 * A non-media type anywhere in the chain rejects the upload.
 * @param {unknown} blobType
 * @param {unknown} headerType
 * @param {unknown} contentType
 * @returns {string}
 */
function mediaTypeForUpload(blobType, headerType, contentType) {
  const candidates = [blobType, headerType, contentType];
  for (const value of candidates) {
    if ((typeof value === "string") && value.trim() && !isDiscordMirrorMediaType(value)) return "";
  }
  for (const value of candidates) {
    if ((typeof value === "string") && isDiscordMirrorMediaType(value)) {
      return value.toLowerCase().split(";")[0].trim();
    }
  }
  return "";
}

/**
 * @param {unknown} filename
 * @param {string} href
 * @returns {string}
 */
function downloadName(filename, href) {
  const raw = (typeof filename === "string" && filename.trim()) ? filename.trim() : fileLabel("", href);
  const base = raw.split(/[/\\]/u).pop() || "file";
  return base.slice(0, 120);
}
