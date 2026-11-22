import { renderTokenPng } from "./token-png.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const STATE_SECONDS = 600;
const TICKET_SECONDS = 900;
const standardHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const cleanId = (s) => typeof s === "string" && /^[A-Za-z0-9_:.@-]{1,128}$/.test(s);
const snowflake = (s) => typeof s === "string" && /^[0-9]{16,22}$/.test(s);

function base64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function fromBase64(value) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
async function digest(value) {
  return base64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
async function importKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function seal(key, payload) {
  const body = base64(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return body + "." + base64(new Uint8Array(signature));
}
async function unseal(key, token, kind, now) {
  if (typeof token !== "string" || !/^[\w-]{1,4000}\.[\w-]{43}$/.test(token)) return;
  try {
    const [body, signature] = token.split(".");
    if (!await crypto.subtle.verify("HMAC", key, fromBase64(signature), encoder.encode(body))) return;
    const payload = JSON.parse(decoder.decode(fromBase64(body)));
    if (payload.kind === kind && payload.exp > now) return payload;
  } catch {
    return;
  }
}
function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...standardHeaders, ...headers } });
}
function readCookie(request, name) {
  return request.headers.get("Cookie")?.split(/;\s*/)
    .find((part) => part.startsWith(name + "="))?.slice(name.length + 1);
}
function setCookie(name, value, seconds) {
  return name + "=" + value + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=" + seconds;
}
function roomTarget(value) {
  try {
    const target = new URL(value);
    if (["https://www.owlbear.rodeo", "https://owlbear.rodeo"].includes(target.origin) && /^\/room\/[\w-]+(?:\/[^/]+)?\/?$/.test(target.pathname) &&
        !target.search && !target.hash && !target.username && !target.password) return target.href;
  } catch {}
}
async function registerJoinCommand(env, fetchDiscord) {
  const access = await fetchDiscord("https://discord.com/api/v10/oauth2/token", {
    method:"POST", redirect:"manual", signal:AbortSignal.timeout(10000),
    body:new URLSearchParams({
      client_id:env.DISCORD_CLIENT_ID, client_secret:env.DISCORD_CLIENT_SECRET,
      grant_type:"client_credentials", scope:"applications.commands.update",
    }),
  });
  if (!access.ok) throw Error("Discord command token request returned " + access.status);
  const {access_token} = await access.json();
  if (typeof access_token !== "string" || !access_token) throw Error("Discord did not issue a command token.");
  const endpoint = "https://discord.com/api/v10/applications/" + env.DISCORD_CLIENT_ID +
    "/guilds/" + env.DISCORD_GUILD_ID + "/commands";
  const registered = await fetchDiscord(endpoint, {
    method:"POST", redirect:"manual", signal:AbortSignal.timeout(10000),
    headers:{Authorization:"Bearer " + access_token, "Content-Type":"application/json"},
    body:JSON.stringify({type:1, name:"join", description:"Open the linked Owlbear room"}),
  });
  if (!registered.ok) throw Error("Discord guild command registration returned " + registered.status);
  console.info("Registered the Discord /join guild command.");
}
async function discordInteraction(request, env, key, now, register) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const validHex = (s, length) => typeof s === "string" && s.length === length && /^[\da-f]+$/i.test(s);
  if (!validHex(signature, 128) || !validHex(env.DISCORD_PUBLIC_KEY, 64) ||
      !/^\d+$/.test(timestamp ?? "") || Math.abs(now - Number(timestamp)) > 300) return json({}, 401);
  const bytes = (value) => Uint8Array.from(value.match(/../g), (pair) => parseInt(pair, 16));
  const raw = await request.text();
  const publicKey = await crypto.subtle.importKey("raw", bytes(env.DISCORD_PUBLIC_KEY), "Ed25519", false, ["verify"]);
  if (!await crypto.subtle.verify("Ed25519", publicKey, bytes(signature), encoder.encode(timestamp + raw))) return json({}, 401);
  let event;
  try { event = JSON.parse(raw); } catch { return json({}, 400); }
  if (event.type === 1) {
    register?.();
    return json({type:1});
  }
  const reply = (content) => json({type:4, data:{content, flags:64, allowed_mentions:{parse:[]}}});
  if (event.type !== 2 || event.data?.name !== "join" || event.guild_id !== env.DISCORD_GUILD_ID ||
      event.channel_id !== env.DISCORD_CHANNEL_ID) return reply("Use /join in the configured Owlbear channel.");
  const user = event.member?.user;
  if (!snowflake(user?.id) || !roomTarget(env.OWLBEAR_JOIN_URL)) return reply("This channel’s Owlbear room is not configured.");
  const link = await seal(key, {kind:"join", user:user.id, channel:event.channel_id, exp:now+600});
  return reply("Open your Owlbear room and connect Discord: <" + env.PUBLIC_ORIGIN + "/oauth/join?ticket=" + link + ">");
}
function callbackPage(ticket, cookie, frontend) {
  const contents = ticket
    ? '<p>Discord is linked. Return to Owlbear to finish creating your token. If Owlbear is still waiting, copy this code into the extension.</p><textarea readonly rows="3" aria-label="sign-in code" data-opener-origin="' + frontend + '">' + ticket +
      '</textarea><div class="actions"><button id="return" hidden>close this tab</button><button id="copy">copy sign-in code</button></div><p id="feedback" role="status"></p><script src="/callback.js" defer></script>'
    : '<p>Sign-in ended or expired. Return to Owlbear and try again.</p>';
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Discord Arrivals</title><link rel="stylesheet" href="/style.css"><h1>discord arrivals</h1>' + contents + '</html>', {
    headers: {
      ...standardHeaders, "Content-Type":"text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
    status: ticket ? 200 : 400,
  });
}

