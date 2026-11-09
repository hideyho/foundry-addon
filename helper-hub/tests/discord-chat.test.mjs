/**
 * Discord mirror rules and escaped chat HTML. Run with node; Foundry is not required.
 * node helper-hub/tests/discord-chat.test.mjs
 */
import assert from "node:assert/strict";
import {
  discordAcceptsMessages,
  discordCdnHref,
  discordChannelIdToSave,
  discordChannelsAfterEvent,
  discordCloseAction,
  discordDialogPhase,
  fatalTokenAfterConnect,
  guildCreateAnswerId,
  discordMediaRequest,
  discordMessageContent,
  isDiscordCdnHost,
  isDiscordMirrorMediaType,
  shouldForgetDiscordGuild,
  shouldMirrorDiscordMessage
} from "../scripts/discord-chat.mjs";

class TestElement {
  /**
   * @param {string} tag
   */
  constructor(tag) {
    this.tagName = tag;
    /** @type {Map<string, string>} */
    this.attrs = new Map();
    /** @type {Array<TestElement | string>} */
    this.nodes = [];
    /** @type {string | null} */
    this.rawHtml = null;
  }

  /**
   * @param {string} value
   */
  set className(value) {
    this.setAttribute("class", value);
  }

  /**
   * @returns {string}
   */
  get className() {
    return this.attrs.get("class") ?? "";
  }

  /**
   * @param {string} value
   */
  set textContent(value) {
    this.rawHtml = null;
    this.nodes = [String(value)];
  }

  /**
   * @returns {string}
   */
  get textContent() {
    return this.nodes.map(node => (typeof node === "string") ? node : node.textContent).join("");
  }

  /**
   * @returns {Array<TestElement | string>}
   */
  get childNodes() {
    return this.nodes;
  }

  /**
   * @param {string} value
   */
  set innerHTML(value) {
    this.nodes = [];
    this.rawHtml = String(value);
  }

  /**
   * @param {string} name
   * @param {string} value
   */
  setAttribute(name, value) {
    this.rawHtml = null;
    this.attrs.set(String(name), String(value));
  }

  /**
   * @param {...(TestElement | string)} items
   */
  append(...items) {
    this.rawHtml = null;
    for (const item of items) this.nodes.push(item);
  }

  /**
   * @returns {string}
   */
  get outerHTML() {
    if (this.rawHtml !== null) return this.rawHtml;
    const attrs = [...this.attrs].map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join("");
    const inner = this.nodes.map(serialize).join("");
    return `<${this.tagName}${attrs}>${inner}</${this.tagName}>`;
  }
}

installDocument();

assert.equal(typeof globalThis.game, "undefined");
assert.equal(typeof globalThis.Hooks, "undefined");
assert.equal(typeof globalThis.PIXI, "undefined");
assert.equal(typeof globalThis.canvas, "undefined");

const channel = {ready: true, channelId: "channel-1", botUserId: "bot-1"};

assert.equal(shouldMirrorDiscordMessage({
  id: "m1",
  channel_id: "channel-2",
  author: {id: "user-1", username: "Ada"}
}, channel), false, "another channel is rejected");

assert.equal(shouldMirrorDiscordMessage({
  id: "m1",
  channel_id: "channel-1",
  author: {id: "user-1", username: "Ada"}
}, {...channel, ready: false}), false, "a message before ready is rejected");

assert.equal(shouldMirrorDiscordMessage({
  id: "m1",
  channel_id: "channel-1",
  author: {id: "bot-1", username: "Helper"}
}, channel), false, "a message from the bot is rejected");

assert.equal(shouldMirrorDiscordMessage({
  id: "m1",
  channel_id: "channel-1",
  content: "hello",
  webhook_id: "hook-1",
  author: {id: "user-1", username: "Ada"}
}, channel), true, "a matching user message after ready is accepted");

assert.equal(shouldMirrorDiscordMessage({
  id: "m1",
  channel_id: "channel-1",
  content: "",
  attachments: [],
  embeds: [],
  author: {id: "user-1", username: "Ada"}
}, channel), false, "an empty message is not posted");

assert.equal(shouldMirrorDiscordMessage({
  id: "m-file",
  channel_id: "channel-1",
  content: "",
  attachments: [{filename: "cat.png", url: "https://cdn.discordapp.com/attachments/1/2/cat.png"}],
  author: {id: "user-1", username: "Ada"}
}, channel), true, "an attachment with no text is posted");

