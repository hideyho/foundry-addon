const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com"
]);

const CHANNEL_SETTINGS = {
  music: "globalPlaylistVolume",
  environment: "globalAmbientVolume",
  interface: "globalInterfaceVolume"
};

/**
 * A single https URL. Rejects surrounding text so a normal sentence is left alone.
 * @param {unknown} value
 * @returns {URL | null}
 */
export function parseHttpsUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/u.test(trimmed)) return null;
  return httpsUrl(trimmed);
}

/**
 * @param {string} value
 * @returns {URL | null}
 */
function httpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return url;
}

/**
 * Image URLs are https, and the path extension is a key of CONST.IMAGE_FILE_EXTENSIONS.
 * The query string is not part of the extension.
 * @param {URL} url
 * @param {object | null | undefined} extensions
 * @returns {boolean}
 */
export function isImageUrl(url, extensions) {
  if (!(url instanceof URL) || url.protocol !== "https:") return false;
  if (!extensions || (typeof extensions !== "object")) return false;
  const slash = url.pathname.lastIndexOf("/");
  const base = slash >= 0 ? url.pathname.slice(slash + 1) : url.pathname;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || (dot === base.length - 1)) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(extensions, ext);
}

/**
 * Parse an 11-character YouTube id from an https URL.
 * Core getYouTubeId treats /shorts/ and /live/ as part of the id, so this parser does not use it.
 * @param {unknown} value
 * @returns {{id: string, start: number | null, href: string} | null}
 */
export function parseYouTubeUrl(value) {
  const url = value instanceof URL ? (value.protocol === "https:" ? value : null) : parseHttpsUrl(value);
  if (!url) return null;

  const host = url.hostname.toLowerCase();
  let rawId = "";
  if (host === "youtu.be" || host === "www.youtu.be") {
    rawId = pathSegments(url)[0] ?? "";
  } else if (YOUTUBE_HOSTS.has(host)) {
    const segments = pathSegments(url);
    const head = segments[0] ?? "";
    if (head === "watch") rawId = url.searchParams.get("v") ?? "";
    else if (head === "embed" || head === "shorts" || head === "live") rawId = segments[1] ?? "";
  }

  const id = normalizeYouTubeId(rawId);
  if (!id) return null;
  return {id, start: readStart(url), href: url.href};
}

/**
 * @param {string} rawId
 * @returns {string}
 */
function normalizeYouTubeId(rawId) {
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return "";
  }
  return YOUTUBE_ID.test(id) ? id : "";
}

/**
 * @param {URL} url
 * @returns {string[]}
 */
function pathSegments(url) {
  return url.pathname.split("/").filter(segment => segment.length > 0);
}

/**
 * Seconds from a t= or start= query. Accepts an integer or a 1h2m3s / 1m30s value.
 * @param {URL} url
 * @returns {number | null}
 */
function readStart(url) {
  for (const key of ["start", "t"]) {
    const raw = url.searchParams.get(key);
    if (raw == null || raw === "") continue;
    const seconds = parseYouTubeTime(raw);
    if (Number.isFinite(seconds) && (seconds >= 0)) return seconds;
  }
  return null;
}

/**
 * @param {string} raw
 * @returns {number}
 */
export function parseYouTubeTime(raw) {
  if (typeof raw !== "string" || !raw) return NaN;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i.exec(raw);
  if (!match || (!match[1] && !match[2] && !match[3])) return NaN;
  return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0);
}

/**
 * Embed URL for a parsed video. Uses the core helper when its id is already clean.
 * @param {string} originalHref
 * @param {string} videoId
 * @param {number | null} startSeconds
 * @returns {string}
 */
export function youtubeEmbedURL(originalHref, videoId, startSeconds) {
  if (!YOUTUBE_ID.test(videoId)) return "";
  const start = Number.isFinite(startSeconds) ? Math.floor(startSeconds) : null;
  const vars = {};
  if ((start !== null) && (start >= 0)) vars.start = String(start);

  const helper = globalThis.game?.video;
  const coreId = helper?.getYouTubeId?.(originalHref) ?? "";
  if ((coreId === videoId) && (typeof helper.getYouTubeEmbedURL === "function")) {
    const embed = helper.getYouTubeEmbedURL(originalHref, vars);
    if (isYouTubeEmbed(embed, videoId)) return embed;
  }

  const embed = new URL(`https://www.youtube.com/embed/${videoId}`);
  embed.searchParams.set("enablejsapi", "1");
  if (vars.start !== undefined) embed.searchParams.set("start", vars.start);
  return embed.href;
}

