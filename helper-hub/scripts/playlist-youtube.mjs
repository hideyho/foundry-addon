import {
  parseYouTubeUrl,
  readDraggedUrl,
  soundChannel,
  youtubeEmbedURL,
  youtubePercent,
  youtubeTitle
} from "./media-urls.mjs";

const MODULE_ID = "helper-hub";
const SILENCE_PATH = "modules/helper-hub/assets/silence.ogg";
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * @typedef {object} PlaylistYouTubeEntry
 * @property {string} videoId
 * @property {number | null} start
 * @property {number} generation
 * @property {boolean} closed
 * @property {boolean} advanced
 * @property {string} frameId
 * @property {HTMLIFrameElement | null} iframe
 * @property {YT.Player | null} player
 * @property {string} playlistId
 * @property {string} soundId
 */

/** @type {Map<string, PlaylistYouTubeEntry>} */
const players = new Map();

/**
 * Right-click a playlist header to paste a YouTube URL.
 */
export function registerPlaylistYouTubeMenu() {
  Hooks.on("getPlaylistContextOptions", (_app, entries) => {
    entries.push({
      label: "HELPERHUB.PlaylistYouTube",
      icon: "fa-brands fa-youtube",
      visible: header => canEditPlaylist(playlistFromHeader(header)),
      onClick: (_event, header) => promptYouTubeTrack(playlistFromHeader(header))
    });
  });
}

/**
 * Skip the core Sound for tracks flagged as YouTube. Silence.ogg only satisfies the path field.
 * @param {Function} wrapped
 * @this {PlaylistSound}
 */
export function syncPlaylistSound(wrapped) {
  const track = youtubeTrack(this);
  if (!track) return wrapped();
  releaseCoreSound(this);
  syncYouTube(this, track);
}

/**
 * A YouTube URL dropped on a playlist becomes a track. Document drags keep the core handler.
 * @param {Function} wrapped
 * @param {DragEvent} event
 * @this {PlaylistDirectory}
 */
export function onPlaylistDrop(wrapped, event) {
  const dragged = readDraggedUrl(event?.dataTransfer);
  if (dragged.kind !== "url") return wrapped(event);
  const playlist = playlistFromEvent(event);
  if (!playlist) return wrapped(event);
  const video = parseYouTubeUrl(dragged.url);
  if (!video) {
    ui.notifications.warn(game.i18n.localize("HELPERHUB.PlaylistNotYouTube"));
    return;
  }
  return createYouTubeSound(playlist, video);
}

/**
 * The channel sliders do not call sync, so apply them onto players that are already running.
 * @param {string} [channel] Only this channel uses the hook volume. Other players keep their own slider.
 * @param {number} [volume] Live gain from the matching global volume hook.
 */
export function refreshPlaylistYouTubeVolumes(channel, volume) {
  for (const entry of players.values()) {
    if (entry.closed || !entry.player) continue;
    const sound = game.playlists.get(entry.playlistId)?.sounds.get(entry.soundId);
    if (!sound) continue;
    if (channel && (soundChannel(sound) !== channel)) continue;
    applyVolume(sound, entry.player, volume);
  }
}

/**
 * @param {Playlist | null} playlist
 * @returns {Promise<void>}
 */