function avatarUrl(user) {
  if (typeof user.avatar === "string" && /^(?:a_)?[0-9a-f]{32}$/.test(user.avatar)) {
    return "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar + ".png?size=256";
  }
  const i = /^[1-9]\d{3}$/.test(user.discriminator)
    ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n);
  return "https://cdn.discordapp.com/embed/avatars/" + i + ".png";
}

const avatarPath = /^(?:\/avatars\/\d{16,22}\/(?:a_)?[0-9a-f]{32}|\/embed\/avatars\/[0-5])\.png$/;
const legacyTokenPrefix = "/token/v1";
const tokenPrefix = "/token/v2";

function mac(key, value) {
  return crypto.subtle.sign("HMAC", key, encoder.encode(value));
}

async function encryptionKey(key, purpose) {
  return crypto.subtle.importKey("raw", await mac(key, purpose), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(key, purpose, value, binding = "") {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const algorithm = {name:"AES-GCM", iv, additionalData:encoder.encode(binding)};
  const encrypted = await crypto.subtle.encrypt(algorithm, await encryptionKey(key, purpose), encoder.encode(JSON.stringify(value)));
  return base64(new Uint8Array([...iv, ...new Uint8Array(encrypted)]));
}

async function decrypt(key, purpose, value, binding = "") {
  if (typeof value !== "string" || !/^[\w-]{40,4000}$/.test(value)) return;
  try {
    const bytes = fromBase64(value);
    const algorithm = {name:"AES-GCM", iv:bytes.subarray(0,12), additionalData:encoder.encode(binding)};
    return JSON.parse(decoder.decode(await crypto.subtle.decrypt(algorithm, await encryptionKey(key, purpose), bytes.subarray(12))));
  } catch {}
}

async function avatarId(key, sourcePath) {
  return base64(new Uint8Array(await mac(key, "avatar-id:v2:" + sourcePath)));
}

function revoked(env, id) {
  return (env.AVATAR_REVOKED_IDS ?? "").split(/[\s,]+/).includes(id);
}

async function tokenUrl(key, origin, sourcePath) {
  const id = await avatarId(key, sourcePath);
  const locator = await encrypt(key, "avatar-link:v2", sourcePath, id);
  return new URL(tokenPrefix + "/" + id + "/" + locator + ".png", origin).href;
}

async function legacyPath(url, key) {
  if (!url.pathname.startsWith(legacyTokenPrefix + "/")) return;
  const sourcePath = url.pathname.slice(legacyTokenPrefix.length);
  if (!avatarPath.test(sourcePath)) return;
  const signature = url.searchParams.get("sig");
  if (sourcePath.startsWith("/embed/") ? url.search === "" :
    /^[\w-]{43}$/.test(signature ?? "") && url.search === "?sig=" + signature &&
    await crypto.subtle.verify("HMAC",key,fromBase64(signature),encoder.encode(url.pathname))) return sourcePath;
}

async function tokenImage(request, url, env, key, fetchDiscord, ctx) {
  if (request.method !== "GET") return json({},404);
  const opaque = /^\/token\/v2\/([\w-]{43})\/([\w-]{40,400})\.png$/.exec(url.pathname);
  let sourcePath;
  let id;
  if (opaque && !url.search) {
    [, id] = opaque;
    if (revoked(env, id)) return json({},404);
    sourcePath = await decrypt(key, "avatar-link:v2", opaque[2], id);
  } else {
    if (env.DISABLE_LEGACY_AVATAR_URLS === "true") return json({},404);
    sourcePath = await legacyPath(url, key);
    if (!sourcePath) return json({},404);
    id = await avatarId(key, sourcePath);
    if (revoked(env, id)) return json({},404);
  }
  if (typeof sourcePath !== "string" || !avatarPath.test(sourcePath)) return json({},404);
  const cacheKey = new URL("/internal-avatar-cache/" + id, url.origin).href;
  const uncached = (response) => {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control","private, no-store");
    return new Response(response.body,{headers});
  };
  const cache = globalThis.caches?.default;
  const cached = await cache?.match(cacheKey);
  if (cached) return uncached(cached);
  try {
    const source = new URL(sourcePath, "https://cdn.discordapp.com");
    source.searchParams.set("size","256");
    const avatar = await fetchDiscord(source.href,{redirect:"manual", signal:AbortSignal.timeout(7000)});
    if (!avatar.ok || !avatar.body) return json({},502);
    const png = new Response(await renderTokenPng(avatar.body),{headers:{
      ...standardHeaders, "Content-Type":"image/png", "Access-Control-Allow-Origin":"*",
      "Cache-Control":"public, max-age=86400, s-maxage=604800",
    }});
    if (cache && ctx) ctx.waitUntil(cache.put(cacheKey,png.clone()).catch(() => {}));
    return uncached(png);
  } catch {
    return json({error:"Discord avatar could not be rendered."},502);
  }
}

export function createWorker({ fetchDiscord = fetch, clock = Date.now } = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const activation = url.pathname === "/discord/interactions/register";
      const interaction = (url.pathname === "/discord/interactions" || activation) && request.method === "POST";
      const image = [legacyTokenPrefix, tokenPrefix].some((prefix) => url.pathname.startsWith(prefix + "/"));
      const migration = url.pathname === "/token/migrate";
      if (!image && !migration && !interaction && !url.pathname.startsWith("/oauth/")) return env.ASSETS.fetch(request);
      if (url.origin !== env.PUBLIC_ORIGIN || !snowflake(env.DISCORD_CLIENT_ID) ||
          !env.DISCORD_CLIENT_SECRET || (env.SIGNING_SECRET && env.SIGNING_SECRET.length < 32)) {
        return json({ error: "Server configuration is incomplete." }, 503);
      }
      const key = await importKey(env.SIGNING_SECRET ?? await digest("discord-arrivals/signing/v1:" + env.DISCORD_CLIENT_SECRET));
      if (image) return tokenImage(request,url,env,key,fetchDiscord,ctx);
      const now = Math.floor(clock() / 1000);
      if (interaction) return discordInteraction(request, env, key, now, activation && ctx ? () => {
        if (!snowflake(env.DISCORD_GUILD_ID)) return;
        ctx.waitUntil(registerJoinCommand(env, fetchDiscord).catch((error) => console.error(error.message)));
      } : undefined);
      const redirect = env.PUBLIC_ORIGIN + "/oauth/callback";
      const frontend = new URL(env.FRONTEND_ORIGIN || env.PUBLIC_ORIGIN).origin;
      async function claimFor(context, user) {
        const profile = base64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode("profile:" + context.room + ":" + user.id))));
        const privateProfile = {profile, name:user.name, sourcePath:new URL(user.avatar).pathname};
        const payload = await encrypt(key, "profile-claim:v2", privateProfile, JSON.stringify([context.room, context.player, context.connection]));
        return seal(key, {kind:"claim", ...context, payload, exp:now+TICKET_SECONDS});
      }
      if (["/oauth/start", "/oauth/join"].includes(url.pathname) && request.method === "GET") {
        let context;
        if (url.pathname === "/oauth/join") {
          const join = await unseal(key, url.searchParams.get("ticket"), "join", now);
          if (!join || join.channel !== env.DISCORD_CHANNEL_ID || !roomTarget(env.OWLBEAR_JOIN_URL)) return callbackPage();
          const session = await unseal(key, readCookie(request, "__Host-da-session"), "session", now);
          if (session?.user.id === join.user) return Response.redirect(roomTarget(env.OWLBEAR_JOIN_URL), 302);
          context = {joinUser:join.user, channel:join.channel};
        } else {
          const [room, player, connection] = ["room", "player", "connection"].map((name) => url.searchParams.get(name));
          if (![room, player, connection].every(cleanId)) return json({error:"Missing Owlbear context."}, 400);
          context = {room, player, connection};
          const session = await unseal(key, readCookie(request, "__Host-da-session"), "session", now);
          if (session && room === env.OWLBEAR_ROOM_ID) return callbackPage(await claimFor(context, session.user), undefined, frontend);
        }
        const nonce = base64(crypto.getRandomValues(new Uint8Array(18)));
        const cookie = base64(crypto.getRandomValues(new Uint8Array(24)));
        const state = await seal(key, {kind:"state", ...context, nonce, cookieHash:await digest(cookie), exp:now+STATE_SECONDS});
        const authorize = new URL("https://discord.com/oauth2/authorize");
        authorize.search = new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID, redirect_uri: redirect, response_type:"code", scope:"identify", state,
        });
        return new Response(null, {status:302, headers:{
          ...standardHeaders, Location:authorize.href,
          "Set-Cookie":setCookie("__Host-da-" + nonce, cookie, STATE_SECONDS),
        }});
      }
      if (url.pathname === "/oauth/callback" && request.method === "GET") {
        const state = await unseal(key, url.searchParams.get("state"), "state", now);
        if (!state) return callbackPage();
        const cookieName = "__Host-da-" + state.nonce;
        const cookie = readCookie(request, cookieName);
        const code = url.searchParams.get("code");
        const expired = setCookie(cookieName, "", 0);
        if (!cookie || await digest(cookie) !== state.cookieHash) return callbackPage();
        if (!code || code.length > 512) return callbackPage(undefined, expired);
        try {
          const response = await fetchDiscord("https://discord.com/api/v10/oauth2/token", {
            method:"POST", redirect:"manual", signal:AbortSignal.timeout(10000),
            body:new URLSearchParams({
              client_id:env.DISCORD_CLIENT_ID, client_secret:env.DISCORD_CLIENT_SECRET,
              grant_type:"authorization_code", code, redirect_uri:redirect,
            }),
          });
          if (!response.ok) return callbackPage(undefined, expired);
          const { access_token } = await response.json();
          if (typeof access_token !== "string" || !access_token) return callbackPage(undefined, expired);
          const who = await fetchDiscord("https://discord.com/api/v10/users/@me", {
            headers:{Authorization:"Bearer " + access_token}, redirect:"manual", signal:AbortSignal.timeout(10000),
          });
          if (!who.ok) return callbackPage(undefined, expired);
          const user = await who.json();
          if (!snowflake(user.id)) return callbackPage(undefined, expired);
          const name = String(user.global_name || user.username || "Player").replace(/\s+/gu, " ").trim().slice(0, 48) || "Player";
          const identity = {id:user.id, name, avatar:avatarUrl(user)};
          if (state.joinUser) {
            const target = roomTarget(env.OWLBEAR_JOIN_URL);
            if (!target || state.channel !== env.DISCORD_CHANNEL_ID || state.joinUser !== user.id) return callbackPage(undefined, expired);
            const session = await seal(key, {kind:"session", user:identity, exp:now+28800});
            const headers = new Headers({...standardHeaders, Location:target});
            headers.append("Set-Cookie", expired);
            headers.append("Set-Cookie", setCookie("__Host-da-session", session, 28800));
            return new Response(null, {status:302, headers});
          }
          const ticket = await claimFor({room:state.room, player:state.player, connection:state.connection}, identity);
          return callbackPage(ticket, expired, frontend);
        } catch {
          return callbackPage(undefined, expired);
        }
      }
      if ((migration || url.pathname === "/oauth/verify") && ["POST", "OPTIONS"].includes(request.method)) {
        const origin = request.headers.get("Origin");
        if (origin && origin !== frontend && origin !== url.origin) return json({error:"Invalid frontend origin."}, 403);
        const cors = origin ? {"Access-Control-Allow-Origin":origin, "Vary":"Origin"} : {};
        if (request.method === "OPTIONS") return new Response(null, {status:204, headers:{
          ...cors, "Access-Control-Allow-Methods":"POST", "Access-Control-Allow-Headers":"Content-Type",
        }});
        try {
          const raw = await request.text();
          if (raw.length > 6000) return json({error:"Invalid claim."}, 400, cors);
          const input = JSON.parse(raw);
          if (migration) {
            const legacy = new URL(input.url);
            if (legacy.origin !== url.origin || legacy.username || legacy.password || legacy.hash) return json({},404,cors);
            const sourcePath = await legacyPath(legacy, key);
            if (!sourcePath || revoked(env, await avatarId(key, sourcePath))) return json({},404,cors);
            return json({tokenImage:await tokenUrl(key,url.origin,sourcePath)},200,cors);
          }
          const {ticket, room, player, connection} = input;
          const claim = await unseal(key, ticket, "claim", now);
          if (!claim || claim.room !== room || claim.player !== player || claim.connection !== connection)
            return json({error:"This sign-in code is expired or belongs to a different connection."}, 403, cors);
          const identity = await decrypt(key, "profile-claim:v2", claim.payload, JSON.stringify([room, player, connection]));
          if (!identity || !avatarPath.test(identity.sourcePath)) return json({error:"Connect Discord again to get a new sign-in code."},403,cors);
          return json({
            profile:identity.profile, name:identity.name,
            tokenImage:await tokenUrl(key,url.origin,identity.sourcePath),
          }, 200, cors);
        } catch {
          return json({error:"Invalid claim."}, 400, cors);
        }
      }
      return json({error:"Not found."}, 404);
    },
  };
}

export default createWorker();