/**
 * @param {unknown} value
 * @param {string} videoId
 * @returns {boolean}
 */
function isYouTubeEmbed(value, videoId) {
  if (typeof value !== "string" || !value) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if ((url.hostname !== "www.youtube.com") && (url.hostname !== "youtube.com")) return false;
  return url.pathname === `/embed/${videoId}`;
}

/**
 * oEmbed title, or the video id when the request fails.
 * @param {string} videoId
 * @returns {Promise<string>}
 */
export async function youtubeTitle(videoId) {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
  endpoint.searchParams.set("format", "json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(endpoint, {signal: controller.signal});
    if (!response.ok) return videoId;
    const data = await response.json();
    const title = typeof data?.title === "string" ? data.title.replace(/\s+/g, " ").trim() : "";
    return title ? title.slice(0, 180) : videoId;
  } catch {
    return videoId;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Foundry document drags put JSON in text/plain. A URL drop is text/uri-list or one https URL.
 * @param {DataTransfer | null | undefined} dataTransfer
 * @returns {{kind: "document"} | {kind: "none"} | {kind: "url", url: URL}}
 */
export function readDraggedUrl(dataTransfer) {
  if (!dataTransfer || (typeof dataTransfer.getData !== "function")) return {kind: "none"};
  const plain = dragText(dataTransfer, "text/plain").trim();
  if (plain.startsWith("{")) return {kind: "document"};
  if (plain) {
    try {
      JSON.parse(plain);
      return {kind: "document"};
    } catch {
      // Not a Foundry document payload.
    }
  }

  const uri = firstUriListEntry(dragText(dataTransfer, "text/uri-list"));
  if (uri) {
    try {
      const url = new URL(uri);
      if ((url.protocol === "http:") || (url.protocol === "https:")) return {kind: "url", url};
    } catch {
      // The uri-list line was not a URL.
    }
  }

  const https = parseHttpsUrl(plain);
  if (https) return {kind: "url", url: https};
  return {kind: "none"};
}

/**
 * @param {DataTransfer} dataTransfer
 * @param {string} type
 * @returns {string}
 */
function dragText(dataTransfer, type) {
  try {
    return dataTransfer.getData(type) ?? "";
  } catch {
    return "";
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function firstUriListEntry(value) {
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return "";
}

/**
 * Core channel slider, or 1 when that setting is missing.
 * @param {string} setting
 * @returns {number}
 */
export function coreVolume(setting) {
  const settings = globalThis.game?.settings;
  if (!settings?.settings?.has(`core.${setting}`)) return 1;
  const value = settings.get("core", setting);
  if ((typeof value !== "number") || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/**
 * Playlist channel, matching PlaylistSound#context with a blank-string fallback.
 * @param {{channel?: string, parent?: {channel?: string} | null}} sound
 * @returns {"music" | "environment" | "interface"}
 */
export function soundChannel(sound) {
  const channel = (sound?.channel || sound?.parent?.channel) ?? "music";
  if ((channel === "music") || (channel === "environment") || (channel === "interface")) return channel;
  return "music";
}

/**
 * YouTube setVolume units. sound.volume and the channel slider are both 0-1.
 * @param {number} localVolume
 * @param {string} channel
 * @returns {number}
 */
export function youtubePercent(localVolume, channel) {
  const local = (typeof localVolume === "number" && Number.isFinite(localVolume)) ? localVolume : 0;
  const setting = CHANNEL_SETTINGS[channel] ?? CHANNEL_SETTINGS.music;
  const scaled = Math.min(1, Math.max(0, local)) * coreVolume(setting);
  return Math.min(100, Math.max(0, Math.round(scaled * 100)));
}

/**
 * Chat playback follows the playlist slider alone.
 * @returns {number}
 */
export function chatYouTubeVolume() {
  return Math.min(100, Math.max(0, Math.round(coreVolume("globalPlaylistVolume") * 100)));
}