async function promptYouTubeTrack(playlist) {
  if (!playlist) return;
  if (!canEditPlaylist(playlist)) {
    ui.notifications.error(game.i18n.localize("HELPERHUB.PlaylistNoModify"));
    return;
  }

  let result;
  try {
    result = await foundry.applications.api.DialogV2.input({
      window: {title: "HELPERHUB.PlaylistYouTube"},
      content: youtubeDialogContent(),
      modal: true,
      rejectClose: false,
      ok: {label: "PLAYLIST.SoundAdd", icon: "fa-solid fa-check"}
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not open the YouTube playlist dialog.`, err);
    return;
  }
  if (!result) return;

  const raw = typeof result.url === "string" ? result.url.trim() : "";
  if (!raw) return;
  const video = parseYouTubeUrl(raw);
  if (!video) {
    ui.notifications.error(game.i18n.localize("HELPERHUB.PlaylistNotYouTube"));
    return;
  }
  await createYouTubeSound(playlist, video);
}

/**
 * The dialog content element itself cannot carry attributes. DialogV2 copies its innerHTML.
 * @returns {HTMLDivElement}
 */
function youtubeDialogContent() {
  const content = document.createElement("div");
  const group = document.createElement("div");
  group.className = "form-group";
  const label = document.createElement("label");
  label.textContent = game.i18n.localize("HELPERHUB.PlaylistYouTubeUrl");
  const input = document.createElement("input");
  input.type = "text";
  input.name = "url";
  input.placeholder = "https://www.youtube.com/watch?v=";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.autofocus = true;
  group.append(label, input);
  content.append(group);
  return content;
}

/**
 * @param {Playlist | null} playlist
 * @param {{id?: string, start?: number | null}} video
 * @returns {Promise<void>}
 */
async function createYouTubeSound(playlist, video) {
  const videoId = video?.id ?? "";
  if (!playlist || !YOUTUBE_ID.test(videoId)) return;
  if (!canEditPlaylist(playlist)) {
    ui.notifications.error(game.i18n.localize("HELPERHUB.PlaylistNoModify"));
    return;
  }

  /** @type {{id: string, start?: number}} */
  const flag = {id: videoId};
  if ((typeof video.start === "number") && Number.isFinite(video.start) && (video.start >= 0)) {
    flag.start = Math.floor(video.start);
  }

  const name = await youtubeTitle(videoId);
  ui.playlists?._expanded?.add(playlist.id);
  try {
    await playlist.createEmbeddedDocuments("PlaylistSound", [{
      name,
      path: SILENCE_PATH,
      repeat: false,
      volume: 0.5,
      flags: {[MODULE_ID]: {youtube: flag}}
    }]);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not add a YouTube playlist track.`, err);
    if (err instanceof Error && err.message) ui.notifications.error(err.message);
  }
}

/**
 * @param {Playlist | null | undefined} playlist
 * @returns {boolean}
 */
function canEditPlaylist(playlist) {
  try {
    return !!playlist?.canUserModify(game.user, "update");
  } catch {
    return false;
  }
}

/**
 * String flags from 1.0.1 are a bare video id. Newer tracks store {id, start}.
 * @param {PlaylistSound} sound
 * @returns {{id: string, start: number | null} | null}
 */
function youtubeTrack(sound) {
  const flag = sound?.getFlag?.(MODULE_ID, "youtube");
  if (typeof flag === "string") return YOUTUBE_ID.test(flag) ? {id: flag, start: null} : null;
  if (!flag || (typeof flag !== "object")) return null;
  const id = flag.id;
  if ((typeof id !== "string") || !YOUTUBE_ID.test(id)) return null;
  const start = (typeof flag.start === "number" && Number.isFinite(flag.start) && (flag.start >= 0))
    ? flag.start
    : null;
  return {id, start};
}

/**
 * Channel changes call _createSound before sync. Drop that Sound so silence.ogg never plays.
 * @param {PlaylistSound} sound
 */
function releaseCoreSound(sound) {
  const coreSound = sound.sound;
  if (!coreSound) return;
  try {
    coreSound.stop();
  } catch {
    // The placeholder was not playing.
  }
  sound.sound = null;
}

/**
 * @param {PlaylistSound} sound
 * @param {{id: string, start: number | null}} track
 */
function syncYouTube(sound, track) {
  const key = playerKey(sound);
  if (!sound.playing) {
    destroyPlayer(key);
    return;
  }

  const existing = players.get(key);
  if (existing && !existing.closed && (existing.videoId === track.id) && (existing.start === track.start)) {
    if (existing.player) applyPlayer(sound, existing.player);
    return;
  }

  destroyPlayer(key);
  /** @type {PlaylistYouTubeEntry} */
  const entry = {
    videoId: track.id,
    start: track.start,
    generation: (existing?.generation ?? 0) + 1,
    closed: false,
    advanced: false,
    frameId: "",
    iframe: null,
    player: null,
    playlistId: sound.parent?.id ?? "",
    soundId: sound.id
  };
  players.set(key, entry);
  void mountPlayer(entry);
}

/**
 * @param {PlaylistYouTubeEntry} entry
 * @returns {Promise<void>}
 */
async function mountPlayer(entry) {
  const key = `${entry.playlistId}:${entry.soundId}`;
  const watch = `https://www.youtube.com/watch?v=${entry.videoId}`;
  const src = youtubeEmbedURL(watch, entry.videoId, entry.start, {autoplay: true});
  if (!src) {
    destroyPlayer(key);
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.id = `helper-hub-pl-${entry.soundId}-${entry.generation}`;
  iframe.className = "helper-hub-playlist-youtube";
  iframe.setAttribute("src", src);
  iframe.setAttribute("allow", "autoplay; encrypted-media");
  iframe.setAttribute("title", "YouTube");
  iframe.setAttribute("aria-hidden", "true");
  entry.frameId = iframe.id;
  entry.iframe = iframe;
  document.body.append(iframe);
  if (entry.closed) {
    removeFrame(entry);
    return;
  }

  try {
    const player = await game.video.getYouTubePlayer(iframe.id, {
      events: {
        onStateChange: event => onPlaylistState(entry, event)
      }
    });
    if (entry.closed || (players.get(key) !== entry)) {
      try { player.pauseVideo(); } catch { /* already gone */ }
      removeFrame(entry);
      return;
    }
    entry.player = player;
    const sound = game.playlists.get(entry.playlistId)?.sounds.get(entry.soundId);
    if (!sound?.playing || (youtubeTrack(sound)?.id !== entry.videoId)) {
      destroyPlayer(key);
      return;
    }
    applyPlayer(sound, player);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not start a playlist YouTube player.`, err);
    if (players.get(key) === entry) destroyPlayer(key);
  }
}

/**
 * @param {PlaylistYouTubeEntry} entry
 * @param {{data?: number}} event
 */
function onPlaylistState(entry, event) {
  if (entry.closed || entry.advanced) return;
  if ((typeof YT === "undefined") || (event?.data !== YT.PlayerState.ENDED)) return;

  const sound = game.playlists.get(entry.playlistId)?.sounds.get(entry.soundId);
  if (!sound || (youtubeTrack(sound)?.id !== entry.videoId)) return;
  if (sound.repeat) {
    try { entry.player?.playVideo(); } catch { /* the player was removed */ }
    return;
  }
  if (!sound.parent?.isOwner) return;

  entry.advanced = true;
  try {
    const advanced = sound.parent._onSoundEnd(sound);
    void advanced?.catch?.(err => {
      entry.advanced = false;
      console.warn(`${MODULE_ID} | Could not advance the playlist.`, err);
    });
  } catch (err) {
    entry.advanced = false;
    console.warn(`${MODULE_ID} | Could not advance the playlist.`, err);
  }
}

/**
 * @param {PlaylistSound} sound
 * @param {YT.Player} player
 */
function applyPlayer(sound, player) {
  applyVolume(sound, player);
  if (typeof player.setLoop === "function") {
    try { player.setLoop(!!sound.repeat); } catch { /* no setLoop on this player */ }
  }

  let state = -1;
  try {
    if (typeof player.getPlayerState === "function") state = player.getPlayerState();
  } catch {
    state = -1;
  }
  const api = typeof YT !== "undefined" ? YT.PlayerState : null;
  if (api && ((state === api.PLAYING) || (state === api.BUFFERING))) return;
  try { player.playVideo(); } catch { /* autoplay can be blocked */ }
}

/**
 * @param {PlaylistSound} sound
 * @param {YT.Player} player
 * @param {number} [override]
 */
function applyVolume(sound, player, override) {
  try {
    player.setVolume(youtubePercent(sound.volume, soundChannel(sound), override));
  } catch {
    // Volume can be set once the player is ready.
  }
}

/**
 * @param {string} key
 */
function destroyPlayer(key) {
  const entry = players.get(key);
  if (!entry) return;
  entry.closed = true;
  players.delete(key);
  try {
    if (typeof entry.player?.pauseVideo === "function") entry.player.pauseVideo();
    else entry.player?.stopVideo?.();
  } catch {
    // The iframe API was already torn down.
  }
  removeFrame(entry);
}

/**
 * @param {PlaylistYouTubeEntry} entry
 */
function removeFrame(entry) {
  entry.iframe?.remove();
  if (entry.frameId) document.getElementById(entry.frameId)?.remove();
  entry.iframe = null;
  entry.player = null;
}

/**
 * @param {PlaylistSound} sound
 * @returns {string}
 */
function playerKey(sound) {
  return `${sound.parent?.id ?? ""}:${sound.id}`;
}

/**
 * @param {EventTarget | null | undefined} header
 * @returns {Playlist | null}
 */
function playlistFromHeader(header) {
  const element = header instanceof Element ? header : null;
  const id = element?.closest("[data-entry-id]")?.dataset.entryId;
  return id ? (game.playlists.get(id) ?? null) : null;
}

/**
 * @param {DragEvent} event
 * @returns {Playlist | null}
 */
function playlistFromEvent(event) {
  const target = event?.target;
  const element = target instanceof Element ? target : target?.parentElement;
  const row = element?.closest?.(".playlist, [data-entry-id]");
  const id = row?.dataset?.entryId;
  return id ? (game.playlists.get(id) ?? null) : null;
}