assert.equal(shouldMirrorDiscordMessage({
  id: "m-embed",
  channel_id: "channel-1",
  content: " ",
  embeds: [{description: "caption"}],
  author: {id: "user-1", username: "Ada"}
}, channel), true, "an embed with no text is posted");

assert.equal(shouldMirrorDiscordMessage({
  id: "m1",
  channel_id: "channel-1",
  author: {id: "user-1", username: "Ada"}
}, {...channel, seen: new Set(["m1"])}), false, "a Discord id already posted this session is rejected");

const hostile = discordMessageContent({
  content: `<script>alert(1)</script>"><img src=x onerror=alert(1)>`
});
assert.equal(/<script/i.test(hostile), false, "script markup is not a tag");
assert.equal(/<img/i.test(hostile), false, "an attribute breakout is not an img tag");
assert.equal(/<[^>]*\sonerror\s*=/i.test(hostile), false, "onerror is not an attribute");
assert.equal(hostile.includes("&lt;script"), true, "script text is escaped");
assert.equal(hostile.includes("&lt;img"), true, "img breakout text is escaped");

const image = discordMessageContent({
  attachments: [{
    filename: "cat.png",
    content_type: "image/png",
    url: "https://cdn.example/cat.png"
  }]
});
assert.match(image, /<img\b[^>]*\bsrc="https:\/\/cdn\.example\/cat\.png"/, "an image attachment becomes an img");

const stored = discordMessageContent({
  attachments: [{
    filename: "cat.png",
    content_type: "image/png",
    url: "modules/helper-hub/storage/chat/abc-cat.png"
  }]
});
assert.match(stored, /<img\b[^>]*\bsrc="modules\/helper-hub\/storage\/chat\/abc-cat\.png"/, "a stored file path can be the img src");

const file = discordMessageContent({
  attachments: [{
    filename: "notes.txt",
    content_type: "text/plain",
    url: "https://cdn.example/notes.txt"
  }]
});
assert.match(file, /<a\b[^>]*\bhref="https:\/\/cdn\.example\/notes\.txt"[^>]*>notes\.txt<\/a>/);
assert.equal(/<img\b/i.test(file), false, "a non-image file is not an img");

const video = discordMessageContent({
  attachments: [{
    filename: "clip.mp4",
    content_type: "video/mp4",
    url: "https://cdn.example/clip.mp4"
  }]
});
assert.match(video, /<video\b[^>]*\bcontrols(?:="[^"]*")?[^>]*\bsrc="https:\/\/cdn\.example\/clip\.mp4"/);
assert.equal(/<img\b/i.test(video), false);

const scriptUrl = discordMessageContent({
  content: "javascript:alert(1) and https://cdn.example/ok",
  attachments: [{
    filename: "evil.png",
    content_type: "image/png",
    url: "javascript:alert(1)"
  }],
  embeds: [{
    title: "javascript:alert(2)",
    image: {url: "javascript:alert(3)"},
    video: {url: "javascript:alert(4)"}
  }]
});
assert.equal(/\s(?:href|src)\s*=\s*["']javascript:/i.test(scriptUrl), false, "a javascript URL is not an href or src");
assert.equal(/<img\b/i.test(scriptUrl), false);
assert.equal(/<video\b/i.test(scriptUrl), false);
assert.match(scriptUrl, /<a\b[^>]*\bhref="https:\/\/cdn\.example\/ok"/, "an https URL in the text becomes a link");

const httpOnly = discordMessageContent({
  content: "see http://cdn.example/a",
  attachments: [{
    filename: "a.png",
    content_type: "image/png",
    url: "http://cdn.example/a.png"
  }]
});
assert.equal(/\s(?:href|src)\s*=\s*["']http:/i.test(httpOnly), false, "an http URL is not an href or src");

const embedLink = discordMessageContent({
  embeds: [{
    title: "see https://cdn.example/title",
    description: "and https://cdn.example/body <script>"
  }]
});
assert.match(embedLink, /<a\b[^>]*\bhref="https:\/\/cdn\.example\/title"/, "an embed title URL becomes a link");
assert.match(embedLink, /<a\b[^>]*\bhref="https:\/\/cdn\.example\/body"/, "an embed description URL becomes a link");
assert.equal(/<script/i.test(embedLink), false, "embed text does not become a tag");

assert.equal(isDiscordCdnHost("cdn.discordapp.com"), true, "cdn.discordapp.com is a Discord CDN host");
assert.equal(isDiscordCdnHost("media.discordapp.net"), true, "media.discordapp.net is a Discord CDN host");
assert.equal(isDiscordCdnHost("CDN.DISCORDAPP.COM"), true, "the CDN host check ignores case");
assert.equal(isDiscordCdnHost("cdn.discordapp.com.evil.test"), false, "a lookalike host is not the CDN");
assert.equal(isDiscordCdnHost("files.example"), false);

const cdnFile = "https://cdn.discordapp.com/attachments/1/2/cat.png";
const cdnRequest = discordMediaRequest(cdnFile);
assert.equal(discordCdnHref(cdnFile), cdnFile);
assert.equal(cdnRequest?.credentials, "omit");
assert.equal(cdnRequest?.redirect, "error");
assert.equal(discordMediaRequest("https://media.discordapp.net/attachments/1/2/cat.png")?.href.startsWith("https://media.discordapp.net/"), true);

assert.equal(discordMediaRequest("https://evil.example/cat.png"), null, "a non-CDN URL is not fetched");
assert.equal(discordMediaRequest("http://cdn.discordapp.com/cat.png"), null, "an http CDN URL is not fetched");
assert.equal(discordCdnHref("javascript:alert(1)"), null, "a javascript URL is still rejected");
assert.equal(discordMediaRequest("javascript:alert(1)"), null, "a javascript URL is not fetched");

assert.equal(isDiscordMirrorMediaType("image/png"), true);
assert.equal(isDiscordMirrorMediaType("video/mp4"), true);
assert.equal(isDiscordMirrorMediaType("audio/ogg"), true);
assert.equal(isDiscordMirrorMediaType("text/html"), false, "HTML is not uploaded");
assert.equal(isDiscordMirrorMediaType("text/html; charset=utf-8"), false);
assert.equal(isDiscordMirrorMediaType("application/octet-stream"), false);

const guilds = new Map([["guild-1", {id: "guild-1", name: "Server"}]]);
const outage = {id: "guild-1", unavailable: true};
if (shouldForgetDiscordGuild(outage)) guilds.delete(outage.id);
assert.equal(guilds.has("guild-1"), true, "GUILD_DELETE with unavailable: true does not remove the guild");
assert.equal(shouldForgetDiscordGuild({id: "guild-1", unavailable: false}), true, "a real departure removes the guild");
assert.equal(shouldForgetDiscordGuild({id: "guild-1"}), true);

assert.equal(guildCreateAnswerId({id: "guild-down", unavailable: true}), "guild-down", "an unavailable create answers that pending guild");
assert.equal(guildCreateAnswerId({id: "guild-up", unavailable: false}), "guild-up");
assert.equal(guildCreateAnswerId({id: "guild-up"}), "guild-up");
assert.equal(guildCreateAnswerId({unavailable: true}), "");
assert.equal(guildCreateAnswerId({id: ""}), "");
assert.equal(guildCreateAnswerId(null), "");
const pendingGuilds = new Set(["guild-down", "guild-up"]);
const answeredGuild = guildCreateAnswerId({id: "guild-down", unavailable: true});
if (answeredGuild) pendingGuilds.delete(answeredGuild);
assert.equal(pendingGuilds.has("guild-down"), false, "an unavailable create leaves the pending set");
assert.equal(pendingGuilds.has("guild-up"), true);

assert.equal(fatalTokenAfterConnect("saved-token", "saved-token", true), "", "force clears a refusal of the token being connected");
assert.equal(fatalTokenAfterConnect("saved-token", "typed-token", true), "saved-token", "force leaves a refusal of a different token");
assert.equal(fatalTokenAfterConnect("saved-token", "saved-token", false), "saved-token", "without force the refusal stays");
assert.equal(fatalTokenAfterConnect("", "typed-token", true), "");

assert.equal(discordAcceptsMessages("RESUME"), false, "Resume does not set accept");
assert.equal(discordAcceptsMessages("IDENTIFY"), false);
assert.equal(discordAcceptsMessages("READY"), true, "READY accepts messages");
assert.equal(discordAcceptsMessages("RESUMED"), true, "RESUMED accepts messages");

assert.equal(discordCloseAction(4004), "stop");
assert.equal(discordCloseAction(4010), "stop");
assert.equal(discordCloseAction(4013), "stop");
assert.equal(discordCloseAction(4014), "stop");
assert.equal(discordCloseAction(4007), "identify");
assert.equal(discordCloseAction(4009), "identify");
assert.equal(discordCloseAction(1000), "retry");
assert.equal(discordCloseAction(4000), "retry");

assert.equal(discordDialogPhase({token: ""}), "idle", "an empty token is idle");
assert.equal(discordDialogPhase({}), "idle");
assert.equal(discordDialogPhase(null), "idle");
assert.equal(discordDialogPhase({
  token: "typed-token",
  socketToken: "",
  guildsSettled: false,
  fatalToken: ""
}), "idle", "a token that is not on the socket yet is idle");
assert.equal(discordDialogPhase({
  token: "typed-token",
  socketToken: "saved-token",
  guildsSettled: true,
  fatalToken: ""
}), "idle", "a token that is not the socket token is idle");
assert.equal(discordDialogPhase({
  token: "bot-token",
  socketToken: "bot-token",
  guildsSettled: false,
  fatalToken: ""
}), "connecting", "this token's socket has not settled the guild list");
assert.equal(discordDialogPhase({
  token: "bot-token",
  socketToken: "bot-token",
  guildsSettled: true,
  fatalToken: ""
}), "ready", "a settled guild list for this token is ready");
assert.equal(discordDialogPhase({
  token: "bot-token",
  socketToken: "bot-token",
  guildsSettled: false,
  fatalToken: "bot-token"
}), "refused", "a fatal refusal for this token is refused");
assert.equal(discordDialogPhase({
  token: "bot-token",
  socketToken: "bot-token",
  guildsSettled: true,
  fatalToken: "bot-token"
}), "refused", "a fatal refusal wins over a settled list");
assert.equal(discordDialogPhase({
  token: "other-token",
  socketToken: "bot-token",
  guildsSettled: false,
  fatalToken: "bot-token"
}), "idle", "a refusal for another token leaves the typed token idle");

assert.equal(discordChannelIdToSave({
  selectValue: "",
  savedChannelId: "channel-9",
  guildListReady: false
}), "channel-9", "a placeholder before the guild list loads keeps the saved channel");
assert.equal(discordChannelIdToSave({
  selectValue: "",
  savedChannelId: "channel-9",
  guildListReady: true
}), "", "a placeholder on a loaded list clears the channel");
assert.equal(discordChannelIdToSave({
  selectValue: "channel-2",
  savedChannelId: "channel-9",
  guildListReady: false
}), "channel-2", "a chosen channel is saved even while other guilds are still loading");

const textChannels = [
  {id: "general", name: "general", position: 1},
  {id: "news", name: "news", position: 0}
];
const withCreated = discordChannelsAfterEvent(textChannels, "CHANNEL_CREATE", {
  id: "announcements",
  name: "announcements",
  type: 5,
  position: 2
});
assert.deepEqual(withCreated.map(channel => channel.id), ["news", "general", "announcements"]);
const ignoredVoice = discordChannelsAfterEvent(textChannels, "CHANNEL_CREATE", {
  id: "voice",
  name: "voice",
  type: 2,
  position: 0
});
assert.deepEqual(ignoredVoice.map(channel => channel.id), ["general", "news"]);
const renamed = discordChannelsAfterEvent(textChannels, "CHANNEL_UPDATE", {
  id: "general",
  name: "lobby",
  type: 0,
  position: 1
});
assert.equal(renamed.find(channel => channel.id === "general")?.name, "lobby");
const demoted = discordChannelsAfterEvent(textChannels, "CHANNEL_UPDATE", {
  id: "general",
  name: "general",
  type: 2,
  position: 1
});
assert.equal(demoted.some(channel => channel.id === "general"), false, "a channel that leaves text types is removed");
const removed = discordChannelsAfterEvent(textChannels, "CHANNEL_DELETE", {id: "news", type: 0});
assert.equal(removed.some(channel => channel.id === "news"), false);

console.log("discord-chat: mirror rules and escaped content passed");

/**
 * A small document that escapes text and attributes the way the chat builder relies on.
 * Assigning innerHTML stores raw markup so a concatenated Discord string fails the escape checks.
 */
function installDocument() {
  globalThis.document = {
    createElement(tag) {
      return new TestElement(String(tag).toLowerCase());
    }
  };
}

/**
 * @param {TestElement | string} node
 * @returns {string}
 */
function serialize(node) {
  if (typeof node === "string") return escapeText(node);
  return node.outerHTML;
}

/**
 * @param {string} value
 */
function escapeText(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * @param {string} value
 */
function escapeAttr(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}
